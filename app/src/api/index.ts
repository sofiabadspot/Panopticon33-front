/* =====================================================================
   API — capa de servicios. La interfaz SOLO obtiene datos de aquí.
   Cada función documenta el endpoint que el backend debe implementar
   (REST + WebSocket /v1/stream). Al conectar el backend se reemplaza el
   cuerpo de estas funciones; las vistas no cambian.
   Toda consulta o decisión sensible pasa por audit().
   ===================================================================== */
import { placeAlert } from './place';
import { useSyncExternalStore } from 'react';
import seedJson from '../data/generated/seed.json';
import * as seed from './seed';
import { normalizePlate } from './format';
import { KIND_LABEL } from './labels';
import type {
  Alert, AuditEntry, Camera, MaicLink, MassEvent, PlateRead, Role, Rule, Unit, User, WatchList, Zone, ZoneStatus,
} from './types';

const MIN = 60_000;
const r = seed.prng(77);

interface State {
  now: number;
  zones: Zone[];
  zoneStatus: Record<string, ZoneStatus>;
  cameras: Camera[];
  units: Unit[];
  alerts: Alert[];
  events: MassEvent[];
  rules: Rule[];
  lists: WatchList[];
  users: User[];
  audit: AuditEntry[];
  maic: MaicLink;
  /** ¿Hay acceso a la plataforma de ubicación policial? Sin ella no hay capa de unidades ni brecha de presencia. */
  policeSource: boolean;
}

/* Historia de 60 min (cada 2 min) por zona, tomada del prototipo y escalada a la base actual. */
const history: Record<string, number[]> = {};
for (const z of (seedJson as unknown as { zones: { id: string; history: number[] }[] }).zones) {
  const last = z.history[z.history.length - 1] || 1;
  history[z.id] = z.history.map((v) => (v / last) * seed.zoneBase[z.id]);
}
const level: Record<string, number> = { ...seed.zoneBase };

let state: State = {
  now: Date.now(),
  zones: seed.zones,
  zoneStatus: {},
  cameras: seed.cameras,
  units: seed.units,
  alerts: seed.alerts.map((a) => placeAlert(a, seed.zones)),
  events: seed.events,
  rules: seed.rules,
  lists: seed.lists,
  users: seed.users,
  audit: seed.audit,
  maic: { connected: true, lastMessageAt: Date.now(), mode: 'producción' },
  policeSource: true,
};

const listeners = new Set<() => void>();
function commit(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Suscripción a datos vivos (en producción: WS /v1/stream, temas zones · alerts · cameras · units · maic). */
export function useApi<T>(select: (s: State) => T): T {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => select(state));
}
export const snapshot = () => state;

/* ---------------- Medición de zonas ---------------- */
function officersIn(zoneId: string, s: State) {
  return s.units.filter((u) => u.zoneId === zoneId && u.status === 'en_servicio').reduce((n, u) => n + seed.AGENTS[u.type], 0);
}
function measure(s: State): Record<string, ZoneStatus> {
  const out: Record<string, ZoneStatus> = {};
  for (const z of s.zones) {
    const cams = s.cameras.filter((c) => z.cameras.includes(c.id));
    const measurable = cams.filter((c) => c.status === 'operativa' || c.status === 'degradada');
    const coverage: ZoneStatus['coverage'] = measurable.length ? 'medida' : cams.some((c) => c.status === 'fuera_de_preset') ? 'sin_cobertura' : 'sin_datos';
    const officers = s.policeSource ? officersIn(z.id, s) : null;
    if (coverage !== 'medida') {
      out[z.id] = { zoneId: z.id, coverage, updatedAt: s.now, count: null, low: null, high: null, densityPerM2: null, occupancy: null,
        trend: (history[z.id] ?? []).map(() => null), flowIn: null, flowOut: null, officers, perOfficer: null };
      continue;
    }
    const count = level[z.id];
    const spread = count > 10000 ? 0.1 : 0.15;
    const h = history[z.id];
    const prev = h[h.length - 6] ?? count;
    out[z.id] = {
      zoneId: z.id, coverage, updatedAt: s.now, count, low: count * (1 - spread), high: count * (1 + spread),
      densityPerM2: count / z.areaM2, occupancy: count / z.capacity, trend: [...h],
      flowIn: Math.max(0, Math.round((count - prev) / 10 + count * 0.004)), flowOut: Math.round(count * 0.004),
      officers, perOfficer: officers ? count / officers : null,
    };
  }
  return out;
}
state.zoneStatus = measure(state);

