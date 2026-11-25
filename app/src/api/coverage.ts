/* Cobertura y densidad con H3 (hexágonos de Uber, https://www.uber.com/us/en/blog/h3/).
   Todo el mapa se lee sobre la misma grilla: personas, cobertura y alertas caen en hexágonos de un
   solo tamaño (HEX_RES), que no cambia con el zoom. Así un hexágono es siempre la misma porción de
   calle y se pueden comparar entre sí, y la cobertura se calcula sobre las mismas celdas que se ven.
   Las zonas no se reemplazan: una alerta sigue siendo sobre "Plaza Salvador del Mundo".

   En producción esto lo calcula el backend (mismas celdas H3). Hoy usa los datos simulados. */
import { cellToBoundary, cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell, polygonToCells } from 'h3-js';
import type { Alert, Camera, LngLat, Unit, Zone, ZoneStatus } from './types';

export type HexMetric = 'patrullas' | 'personas' | 'alertas';
export type ZoneCoverage = 'cubierta' | 'cerca' | 'sin_cobertura';

/** Resolución H3 de todo el mapa, fija: res 10, ~65 m de lado (~1,5 ha), unos 115 m entre centros.
    Fina para ver una plaza y todavía legible con la ciudad entera en pantalla. */
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

/** Cantidad por hexágono para la métrica elegida. Personas: la estimación de cada zona repartida en sus celdas. */
export function hexCounts(metric: HexMetric, res: number, d: { units: Unit[] | null; alerts: Alert[]; zones: Zone[]; status: Record<string, ZoneStatus> }) {
  const m = new Map<string, number>();
  const put = (cell: string, n: number) => m.set(cell, (m.get(cell) ?? 0) + n);
  if (metric === 'patrullas') for (const u of d.units ?? []) { if (reporting(u)) put(latLngToCell(u.lat, u.lon, res), 1); }
  if (metric === 'alertas') for (const a of d.alerts) put(latLngToCell(a.lat, a.lon, res), 1);
  if (metric === 'personas') for (const z of d.zones) { const n = d.status[z.id]?.count; if (n == null) continue; const cs = cellsOf(z, res); for (const c of cs) put(c, n / cs.length); }
  return m;
}

/* ---------- Personas en todo el mapa ----------
   Un campo continuo, no un relleno por zona: cada medición se reparte alrededor de donde se tomó y
   se apaga con la distancia (campana). Donde se juntan varias se combinan sin pasar de 1
   (1 − Π(1 − aporte)), para que muchas cámaras de una misma calle no la vuelvan roja. Así la gente se ve como
   una mancha que se desvanece hacia los bordes, sobre la grilla de todo el mapa, sin límites de zona.
   · Zona medida: su ocupación (o densidad/5), repartida en un radio que crece con su superficie.
   · Cámara peatonal o mixta que funciona: la gente que ve en la calle. SIMULADO: las cámaras todavía
     no informan conteo; en producción lo manda el backend por celda H3.
   Donde ninguna cámara mide no hay hexágono: "sin datos" nunca se muestra como cero. */
const FIELD_MIN = 0.04;
const camSeed = (id: string) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h / 9973; };
export function peopleField(zones: Zone[], status: Record<string, ZoneStatus>, cameras: Camera[]): { cell: string; w: number }[] {
  const src: { lat: number; lon: number; a: number; sigma: number }[] = [];
  for (const z of zones) {
    const s = status[z.id]; if (!s || s.count == null) continue;
    const a = Math.max(0.05, Math.min(0.97, s.occupancy ?? (s.densityPerM2 ?? 0) / 5));
    src.push({ lat: z.lat, lon: z.lon, a, sigma: Math.max(220, Math.sqrt(z.areaM2) * 1.4) });
  }
  for (const c of cameras) {
    if (c.kind === 'vehicular' || c.status === 'caida' || c.status === 'fuera_de_preset') continue;
    src.push({ lat: c.lat, lon: c.lon, a: 0.05 + 0.15 * camSeed(c.id), sigma: 340 });
  }
  const empty = new Map<string, number>(); // Π(1 − aporte) por celda
  for (const s of src) {
    const k = Math.ceil((2.6 * s.sigma) / HEX_STEP_M);
    for (const cell of gridDisk(latLngToCell(s.lat, s.lon, HEX_RES), k)) {
      const [lat, lon] = cellToLatLng(cell); const d = meters([s.lon, s.lat], [lon, lat]);
      const g = s.a * Math.exp(-(d * d) / (2 * s.sigma * s.sigma));
      if (g > 0.005) empty.set(cell, (empty.get(cell) ?? 1) * (1 - g));
    }
  }
  return [...empty].map(([cell, e]) => ({ cell, w: 1 - e })).filter(({ w }) => w >= FIELD_MIN);
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
