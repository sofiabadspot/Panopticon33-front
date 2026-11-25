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
import { etaMin } from './coverage';
import type {
  Alert, AuditEntry, Camera, InvPlace, Investigation, MaicLink, MassEvent, PlateRead, Role, Rule, Sighting, Unit, User, WatchList, Zone, ZoneStatus,
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
  /** Investigaciones de los analistas. */
  investigations: Investigation[];
  /** Escenario en que se muestra la consola (para revisar cada estado de la interfaz). */
  scenario: Scenario;
  /** Todavía llegan los primeros datos: paneles y mapa muestran el estado de carga. */
  loading: boolean;
}

/* ---------------- Escenarios ----------------
   La consola tiene que verse bien en todos sus estados, no solo con datos. Cada escenario
   cambia los datos de entrada; la interfaz es la misma. Se elige en el menú de la cuenta. */
export type Scenario = 'normal' | 'gestionadas' | 'sin_alertas' | 'sin_eventos' | 'cargando' | 'sin_maic';
export const SCENARIO_LABEL: Record<Scenario, string> = {
  normal: 'Con alertas por revisar', gestionadas: 'Todo gestionado', sin_alertas: 'Sin alertas ni coincidencias', sin_eventos: 'Sin eventos',
  cargando: 'Cargando datos', sin_maic: 'Sin conexión con Maic',
};
const SCENARIOS = Object.keys(SCENARIO_LABEL) as Scenario[];
const readScenario = (): Scenario => { try { const v = localStorage.getItem('p33.escenario'); return SCENARIOS.includes(v as Scenario) ? (v as Scenario) : 'normal'; } catch { return 'normal'; } };

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
  alerts: [],
  events: seed.events,
  rules: seed.rules,
  lists: seed.lists,
  users: seed.users,
  audit: seed.audit,
  maic: { connected: true, lastMessageAt: Date.now(), mode: 'producción' },
  policeSource: true,
  investigations: [],
  scenario: 'normal',
  loading: false,
};

const baseAlerts = seed.alerts.map((a) => placeAlert(a, seed.zones));
/** Alertas de cada escenario. "Gestionadas": todo lo que esperaba decisión ya se resolvió y los refuerzos llegaron. */
function alertsFor(sc: Scenario): Alert[] {
  if (sc === 'sin_alertas' || sc === 'cargando') return [];
  if (sc !== 'gestionadas') return baseAlerts;
  return baseAlerts.map((a, i) => {
    const at = a.createdAt + (4 + (i % 5)) * 60000;
    if (a.review === 'por_revisar' && a.kind === 'camara_caida')
      return { ...a, review: 'descartada', reviewedBy: 'Karla Méndez', discardReason: 'La cámara volvió a enviar video', updatedAt: at, timeline: [...a.timeline, { at, label: 'Descartada: la cámara volvió a enviar video', by: 'Karla Méndez' }] };
    if (a.review === 'por_revisar')
      return { ...a, review: 'confirmada', reviewedBy: 'Karla Méndez', dispatch: 'en_lugar', updatedAt: at, timeline: [...a.timeline, { at, label: 'Confirmada: se envía 1 unidad', by: 'Karla Méndez' }, { at: at + 6 * 60000, label: 'Llegó la unidad · refuerzos en el lugar' }] };
    return a.dispatch === 'en_camino' ? { ...a, dispatch: 'en_lugar' } : a;
  });
}
function scenarioPatch(sc: Scenario, now = Date.now()): Partial<State> {
  return { scenario: sc, loading: sc === 'cargando', alerts: alertsFor(sc), events: sc === 'sin_eventos' ? [] : seed.events,
    maic: { ...state.maic, connected: sc !== 'sin_maic', lastMessageAt: sc === 'sin_maic' ? now - 7 * 60000 : now } };
}
/** Cambia el escenario de la consola (queda guardado en este navegador). */
export function setScenario(sc: Scenario) {
  try { localStorage.setItem('p33.escenario', sc); } catch { /* sin almacenamiento */ }
  plateSeq = 0;
  try { window.dispatchEvent(new CustomEvent('p33:escenario', { detail: sc })); } catch { /* sin ventana */ }
  commit({ ...scenarioPatch(sc), units: sc === 'cargando' ? [] : seed.units });
}
state = { ...state, ...scenarioPatch(readScenario()), units: readScenario() === 'cargando' ? [] : seed.units };

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
  // Demo: una placa en lista pasa por una cámara a los 48 s y después una vez por minuto (hasta 4). Si ya
  // tiene una alerta abierta, se suma a esa; si no, se crea. (Solo con alertas: en los escenarios
  // gestionadas, sin alertas y cargando no llegan.)
  if ((state.scenario === 'normal' || state.scenario === 'sin_maic') && (tick === 12 || (tick > 12 && tick <= 57 && tick % 15 === 12))) alerts = plateSighting(alerts, now);
  const moved = advanceUnits(state.units, now);
  alerts = closeArrived(alerts, moved, now);
  const units = tick % 4 === 0 ? moved.map((u) => (u.status === 'sin_reporte' || u.status === 'desconocida' || u.enRoute ? u
    : { ...u, lat: u.lat + (r() - 0.5) * 0.00012, lon: u.lon + (r() - 0.5) * 0.00012, lastReportAt: now })) : moved;
  const next = { ...state, now, alerts, units, maic: { ...state.maic, lastMessageAt: state.maic.connected ? now : state.maic.lastMessageAt } };
  commit({ ...next, zoneStatus: measure(next) });
}
setInterval(simulate, 4000);

