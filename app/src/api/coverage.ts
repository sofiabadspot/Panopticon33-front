/* Cobertura y densidad con H3 (hexágonos de Uber, https://www.uber.com/us/en/blog/h3/).
   Cada punto (unidad, alerta) cae en un hexágono; los hexágonos se agrupan en otros más grandes
   según el zoom, sin recalcular nada. Sirve para leer densidad y cobertura de un vistazo.
   Las zonas no se reemplazan: una alerta sigue siendo sobre "Plaza Salvador del Mundo".

   En producción esto lo calcula el backend (mismas celdas H3). Hoy usa los datos simulados. */
import { cellToBoundary, cellToLatLng, cellToParent, gridDisk, latLngToCell, polygonToCells } from 'h3-js';
import type { Alert, LngLat, Unit, Zone, ZoneStatus } from './types';

export type HexMetric = 'patrullas' | 'personas' | 'alertas';
export type ZoneCoverage = 'cubierta' | 'cerca' | 'sin_cobertura';

/** Resolución H3 según el zoom: res 9 (~175 m de lado, barrio) · res 8 (~460 m) · res 7 (~1,2 km, ciudad). */
export const resForZoom = (z: number) => (z >= 15 ? 9 : z >= 13 ? 8 : 7);
/** Personas: un nivel más fino, para que se distinga una zona de otra aun con el zoom alejado
    (res 10 ~65 m · res 9 ~175 m · res 8 ~460 m). */
export const peopleRes = (z: number) => Math.min(10, resForZoom(z) + 1);

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

/** Cantidad por hexágono para la métrica elegida. Personas: la estimación de cada zona repartida en sus celdas. */
export function hexCounts(metric: HexMetric, res: number, d: { units: Unit[] | null; alerts: Alert[]; zones: Zone[]; status: Record<string, ZoneStatus> }) {
  const m = new Map<string, number>();
  const put = (cell: string, n: number) => m.set(cell, (m.get(cell) ?? 0) + n);
  if (metric === 'patrullas') for (const u of d.units ?? []) { if (reporting(u)) put(latLngToCell(u.lat, u.lon, res), 1); }
  if (metric === 'alertas') for (const a of d.alerts) put(latLngToCell(a.lat, a.lon, res), 1);
  if (metric === 'personas') for (const z of d.zones) { const n = d.status[z.id]?.count; if (n == null) continue; const cs = cellsOf(z, res); for (const c of cs) put(c, n / cs.length); }
  return m;
}

/** Contorno de un hexágono para el mapa ([lon, lat], cerrado). */
export function hexRing(cell: string): LngLat[] { const b = cellToBoundary(cell).map(([lat, lon]) => [lon, lat] as LngLat); return [...b, b[0]]; }
export const parentOf = (cell: string, res: number) => cellToParent(cell, res);

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
  // Hexágonos (res 9) que toca el radio, para dibujarlos
  const c = latLngToCell(p[1], p[0], 9); const k = Math.max(1, Math.round(radiusM / 300));
  return { state, within, nearest, cells: gridDisk(c, k) };
}

/** Llega rápido: la unidad más cercana tarda esto o menos (min). */
export const FAST_MIN = 2;

/** Celdas del sector (las zonas y ~1,5 km alrededor), por resolución. */
const sectorCells = new Map<string, string[]>();
function cellsOfSector(zones: Zone[], res: number) {
  const k = zones.map((z) => z.id).join(',') + ':' + res; let c = sectorCells.get(k);
  if (!c) {
    const lons = zones.flatMap((z) => z.ring.map((p) => p[0])), lats = zones.flatMap((z) => z.ring.map((p) => p[1]));
    const pad = 0.014;
    const w = Math.min(...lons) - pad, e = Math.max(...lons) + pad, s = Math.min(...lats) - pad, n = Math.max(...lats) + pad;
    c = polygonToCells([[[s, w], [s, e], [n, e], [n, w], [s, w]]], res);
    sectorCells.set(k, c);
  }
  return c;
}

/** Cobertura del sector en hexágonos: cada celda según cuánto tarda en llegar la unidad más cercana.
    cubierta ≤ FAST_MIN · cerca ≤ NEAR_MIN · sin_cobertura más. */
export function coverageHexes(zones: Zone[], res: number, units: Unit[] | null): { cell: string; state: ZoneCoverage; eta: number | null }[] {
  if (!zones.length) return [];
  const us = (units ?? []).filter(reporting);
  return cellsOfSector(zones, res).map((cell) => {
    const [lat, lon] = cellToLatLng(cell);
    const eta = us.length ? Math.min(...us.map((u) => etaMin(u, [lon, lat]))) : null;
    const state: ZoneCoverage = eta == null ? 'sin_cobertura' : eta <= FAST_MIN ? 'cubierta' : eta <= NEAR_MIN ? 'cerca' : 'sin_cobertura';
    return { cell, state, eta };
  });
}
