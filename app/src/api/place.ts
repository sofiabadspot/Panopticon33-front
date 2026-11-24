/* Dónde está una alerta.
   Regla: una alerta pertenece a la zona en la que está su punto en el mapa, nunca a otra.
   · Aglomeración y brecha de presencia se miden sobre la zona: su punto va siempre adentro.
   · Placa y cámara sin video pasan donde está la cámara, que suele estar en una esquina
     alrededor de la zona. Si esa esquina queda afuera, la alerta no es "de la zona": se nombra
     por la calle y la zona se da solo como referencia ("a 108 m de Estadio Mágico González"). */
import type { Alert, LngLat, Zone } from './types';

export function insideRing(p: LngLat, ring: LngLat[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Zona que contiene el punto, si hay una. */
export const zoneAt = (p: LngLat, zones: Zone[]) => zones.find((z) => insideRing(p, z.ring)) ?? null;

function segMeters(p: LngLat, a: LngLat, b: LngLat) {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320;
  const P = [p[0] * k, p[1] * 111320], A = [a[0] * k, a[1] * 111320], B = [b[0] * k, b[1] * 111320];
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy);
}

/** Zona más cercana (por su borde) a menos de `maxM` metros, para dar referencia a un punto que está afuera. */
export function nearZone(p: LngLat, zones: Zone[], maxM = 300): { zone: Zone; m: number } | null {
  let best: { zone: Zone; m: number } | null = null;
  for (const z of zones) {
    const m = Math.min(...z.ring.slice(1).map((b, i) => segMeters(p, z.ring[i], b)));
    if (m <= maxM && (!best || m < best.m)) best = { zone: z, m };
  }
  return best;
}

/** Ajusta zona y punto de una alerta según la regla de arriba. */
export function placeAlert(a: Alert, zones: Zone[]): Alert {
  const p: LngLat = [a.lon, a.lat];
  if (a.kind === 'aglomeracion' || a.kind === 'brecha_presencia') {
    const z = zones.find((q) => q.id === a.zoneId);
    if (!z || insideRing(p, z.ring)) return a;
    // Se acerca al centro de la zona hasta quedar adentro
    for (const f of [0.5, 0.25, 0]) {
      const q: LngLat = [z.lon + (p[0] - z.lon) * f, z.lat + (p[1] - z.lat) * f];
      if (insideRing(q, z.ring) || f === 0) return { ...a, lon: q[0], lat: q[1] };
    }
    return a;
  }
  return { ...a, zoneId: zoneAt(p, zones)?.id ?? null };
}