/** Las lecturas de una alerta de placa (las de antes del cambio no las guardaban: se arma la primera). */
export function sightingsOf(a: Alert): Sighting[] {
  if (a.sightings?.length) return a.sightings;
  const cam = state.cameras.find((c) => c.id === a.cameraId);
  return [{ at: a.createdAt, cameraId: a.cameraId, street: cam?.street ?? '', lat: a.lat, lon: a.lon, confidence: a.plate?.confidence ?? 0, evidence: a.evidence }];
}
/** Una placa en lista vuelve a pasar por una cámara. Si el vehículo ya tiene una alerta abierta (por
    revisar, o confirmada con refuerzos en camino), se actualiza esa: dónde está ahora, una lectura más y una línea en su
    historia; sube al principio de la lista. Si no, se crea una alerta nueva. Una sola alerta por vehículo:
    si no, la bandeja se llena con el mismo auto. */
function plateSighting(alerts: Alert[], now: number): Alert[] {
  const read = newPlateAlert(now);
  const open = alerts.find((a) => a.plate?.listed === read.plate!.listed && (a.review === 'por_revisar' || a.dispatch === 'en_camino'));
  if (!open) return [read, ...alerts];
  const s = sightingsOf(read)[0];
  const next: Alert = {
    ...open, lat: s.lat, lon: s.lon, cameraId: s.cameraId, zoneId: read.zoneId, updatedAt: now, observations: open.observations + 1,
    sightings: [...sightingsOf(open), s],
    timeline: [...open.timeline, { at: now, label: `Nueva lectura de la placa: ${s.cameraId}${s.street ? ' · ' + s.street : ''}` }],
  };
  return [next, ...alerts.filter((a) => a.id !== open.id)];
}

/** Cada lectura de la demo lleva su propia cámara (y, si crea alerta, su propio número). */
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
    sightings: [{ at: now, cameraId: cam.id, street: cam.street, lat: cam.lat, lon: cam.lon, confidence: 0.95, evidence: { type: 'pendiente', caption: 'Recorte de placa y foto del vehículo' } }],
    review: 'por_revisar', dispatch: null, timeline: [{ at: now, label: 'Alerta creada por la regla "Placa en lista de robados"' }],
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

/* ---------------- Refuerzos: unidades en camino ----------------
   La plataforma asigna las unidades, no Maic (reunión con el Gobierno, 25/11): el operador 911 o el
   mando elige cuántas y cuáles al confirmar una alerta, o manda las que quiera a un punto desde
   "¿Quién llega?". A Maic le llega el evento por el backend, sin que el operador haga nada.
   En la demo avanzan en línea recta ~45 m cada 4 s y al llegar quedan en servicio. */
const metersBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 111320);
};
/** Qué sigue la unidad: la alerta, no una dirección. Con placa, el vehículo; si no, el tipo de alerta. */
function followLabel(a: Alert) {
  return a.plate ? `Sigue a ${a.plate.listed}` : `Va a ${KIND_LABEL[a.kind].toLowerCase()} · ${a.id}`;
}
/** La alerta a seguir ahora: para una placa, la última lectura de ese vehículo (puede haberse movido). */
function followTarget(alertId: string): Alert | undefined {
  const a = state.alerts.find((x) => x.id === alertId); if (!a?.plate) return a;
  return state.alerts.filter((x) => x.plate?.listed === a.plate!.listed).sort((p, q) => q.createdAt - p.createdAt)[0];
}
/** Cuántas unidades se sugieren al confirmar: aglomeración 3 si es crítica y 2 si es media; brecha de
    presencia 2 si es crítica; placa y persona en lista, 1; cámara caída, ninguna. El operador lo cambia. */
export function suggestedUnits(a: Alert) {
  if (a.kind === 'camara_caida') return 0;
  if (a.kind === 'aglomeracion') return a.severity === 'critica' ? 3 : a.severity === 'media' ? 2 : 1;
  if (a.kind === 'brecha_presencia') return a.severity === 'critica' ? 2 : 1;
  return 1;
}
/** Distancia a la que una unidad ya cuenta como presente en el lugar (m). */
const ALREADY_M = 150;
/** Qué está haciendo una unidad, visto desde quien manda refuerzos.
    · disponible: libre, sin tarea.
    · ocupada: se está haciendo cargo de algo (cuida su zona). Se puede mandar, pero deja lo que hace.
    · asignada: ya va a otro lugar. No se puede mandar.
    · en_lugar: ya está donde hace falta (a menos de ALREADY_M). No es refuerzo.
    · sin_reporte / desconocida: no se sabe dónde está o qué hace. No se puede mandar. */
export type UnitAvail = 'disponible' | 'ocupada' | 'asignada' | 'en_lugar' | 'sin_reporte' | 'desconocida';
export const AVAIL_LABEL: Record<UnitAvail, string> = { disponible: 'Disponible', ocupada: 'Ocupada', asignada: 'Asignada', en_lugar: 'Ya en el lugar', sin_reporte: 'Sin reporte', desconocida: 'Estado desconocido' };
/** Una unidad para mandar a un punto: cuánto tarda, qué está haciendo y si se puede elegir. */
export interface UnitOption { unit: Unit; eta: number; dist: number; avail: UnitAvail; free: boolean;
  /** Detalle del estado: la zona que cuida, adónde va. */ detail?: string;
  /** Por qué no se puede elegir. */ why?: string }
/** Todas las unidades, de la que llega antes a la que llega después, con su estado. */
export function unitOptions(p: { lat: number; lon: number }): UnitOption[] {
  return state.units.map((unit) => {
    const dist = metersBetween(unit, p), eta = etaMin(unit, [p.lon, p.lat]);
    const avail: UnitAvail = unit.status === 'sin_reporte' ? 'sin_reporte' : unit.status === 'desconocida' ? 'desconocida' : unit.enRoute ? 'asignada' : dist < ALREADY_M ? 'en_lugar' : unit.status === 'en_servicio' ? 'ocupada' : 'disponible';
    const zone = unit.zoneId ? state.zones.find((z) => z.id === unit.zoneId)?.name : undefined;
    const detail = avail === 'asignada' ? unit.enRoute!.label : avail === 'ocupada' ? (zone ? `cuida ${zone}` : 'en servicio') : undefined;
    const free = avail === 'disponible' || avail === 'ocupada';
    return { unit, eta, dist, avail, free, detail, why: free ? undefined : AVAIL_LABEL[avail] };
  }).sort((a, b) => a.eta - b.eta);
}
/** Las `n` más cercanas que se pueden mandar: primero las disponibles; si no alcanzan, las ocupadas. */
export const nearestFree = (p: { lat: number; lon: number }, n: number) => {
  const o = unitOptions(p);
  return [...o.filter((x) => x.avail === 'disponible'), ...o.filter((x) => x.avail === 'ocupada')].slice(0, n).map((x) => x.unit.id);
};
/** Manda unidades a una alerta (siguen a la alerta si se mueve) o a un punto. */
function sendUnits(ids: string[], target: { lat: number; lon: number; label: string; alertId?: string }) {
  if (!ids.length) return;
  const set = new Set(ids);
  const enRoute = { lat: target.lat, lon: target.lon, label: target.label, alertId: target.alertId, since: Date.now() };
  commit({ units: state.units.map((u) => (set.has(u.id) ? { ...u, status: 'en_servicio', enRoute } : u)) });
}
/** Unidades que llegaron en este ciclo. */
let arrivals: { alertId: string; unitId: string }[] = [];
/** Llegó una unidad. Si van varias, cada llegada queda en la línea de tiempo; cuando llega la última,
    la alerta (y, si es una placa, las lecturas confirmadas del mismo vehículo) queda con los refuerzos en el lugar. */
