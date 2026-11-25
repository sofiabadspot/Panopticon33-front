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

/* ---------- Lo que se ve: hexágonos chicos en degradé ---------- */
/** Lado medio del hexágono por resolución H3 (m). */
const EDGE_M: Record<number, number> = { 7: 1220, 8: 461, 9: 174, 10: 66, 11: 25, 12: 9.4 };
/** Metros por píxel en San Salvador (latitud ~13,7°) a cada zoom. */
const mPerPx = (zoom: number) => 151900 / 2 ** zoom;
/** Celdas como mucho en pantalla: más que esto y el mapa se pone lento; se pasa a una resolución mayor. */
const MAX_CELLS = 14000;
export interface Bounds { w: number; s: number; e: number; n: number }
/** Resolución para dibujar: el hexágono mide unos 4 px de lado en pantalla (de res 8 a 12),
    o menos fina si así entrarían demasiadas celdas en lo que se ve. */
export function displayRes(zoom: number, b: Bounds) {
  const want = 4 * mPerPx(zoom);
  let res = 8; for (let r = 8; r <= 12; r++) if (Math.abs(Math.log(EDGE_M[r] / want)) < Math.abs(Math.log(EDGE_M[res] / want))) res = r;
  const area = meters([b.w, b.s], [b.e, b.s]) * meters([b.w, b.s], [b.w, b.n]);
  while (res > 8 && area / (2.6 * EDGE_M[res] ** 2) > MAX_CELLS) res--;
  return res;
}

/** Fuente de un campo: algo medido en un punto que se reparte alrededor y se apaga con la distancia. */
interface Source { lat: number; lon: number; a: number; sigma: number }
const camSeed = (id: string) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h / 9973; };
/** Gente de fondo en el área metropolitana de San Salvador. SIMULADO: manchas fijas (centros
    comerciales, mercados, avenidas) hasta que el backend mande personas por celda de toda la ciudad. */
const CITY: Source[] = (() => {
  let s = 20261125; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: 90 }, () => ({ lon: -89.31 + r() * 0.22, lat: 13.62 + r() * 0.16, a: 0.03 + 0.3 * r() ** 2.5, sigma: 300 + 800 * r() }));
})();

/** Personas. Cada medición se reparte alrededor de donde se tomó:
    · zona medida: su ocupación (o densidad/5), en un radio que crece con su superficie;
    · cámara peatonal o mixta que funciona: la gente que ve en la calle (SIMULADO: las cámaras todavía
      no informan conteo);
    · el resto de la ciudad: CITY. */
function peopleSources(zones: Zone[], status: Record<string, ZoneStatus>, cameras: Camera[]): Source[] {
  const src: Source[] = [...CITY];
  for (const z of zones) {
    const s = status[z.id]; if (!s || s.count == null) continue;
    src.push({ lat: z.lat, lon: z.lon, a: Math.max(0.05, Math.min(0.97, s.occupancy ?? (s.densityPerM2 ?? 0) / 5)), sigma: Math.max(220, Math.sqrt(z.areaM2) * 1.4) });
  }
  for (const c of cameras) {
    if (c.kind === 'vehicular' || c.status === 'caida' || c.status === 'fuera_de_preset') continue;
    src.push({ lat: c.lat, lon: c.lon, a: 0.05 + 0.15 * camSeed(c.id), sigma: 340 });
  }
  return src;
}
/** Alertas abiertas (sin descartar ni cerradas en Maic), pesadas por criticidad. */
const SEV_W = { critica: 0.9, media: 0.6, baja: 0.35 } as const;
function alertSources(alerts: Alert[]): Source[] {
  return alerts.filter((a) => a.review !== 'descartada' && a.maic !== 'cerrada').map((a) => ({ lat: a.lat, lon: a.lon, a: SEV_W[a.severity], sigma: 280 }));
}

/** Debajo de esto la celda no se dibuja: es el borde de la mancha. */
const FIELD_MIN = 0.02;
/** Valor de cada celda (0–1). Las fuentes se combinan sin pasar de 1 (1 − Π(1 − aporte)), para que
    muchas mediciones juntas no vuelvan todo rojo. */
function evalField(cells: string[], src: Source[]) {
  const box = src.map((s) => { const dy = (3 * s.sigma) / 111320, dx = dy / Math.cos((s.lat * Math.PI) / 180); return { s, w: s.lon - dx, e: s.lon + dx, so: s.lat - dy, n: s.lat + dy }; });
  const out: { cell: string; w: number }[] = [];
  for (const cell of cells) {
    const [lat, lon] = cellToLatLng(cell); let empty = 1;
    for (const b of box) {
      if (lon < b.w || lon > b.e || lat < b.so || lat > b.n) continue;
      const d = meters([b.s.lon, b.s.lat], [lon, lat]);
      empty *= 1 - b.s.a * Math.exp(-(d * d) / (2 * b.s.sigma * b.s.sigma));
    }
    if (1 - empty >= FIELD_MIN) out.push({ cell, w: 1 - empty });
  }
  return out;
}

/** Celdas a dibujar en lo que se ve, con su valor (0–1) para la lectura elegida.
    · personas y alertas: 0 nada → 1 mucho; sin hexágono donde no hay.
    · cobertura: los minutos que tarda la unidad más cercana (el mapa los pinta en tres estados con
      FAST_MIN y NEAR_MIN). Sin unidades que reporten no hay hexágonos: "sin datos" nunca se muestra como cero. */
export function hexField(metric: HexMetric, b: Bounds, res: number, d: { zones: Zone[]; status: Record<string, ZoneStatus>; cameras: Camera[]; units: Unit[] | null; alerts: Alert[] }) {
  const cells = polygonToCells([[[b.s, b.w], [b.s, b.e], [b.n, b.e], [b.n, b.w], [b.s, b.w]]], res);
  if (metric === 'personas') return evalField(cells, peopleSources(d.zones, d.status, d.cameras));
  if (metric === 'alertas') return evalField(cells, alertSources(d.alerts));
  const us = (d.units ?? []).filter(reporting);
  if (!us.length) return [];
  return cells.map((cell) => { const [lat, lon] = cellToLatLng(cell); return { cell, w: Math.min(...us.map((u) => etaMin(u, [lon, lat]))) }; });
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
