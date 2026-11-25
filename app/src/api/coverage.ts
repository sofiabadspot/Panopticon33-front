/* Hexágonos H3 (Uber, https://www.uber.com/us/en/blog/h3/): la forma en que el mapa toma el dato.
   · El DATO vive en celdas de un solo tamaño (HEX_RES), que no cambia: eventos, cobertura de un punto,
     lo que se cuente por celda. Es la escala fija con la que se comparan los lugares entre sí.
   · Lo que se VE es un degradé: el mapa pinta hexágonos tan chicos que en pantalla miden pocos
     píxeles (displayRes, según el zoom), sin borde, y se leen como un mapa de calor. De cerca se nota
     la textura hexagonal.
   Una sola capa, con tres lecturas a elegir: personas, cobertura o alertas.

   En producción esto lo calcula el backend (mismas celdas H3). Hoy usa los datos simulados. */
import { cellToBoundary, cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell, polygonToCells } from 'h3-js';
import type { Alert, Camera, LngLat, Unit, Zone, ZoneStatus } from './types';

/** Qué muestran los hexágonos del mapa. */
export type HexMetric = 'personas' | 'cobertura' | 'alertas';
export type ZoneCoverage = 'cubierta' | 'cerca' | 'sin_cobertura';

/** Resolución H3 del dato, fija: res 10, ~65 m de lado (~1,5 ha), unos 115 m entre centros. */
export const HEX_RES = 10;
/** Distancia entre centros de hexágonos vecinos a HEX_RES (m), para pasar un radio a anillos. */
const HEX_STEP_M = 115;

/** Velocidad media de una unidad en calle (km/h) y factor calle/línea recta, para estimar la llegada. */
const SPEED = { Patrulla: 30, Motorizada: 35, 'A pie': 5 } as const;
const STREET = 1.35;
/** "Patrulla cerca": hay una unidad que llega en este tiempo o menos (min). */
export const NEAR_MIN = 4;

const reporting = (u: Unit) => u.status === 'disponible' || u.status === 'en_servicio';
function meters(a: LngLat, b: LngLat) {
  const k = Math.cos((a[1] * Math.PI) / 180) * 111320;
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 111320);
}
export const etaMin = (u: Unit, p: LngLat) => (meters([u.lon, u.lat], p) * STREET) / ((SPEED[u.type] * 1000) / 60);

/** Celdas de una zona a la resolución pedida (al menos la de su centro). */
const zoneCells = new Map<string, string[]>();
function cellsOf(z: Zone, res: number) {
  const k = z.id + ':' + res; let c = zoneCells.get(k);
  if (!c) { c = polygonToCells([z.ring.map(([lon, lat]) => [lat, lon])], res); if (!c.length) c = [latLngToCell(z.lat, z.lon, res)]; zoneCells.set(k, c); }
  return c;
}

/* ---------- Lo que se ve: hexágonos chicos en degradé ----------
   Rinde porque separa lo que casi no cambia de lo que sí:
   · la GRILLA (qué celdas, dónde están, su contorno) depende solo de lo que se ve y del zoom. Se arma
     con margen alrededor de la pantalla y se reusa mientras uno se mueve dentro de ese margen;
   · el VALOR de cada celda depende de los datos. Lo fijo (gente de fondo de la ciudad, cámaras) se
     calcula una vez por grilla; en cada actualización solo se suma lo que cambia (las zonas). */