function closeArrived(alerts: Alert[], units: Unit[], now: number): Alert[] {
  if (!arrivals.length) return alerts;
  const done = arrivals; arrivals = [];
  return alerts.map((x) => {
    const hits = done.filter(({ alertId }) => { const a = alerts.find((y) => y.id === alertId); return x.id === alertId || (!!a?.plate && x.plate?.listed === a.plate.listed); });
    if (!hits.length || x.review !== 'confirmada' || x.dispatch !== 'en_camino') return x;
    const stillGoing = units.some((u) => u.enRoute?.alertId && hits.some((h) => h.alertId === u.enRoute!.alertId));
    const timeline = [...x.timeline, ...hits.map((h, i) => ({ at: now, label: !stillGoing && i === hits.length - 1 ? `Llegó ${h.unitId} · refuerzos en el lugar` : `Llegó ${h.unitId}` }))];
    return { ...x, dispatch: stillGoing ? x.dispatch : 'en_lugar', updatedAt: now, timeline };
  });
}
function advanceUnits(units: Unit[], now: number): Unit[] {
  return units.map((u) => {
    if (!u.enRoute) return u;
    // El destino acompaña a la alerta: si el vehículo de la placa aparece en otra cámara, la unidad cambia de rumbo.
    const t = u.enRoute.alertId ? followTarget(u.enRoute.alertId) : undefined;
    if (t && (t.lat !== u.enRoute.lat || t.lon !== u.enRoute.lon)) u = { ...u, enRoute: { ...u.enRoute, lat: t.lat, lon: t.lon, alertId: t.id, label: followLabel(t) } };
    const go = u.enRoute!;
    const d = metersBetween(u, go);
    if (d < 30) { if (go.alertId) arrivals.push({ alertId: go.alertId, unitId: u.id }); return { ...u, lat: go.lat, lon: go.lon, enRoute: null, lastReportAt: now, zoneId: state.alerts.find((a) => a.id === go.alertId)?.zoneId ?? u.zoneId }; }
    const k = Math.min(1, 45 / d);
    return { ...u, lat: u.lat + (go.lat - u.lat) * k, lon: u.lon + (go.lon - u.lon) * k, lastReportAt: now };
  });
}
// Demo: las alertas con refuerzos en camino al abrir tienen sus unidades viajando (desde un poco más lejos, para que se vea el viaje).
for (const a of state.alerts) if (a.dispatch === 'en_camino') {
  let ids = unitOptions(a).filter((o) => o.free && o.dist > 900).slice(0, suggestedUnits(a)).map((o) => o.unit.id);
  if (!ids.length) ids = nearestFree(a, suggestedUnits(a)); // si no hay lejos, las más cercanas
  if (ids.length) sendUnits(ids, { lat: a.lat, lon: a.lon, label: followLabel(a), alertId: a.id });
  else state.alerts = state.alerts.map((x) => (x.id === a.id ? { ...x, dispatch: 'en_lugar' } : x));
}

function patchAlert(id: string, fn: (a: Alert) => Alert) {
  commit({ alerts: state.alerts.map((a) => (a.id === id ? fn(a) : a)) });
}