/* ---------------- Simulador en vivo (solo en la demo) ---------------- */
let tick = 0;
function simulate() {
  tick++;
  const now = Date.now();
  for (const id of Object.keys(level)) {
    const drift = id === 'Z-01' ? 1.0012 : id === 'Z-04' ? 1.0008 : 1.0002;
    level[id] = level[id] * drift * (0.996 + r() * 0.008);
    const h = history[id];
    if (tick % 30 === 0) { h.shift(); h.push(level[id]); } else h[h.length - 1] = level[id];
  }
  let alerts = state.alerts;
  // Mediciones repetidas de la misma zona y regla se suman a la alerta abierta, no crean otra.
  if (tick % 5 === 0) {
    alerts = alerts.map((a) => (a.review === 'por_revisar' && (a.kind === 'aglomeracion' || a.kind === 'brecha_presencia')
      ? { ...a, observations: a.observations + 1, updatedAt: now } : a));
  }
  // Demo: llega una alerta de placa nueva a los 48 s y después una por minuto (hasta 4)
  if (tick === 12 || (tick > 12 && tick <= 57 && tick % 15 === 12)) alerts = [newPlateAlert(now), ...alerts];
  const units = tick % 4 === 0 ? state.units.map((u) => (u.status === 'sin_reporte' || u.status === 'desconocida' ? u
    : { ...u, lat: u.lat + (r() - 0.5) * 0.00012, lon: u.lon + (r() - 0.5) * 0.00012, lastReportAt: now })) : state.units;
  const next = { ...state, now, alerts, units, maic: { ...state.maic, lastMessageAt: state.maic.connected ? now : state.maic.lastMessageAt } };
  commit({ ...next, zoneStatus: measure(next) });
}
setInterval(simulate, 4000);

/** Cada alerta de la demo lleva su propio número y su propia cámara: si no, la lista las trata como una sola. */
let plateSeq = 0;
function newPlateAlert(now: number): Alert {
  const watch = Object.keys(seed.plateWatch);
  const n = plateSeq++;
  const plate = watch[n % watch.length];
  const cams = state.cameras.filter((c) => c.kind !== 'peatonal' && c.status === 'operativa');
  const cam = cams[(11 + n * 5) % cams.length];
  const info = seed.plateWatch[plate];
  return placeAlert({
    id: 'AL-' + (4108 + n), kind: 'placa_en_lista', severity: 'critica', createdAt: now, updatedAt: now, zoneId: cam.zoneId, cameraId: cam.id, lat: cam.lat, lon: cam.lon,
    rule: { id: 'R-PLACA', name: 'Placa en lista de robados', threshold: 'Confianza ≥ 85 %', measured: 'Confianza 95 %', persistence: 'Inmediata' },
    observations: 1, evidence: { type: 'pendiente', caption: 'Recorte de placa y foto del vehículo' },
    plate: { read: plate, listed: plate, confidence: 0.95, reason: info.reason, caseId: info.case, since: info.since, vehicle: info.vehicle, direction: 'Hacia el oriente' },
    review: 'por_revisar', maic: null, timeline: [{ at: now, label: 'Alerta creada por la regla "Placa en lista de robados"' }],
  }, state.zones);
}

/* ---------------- Sesión ---------------- */
export interface Session { user: User }
/** GET /v1/me (Keycloak: el rol define vistas y territorio). En la demo se elige el rol. */
export function sessionFor(role: Role): Session {
  return { user: state.users.find((u) => u.role === role && u.active)! };
}

/* ---------------- Bitácora ---------------- */
let aid = 60000;
/** POST /v1/audit — en producción lo registra el backend en cada endpoint. */
export function audit(user: User, action: string, object: string, detail: string, reason?: string) {
  const e: AuditEntry = { id: 'AUD-' + aid++, at: Date.now(), user: user.name, role: user.role, action, object, detail, reason };
  commit({ audit: [e, ...state.audit] });
}

/* ---------------- Alertas ---------------- */
const opened = new Set<string>();
/** GET /v1/zones/{id} → auditado una vez por sesión y zona. */
export function openZone(id: string, name: string, user: User) {
  if (opened.has(user.id + id)) return;
  opened.add(user.id + id);
  audit(user, 'Abrir zona', id, name);
}
/** GET /v1/alerts/{id} → auditado (quién abrió qué evidencia). */
export function openAlert(id: string, user: User) {
  const a = state.alerts.find((x) => x.id === id);
  if (!a || opened.has(user.id + id)) return;
  opened.add(user.id + id);
  audit(user, 'Abrir alerta', id, KIND_LABEL[a.kind]);
}