/** Lado medio del hexágono por resolución H3 (m). */
const EDGE_M: Record<number, number> = { 7: 1220, 8: 461, 9: 174, 10: 66, 11: 25, 12: 9.4 };
/** Metros por píxel en San Salvador (latitud ~13,7°) a cada zoom. */
const mPerPx = (zoom: number) => 151900 / 2 ** zoom;
/** Celdas como mucho en la grilla (pantalla y margen): más y el mapa se pone lento. */
const MAX_CELLS = 9000;
/** Lado del hexágono en pantalla (px): chico para que se lea como degradé. */
const EDGE_PX = 5;
export interface Bounds { w: number; s: number; e: number; n: number }
const areaOf = (b: Bounds) => meters([b.w, b.s], [b.e, b.s]) * meters([b.w, b.s], [b.w, b.n]);
/** Resolución para dibujar: el hexágono mide unos EDGE_PX de lado en pantalla (de res 8 a 12),
    o menos fina si así la grilla tendría demasiadas celdas. */
export function displayRes(zoom: number, b: Bounds) {
  const want = EDGE_PX * mPerPx(zoom);
  let res = 8; for (let r = 8; r <= 12; r++) if (Math.abs(Math.log(EDGE_M[r] / want)) < Math.abs(Math.log(EDGE_M[res] / want))) res = r;
  while (res > 8 && areaOf(b) / (2.6 * EDGE_M[res] ** 2) > MAX_CELLS) res--;
  return res;
}
/** Lo que se ve, agrandado `pad` veces su tamaño hacia cada lado. */
export const padBounds = (b: Bounds, pad = 0.3): Bounds => { const dx = (b.e - b.w) * pad, dy = (b.n - b.s) * pad; return { w: b.w - dx, s: b.s - dy, e: b.e + dx, n: b.n + dy }; };
export const inside = (a: Bounds, b: Bounds) => a.w >= b.w && a.e <= b.e && a.s >= b.s && a.n <= b.n;

/** Grilla de celdas para dibujar: sus centros se calculan al armarla; el contorno, la primera vez
    que la celda se pinta (ringOf), porque muchas nunca se pintan. */
export interface HexGrid { res: number; b: Bounds; cells: string[]; lat: Float64Array; lon: Float64Array; rings: (LngLat[] | undefined)[];
  /** Aporte de lo fijo por celda, Π(1 − aporte), por firma de cámaras. */ base: Map<string, Float64Array> }
export function hexGrid(b: Bounds, res: number): HexGrid {
  const cells = polygonToCells([[[b.s, b.w], [b.s, b.e], [b.n, b.e], [b.n, b.w], [b.s, b.w]]], res);
  const lat = new Float64Array(cells.length), lon = new Float64Array(cells.length);
  cells.forEach((c, i) => { const [a, o] = cellToLatLng(c); lat[i] = a; lon[i] = o; });
  return { res, b, cells, lat, lon, rings: new Array(cells.length), base: new Map() };
}
export const ringOf = (g: HexGrid, i: number) => (g.rings[i] ??= hexRing(g.cells[i]));

/** Fuente de un campo: algo medido en un punto que se reparte alrededor y se apaga con la distancia. */
interface Source { lat: number; lon: number; a: number; sigma: number }
const camSeed = (id: string) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h / 9973; };
/** Gente de fondo en el área metropolitana de San Salvador. SIMULADO: manchas fijas (centros
    comerciales, mercados, avenidas) hasta que el backend mande personas por celda de toda la ciudad. */
const CITY: Source[] = (() => {
  let s = 20261125; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: 90 }, () => ({ lon: -89.31 + r() * 0.22, lat: 13.62 + r() * 0.16, a: 0.03 + 0.3 * r() ** 2.5, sigma: 300 + 800 * r() }));
})();
/** Cámara peatonal o mixta que funciona: la gente que ve en la calle. SIMULADO: las cámaras todavía
    no informan conteo. */
const camSources = (cameras: Camera[]): Source[] => cameras
  .filter((c) => c.kind !== 'vehicular' && c.status !== 'caida' && c.status !== 'fuera_de_preset')
  .map((c) => ({ lat: c.lat, lon: c.lon, a: 0.05 + 0.15 * camSeed(c.id), sigma: 340 }));