const unitsTxt = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`;
/** POST /v1/alerts/{id}/confirm { units } — confirma y manda los refuerzos elegidos (pueden ser ninguno).
    El evento le llega a Maic por el backend, sin que el operador haga nada. */
export function confirmAlert(id: string, user: User, unitIds: string[] = []) {
  const now = Date.now();
  const a = state.alerts.find((x) => x.id === id); if (!a) return;
  patchAlert(id, (x) => ({ ...x, review: 'confirmada', reviewedBy: user.name, dispatch: unitIds.length ? 'en_camino' : null, updatedAt: now,
    timeline: [...x.timeline, { at: now, label: unitIds.length ? `Confirmada: se ${unitIds.length === 1 ? 'envía' : 'envían'} ${unitsTxt(unitIds.length)} (${unitIds.join(', ')})` : 'Confirmada sin refuerzos', by: user.name }] }));
  sendUnits(unitIds, { lat: a.lat, lon: a.lon, label: followLabel(a), alertId: id });
  audit(user, 'Confirmar alerta', id, unitIds.length ? `Refuerzos: ${unitIds.join(', ')}` : 'Sin refuerzos');
}
/** POST /v1/dispatch { point, units } — manda unidades a un punto del mapa ("¿Quién llega?"). */
export function sendUnitsTo(p: { lat: number; lon: number }, unitIds: string[], user: User, label = 'Refuerzo a un punto del mapa') {
  sendUnits(unitIds, { lat: p.lat, lon: p.lon, label });
  audit(user, 'Mandar unidades', unitIds.join(', '), `${unitsTxt(unitIds.length)} a ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`);
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

/* ---------------- Investigaciones ---------------- */
const inPlace = (p: InvPlace, x: { lat: number; lon: number }) => metersBetween(p, x) <= p.radiusM;
/** Nombre legible de un punto: la calle de la cámara más cercana. */
export function placeLabel(lat: number, lon: number) {
  let best: Camera | null = null, d = Infinity;
  for (const c of state.cameras) { const m = metersBetween({ lat, lon }, c); if (m < d) { d = m; best = c; } }
  return best ? (d < 60 ? best.street : `Cerca de ${best.street}`) : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

let invSeq = 931;
const newInvId = () => 'INV-' + String(invSeq++).padStart(4, '0');
export interface NewInvestigation { title: string; reason: string; place: InvPlace; from: number; to: number }
/** POST /v1/investigations → auditado. El motivo cubre todas las consultas que se hagan dentro. */
export function createInvestigation(n: NewInvestigation, user: User): Investigation {
  const k: Investigation = { ...n, id: newInvId(), createdAt: Date.now(), createdBy: user.name, plates: [], notes: [] };
  commit({ investigations: [k, ...state.investigations] });
  audit(user, 'Crear investigación', k.id, `${k.title} · ${k.place.label}`, k.reason);
  return k;
}
const patchInv = (id: string, f: (k: Investigation) => Investigation) => commit({ investigations: state.investigations.map((x) => (x.id === id ? f(x) : x)) });
/** PATCH /v1/investigations/{id} {place, from, to} → auditado: cambia lo que se consulta. */
export function moveInvestigation(id: string, patch: Partial<Pick<Investigation, 'place' | 'from' | 'to'>>, user: User) {
  const k = state.investigations.find((x) => x.id === id); if (!k) return;
  patchInv(id, (x) => ({ ...x, ...patch }));
  audit(user, 'Cambiar lugar o ventana', id, patch.place ? `${patch.place.label} · ${patch.place.radiusM} m` : 'Ventana de tiempo', k.reason);
}
/** POST /v1/investigations/{id}/plates {plate} → auditado. */
export function pinPlate(id: string, plate: string, user: User) {
  const k = state.investigations.find((x) => x.id === id); if (!k || k.plates.includes(plate)) return;
  patchInv(id, (x) => ({ ...x, plates: [...x.plates, plate] }));
  audit(user, 'Fijar vehículo', id, plate, k.reason);
}
/** DELETE /v1/investigations/{id}/plates/{plate}. */
export function unpinPlate(id: string, plate: string, user: User) {
  patchInv(id, (x) => ({ ...x, plates: x.plates.filter((p) => p !== plate) }));
  audit(user, 'Quitar vehículo', id, plate);
}
/** POST /v1/investigations/{id}/notes {text}. */
export function addInvNote(id: string, text: string, user: User) {
  patchInv(id, (x) => ({ ...x, notes: [...x.notes, { at: Date.now(), by: user.name, text }] }));
  audit(user, 'Nota en la investigación', id, text.length > 60 ? text.slice(0, 60) + '…' : text);
}

export interface PlaceVehicle { plate: string; reads: PlateRead[]; listed: boolean }
export interface WhatHappened { vehicles: PlaceVehicle[]; reads: number; alerts: Alert[]; cameras: Camera[] }
/** GET /v1/places/activity?lat=&lon=&r=&from=&to= — qué registraron las cámaras en ese lugar y esa ventana. */
export function whatHappened(place: InvPlace, from: number, to: number): WhatHappened {
  const now = Date.now();
  const cameras = state.cameras.filter((c) => inPlace(place, c));
  const camIds = new Set(cameras.map((c) => c.id));
  const rs = seed.reads.filter((x) => camIds.has(x.cameraId) && x.at >= from && x.at <= Math.min(to, now));
  const by = new Map<string, PlateRead[]>();
  for (const r of rs) (by.get(r.plate) ?? by.set(r.plate, []).get(r.plate)!).push(r);
  const vehicles = [...by.entries()].map(([plate, list]) => ({ plate, reads: list.sort((a, b) => a.at - b.at), listed: !!seed.plateWatch[plate] }))
    .sort((a, b) => Number(b.listed) - Number(a.listed) || b.reads.length - a.reads.length || a.reads[0].at - b.reads[0].at);
  const alerts = state.alerts.filter((a) => forOperator(a) && a.createdAt >= from && a.createdAt <= to && (camIds.has(a.cameraId) || inPlace(place, a))).sort((a, b) => a.createdAt - b.createdAt);
  return { vehicles, reads: rs.length, alerts, cameras };
}
/** Patrones del lugar: alertas y lecturas por hora del día en los últimos 7 días. */
export function placePatterns(place: InvPlace) {
  const now = Date.now(), from = now - 7 * 24 * 3600e3;
  const camIds = new Set(state.cameras.filter((c) => inPlace(place, c)).map((c) => c.id));
  const hour = (t: number) => Number(new Date(t).toLocaleString('en-US', { timeZone: 'America/El_Salvador', hour: 'numeric', hourCycle: 'h23' }));
  const reads = Array(24).fill(0) as number[], alerts = Array(24).fill(0) as number[];
  for (const r of seed.reads) if (camIds.has(r.cameraId) && r.at >= from && r.at <= now) reads[hour(r.at)]++;
  const list = state.alerts.filter((a) => forOperator(a) && a.createdAt >= from && (camIds.has(a.cameraId) || inPlace(place, a))).sort((a, b) => b.createdAt - a.createdAt);
  for (const a of list) alerts[hour(a.createdAt)]++;
  return { reads, alerts, list };
}

/* Investigación de ejemplo: el robo del primer vehículo de la lista, en la esquina de su segunda lectura. */
{
  const lead = seed.reads.filter((x) => x.plate === Object.keys(seed.plateWatch)[0]).sort((a, b) => a.at - b.at);
  const at = lead[1] ?? lead[0];
  if (at) state.investigations = [{
    id: newInvId(), title: 'Robo de vehículo con conductor', reason: 'Investigación de robo de vehículo · DEN-2026-114827',
    place: { lat: at.lat, lon: at.lon, label: at.street, radiusM: 250 }, from: lead[0].at - 40 * MIN, to: lead[lead.length - 1].at + 15 * MIN,
    createdAt: Date.now() - 20 * MIN, createdBy: 'Lucía Hernández', plates: [], notes: [],
  }];
}

/** GET /v1/plates/{plate}/reads?limit= — lecturas previas del mismo vehículo (detalle de alerta). */
export const readsOf = (plate: string) => seed.reads.filter((x) => x.plate === plate);
/** Las alertas de cámara caída van al administrador (Configuración), no a la bandeja del 911. */
export const forOperator = (a: Alert) => a.kind !== 'camara_caida';

/** Coincidencias faciales como alertas "Persona en lista" (las arma api/facial.ts, que es la fuente):
    reemplaza las que había, así la bandeja y el mapa las muestran junto a las demás. */
export function syncFaceAlerts(list: Alert[]) {
  commit({ alerts: [...state.alerts.filter((a) => a.kind !== 'persona_en_lista'), ...list] });
}
