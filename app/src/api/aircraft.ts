/* Medios aéreos: drones y helicópteros de la PNC (tarea 35).
   Por ahora solo se ven: se mueven en el mapa junto a las patrullas, con su rastro, pero no se despachan
   ni suman a la cobertura de los hexágonos (miran, no intervienen).
   SIMULADOS: la posición sale de una ruta fija en función de la hora, así que todos los clientes los ven
   en el mismo lugar y el rastro se puede reconstruir sin guardar historia. En producción, la posición
   llega por telemetría (WS /v1/stream, tema aircraft) y el rastro son sus últimos reportes.
   Idea tomada de God's Eye View: el ícono gira con el rumbo, se mueve suave entre reportes y deja
   detrás una estela que se desvanece. */
import { zones } from './seed';

export type AirType = 'Dron' | 'Helicóptero';
export interface AirAsset {
  id: string; type: AirType;
  /** Qué está haciendo, en palabras del operador. */
  mission: string;
  altM: number; speedKmh: number;
  /** Segundos de estela detrás. */
  trailS: number;
  path: { k: 'orbit'; lat: number; lon: number; radiusM: number; cw?: boolean } | { k: 'loop'; pts: [number, number][] };
  /** Transmisión de la cámara de a bordo. El Gobierno ya tiene acceso al video de drones y helicópteros
      (reunión del 25/11); hasta conectarlo no hay material real, así que es null y se muestra "Esperando enlace"
      (misma regla de evidencia que las cámaras, ver video.ts). En producción, WebRTC o HLS del servidor de video. */
  stream: { src: string; poster?: string } | null;
}
export interface AirFix { lat: number; lon: number; /** Grados desde el norte, en sentido horario. */ heading: number; altM: number }

const M_LAT = 111320;
const zone = (id: string) => zones.find((z) => z.id === id) ?? zones[0];
const z1 = zone('Z-01'), z6 = zone('Z-06');

export const AIRCRAFT: AirAsset[] = [
  { id: 'DRN-01', type: 'Dron', mission: `Sobrevuela ${z1.name}`, altM: 110, speedKmh: 36, trailS: 22,
    path: { k: 'orbit', lat: z1.lat, lon: z1.lon, radiusM: 160 }, stream: null },
  { id: 'DRN-02', type: 'Dron', mission: `Sobrevuela ${z6.name}`, altM: 90, speedKmh: 30, trailS: 22,
    path: { k: 'orbit', lat: z6.lat, lon: z6.lon, radiusM: 210, cw: true }, stream: null },
  // El helicóptero recorre el sector pasando por fuera de las zonas.
  { id: 'HEL-PNC-1', type: 'Helicóptero', mission: 'Patrullaje del sector', altM: 300, speedKmh: 120, trailS: 30,
    path: { k: 'loop', pts: ['Z-03', 'Z-04', 'Z-02', 'Z-06', 'Z-05'].map((id) => { const z = zone(id); return [z.lon, z.lat] as [number, number]; }) }, stream: null },
];

/* ---------- Ruta cerrada: curva suave (Catmull-Rom) por los puntos, medida en metros ---------- */
interface Loop { pts: [number, number][]; cum: number[]; len: number }
const loops = new Map<string, Loop>();
function loopOf(a: AirAsset & { path: { k: 'loop' } }): Loop {
  let L = loops.get(a.id); if (L) return L;
  const P = a.path.pts, n = P.length, out: [number, number][] = [];
  // Abre la ruta un poco hacia afuera del centro para que no pase justo encima de los rótulos de zona.
  const cx = P.reduce((s, p) => s + p[0], 0) / n, cy = P.reduce((s, p) => s + p[1], 0) / n;
  const Q = P.map(([x, y]) => [cx + (x - cx) * 1.35, cy + (y - cy) * 1.35] as [number, number]);
  for (let i = 0; i < n; i++) {
    const p0 = Q[(i - 1 + n) % n], p1 = Q[i], p2 = Q[(i + 1) % n], p3 = Q[(i + 2) % n];
    for (let s = 0; s < 40; s++) {
      const t = s / 40, t2 = t * t, t3 = t2 * t;
      const f = (a0: number, a1: number, a2: number, a3: number) => 0.5 * (2 * a1 + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(out[0]);
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + meters(out[i - 1], out[i]));
  L = { pts: out, cum, len: cum[cum.length - 1] }; loops.set(a.id, L); return L;
}
function meters(a: [number, number], b: [number, number]) {
  const kx = Math.cos((a[1] * Math.PI) / 180) * M_LAT;
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * M_LAT);
}
const bearingOf = (east: number, north: number) => ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;

/** Dónde está el medio aéreo a la hora `t` (ms). */
export function airAt(a: AirAsset, t: number): AirFix {
  const v = (a.speedKmh * 1000) / 3600; // m/s
  const s = (t / 1000) * v;
  if (a.path.k === 'orbit') {
    const { lat, lon, radiusM, cw } = a.path;
    const th = (cw ? -1 : 1) * (s / radiusM);
    const e = Math.cos(th) * radiusM, n = Math.sin(th) * radiusM;
    const kx = Math.cos((lat * Math.PI) / 180) * M_LAT;
    // Un leve vaivén de altura: el dron no queda clavado en un número.
    return { lat: lat + n / M_LAT, lon: lon + e / kx, heading: bearingOf(cw ? Math.sin(th) : -Math.sin(th), cw ? -Math.cos(th) : Math.cos(th)), altM: Math.round(a.altM + Math.sin(t / 7000) * 4) };
  }
  const L = loopOf(a as AirAsset & { path: { k: 'loop' } });
  const d = ((s % L.len) + L.len) % L.len;
  let lo = 0, hi = L.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.cum[m] <= d) lo = m; else hi = m; }
  const p = L.pts[lo], q = L.pts[hi], k = (d - L.cum[lo]) / Math.max(1e-6, L.cum[hi] - L.cum[lo]);
  const kx = Math.cos((p[1] * Math.PI) / 180) * M_LAT;
  return { lon: p[0] + (q[0] - p[0]) * k, lat: p[1] + (q[1] - p[1]) * k, heading: bearingOf((q[0] - p[0]) * kx, (q[1] - p[1]) * M_LAT), altM: a.altM };
}

/** Estela: dónde estuvo en los últimos `trailS` segundos, de la cola a la cabeza. */
export function airTrail(a: AirAsset, t: number, stepS = 1): [number, number][] {
  const out: [number, number][] = [];
  for (let s = a.trailS; s > 0; s -= stepS) { const f = airAt(a, t - s * 1000); out.push([f.lon, f.lat]); }
  const f = airAt(a, t); out.push([f.lon, f.lat]);
  return out;
}

/** Rumbo en palabras cortas (N, NE, E…), para la ficha. */
export function compass(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}
