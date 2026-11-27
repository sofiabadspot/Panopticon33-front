/* Datos simulados con la forma del contrato. Geometría real (OpenStreetMap) del sector
   Salvador del Mundo, tomada del prototipo (MockDB) por scripts/sync-assets.mjs.
   Todo lo demás (conteos, alertas, placas, unidades, usuarios) es simulado. */
import seedJson from '../data/generated/seed.json';
import type {
  Alert, AuditEntry, Camera, LayerAccess, LayerKey, LngLat, MassEvent, PlateRead, RoleConfig, Rule, Territory, Unit, UnitType, User, WatchList, Zone,
} from './types';

interface SeedZone { id: string; name: string; lat: number; lon: number; areaM2: number; capacity: number; est: number; officers: number; growth: number; cameras: string[]; history: number[]; ring: LngLat[] }
interface SeedCam { id: string; street: string; lat: number; lon: number; heading: number; status: string; fps: number; zoneId: string | null; compute: string }
interface SeedUnit { id: string; type: UnitType; lat: number; lon: number }
type Watch = Record<string, { reason: string; since: string; vehicle: { type: string; color: string; make: string }; case: string }>;
const S = seedJson as unknown as { zones: SeedZone[]; cameras: SeedCam[]; units: SeedUnit[]; plateWatch: Watch; origin: { lat: number; lon: number } };

/** PRNG determinista: la demo se ve igual cada vez. */
export function prng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r = prng(33);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
const MIN = 60_000;
const NOW = Date.now();

export const ORIGIN = S.origin;

/* ---------- Zonas: capacidad de referencia = 4 personas/m² (supuesto hasta que el Ministerio la fije) ---------- */
/** Base de personas por zona en el escenario de la demo (evento de diciembre en la plaza). */
const BASE: Record<string, number> = { 'Z-01': 78000, 'Z-02': 31000, 'Z-03': 19500, 'Z-04': 17200, 'Z-05': 470, 'Z-06': 900 };
/** Territorio de cada zona (demo): el estadio y la Masferrer quedan fuera del centro, para que el filtro del 911 se note. */
/** Por ahora hay un solo territorio: San Salvador. */
const TERRITORY: Record<string, string> = {};
/** Zona vigilada que todavía no tiene cámaras, lejos del sector: no se mide, y el mapa la marca con un
    contorno gris punteado y sin mapa de calor adentro. El contorno es un polígono simple alrededor del centro. */
function zoneWithoutCameras(id: string, name: string, lon: number, lat: number, radiusM: number): Zone {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ring: LngLat[] = Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * 2 * Math.PI, f = i % 2 ? 0.82 : 1; return [lon + (Math.cos(a) * radiusM * f) / kx, lat + (Math.sin(a) * radiusM * f) / 111320] as LngLat; });
  const areaM2 = Math.round(Math.PI * radiusM * radiusM * 0.85);
  return { id, name, lat, lon, areaM2, ring, cameras: [], capacity: Math.round((areaM2 * 4) / 100) * 100, territory: TERRITORY[id] ?? 'San Salvador' };
}
export const zones: Zone[] = [
  ...S.zones.map((z) => ({
    id: z.id, name: z.name, lat: z.lat, lon: z.lon, areaM2: z.areaM2, ring: z.ring, cameras: z.cameras,
    capacity: Math.round((z.areaM2 * 4) / 100) * 100, territory: TERRITORY[z.id] ?? 'San Salvador',
  })),
  zoneWithoutCameras('Z-07', 'Mercado Central', -89.1945, 13.6985, 90),
  zoneWithoutCameras('Z-08', 'Plaza Masferrer', -89.2405, 13.7085, 70),
];
export const zoneBase = BASE;