/** Zona medida: su ocupación (o densidad/5), en un radio que crece con su superficie. */
const zoneSources = (zones: Zone[], status: Record<string, ZoneStatus>): Source[] => zones.flatMap((z) => {
  const s = status[z.id]; if (!s || s.count == null) return [];
  return [{ lat: z.lat, lon: z.lon, a: Math.max(0.05, Math.min(0.97, s.occupancy ?? (s.densityPerM2 ?? 0) / 5)), sigma: Math.max(220, Math.sqrt(z.areaM2) * 1.4) }];
});
/** Alertas abiertas (sin descartar ni cerradas en Maic), pesadas por criticidad. */
const SEV_W = { critica: 0.9, media: 0.6, baja: 0.35 } as const;
const alertSources = (alerts: Alert[]): Source[] =>
  alerts.filter((a) => a.review !== 'descartada' && a.maic !== 'cerrada').map((a) => ({ lat: a.lat, lon: a.lon, a: SEV_W[a.severity], sigma: 280 }));

/** Multiplica en `empty` el Π(1 − aporte) de cada fuente, solo en las celdas que alcanza (3σ). */
function addSources(g: HexGrid, src: Source[], empty: Float64Array) {
  for (const s of src) {
    const dy = (3 * s.sigma) / 111320, dx = dy / Math.cos((s.lat * Math.PI) / 180);
    const kx = Math.cos((s.lat * Math.PI) / 180) * 111320, two = 2 * s.sigma * s.sigma;
    for (let i = 0; i < g.cells.length; i++) {
      const la = g.lat[i], lo = g.lon[i];
      if (lo < s.lon - dx || lo > s.lon + dx || la < s.lat - dy || la > s.lat + dy) continue;
      const mx = (lo - s.lon) * kx, my = (la - s.lat) * 111320;
      empty[i] *= 1 - s.a * Math.exp(-(mx * mx + my * my) / two);
    }
  }
}

export type HexData = { zones: Zone[]; status: Record<string, ZoneStatus>; cameras: Camera[]; units: Unit[] | null; alerts: Alert[] };
/** Firma de los datos que usa cada lectura: si no cambia, no hace falta recalcular aunque los
    objetos sean otros. Redondea lo que el ojo no distingue (personas a ~2 %, posiciones a ~10 m). */
export function hexSignature(metric: HexMetric, d: HexData): string {
  if (metric === 'personas') return d.zones.map((z) => { const s = d.status[z.id]; return `${z.id}:${s?.count == null ? '-' : Math.round((s.occupancy ?? (s.densityPerM2 ?? 0) / 5) * 50)}`; }).join(',') + '|' + camSig(d.cameras);
  if (metric === 'alertas') return d.alerts.map((a) => `${a.id}:${a.severity}:${a.review}:${a.maic ?? ''}`).join(',');
  return (d.units ?? []).filter(reporting).map((u) => `${u.id}:${u.lat.toFixed(4)}:${u.lon.toFixed(4)}`).join(',');
}
const camSig = (cameras: Camera[]) => cameras.map((c) => c.status[0]).join('');

/** Debajo de esto la celda no se dibuja: es el borde de la mancha. */
const FIELD_MIN = 0.02;
/** Valor de cada celda de la grilla para la lectura elegida; NaN = no se dibuja.
    · personas y alertas: 0 nada → 1 mucho (las fuentes se combinan sin pasar de 1: 1 − Π(1 − aporte),
      para que muchas mediciones juntas no vuelvan todo rojo);
    · cobertura: los minutos que tarda la unidad más cercana (el mapa los pinta en tres estados con
      FAST_MIN y NEAR_MIN). Sin unidades que reporten no hay hexágonos: "sin datos" nunca se muestra como cero. */