function patchAlert(id: string, fn: (a: Alert) => Alert) {
  commit({ alerts: state.alerts.map((a) => (a.id === id ? fn(a) : a)) });
}

/** POST /v1/alerts/{id}/confirm → crea el evento en Maic (sandbox). Maic devuelve el estado por /v1/stream. */
export function confirmAlert(id: string, user: User) {
  const now = Date.now();
  const maicId = 'MAIC-' + (77200 + Math.floor(r() * 700));
  patchAlert(id, (a) => ({ ...a, review: 'confirmada', reviewedBy: user.name, maic: 'enviada', maicId, updatedAt: now,
    timeline: [...a.timeline, { at: now, label: 'Confirmada y enviada a Maic', by: user.name }] }));
  audit(user, 'Confirmar alerta', id, 'Enviada a Maic');
  setTimeout(() => patchAlert(id, (a) => ({ ...a, maic: 'recibida', updatedAt: Date.now(), timeline: [...a.timeline, { at: Date.now(), label: `Recibida en Maic (${maicId})` }] })), 2200);
  setTimeout(() => patchAlert(id, (a) => ({ ...a, maic: 'despachada', updatedAt: Date.now(), timeline: [...a.timeline, { at: Date.now(), label: 'Despachada por Maic' }] })), 9000);
}

/** POST /v1/alerts/{id}/discard { reason } — el motivo alimenta el ajuste de umbrales. */
export function discardAlert(id: string, reason: string, user: User) {
  const now = Date.now();
  patchAlert(id, (a) => ({ ...a, review: 'descartada', reviewedBy: user.name, discardReason: reason, updatedAt: now,
    timeline: [...a.timeline, { at: now, label: `Descartada: ${reason}`, by: user.name }] }));
  audit(user, 'Descartar alerta', id, KIND_LABEL[state.alerts.find((a) => a.id === id)!.kind], reason);
}

/* ---------------- Placas ---------------- */
export interface PlateQuery { plate: string; from: number; to: number; zoneId: string | null; reason: string }
/** GET /v1/plates/reads?q=&from=&to=&zone=&reason= → auditado. Sin motivo no hay resultados. */
export async function searchPlates(q: PlateQuery, user: User): Promise<PlateRead[]> {
  if (!q.reason.trim()) throw new Error('motivo');
  const pat = normalizePlate(q.plate).replace(/\*/g, '.*').replace(/\?/g, '.');
  const re = new RegExp(pat.includes('.*') ? `^${pat}$` : pat);
  const zoneCams = q.zoneId ? new Set(state.cameras.filter((c) => c.zoneId === q.zoneId).map((c) => c.id)) : null;
  const out = seed.reads.filter((x) => re.test(normalizePlate(x.plate)) && x.at >= q.from && x.at <= q.to && (!zoneCams || zoneCams.has(x.cameraId)));
  audit(user, 'Búsqueda de placa', q.plate.toUpperCase(), `${out.length} lecturas`, q.reason);
  await new Promise((res) => setTimeout(res, 450));
  return out;
}
export const plateWatch = (plate: string) => seed.plateWatch[plate] ?? null;

/** GET /v1/plates/reads/export (CSV con enlaces a la evidencia) → auditado. */
export function exportPlates(rows: PlateRead[], label: string, reason: string, user: User) {
  const head = 'placa,fecha_hora,camara,ubicacion,latitud,longitud,confianza,en_lista';
  const body = rows.map((x) => [x.plate, new Date(x.at).toISOString(), x.cameraId, `"${x.street}"`, x.lat.toFixed(6), x.lon.toFixed(6), x.confidence.toFixed(2), x.listed ? 'sí' : 'no'].join(','));
  audit(user, 'Exportar ficha', label, `${rows.length} lecturas`, reason);
  return [head, ...body].join('\n');
}

/* ---------------- Eventos masivos ---------------- */
/** PUT /v1/events/{id} · POST /v1/events */
export function saveEvent(ev: MassEvent, user: User) {
  const exists = state.events.some((e) => e.id === ev.id);
  commit({ events: exists ? state.events.map((e) => (e.id === ev.id ? ev : e)) : [ev, ...state.events] });
  audit(user, exists ? 'Editar evento' : 'Crear evento', ev.id, `${ev.name} · ${ev.zoneIds.length} zonas${ev.thresholds ? ' · umbrales propios' : ''}`);
}
export const newEventId = () => 'EV-' + (1212 + state.events.length);