/* ---------- Cámaras ---------- */
const STATUS: Record<string, Camera['status']> = { online: 'operativa', degraded: 'degradada', offline: 'caida' };
export const cameras: Camera[] = S.cameras.map((c, i) => {
  const ptz = i % 6 === 3;
  return {
    id: c.id, street: c.street, lat: c.lat, lon: c.lon, heading: c.heading, zoneId: c.zoneId, compute: c.compute, fps: c.fps,
    status: STATUS[c.status] ?? 'operativa',
    kind: i % 3 === 0 ? 'vehicular' : i % 3 === 1 ? 'mixta' : 'peatonal',
    ptz, presets: ptz ? ['P1 · Calzada', 'P2 · Acera norte', 'P3 · Panorámica'] : ['Fijo'],
    lastFrameAt: c.status === 'offline' ? NOW - 23 * MIN : NOW,
  };
});
// Redondel Olímpico: su cámara es PTZ (se puede mover entre presets). Se mide normalmente; el ejemplo de
// zona sin medición son las zonas sin cámaras, lejos del sector (Z-07 y Z-08).
for (const id of S.zones.find((z) => z.id === 'Z-05')?.cameras ?? []) {
  const cam = cameras.find((c) => c.id === id);
  if (cam) { cam.ptz = true; cam.presets = ['P1 · Redondel', 'P2 · Acceso sur']; }
}