export function hexValues(metric: HexMetric, g: HexGrid, d: HexData): Float64Array {
  const n = g.cells.length, out = new Float64Array(n);
  if (metric === 'cobertura') {
    const us = (d.units ?? []).filter(reporting);
    if (!us.length) return out.fill(NaN);
    const pace = us.map((u) => ({ lat: u.lat, lon: u.lon, kx: Math.cos((u.lat * Math.PI) / 180) * 111320, mpm: ((SPEED[u.type] * 1000) / 60) / STREET }));
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const u of pace) { const t = Math.hypot((g.lon[i] - u.lon) * u.kx, (g.lat[i] - u.lat) * 111320) / u.mpm; if (t < best) best = t; }
      out[i] = best;
    }
    return out;
  }
  const empty = new Float64Array(n).fill(1);
  if (metric === 'personas') {
    const k = camSig(d.cameras); let base = g.base.get(k);
    if (!base) { base = new Float64Array(n).fill(1); addSources(g, CITY, base); addSources(g, camSources(d.cameras), base); g.base.clear(); g.base.set(k, base); }
    empty.set(base); addSources(g, zoneSources(d.zones, d.status), empty);
  } else addSources(g, alertSources(d.alerts), empty);
  for (let i = 0; i < n; i++) { const w = 1 - empty[i]; out[i] = w >= FIELD_MIN ? w : NaN; }
  return out;
}

/** Contorno de un área armada con hexágonos (un evento, una zona elegida): las celdas de sus zonas y un
    anillo alrededor, unidas en un solo borde. Coordenadas GeoJSON ([lon, lat]). */
export function areaOutline(zones: Zone[]): LngLat[][][] {
  const cells = new Set<string>();
  for (const z of zones) for (const c of cellsOf(z, HEX_RES)) for (const n of gridDisk(c, 1)) cells.add(n);
  return cells.size ? (cellsToMultiPolygon([...cells], true) as LngLat[][][]) : [];
}

/** Contorno de un hexágono para el mapa ([lon, lat], cerrado). */
export function hexRing(cell: string): LngLat[] { const b = cellToBoundary(cell).map(([lat, lon]) => [lon, lat] as LngLat); return [...b, b[0]]; }

/** Cobertura de una zona: cubierta (hay unidades adentro), patrulla cerca (llega en ≤ NEAR_MIN) o sin cobertura. */
export function zoneCoverage(z: Zone, units: Unit[] | null): { state: ZoneCoverage; inside: number; nearest: { unit: Unit; eta: number } | null } {
  const us = (units ?? []).filter(reporting);
  const inside = us.filter((u) => u.zoneId === z.id).length;
  const nearest = us.map((unit) => ({ unit, eta: etaMin(unit, [z.lon, z.lat]) })).sort((a, b) => a.eta - b.eta)[0] ?? null;
  const state: ZoneCoverage = inside > 0 ? 'cubierta' : nearest && nearest.eta <= NEAR_MIN ? 'cerca' : 'sin_cobertura';
  return { state, inside, nearest };
}

/** Cobertura alrededor de un punto: unidades dentro del radio, ordenadas por tiempo de llegada, y el estado. */
export function coverageAt(p: LngLat, radiusM: number, units: Unit[] | null) {
  const us = (units ?? []).filter(reporting).map((unit) => ({ unit, dist: meters([unit.lon, unit.lat], p), eta: etaMin(unit, p) }));
  const within = us.filter((x) => x.dist <= radiusM).sort((a, b) => a.eta - b.eta);
  const nearest = us.sort((a, b) => a.eta - b.eta)[0] ?? null;
  const state: ZoneCoverage = within.length ? 'cubierta' : nearest && nearest.eta <= NEAR_MIN ? 'cerca' : 'sin_cobertura';
  // Hexágonos que toca el radio, para dibujarlos
  const c = latLngToCell(p[1], p[0], HEX_RES); const k = Math.max(1, Math.round(radiusM / HEX_STEP_M));
  return { state, within, nearest, cells: gridDisk(c, k) };
}

/** Llega rápido: la unidad más cercana tarda esto o menos (min). */
export const FAST_MIN = 2;
