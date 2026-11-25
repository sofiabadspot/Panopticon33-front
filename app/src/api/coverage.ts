/* Hexágonos H3 (Uber, https://www.uber.com/us/en/blog/h3/): la forma en que el mapa toma el dato.
   · El DATO vive en celdas de un solo tamaño (HEX_RES), que no cambia: eventos, cobertura de un punto,
     lo que se cuente por celda. Es la escala fija con la que se comparan los lugares entre sí.
   · Lo que se VE es un degradé: el mapa pinta hexágonos tan chicos que en pantalla miden pocos
     píxeles (una grilla por franja de zoom, HEX_TIERS), sin borde, y se leen como un mapa de calor. De cerca se nota
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

/* ---------- Lo que se ve: hexágonos chicos en degradé ----------
   Para que el mapa no parpadee al moverlo, la geometría NO cambia nunca: hay tres grillas fijas,
   cada una para una franja de zoom, que se cargan una sola vez. Lo que cambia con los datos es solo
   el color de cada celda (feature-state en el mapa). Así, desplazar o hacer zoom no reprocesa nada.
   · res 9  (~175 m), zoom < 13: toda el área metropolitana;
   · res 10 (~65 m),  zoom 13–15,5: toda el área metropolitana;
   · res 11 (~25 m),  zoom ≥ 15,5: el sector y ~2,5 km alrededor (más fino en toda la ciudad serían
     cientos de miles de celdas). */
export interface Bounds { w: number; s: number; e: number; n: number }
export interface HexTier { res: number; minzoom: number; maxzoom: number; area: 'ciudad' | 'sector' }
export const HEX_TIERS: HexTier[] = [
  { res: 9, minzoom: 0, maxzoom: 13, area: 'ciudad' },
  { res: 10, minzoom: 13, maxzoom: 15.5, area: 'ciudad' },
  { res: 11, minzoom: 15.5, maxzoom: 24, area: 'sector' },
];
/** Área metropolitana de San Salvador (donde está la gente de fondo simulada). */
export const CITY_BOUNDS: Bounds = { w: -89.32, s: 13.61, e: -89.08, n: 13.79 };
/** El sector: sus zonas y `pad` grados alrededor (~2,5 km). */
export function sectorBounds(zones: Zone[], pad = 0.023): Bounds {
  const lons = zones.flatMap((z) => z.ring.map((q) => q[0])), lats = zones.flatMap((z) => z.ring.map((q) => q[1]));
  return { w: Math.min(...lons) - pad, s: Math.min(...lats) - pad, e: Math.max(...lons) + pad, n: Math.max(...lats) + pad };
}

/** Grilla de celdas con sus centros. */
export interface HexGrid { res: number; b: Bounds; cells: string[]; lat: Float64Array; lon: Float64Array;
  /** Aporte de lo fijo por celda, Π(1 − aporte), por firma de cámaras. */ base: Map<string, Float64Array> }
export function hexGrid(b: Bounds, res: number): HexGrid {
  const cells = polygonToCells([[[b.s, b.w], [b.s, b.e], [b.n, b.e], [b.n, b.w], [b.s, b.w]]], res);
  const lat = new Float64Array(cells.length), lon = new Float64Array(cells.length);
  cells.forEach((c, i) => { const [a, o] = cellToLatLng(c); lat[i] = a; lon[i] = o; });
  return { res, b, cells, lat, lon, base: new Map() };
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
/** Valor de cada celda de la grilla para la lectura elegida, ya redondeado a lo que el ojo distingue
    (así, entre una actualización y otra, solo cambian las celdas que cambian de color); -1 = no se dibuja.
    · personas y alertas: 0 nada → 1 mucho, en pasos de 1/40 (las fuentes se combinan sin pasar de 1:
      1 − Π(1 − aporte), para que muchas mediciones juntas no vuelvan todo rojo);
    · cobertura: el estado según la unidad más cercana: 0 llega en FAST_MIN o menos, 1 hasta NEAR_MIN,
      2 más. Sin unidades que reporten no hay hexágonos: "sin datos" nunca se muestra como cero. */
export function hexValues(metric: HexMetric, g: HexGrid, d: HexData): Float64Array {
  const n = g.cells.length, out = new Float64Array(n);
  if (metric === 'cobertura') {
    const us = (d.units ?? []).filter(reporting);
    if (!us.length) return out.fill(-1);
    const pace = us.map((u) => ({ lat: u.lat, lon: u.lon, kx: Math.cos((u.lat * Math.PI) / 180) * 111320, mpm: ((SPEED[u.type] * 1000) / 60) / STREET }));
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const u of pace) { const t = Math.hypot((g.lon[i] - u.lon) * u.kx, (g.lat[i] - u.lat) * 111320) / u.mpm; if (t < best) best = t; }
      out[i] = best <= FAST_MIN ? 0 : best <= NEAR_MIN ? 1 : 2;
    }
    return out;
  }
  const empty = new Float64Array(n).fill(1);
  if (metric === 'personas') {
    const k = camSig(d.cameras); let base = g.base.get(k);
    if (!base) { base = new Float64Array(n).fill(1); addSources(g, CITY, base); addSources(g, camSources(d.cameras), base); g.base.clear(); g.base.set(k, base); }
    empty.set(base); addSources(g, zoneSources(d.zones, d.status), empty);
  } else addSources(g, alertSources(d.alerts), empty);
  for (let i = 0; i < n; i++) { const w = 1 - empty[i]; out[i] = w >= FIELD_MIN ? Math.round(w * 40) / 40 : -1; }
  return out;
}

/* ---------- Áreas hechas de hexágonos (eventos, zona elegida) ----------
   Un evento se delimita eligiendo hexágonos: su área es la forma de esas celdas (HEX_RES). Mientras la
   consola no tenga la selección, las celdas salen de las zonas del evento. */
/** Celdas que cubren unas zonas: las que tienen el centro adentro y un anillo alrededor, para que el
    área no quede más chica que la zona. */
export function zoneHexes(zones: Zone[]): string[] {
  const cells = new Set<string>();
  for (const z of zones) {
    const inside = polygonToCells([z.ring.map(([lon, lat]) => [lat, lon])], HEX_RES);
    for (const c of inside.length ? inside : [latLngToCell(z.lat, z.lon, HEX_RES)]) for (const n of gridDisk(c, 1)) cells.add(n);
  }
  return [...cells];
}
/** Contorno de un conjunto de celdas, unidas en una sola figura. Coordenadas GeoJSON (MultiPolygon). */
export const hexesOutline = (cells: string[]): LngLat[][][] => (cells.length ? (cellsToMultiPolygon(cells, true) as LngLat[][][]) : []);

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