/* ---------- Unidades: las de cada zona se reparten dentro de su perímetro ---------- */
function insideRing(ring: LngLat[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function sampleIn(ring: LngLat[]): LngLat {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let k = 0; k < 60; k++) { const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0); if (insideRing(ring, x, y)) return [x, y]; }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
export const AGENTS: Record<UnitType, number> = { Patrulla: 2, Motorizada: 1, 'A pie': 2 };
const TYPES: UnitType[] = ['Patrulla', 'A pie', 'Motorizada', 'A pie'];
export const units: Unit[] = [];
let seq = 210;
for (const z of S.zones) {
  const n = Math.max(1, Math.round(z.officers / 1.8));
  for (let i = 0; i < n; i++) {
    const [lon, lat] = sampleIn(z.ring);
    units.push({ id: 'PNC-' + seq, type: TYPES[(seq + i) % 4], status: 'en_servicio', lon, lat, lastReportAt: NOW - Math.floor(r() * 3) * MIN, zoneId: z.id });
    seq += 7;
  }
}
for (const u of S.units.slice(0, 16)) {
  units.push({ id: 'PNC-' + seq, type: u.type, status: 'disponible', lon: u.lon, lat: u.lat, lastReportAt: NOW - Math.floor(r() * 4) * MIN, zoneId: null });
  seq += 7;
}
// Placa del vehículo, simulada (MAIC la entrega en producción)
units.forEach((u, i) => { u.plate = u.type === 'A pie' ? null : `N ${String(4120 + i * 37).padStart(4, '0')}`; });
// Tareas de algunas unidades libres (sin zona): las asigna su jefatura, no la consola. Simuladas hasta conectar MAIC.
const TASKS = ['Control vehicular · Alameda Roosevelt', 'Custodia de traslado · Fiscalía', 'Patrullaje preventivo · Col. Escalón'];
units.filter((u) => !u.zoneId).slice(1, 1 + TASKS.length * 2).forEach((u, i) => { if (i % 2 === 0) { u.task = { label: TASKS[i / 2], since: NOW - (20 + i * 9) * MIN }; u.status = 'en_servicio'; } });
units[3].status = 'sin_reporte'; units[3].lastReportAt = NOW - 14 * MIN; // atenuada, no cuenta en el índice
units[units.length - 1].status = 'desconocida'; units[units.length - 1].id = 'Sin identificador';

/* ---------- Listas ---------- */
export const plateWatch = S.plateWatch;
export const lists: WatchList[] = [
  { id: 'L-ROB', name: 'Vehículos con reporte de robo', kind: 'vehiculos', origin: 'Base nacional de vehículos', mode: 'Copia periódica', entries: 41238, lastSyncAt: NOW - 12 * MIN, maxAgeMin: 60 },
  { id: 'L-LB', name: 'Personas buscadas', kind: 'personas', origin: 'Lista de la PNC', mode: 'API', entries: 3874, lastSyncAt: NOW - 4 * MIN, maxAgeMin: 30 },
  { id: 'L-LI', name: 'En investigación', kind: 'personas', origin: 'Fiscalía General', mode: 'Copia periódica', entries: 612, lastSyncAt: NOW - 40 * MIN, maxAgeMin: 1440 },
  { id: 'L-LD', name: 'Personas desaparecidas', kind: 'personas', origin: 'Carga del Ministerio', mode: 'Carga manual', entries: 158, lastSyncAt: NOW - 3 * 24 * 60 * MIN, maxAgeMin: 7 * 24 * 60 },
];

/* ---------- Reglas (umbrales: supuestos hasta que el Ministerio los fije) ---------- */
export const rules: Rule[] = [
  { id: 'R-AGL-DENS', severity: 'critica', kind: 'aglomeracion', name: 'Densidad alta', scope: 'Todas las zonas', threshold: 4, unit: 'personas/m²', persistenceMin: 3, enabled: true, source: 'supuesto', overrides: [] },
  { id: 'R-AGL-OCUP', severity: 'media', kind: 'aglomeracion', name: 'Ocupación sobre capacidad', scope: 'Todas las zonas', threshold: 75, unit: '% de capacidad', persistenceMin: 3, enabled: true, source: 'supuesto', overrides: [] },
  { id: 'R-BRECHA', severity: 'critica', kind: 'brecha_presencia', name: 'Personas por policía', scope: 'Todas las zonas', threshold: 2500, unit: 'personas por policía', persistenceMin: 5, enabled: true, source: 'supuesto', overrides: [{ target: 'zona', targetId: 'Z-06', threshold: 1800, persistenceMin: 5 }] },
  { id: 'R-PLACA', severity: 'media', kind: 'placa_en_lista', name: 'Placa en lista de robados', scope: 'Cámaras vehiculares y mixtas', threshold: 85, unit: '% de confianza mínima', persistenceMin: 0, enabled: true, source: 'supuesto', overrides: [] },
  { id: 'R-FACIAL', severity: 'critica', kind: 'persona_en_lista', name: 'Coincidencia facial', scope: 'Puntos de control', threshold: 90, unit: '% de confianza mínima', persistenceMin: 0, enabled: true, source: 'supuesto', overrides: [] },
  { id: 'R-CAM', severity: 'baja', kind: 'camara_caida', name: 'Cámara sin cuadros', scope: 'Todas las cámaras', threshold: 2, unit: 'minutos sin video', persistenceMin: 0, enabled: true, source: 'supuesto', overrides: [] },
];
/** Una unidad "está en la zona" dentro de este radio y tiempo (supuesto inicial del documento). */
export const presence = { radiusM: 200, windowMin: 5 };

/* ---------- Eventos masivos ---------- */
// El evento de la Plaza empezó a la hora en punto de hace 3 h y dura 8 h: al abrir la consola está en curso.
const today = new Date(NOW - 3 * 60 * MIN); today.setMinutes(0, 0, 0);
export const events: MassEvent[] = [
  { id: 'EV-1207', name: 'Festividades de diciembre · Plaza Salvador del Mundo', venue: 'Plaza Salvador del Mundo y alrededores', zoneIds: ['Z-01', 'Z-02', 'Z-04'],
    start: today.getTime(), end: today.getTime() + 8 * 60 * MIN, expected: 90000, plannedOfficers: 120, capacity: 110000,
    thresholds: { occupancyPct: 110, perOfficer: 2000, persistenceMin: 3 }, createdBy: 'Marta Rivas' },
  { id: 'EV-1211', name: 'Clásico de fútbol · Estadio Mágico González', venue: 'Estadio Mágico González', zoneIds: ['Z-06'],
    start: NOW + 7 * 24 * 60 * MIN, end: NOW + 7 * 24 * 60 * MIN + 4 * 60 * MIN, expected: 32000, plannedOfficers: 60, capacity: null, thresholds: null, createdBy: 'Marta Rivas' },
  { id: 'EV-1189', name: 'Concierto · Paseo General Escalón', venue: 'Paseo General Escalón', zoneIds: ['Z-03'],
    start: NOW - 5 * 24 * 60 * MIN, end: NOW - 5 * 24 * 60 * MIN + 5 * 60 * MIN, expected: 25000, plannedOfficers: 45, capacity: null, thresholds: null, createdBy: 'Marta Rivas' },
];

/* ---------- Usuarios (roles de Keycloak) ---------- */
export const users: User[] = [
  { id: 'U-01', name: 'Roberto Martínez', role: 'command', territory: 'Nacional', active: true },
  { id: 'U-02', name: 'Cmdte. Ernesto Alfaro', role: 'command', territory: 'San Salvador', active: true },
  { id: 'U-03', name: 'Karla Méndez', role: 'operator_911', territory: 'San Salvador', active: true },
  { id: 'U-04', name: 'José Portillo', role: 'operator_911', territory: 'San Salvador', active: true },
  { id: 'U-05', name: 'Lucía Hernández', role: 'analyst', territory: 'Nacional', active: true },
  { id: 'U-06', name: 'Marta Rivas', role: 'admin', territory: 'Nacional', active: true },
  { id: 'U-08', name: 'Daniel Ayala', role: 'operator_911', territory: 'San Salvador', active: false },
];

/** Territorios a los que se puede limitar un usuario. */
export const territories: Territory[] = [{ name: 'San Salvador', note: 'Área metropolitana de San Salvador' }];

/* ---------- Roles: capas y alcance de alertas (supuestos, a validar con el cliente) ----------
   Mando ve todo. Operador 911: sin mapa de calor al entrar, solo unidades, alertas y eventos, y solo
   las alertas de su territorio. No todos ven la ubicación de cada agente. */
const L = (o: Partial<Record<LayerKey, LayerAccess>>): Record<LayerKey, LayerAccess> =>
  ({ zones: 'disponible', events: 'disponible', alerts: 'disponible', units: 'disponible', cameras: 'disponible', hex: 'disponible', drones: 'disponible', helis: 'disponible', ...o });
const base = { system: true, version: 1 } as const;
export const roleConfigs: RoleConfig[] = [
  { ...base, role: 'command', name: 'Mando', description: 'Mando y ministro', tabs: ['estado', 'alertas'], alertScope: 'todas', minSeverity: null,
    actions: ['despachar', 'registrar'], jules: true, config: false,
    layers: L({ zones: 'inicio', events: 'inicio', alerts: 'inicio', units: 'inicio', hex: 'inicio', drones: 'inicio', helis: 'inicio' }) },
  // Operador 911 y Analista sin Jules (27-nov): el lateral derecho queda para la ficha.
  { ...base, role: 'operator_911', name: 'Operador 911', description: 'Decide las alertas', tabs: ['alertas', 'verificacion', 'estado'], alertScope: 'territorio', minSeverity: null,
    actions: ['decidir', 'decidir_facial', 'despachar', 'registrar'], jules: false, config: false,
    layers: L({ events: 'inicio', alerts: 'inicio', units: 'inicio' }) },
  { ...base, role: 'analyst', name: 'Analista', description: 'Investiga', tabs: ['investigar', 'estado'], alertScope: 'todas', minSeverity: null,
    actions: [], jules: false, config: false,
    layers: L({ zones: 'inicio', events: 'inicio', alerts: 'inicio', cameras: 'inicio', hex: 'inicio' }) },
  { ...base, role: 'admin', name: 'Administrador', description: 'Configura', tabs: [], alertScope: 'todas', minSeverity: null,
    actions: [], jules: true, config: true,
    layers: L({ zones: 'inicio', events: 'inicio', cameras: 'inicio', units: 'oculta' }) },
];

/* ---------- Lecturas de placas (7 días) ---------- */
const plateCams = cameras.filter((c) => c.kind !== 'peatonal' && c.status !== 'caida');
const randPlate = () => {
  const pre = r() < 0.82 ? 'P' : pick(['C', 'M', 'A', 'N']);
  return `${pre} ${100 + Math.floor(r() * 900)}-${String(Math.floor(r() * 1000)).padStart(3, '0')}`;
};
export const reads: PlateRead[] = [];
let rid = 880000;
const addRead = (plate: string, at: number, cam: Camera, confidence: number, listed: boolean) => {
  reads.push({ id: 'P-' + rid++, plate, at, cameraId: cam.id, street: cam.street, lat: cam.lat, lon: cam.lon, confidence, normalized: !plate.includes('?'), listed,
    evidence: { type: 'pendiente', caption: 'Foto de la lectura' } });
};
for (let i = 0; i < 520; i++) addRead(randPlate(), NOW - Math.floor(r() * 7 * 24 * 60) * MIN, pick(plateCams), 0.62 + r() * 0.37, false);
// Recorridos de los vehículos en lista: pasan por cámaras vecinas, en orden.
Object.keys(plateWatch).forEach((plate, k) => {
  let cam = plateCams[(k * 7 + 3) % plateCams.length];
  const used = new Set<string>();
  // Entre lectura y lectura pasan de 5 a 11 min; la última, como mucho 2 min antes de ahora (nunca en el futuro).
  const gaps = Array.from({ length: 6 }, (_, i) => (i ? 5 + Math.floor(r() * 7) : 0));
  const span = gaps.reduce((s, g) => s + g, 0);
  let at = NOW - Math.max(k === 0 ? 50 : 180 + k * 400, span + 2) * MIN;
  for (let i = 0; i < 6; i++) {
    used.add(cam.id);
    at += gaps[i] * MIN;
    addRead(plate, at, cam, 0.9 + r() * 0.09, true);
    const next = plateCams.filter((c) => !used.has(c.id)).sort((a, b) => Math.hypot(a.lat - cam.lat, a.lon - cam.lon) - Math.hypot(b.lat - cam.lat, b.lon - cam.lon))[1];
    if (!next) break;
    cam = next;
  }
});
// Vehículo que viaja junto al primero de la lista: pasa por 4 de sus 6 cámaras con segundos de diferencia.
{
  const lead = reads.filter((x) => x.plate === Object.keys(plateWatch)[0]).sort((a, b) => a.at - b.at);
  [0, 1, 3, 4].forEach((i, k) => { const x = lead[i]; const cam = plateCams.find((c) => c.id === x?.cameraId); if (x && cam) addRead('P 330-121', x.at + (25 + k * 9) * 1000, cam, 0.93, false); });
}
addRead('P 5I2-884', NOW - 300 * MIN, plateCams[4], 0.58, false); // lectura de baja confianza: sin alerta, se puede buscar
addRead('?? 4?1-2', NOW - 41 * MIN, plateCams[9], 0.41, false); // ilegible: se guarda tal como la leyó el modelo
reads.sort((a, b) => b.at - a.at);

/* ---------- Alertas ---------- */
const z = (id: string) => zones.find((q) => q.id === id)!;
const cam = (id: string) => cameras.find((c) => c.id === id)!;
const pending = (caption: string) => ({ type: 'pendiente' as const, caption });
const stolen = Object.keys(plateWatch);
const lastStolenRead = reads.find((x) => x.plate === stolen[0])!;
const secondStolenRead = reads.find((x) => x.plate === stolen[1])!;
const offline = cameras.find((c) => c.status === 'caida')!;
// Mismo cálculo que la ficha de zona: agentes de las unidades en servicio dentro de la zona.
const plazaOfficers = units.filter((u) => u.zoneId === 'Z-01' && u.status === 'en_servicio').reduce((n, u) => n + AGENTS[u.type], 0);
const plazaPerOfficer = new Intl.NumberFormat('es-SV').format(Math.round(BASE['Z-01'] / Math.max(1, plazaOfficers)));

export const alerts: Alert[] = [
  {
    id: 'AL-4107', kind: 'placa_en_lista', severity: 'critica', createdAt: lastStolenRead.at, updatedAt: lastStolenRead.at,
    zoneId: cam(lastStolenRead.cameraId).zoneId, cameraId: lastStolenRead.cameraId, lat: lastStolenRead.lat, lon: lastStolenRead.lon,
    rule: { id: 'R-PLACA', name: 'Placa en lista de robados', threshold: 'Confianza ≥ 85 %', measured: `Confianza ${Math.round(lastStolenRead.confidence * 100)} %`, persistence: 'Inmediata' },
    observations: 1, evidence: pending('Recorte de placa y foto del vehículo'),
    plate: { read: stolen[0], listed: stolen[0], confidence: lastStolenRead.confidence, reason: plateWatch[stolen[0]].reason, caseId: plateWatch[stolen[0]].case, since: plateWatch[stolen[0]].since, vehicle: plateWatch[stolen[0]].vehicle, direction: 'Hacia el poniente' },
    review: 'por_revisar', dispatch: null, timeline: [{ at: lastStolenRead.at, label: 'Alerta creada por la regla "Placa en lista de robados"' }],
  },
  {
    id: 'AL-4106', kind: 'aglomeracion', severity: 'critica', createdAt: NOW - 6 * MIN, updatedAt: NOW - 20_000,
    zoneId: 'Z-01', cameraId: z('Z-01').cameras[0], lat: z('Z-01').lat, lon: z('Z-01').lon, eventId: 'EV-1207',
    rule: { id: 'R-AGL-DENS', name: 'Densidad alta', threshold: '> 4 personas/m² durante 3 min', measured: '5.2 personas/m² durante 6 min', persistence: '3 min' },
    observations: 72, evidence: pending('Cuadro de la cámara que respalda la medición'),
    review: 'por_revisar', dispatch: null, timeline: [{ at: NOW - 6 * MIN, label: 'Alerta creada por la regla "Densidad alta"' }, { at: NOW - 20_000, label: '71 mediciones más de la misma zona y regla, sumadas a esta alerta' }],
  },
  {
    id: 'AL-4105', kind: 'brecha_presencia', severity: 'critica', createdAt: NOW - 9 * MIN, updatedAt: NOW - 60_000,
    zoneId: 'Z-01', cameraId: z('Z-01').cameras[0], lat: z('Z-01').lat + 0.0006, lon: z('Z-01').lon - 0.0006, eventId: 'EV-1207',
    rule: { id: 'R-BRECHA', name: 'Personas por policía', threshold: '> 2,000 personas por policía durante 3 min (umbral del evento)', measured: `${plazaPerOfficer} personas por policía durante 9 min`, persistence: '3 min' },
    observations: 18, evidence: pending('Cuadro de la cámara y unidades presentes'),
    review: 'por_revisar', dispatch: null, timeline: [{ at: NOW - 9 * MIN, label: 'Alerta creada por la regla "Personas por policía"' }],
  },
  {
    id: 'AL-4104', kind: 'aglomeracion', severity: 'media', createdAt: NOW - 14 * MIN, updatedAt: NOW - 2 * MIN,
    zoneId: 'Z-04', cameraId: z('Z-04').cameras[0], lat: z('Z-04').lat, lon: z('Z-04').lon, eventId: 'EV-1207',
    rule: { id: 'R-AGL-OCUP', name: 'Ocupación sobre capacidad', threshold: '> 75 % de capacidad durante 3 min', measured: '77 % de capacidad durante 14 min', persistence: '3 min' },
    observations: 41, evidence: pending('Cuadro de la cámara que respalda la medición'),
    review: 'por_revisar', dispatch: null, timeline: [{ at: NOW - 14 * MIN, label: 'Alerta creada por la regla "Ocupación sobre capacidad"' }],
  },
  {
    id: 'AL-4103', kind: 'placa_en_lista', severity: 'media', createdAt: secondStolenRead.at, updatedAt: secondStolenRead.at,
    zoneId: cam(secondStolenRead.cameraId).zoneId, cameraId: secondStolenRead.cameraId, lat: secondStolenRead.lat, lon: secondStolenRead.lon,
    rule: { id: 'R-PLACA', name: 'Placa en lista de robados', threshold: 'Confianza ≥ 85 %', measured: 'Confianza 88 %', persistence: 'Inmediata' },
    observations: 1, evidence: pending('Recorte de placa y foto del vehículo'),
    plate: { read: 'P 377-0I9', listed: stolen[1], confidence: 0.88, reason: plateWatch[stolen[1]].reason, caseId: plateWatch[stolen[1]].case, since: plateWatch[stolen[1]].since, vehicle: plateWatch[stolen[1]].vehicle, direction: 'Hacia el norte' },
    review: 'por_revisar', dispatch: null, timeline: [{ at: secondStolenRead.at, label: 'Alerta creada por la regla "Placa en lista de robados"' }],
  },
  {
    id: 'AL-4102', kind: 'camara_caida', severity: 'baja', createdAt: NOW - 23 * MIN, updatedAt: NOW - 23 * MIN,
    zoneId: offline.zoneId, cameraId: offline.id, lat: offline.lat, lon: offline.lon,
    rule: { id: 'R-CAM', name: 'Cámara sin cuadros', threshold: 'Sin video durante 2 min', measured: 'Sin video desde hace 23 min', persistence: 'Inmediata' },
    observations: 1, evidence: pending('Último cuadro recibido'),
    review: 'por_revisar', dispatch: null, timeline: [{ at: NOW - 23 * MIN, label: 'Alerta creada por la regla "Cámara sin cuadros"' }],
  },
  {
    id: 'AL-4098', kind: 'aglomeracion', severity: 'media', createdAt: NOW - 58 * MIN, updatedAt: NOW - 31 * MIN,
    zoneId: 'Z-02', cameraId: z('Z-02').cameras[0], lat: z('Z-02').lat, lon: z('Z-02').lon, eventId: 'EV-1207',
    rule: { id: 'R-AGL-OCUP', name: 'Ocupación sobre capacidad', threshold: '> 110 % de capacidad durante 3 min (umbral del evento)', measured: '112 % de capacidad durante 4 min', persistence: '3 min' },
    observations: 9, evidence: pending('Cuadro de la cámara que respalda la medición'),
    review: 'confirmada', reviewedBy: 'Karla Méndez', dispatch: 'en_camino',
    timeline: [
      { at: NOW - 58 * MIN, label: 'Alerta creada por la regla "Ocupación sobre capacidad"' },
      { at: NOW - 56 * MIN, label: 'Confirmada: se envían 2 unidades', by: 'Karla Méndez' },
    ],
  },
  {
    id: 'AL-4095', kind: 'placa_en_lista', severity: 'media', createdAt: NOW - 97 * MIN, updatedAt: NOW - 95 * MIN,
    zoneId: null, cameraId: plateCams[6].id, lat: plateCams[6].lat, lon: plateCams[6].lon,
    rule: { id: 'R-PLACA', name: 'Placa en lista de robados', threshold: 'Confianza ≥ 85 %', measured: 'Confianza 86 %', persistence: 'Inmediata' },
    observations: 1, evidence: pending('Recorte de placa y foto del vehículo'),
    plate: { read: 'M 204-55I', listed: stolen[2], confidence: 0.86, reason: plateWatch[stolen[2]].reason, caseId: plateWatch[stolen[2]].case, since: plateWatch[stolen[2]].since, vehicle: plateWatch[stolen[2]].vehicle, direction: 'Hacia el sur' },
    review: 'descartada', reviewedBy: 'José Portillo', discardReason: 'Lectura de placa errónea', dispatch: null,
    timeline: [{ at: NOW - 97 * MIN, label: 'Alerta creada por la regla "Placa en lista de robados"' }, { at: NOW - 95 * MIN, label: 'Descartada: Lectura de placa errónea', by: 'José Portillo' }],
  },
];

/* ---------- Bitácora ---------- */
export const audit: AuditEntry[] = [];
let aid = 52000;
const addAudit = (at: number, user: string, role: AuditEntry['role'], action: string, object: string, detail: string, reason?: string) =>
  audit.push({ id: 'AUD-' + aid++, at, user, role, action, object, detail, reason });
addAudit(NOW - 26 * 60 * MIN, 'Marta Rivas', 'admin', 'Editar regla', 'R-BRECHA', 'Umbral 3,000 → 2,500 personas por policía');
addAudit(NOW - 22 * 60 * MIN, 'Marta Rivas', 'admin', 'Crear evento', 'EV-1207', 'Festividades de diciembre · 3 zonas · umbrales propios');
addAudit(NOW - 20 * 60 * MIN, 'Marta Rivas', 'admin', 'Crear evento', 'EV-1211', 'Clásico de fútbol · 1 zona');
addAudit(NOW - 6 * 60 * MIN, 'Lucía Hernández', 'analyst', 'Búsqueda de placa', 'P*884', '3 lecturas · 7 días', 'Investigación de robo de vehículo');
addAudit(NOW - 6 * 60 * MIN + 4 * MIN, 'Lucía Hernández', 'analyst', 'Exportar ficha', 'P512884', 'Ficha con 6 lecturas y evidencia', 'Investigación de robo de vehículo');
addAudit(NOW - 97 * MIN + 30_000, 'José Portillo', 'operator_911', 'Abrir alerta', 'AL-4095', 'Placa en lista');
addAudit(NOW - 95 * MIN, 'José Portillo', 'operator_911', 'Descartar alerta', 'AL-4095', 'Placa en lista', 'Lectura de placa errónea');
addAudit(NOW - 57 * MIN, 'Karla Méndez', 'operator_911', 'Abrir alerta', 'AL-4098', 'Aglomeración · Alameda Roosevelt');
addAudit(NOW - 56 * MIN, 'Karla Méndez', 'operator_911', 'Confirmar alerta', 'AL-4098', 'Unidades enviadas: 2');
addAudit(NOW - 40 * MIN, 'Cmdte. Ernesto Alfaro', 'command', 'Abrir zona', 'Z-01', 'Plaza Salvador del Mundo');
addAudit(NOW - 12 * MIN, 'Roberto Martínez', 'command', 'Abrir evento', 'EV-1207', 'Festividades de diciembre');
audit.sort((a, b) => b.at - a.at);