/* ---------------- Configuración ---------------- */
/** PATCH /v1/rules/{id} */
export function updateRule(id: string, patch: Partial<Rule>, user: User) {
  const before = state.rules.find((x) => x.id === id)!;
  commit({ rules: state.rules.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const what = 'threshold' in patch ? `Umbral ${before.threshold} → ${patch.threshold} ${before.unit}`
    : 'persistenceMin' in patch ? `Persistencia ${before.persistenceMin} → ${patch.persistenceMin} min`
    : `${patch.enabled ? 'Activada' : 'Desactivada'}`;
  audit(user, 'Editar regla', id, what);
}
/** POST /v1/lists/{id}/sync */
export function syncList(id: string, user: User) {
  commit({ lists: state.lists.map((l) => (l.id === id ? { ...l, lastSyncAt: Date.now(), entries: l.entries + 17 } : l)) });
  audit(user, 'Sincronizar lista', id, 'Sincronización manual');
}
/** PUT /v1/settings/police-location */
export function setPoliceSource(on: boolean, user: User) {
  const next = { ...state, policeSource: on };
  commit({ policeSource: on, zoneStatus: measure(next) });
  audit(user, 'Cambiar fuente de ubicación policial', 'Ubicación policial', on ? 'Conectada' : 'Sin acceso');
}
/** PATCH /v1/cameras/{id} { preset } — volver a un preset conocido permite medir de nuevo. */
export function setCameraPreset(id: string, preset: string, user: User) {
  const cameras = state.cameras.map((c) => (c.id === id ? { ...c, status: 'operativa' as const } : c));
  const next = { ...state, cameras };
  commit({ cameras, zoneStatus: measure(next) });
  audit(user, 'Asociar preset', id, preset);
}
/** POST /v1/zones */
export function saveZone(zone: Zone, user: User) {
  const exists = state.zones.some((z) => z.id === zone.id);
  if (!exists) seed.zoneBase[zone.id] = 0;
  level[zone.id] = level[zone.id] ?? 0; history[zone.id] = history[zone.id] ?? Array(30).fill(0);
  const zones = exists ? state.zones.map((z) => (z.id === zone.id ? zone : z)) : [...state.zones, zone];
  const next = { ...state, zones };
  commit({ zones, zoneStatus: measure(next) });
  audit(user, exists ? 'Editar zona' : 'Crear zona', zone.id, `${zone.name} · ${Math.round(zone.areaM2)} m²`);
}
export const newZoneId = () => 'Z-' + String(state.zones.length + 1).padStart(2, '0');
/** PATCH /v1/users/{id} */
export function setUserActive(id: string, active: boolean, user: User) {
  commit({ users: state.users.map((u) => (u.id === id ? { ...u, active } : u)) });
  audit(user, active ? 'Activar usuario' : 'Desactivar usuario', id, state.users.find((u) => u.id === id)!.name);
}

export const presence = seed.presence;
export const SECTOR = { name: 'Sector Salvador del Mundo', lat: seed.ORIGIN.lat, lon: seed.ORIGIN.lon };

/* ---------------- Utilidades derivadas ---------------- */
export const isListStale = (l: WatchList, now: number) => now - l.lastSyncAt > l.maxAgeMin * MIN;
export function eventStatus(e: MassEvent, now: number): 'programado' | 'en_curso' | 'finalizado' {
  return now < e.start ? 'programado' : now > e.end ? 'finalizado' : 'en_curso';
}

/* ---------------- Ficha de vehículo ---------------- */
/** Lo que la cámara ve del vehículo (tipo y color), no lo que dice un registro. */
export interface VehicleLook { type: string; color: string }
export interface VehicleProfile {
  plate: string;
  /** Lecturas de 7 días, de la más antigua a la más reciente. */
  reads: PlateRead[];
  listed: { reason: string; since: string; case: string; vehicle: { type: string; color: string; make: string } } | null;
  seen: VehicleLook | null;
  /** Lo visto por cámara no coincide con el vehículo de la lista: posible placa clonada. */
  mismatch: boolean;
  cameras: { id: string; street: string; n: number }[];
  /** Hora del día (0–23) con más lecturas, si hay al menos 3. */
  usualHours: [number, number] | null;
  companions: { plate: string; times: number; cameras: number; listed: boolean }[];
}

const vehicleReasons = new Map<string, string>();
/** Motivo con el que esta sesión abrió la ficha de esa placa (null = hay que pedirlo). */
export const vehicleReason = (plate: string) => vehicleReasons.get(normalizePlate(plate)) ?? null;
/** POST /v1/vehicles/{plate}/access {reason} → auditado. Sin motivo no se ve la ficha. */
export function grantVehicle(plate: string, reason: string, user: User, via = 'Abrir ficha de vehículo') {
  vehicleReasons.set(normalizePlate(plate), reason);
  audit(user, via, plate.toUpperCase(), `${readsOf(plate).length} lecturas en 7 días`, reason);
}

const LOOK_TYPES = ['Sedán', 'Pickup', 'Camioneta', 'Hatchback', 'Microbús'];
const LOOK_COLORS = ['Gris', 'Blanco', 'Negro', 'Rojo', 'Azul', 'Plata'];
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const hourOf = (t: number) => Number(new Date(t).toLocaleString('en-US', { timeZone: 'America/El_Salvador', hour: 'numeric', hourCycle: 'h23' }));
const COMPANION_S = 90;

/** GET /v1/vehicles/{plate} — perfil del vehículo: lecturas, lista, atributos vistos por cámara y vehículos que viajan con él. */
export function vehicleProfile(plate: string): VehicleProfile {
  const np = normalizePlate(plate);
  const now = Date.now();
  const rs = seed.reads.filter((x) => normalizePlate(x.plate) === np && x.at <= now).sort((a, b) => a.at - b.at);
  const canon = rs[0]?.plate ?? plate.toUpperCase();
  const listed = seed.plateWatch[canon] ?? null;
  // Simulado: el backend entrega tipo y color detectados por el modelo. El segundo de la lista se ve distinto (demo de placa clonada).
  const seen: VehicleLook | null = !rs.length ? null
    : listed ? (canon === Object.keys(seed.plateWatch)[1] ? { type: 'Pickup', color: 'Blanco' } : { type: listed.vehicle.type, color: listed.vehicle.color })
    : { type: LOOK_TYPES[hash(np) % LOOK_TYPES.length], color: LOOK_COLORS[hash(np + 'c') % LOOK_COLORS.length] };
  const mismatch = !!(listed && seen && (seen.type !== listed.vehicle.type || seen.color !== listed.vehicle.color));

  const byCam = new Map<string, { id: string; street: string; n: number }>();
  for (const x of rs) { const e = byCam.get(x.cameraId) ?? { id: x.cameraId, street: x.street, n: 0 }; e.n++; byCam.set(x.cameraId, e); }
  const cameras = [...byCam.values()].sort((a, b) => b.n - a.n);

  let usualHours: [number, number] | null = null;
  if (rs.length >= 3) {
    const hrs = rs.map((x) => hourOf(x.at)).sort((a, b) => a - b);
    usualHours = [hrs[Math.floor(hrs.length * 0.2)], hrs[Math.ceil(hrs.length * 0.8) - 1] + 1];
  }

  // Viajan juntos: otra placa leída en la misma cámara a menos de 90 s, en 2 cámaras distintas o más.
  const near = new Map<string, { reads: Set<string>; cams: Set<string> }>();
  for (const x of rs) for (const y of seed.reads) {
    if (y.cameraId !== x.cameraId || normalizePlate(y.plate) === np || Math.abs(y.at - x.at) > COMPANION_S * 1000 || !y.normalized) continue;
    const e = near.get(y.plate) ?? { reads: new Set(), cams: new Set() }; e.reads.add(x.id); e.cams.add(y.cameraId); near.set(y.plate, e);
  }
  const companions = [...near.entries()].filter(([, e]) => e.cams.size >= 2)
    .map(([p, e]) => ({ plate: p, times: e.reads.size, cameras: e.cams.size, listed: !!seed.plateWatch[p] })).sort((a, b) => b.times - a.times);

  return { plate: canon, reads: rs, listed, seen, mismatch, cameras, usualHours, companions };
}

/** GET /v1/plates/{plate}/reads?limit= — lecturas previas del mismo vehículo (detalle de alerta). */
export const readsOf = (plate: string) => seed.reads.filter((x) => x.plate === plate);
/** Las alertas de cámara caída van al administrador (Configuración), no a la bandeja del 911. */
export const forOperator = (a: Alert) => a.kind !== 'camara_caida';
