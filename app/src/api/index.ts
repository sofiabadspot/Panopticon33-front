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
import { KIND_LABEL, ROLE_LABEL, SEVERITY_RANK, SEVERITY_TARGET_MIN } from './labels';
import { etaMin } from './coverage';
import { buildChapters } from './story';
import type { Other, Prior, Sight } from './story';
import { cameraClip } from './video';
import type { FacialList, FacialMatch, FacialDetection } from './facial';
import type {
  Alert, AuditEntry, Camera, Evidence, Incident, IncidentKind, InvPlace, Investigation, ListMode, MaicLink, MassEvent, PlateRead, Role, RoleConfig, Rule, RuleOverride, Severity, Sighting, Story, StoryChapter, StorySubject, Territory, Unit, User, WatchList, Zone, ZoneStatus,
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
  /** Sectores del territorio: agrupan zonas. */
  territories: Territory[];
  /** Capas y alcance de alertas de cada arquetipo (Configuración → Roles). */
  roleConfigs: RoleConfig[];
  /** Tiempo objetivo para decidir, por criticidad (minutos). */
  severityTargets: Record<Severity, number>;
  audit: AuditEntry[];
  maic: MaicLink;
  /** ¿Hay acceso a la plataforma de ubicación policial? Sin ella no hay capa de unidades ni brecha de presencia. */
  policeSource: boolean;
  /** Investigaciones de los analistas. */
  investigations: Investigation[];
  /** Historias del analista. */
  stories: Story[];
  /** Incidentes registrados a mano desde el mapa (barra de comandos). */
  incidents: Incident[];
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
  cargando: 'Cargando datos', sin_maic: 'Sin conexión con MAIC',
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
  territories: seed.territories,
  roleConfigs: readRoles(),
  severityTargets: { ...SEVERITY_TARGET_MIN },
  audit: seed.audit,
  maic: { connected: true, lastMessageAt: Date.now(), mode: 'producción' },
  policeSource: true,
  investigations: [],
  stories: [],
  incidents: [],
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
      return { ...a, review: 'confirmada', reviewedBy: 'Karla Méndez', dispatch: 'en_lugar', updatedAt: at, timeline: [...a.timeline, { at, label: 'Confirmada: se envía 1 unidad', by: 'Karla Méndez' }, { at: at + 6 * 60000, label: 'Llegó la unidad · unidades en el lugar' }] };
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
    revisar, o confirmada con unidades en camino), se actualiza esa: dónde está ahora, una lectura más y una línea en su
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
  /* Un rol recién creado todavía no tiene a nadie en la demo: se entra con una persona de prueba. */
  return { user: state.users.find((u) => u.role === role && u.active)
    ?? { id: 'U-demo-' + role, name: `Prueba · ${roleName(role)}`, role, territory: 'San Salvador', active: true } };
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
export const AVAIL_LABEL: Record<UnitAvail, string> = { disponible: 'Disponible', ocupada: 'Ocupada', asignada: 'Asignada', en_lugar: 'Ya en el lugar', sin_reporte: 'Sin reporte reciente', desconocida: 'Estado desconocido' };
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
    const detail = avail === 'asignada' ? unit.enRoute!.label : avail === 'ocupada' ? (zone ? `cuida ${zone}` : unit.task ? unit.task.label : 'en servicio') : undefined;
    const free = avail === 'disponible' || avail === 'ocupada';
    return { unit, eta, dist, avail, free, detail, why: free ? undefined : AVAIL_LABEL[avail] };
  }).sort((a, b) => a.eta - b.eta);
}
/** A qué está asignada una unidad, de lo más urgente a lo más general:
    · alerta: va como refuerzo (despacho desde la consola);
    · evento: cuida una zona que es parte de un evento en curso;
    · tarea: su jefatura le dio una tarea (control, custodia);
    · zona: cuida su zona, sin evento;
    · libre: sin asignar. */
export type UnitAssignment =
  | { k: 'alerta'; label: string; alertId?: string; since: number }
  | { k: 'evento'; label: string; eventId: string; zone: string }
  | { k: 'tarea'; label: string; since: number }
  | { k: 'zona'; label: string }
  | { k: 'libre' };
export function unitAssignment(u: Unit, now = Date.now()): UnitAssignment {
  if (u.enRoute) return { k: 'alerta', label: u.enRoute.label, alertId: u.enRoute.alertId, since: u.enRoute.since };
  const zone = u.zoneId ? state.zones.find((z) => z.id === u.zoneId) : undefined;
  const ev = zone ? state.events.find((e) => e.zoneIds.includes(zone.id) && eventStatus(e, now) === 'en_curso') : undefined;
  if (ev && zone) return { k: 'evento', label: ev.name, eventId: ev.id, zone: zone.name };
  if (u.task) return { k: 'tarea', label: u.task.label, since: u.task.since };
  if (zone) return { k: 'zona', label: zone.name };
  return { k: 'libre' };
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
    la alerta (y, si es una placa, las lecturas confirmadas del mismo vehículo) queda con los unidades en el lugar. */
function closeArrived(alerts: Alert[], units: Unit[], now: number): Alert[] {
  if (!arrivals.length) return alerts;
  const done = arrivals; arrivals = [];
  return alerts.map((x) => {
    const hits = done.filter(({ alertId }) => { const a = alerts.find((y) => y.id === alertId); return x.id === alertId || (!!a?.plate && x.plate?.listed === a.plate.listed); });
    if (!hits.length || x.review !== 'confirmada' || x.dispatch !== 'en_camino') return x;
    const stillGoing = units.some((u) => u.enRoute?.alertId && hits.some((h) => h.alertId === u.enRoute!.alertId));
    const timeline = [...x.timeline, ...hits.map((h, i) => ({ at: now, label: !stillGoing && i === hits.length - 1 ? `Llegó ${h.unitId} · unidades en el lugar` : `Llegó ${h.unitId}` }))];
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
// Demo: las alertas con unidades en camino al abrir tienen sus unidades viajando (desde un poco más lejos, para que se vea el viaje).
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
    timeline: [...x.timeline, { at: now, label: unitIds.length ? `Confirmada: se ${unitIds.length === 1 ? 'envía' : 'envían'} ${unitsTxt(unitIds.length)} (${unitIds.join(', ')})` : 'Confirmada sin enviar unidades', by: user.name }] }));
  sendUnits(unitIds, { lat: a.lat, lon: a.lon, label: followLabel(a), alertId: id });
  audit(user, 'Confirmar alerta', id, unitIds.length ? `Unidades: ${unitIds.join(', ')}` : 'Sin enviar unidades');
}
/** POST /v1/dispatch/recall { units } — retira unidades que iban como refuerzo: vuelven a su puesto.
    Si iban a una alerta y no queda ninguna en camino, la alerta queda confirmada sin refuerzos. */
export function recallUnits(unitIds: string[], user: User) {
  if (!unitIds.length) return;
  const now = Date.now(), set = new Set(unitIds);
  const alertIds = new Set(state.units.filter((u) => set.has(u.id) && u.enRoute?.alertId).map((u) => u.enRoute!.alertId!));
  const units = state.units.map((u) => (set.has(u.id) ? { ...u, status: 'disponible' as const, enRoute: null } : u));
  commit({ units });
  for (const aid of alertIds) {
    const left = units.some((u) => u.enRoute?.alertId === aid);
    patchAlert(aid, (x) => ({ ...x, dispatch: left ? x.dispatch : null, updatedAt: now,
      timeline: [...x.timeline, { at: now, label: `Se ${unitIds.length === 1 ? 'retira' : 'retiran'} ${unitIds.join(', ')}${left ? '' : ': sin unidades en camino'}`, by: user.name }] }));
  }
  audit(user, 'Retirar unidades', unitIds.join(', '), alertIds.size ? `Alerta ${[...alertIds].join(', ')}` : 'Envío a un punto');
}
/** POST /v1/dispatch { point, units } — manda unidades a un punto del mapa ("¿Quién llega?"). */
export function sendUnitsTo(p: { lat: number; lon: number }, unitIds: string[], user: User, label = 'Envío a un punto del mapa') {
  sendUnits(unitIds, { lat: p.lat, lon: p.lon, label });
  audit(user, 'Enviar unidades', unitIds.join(', '), `${unitsTxt(unitIds.length)} a ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`);
}

/** POST /v1/alerts/{id}/discard { reason } — el motivo alimenta el ajuste de umbrales. */
export function discardAlert(id: string, reason: string, user: User) {
  const now = Date.now();
  patchAlert(id, (a) => ({ ...a, review: 'descartada', reviewedBy: user.name, discardReason: reason, updatedAt: now,
    timeline: [...a.timeline, { at: now, label: `Descartada: ${reason}`, by: user.name }] }));
  audit(user, 'Descartar alerta', id, KIND_LABEL[state.alerts.find((a) => a.id === id)!.kind], reason);
}

/** POST /v1/alerts/{id}/reopen — deshace un descarte: la alerta vuelve a la bandeja por revisar. */
export function reopenAlert(id: string, user: User) {
  const now = Date.now();
  patchAlert(id, (a) => ({ ...a, review: 'por_revisar', reviewedBy: undefined, discardReason: undefined, updatedAt: now,
    timeline: [...a.timeline, { at: now, label: 'Descarte deshecho: vuelve a la bandeja', by: user.name }] }));
  audit(user, 'Deshacer descarte', id, KIND_LABEL[state.alerts.find((a) => a.id === id)!.kind]);
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
/** POST /v1/events/{id}/cancel — un evento programado que no va a ocurrir. Queda en la lista como cancelado. */
export function cancelEvent(id: string, reason: string, user: User) {
  commit({ events: state.events.map((e) => (e.id === id ? { ...e, cancelled: { at: Date.now(), by: user.name, reason } } : e)) });
  audit(user, 'Cancelar evento', id, state.events.find((e) => e.id === id)?.name ?? '', reason);
}
/** Deshace la cancelación (dentro de los segundos del aviso). */
export function restoreEvent(id: string, user: User) {
  commit({ events: state.events.map((e) => (e.id === id ? { ...e, cancelled: null } : e)) });
  audit(user, 'Deshacer cancelación de evento', id, state.events.find((e) => e.id === id)?.name ?? '');
}
/** POST /v1/events/{id}/end — un evento en curso que terminó antes de lo previsto. Devuelve el fin anterior (para deshacer). */
export function endEventNow(id: string, user: User): number {
  const prev = state.events.find((e) => e.id === id)!.end;
  const now = Date.now();
  commit({ events: state.events.map((e) => (e.id === id ? { ...e, end: now } : e)) });
  audit(user, 'Terminar evento', id, state.events.find((e) => e.id === id)?.name ?? '');
  return prev;
}
export function setEventEnd(id: string, end: number, user: User) {
  commit({ events: state.events.map((e) => (e.id === id ? { ...e, end } : e)) });
  audit(user, 'Deshacer fin de evento', id, state.events.find((e) => e.id === id)?.name ?? '');
}

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
export const newCameraId = () => 'CAM-' + String(state.cameras.length + 1).padStart(3, '0');
/** POST /v1/cameras (una) · POST /v1/cameras/import (CSV o Excel, con plantilla). Quedan sin presets hasta asociarlos. */
export function addCameras(cams: Camera[], user: User, via: 'manual' | 'csv') {
  const ids = new Set(state.cameras.map((c) => c.id));
  const fresh = cams.filter((c) => !ids.has(c.id));
  const cameras = [...state.cameras, ...fresh];
  commit({ cameras, zoneStatus: measure({ ...state, cameras }) });
  audit(user, via === 'csv' ? 'Importar cámaras' : 'Crear cámara', fresh.length === 1 ? fresh[0].id : `${fresh.length} cámaras`, via === 'csv' ? 'Carga masiva desde archivo' : fresh[0]?.street ?? '');
  return fresh.length;
}
/** POST /v1/zones/import — varias zonas a la vez, desde CSV. */
export function importZones(zones: Zone[], user: User) {
  for (const z of zones) { seed.zoneBase[z.id] = 0; level[z.id] = 0; history[z.id] = Array(30).fill(0); }
  const all = [...state.zones, ...zones];
  commit({ zones: all, zoneStatus: measure({ ...state, zones: all }) });
  audit(user, 'Importar zonas', `${zones.length} zonas`, zones.map((z) => z.name).join(', '));
}
/** PUT /v1/rules/{id}/overrides — umbral propio de una zona o evento (reemplaza al global mientras aplica). */
export function setRuleOverrides(id: string, overrides: RuleOverride[], user: User) {
  commit({ rules: state.rules.map((x) => (x.id === id ? { ...x, overrides } : x)) });
  audit(user, 'Editar excepciones de regla', id, overrides.length ? overrides.map((o) => `${o.targetId}: ${o.threshold}`).join(' · ') : 'Sin excepciones');
}
/** PUT /v1/settings/severity-targets — tiempo objetivo para decidir, por criticidad. */
export function setSeverityTargets(t: Record<Severity, number>, user: User) {
  Object.assign(SEVERITY_TARGET_MIN, t); // lo leen la bandeja y los íconos del mapa
  commit({ severityTargets: { ...t } });
  audit(user, 'Editar tiempos objetivo', 'Criticidad', `Crítica ${t.critica} · Media ${t.media} · Baja ${t.baja} min`);
}
/* ---------------- Roles ----------------
   En producción: GET/PUT/POST/DELETE /v1/roles y el evento roles.updated por el canal en vivo, que hace que las
   consolas abiertas con ese rol vuelvan a pedir GET /v1/me/permissions. En la demo los roles se guardan en este
   navegador y se avisan entre pestañas abiertas (evento storage): un cambio se ve al instante en las otras. */
const ROLES_KEY = 'p33.roles.v3';
function readRoles(): RoleConfig[] {
  const ok = (v: unknown): v is RoleConfig[] => Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r.role === 'string' && Array.isArray(r.tabs));
  try {
    // Claves literales: esta función corre al crear el estado, antes de que exista ROLES_KEY.
    const v = JSON.parse(localStorage.getItem('p33.roles.v3') || 'null');
    if (ok(v)) return v;
    /* v2 → v3 (27-nov): el Operador 911 y el Analista pasan a no tener Jules. Se conservan las demás ediciones de roles;
       después, un administrador puede volver a prenderlo desde Roles. */
    const old = JSON.parse(localStorage.getItem('p33.roles.v2') || 'null');
    if (ok(old)) return old.map((r) => (r.role === 'operator_911' || r.role === 'analyst' ? { ...r, jules: false } : r));
  } catch { /* sin almacenamiento o dato viejo */ }
  return seed.roleConfigs;
}
function commitRoles(roleConfigs: RoleConfig[]) {
  commit({ roleConfigs });
  try { localStorage.setItem(ROLES_KEY, JSON.stringify(roleConfigs)); } catch { /* sin almacenamiento */ }
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === ROLES_KEY) commit({ roleConfigs: readRoles() }); });

/** Nombre visible de un rol (el de la configuración; si ya no existe, el id). */
export const roleName = (role: Role) => state.roleConfigs.find((r) => r.role === role)?.name ?? ROLE_LABEL[role] ?? role;
/** Id de un rol nuevo a partir de su nombre ("Supervisor 911" → "supervisor_911"). No cambia al renombrarlo. */
export function roleIdFrom(name: string): string {
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'rol';
  let id = base, n = 2;
  while (state.roleConfigs.some((r) => r.role === id)) id = `${base}_${n++}`;
  return id;
}
/** Qué no deja guardar un rol (errores) y qué conviene revisar (avisos). `me`: el rol de quien edita. */
export function roleProblems(r: RoleConfig, all: RoleConfig[], me: Role): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const name = r.name.trim();
  if (!name) errors.push('Ponle un nombre al rol.');
  else if (all.some((x) => x.role !== r.role && x.name.trim().toLowerCase() === name.toLowerCase())) errors.push(`Ya hay un rol que se llama ${name}.`);
  if (!r.tabs.length && !r.config) errors.push('El rol no ve nada: asígnale al menos una pestaña o el acceso a Configuración.');
  const before = all.find((x) => x.role === r.role);
  if (before?.config && !r.config) {
    if (r.role === me) errors.push('No puedes quitarle Configuración a tu propio rol: no podrías volver a entrar.');
    else if (!all.some((x) => x.role !== r.role && x.config)) errors.push('Es el único rol con Configuración: sin él, nadie podría volver a configurar.');
  }
  const seesAlerts = r.tabs.includes('alertas') || r.layers.alerts !== 'oculta';
  if ((r.actions.includes('decidir') || r.actions.includes('despachar')) && !seesAlerts) warnings.push('Puede actuar sobre alertas, pero no tiene la pestaña Alertas ni la capa Alertas: no va a poder llegar a ellas.');
  if (r.actions.includes('despachar') && r.layers.units === 'oculta') warnings.push('Puede enviar unidades, pero la capa Unidades policiales está oculta.');
  if (r.actions.includes('decidir_facial') && !r.tabs.includes('verificacion')) warnings.push('Puede decidir coincidencias faciales, pero no tiene la pestaña Personas.');
  if (r.config) warnings.push('Tiene Configuración: es administrador. Puede cambiar zonas, reglas, roles y usuarios.');
  return { errors, warnings };
}
/** PUT /v1/roles/{role} — guarda el rol entero. Sube su versión: las consolas con ese rol lo aplican al instante. */
export function saveRole(next: RoleConfig, user: User) {
  const before = state.roleConfigs.find((r) => r.role === next.role);
  if (!before) return;
  commitRoles(state.roleConfigs.map((r) => (r.role === next.role ? { ...next, name: next.name.trim(), version: before.version + 1 } : r)));
  const changed = (Object.keys(next) as (keyof RoleConfig)[]).filter((k) => k !== 'version' && JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  audit(user, before.name !== next.name.trim() ? 'Renombrar rol' : 'Editar rol', next.name.trim(), changed.length ? `Cambió: ${changed.join(', ')}` : 'Sin cambios');
}
/** Compatibilidad: cambio parcial de un rol (capas, alcance…). */
export function updateRoleConfig(role: Role, patch: Partial<RoleConfig>, user: User) {
  const r = state.roleConfigs.find((x) => x.role === role); if (!r) return;
  saveRole({ ...r, ...patch, layers: { ...r.layers, ...patch.layers } }, user);
}
/** POST /v1/roles — crea un rol: copiando otro (`from`) o desde lo mínimo. */
export function createRole(name: string, from: RoleConfig | null, user: User): RoleConfig {
  const role = roleIdFrom(name);
  const minimal: Omit<RoleConfig, 'role' | 'name' | 'description' | 'system' | 'version'> = {
    tabs: ['estado'], alertScope: 'territorio', minSeverity: null, actions: [], jules: false, config: false,
    layers: { zones: 'disponible', events: 'disponible', alerts: 'disponible', units: 'disponible', cameras: 'disponible', hex: 'disponible', drones: 'disponible', helis: 'disponible' },
  };
  const r: RoleConfig = { ...(from ? { ...from, layers: { ...from.layers }, tabs: [...from.tabs], actions: [...from.actions] } : minimal),
    role, name: name.trim(), description: from ? from.description : '', system: false, version: 1 };
  commitRoles([...state.roleConfigs, r]);
  audit(user, 'Crear rol', r.name, from ? `Copia de ${from.name}` : 'Desde cero');
  return r;
}
/** DELETE /v1/roles/{role} — solo un rol creado y que nadie tenga. */
export function deleteRole(role: Role, user: User): boolean {
  const r = state.roleConfigs.find((x) => x.role === role);
  if (!r || r.system || state.users.some((u) => u.role === role)) return false;
  commitRoles(state.roleConfigs.filter((x) => x.role !== role));
  audit(user, 'Borrar rol', r.name, 'Sin usuarios');
  return true;
}
/** Territorio de un punto: el de su zona, o si no tiene, el de la zona más cercana (toda alerta tiene dirección). */
export function territoryAt(lat: number, lon: number, zoneId?: string | null): string {
  const z = (zoneId && state.zones.find((x) => x.id === zoneId))
    || [...state.zones].sort((a, b) => Math.hypot(a.lat - lat, a.lon - lon) - Math.hypot(b.lat - lat, b.lon - lon))[0];
  return z?.territory ?? 'Nacional';
}
/** ¿Le llega esta alerta al usuario? Según su rol (alcance y criticidad mínima) y su territorio. */
export function inScope(a: Alert, user: User): boolean {
  const cfg = state.roleConfigs.find((r) => r.role === user.role);
  if (!cfg) return false; // un rol sin configuración no ve alertas
  if (cfg.minSeverity && SEVERITY_RANK[a.severity] > SEVERITY_RANK[cfg.minSeverity]) return false;
  if (cfg.alertScope === 'territorio' && user.territory !== 'Nacional') return territoryAt(a.lat, a.lon, a.zoneId) === user.territory;
  return true;
}
export const roleConfigOf = (role: Role) => state.roleConfigs.find((r) => r.role === role)!;
/** Alcance de quien ve todo el país (no es un territorio). */
export const NATIONAL = 'Nacional';
/** POST /v1/territories */
export function addTerritory(t: Territory, user: User) {
  commit({ territories: [...state.territories, t] });
  audit(user, 'Crear territorio', t.name, t.note);
}
/** PATCH /v1/territories/{name} — renombrar actualiza sus zonas y sus usuarios. */
export function updateTerritory(name: string, next: Territory, user: User) {
  commit({
    territories: state.territories.map((t) => (t.name === name ? next : t)),
    zones: state.zones.map((z) => (z.territory === name ? { ...z, territory: next.name } : z)),
    users: state.users.map((u) => (u.territory === name ? { ...u, territory: next.name } : u)),
  });
  audit(user, 'Editar territorio', name, name !== next.name ? `Ahora se llama ${next.name}` : next.note);
}
/** DELETE /v1/territories/{name} — solo si no le quedan zonas ni usuarios. */
export function deleteTerritory(name: string, user: User) {
  commit({ territories: state.territories.filter((t) => t.name !== name) });
  audit(user, 'Eliminar territorio', name, '');
}
/** PATCH /v1/cameras/{id} — ubicación, tipo, zona, presets, cómputo. */
export function updateCamera(id: string, patch: Partial<Camera>, user: User) {
  const cameras = state.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c));
  // La zona lleva la lista de sus cámaras: se mantiene igual a lo que dice cada cámara.
  const zones = 'zoneId' in patch ? state.zones.map((z) => {
    const has = z.cameras.includes(id), should = patch.zoneId === z.id;
    return has === should ? z : { ...z, cameras: should ? [...z.cameras, id] : z.cameras.filter((x) => x !== id) };
  }) : state.zones;
  commit({ cameras, zones, zoneStatus: measure({ ...state, cameras, zones }) });
  audit(user, 'Editar cámara', id, Object.keys(patch).join(', '));
}
/** DELETE /v1/zones/{id} — no se borra una zona que usa un evento. */
export function deleteZone(id: string, user: User) {
  const z = state.zones.find((x) => x.id === id)!;
  const zones = state.zones.filter((x) => x.id !== id);
  const cameras = state.cameras.map((c) => (c.zoneId === id ? { ...c, zoneId: null } : c));
  commit({ zones, cameras, rules: state.rules.map((r) => ({ ...r, overrides: r.overrides.filter((o) => o.targetId !== id) })), zoneStatus: measure({ ...state, zones, cameras }) });
  audit(user, 'Eliminar zona', id, z.name);
}
export const zoneEvents = (id: string) => state.events.filter((e) => e.zoneIds.includes(id));
/** POST /v1/lists */
export function addList(l: Omit<WatchList, 'id' | 'entries' | 'lastSyncAt'>, user: User) {
  const id = 'L-' + String(state.lists.length + 1).padStart(2, '0');
  commit({ lists: [...state.lists, { ...l, id, entries: 0, lastSyncAt: Date.now() }] });
  audit(user, 'Crear lista', id, `${l.name} · ${l.mode}`);
  return id;
}
/** PUT /v1/lists/{id}/entries — carga manual: el archivo reemplaza el contenido de la lista. */
export function loadListEntries(id: string, entries: number, user: User) {
  commit({ lists: state.lists.map((l) => (l.id === id ? { ...l, entries, lastSyncAt: Date.now() } : l)) });
  audit(user, 'Cargar lista', id, `${entries} entradas desde archivo`);
}
export const LIST_MODES: ListMode[] = ['API', 'Copia periódica', 'Carga manual'];
/** PATCH /v1/lists/{id} — nombre, origen, cómo se actualiza y el plazo para avisar. */
export function updateList(id: string, patch: Partial<Pick<WatchList, 'name' | 'origin' | 'mode' | 'maxAgeMin'>>, user: User) {
  commit({ lists: state.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  audit(user, 'Editar lista', id, Object.keys(patch).join(', '));
}
/** DELETE /v1/lists/{id} — sus entradas dejan de generar alertas. Devuelve la lista (para deshacer). */
export function deleteList(id: string, user: User): WatchList | null {
  const l = state.lists.find((x) => x.id === id); if (!l) return null;
  commit({ lists: state.lists.filter((x) => x.id !== id) });
  audit(user, 'Eliminar lista', id, `${l.name} · ${l.entries} entradas`);
  return l;
}
export function restoreList(l: WatchList, user: User) {
  if (state.lists.some((x) => x.id === l.id)) return;
  commit({ lists: [...state.lists, l] });
  audit(user, 'Deshacer eliminación de lista', l.id, l.name);
}
/** DELETE /v1/rules/{id} — deja de crear ese tipo de alerta. Devuelve la regla y su lugar (para deshacer). */
export function deleteRule(id: string, user: User): { rule: Rule; index: number } | null {
  const index = state.rules.findIndex((x) => x.id === id); if (index < 0) return null;
  const rule = state.rules[index];
  commit({ rules: state.rules.filter((x) => x.id !== id) });
  audit(user, 'Eliminar regla', id, rule.name);
  return { rule, index };
}
export function restoreRule(r: { rule: Rule; index: number }, user: User) {
  if (state.rules.some((x) => x.id === r.rule.id)) return;
  const rules = [...state.rules]; rules.splice(r.index, 0, r.rule);
  commit({ rules });
  audit(user, 'Deshacer eliminación de regla', r.rule.id, r.rule.name);
}
/** DELETE /v1/cameras/{id} — sale de su zona (que puede quedar sin medición). Devuelve la cámara (para deshacer). */
export function deleteCamera(id: string, user: User): Camera | null {
  const cam = state.cameras.find((c) => c.id === id); if (!cam) return null;
  const cameras = state.cameras.filter((c) => c.id !== id);
  const zones = state.zones.map((z) => (z.cameras.includes(id) ? { ...z, cameras: z.cameras.filter((x) => x !== id) } : z));
  commit({ cameras, zones, zoneStatus: measure({ ...state, cameras, zones }) });
  audit(user, 'Eliminar cámara', id, cam.street);
  return cam;
}
export function restoreCamera(cam: Camera, user: User) {
  if (state.cameras.some((c) => c.id === cam.id)) return;
  const cameras = [...state.cameras, cam];
  const zones = state.zones.map((z) => (z.id === cam.zoneId && !z.cameras.includes(cam.id) ? { ...z, cameras: [...z.cameras, cam.id] } : z));
  commit({ cameras, zones, zoneStatus: measure({ ...state, cameras, zones }) });
  audit(user, 'Deshacer eliminación de cámara', cam.id, cam.street);
}
/** PATCH /v1/users/{id} { territory } */
export function setUserTerritory(id: string, territory: string, user: User) {
  commit({ users: state.users.map((u) => (u.id === id ? { ...u, territory } : u)) });
  audit(user, 'Asignar territorio', id, territory);
}
/** PATCH /v1/users/{id} */
export function setUserActive(id: string, active: boolean, user: User) {
  commit({ users: state.users.map((u) => (u.id === id ? { ...u, active } : u)) });
  audit(user, active ? 'Activar usuario' : 'Desactivar usuario', id, state.users.find((u) => u.id === id)!.name);
}

export const presence = seed.presence;
export const SECTOR = { name: 'Sector Salvador del Mundo', lat: seed.ORIGIN.lat, lon: seed.ORIGIN.lon };

/* ---------------- Utilidades derivadas ---------------- */
export const isListStale = (l: WatchList, now: number) => now - l.lastSyncAt > l.maxAgeMin * MIN;
/** Un evento cancelado cuenta como finalizado (no está en curso ni por venir); su ficha dice "Cancelado". */
export function eventStatus(e: MassEvent, now: number): 'programado' | 'en_curso' | 'finalizado' {
  if (e.cancelled) return 'finalizado';
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

/* ---------------- Incidentes ---------------- */
export const INCIDENT_LABEL: Record<IncidentKind, string> = { robo: 'Robo', rina: 'Riña', accidente: 'Accidente de tránsito', sospechoso: 'Persona o vehículo sospechoso', otro: 'Otro' };
let incSeq = 4410;
/** POST /v1/incidents → auditado. Lo registra un operador desde el mapa: tipo, punto, dirección y nota. */
export function registerIncident(n: Omit<Incident, 'id' | 'at' | 'by'>, user: User): Incident {
  const k: Incident = { ...n, id: 'INC-' + incSeq++, at: Date.now(), by: user.name };
  commit({ incidents: [k, ...state.incidents] });
  audit(user, 'Registrar incidente', k.id, `${INCIDENT_LABEL[k.kind]} · ${k.address}`);
  return k;
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

/* ---------------- Historia del analista ----------------
   Una historia es la reconstrucción de por dónde anduvo una placa o una persona: capítulos en orden, cada
   uno con su evidencia. Lo que el sistema vio se calcula de las lecturas y detecciones; lo que agrega el
   analista y los momentos clave que marca se guardan en la historia. */
interface FaceSource { matches: () => FacialMatch[]; unknown: () => { id: string; label: string; capture: string; sights: FacialDetection[]; seenWith: string }[]; listName: (l: FacialList) => string }
let faces: FaceSource | null = null;
/** Lo llama api/facial.ts al cargarse (index no lo importa: se evita el ciclo). */
export function registerFaces(f: FaceSource) { faces = f; }
const faceMatches = () => faces?.matches() ?? [];
const unknownFaces = () => faces?.unknown() ?? [];

const sameSubject = (a: StorySubject, b: StorySubject) =>
  a.k === 'placa' ? b.k === 'placa' && normalizePlate(a.plate) === normalizePlate(b.plate)
    : a.k === 'persona' ? b.k === 'persona' && a.matchId === b.matchId
      : b.k === 'sin_identificar' && a.faceId === b.faceId;

/** ¿Se puede abrir la historia? No la de una coincidencia descartada ni la de una que no existe. */
/** GET /v1/stories/subjects?plate= — placas que tienen lecturas y coinciden con lo escrito (también a medias:
    "P 512" encuentra "P 512-884"). Para el buscador: ofrece la historia de una placa real, no del texto escrito. */
export function storyPlates(q: string, max = 5): { plate: string; reads: number; listed: boolean }[] {
  const t = normalizePlate(q); if (t.length < 2) return [];
  const now = Date.now(), by = new Map<string, { plate: string; reads: number }>();
  for (const r of seed.reads) {
    if (r.at > now) continue;
    const k = normalizePlate(r.plate); if (!k.includes(t)) continue;
    const e = by.get(k); if (e) e.reads++; else by.set(k, { plate: r.plate, reads: 1 });
  }
  return [...by.values()].sort((a, b) => b.reads - a.reads).slice(0, max).map((e) => ({ ...e, listed: !!seed.plateWatch[e.plate] }));
}
export function canOpenStory(s: StorySubject): boolean {
  if (s.k === 'persona') { const m = faceMatches().find((x) => x.id === s.matchId); return !!m && m.status !== 'descartada'; }
  if (s.k === 'sin_identificar') return unknownFaces().some((u) => u.id === s.faceId);
  return true;
}

/** Cómo se nombra el sujeto. Del analista nunca sale el riesgo de la persona. */
export function storySubjectLabel(s: StorySubject): { title: string; sub: string; photos?: string[]; facts: [string, string][] } {
  if (s.k === 'persona') {
    const m = faceMatches().find((x) => x.id === s.matchId);
    if (!m) return { title: 'Persona', sub: 'Sin datos', facts: [] };
    const list = faces!.listName(m.list);
    return { title: m.name, sub: `${m.docId} · ${list}`, photos: m.listPhotos.map((p) => p.src), facts: [['Documento', m.docId], ['Lista', `${list} · ${m.listRef}`], ['Motivo de la lista', m.reason]] };
  }
  if (s.k === 'sin_identificar') {
    const u = unknownFaces().find((x) => x.id === s.faceId);
    return { title: u?.label ?? 'Sin identificar', sub: 'Sin nombre ni documento', facts: u ? [['Detecciones', String(u.sights.length)], ['Visto junto a', faceMatches().find((m) => m.id === u.seenWith)?.name ?? u.seenWith]] : [] };
  }
  const p = vehicleProfile(s.plate);
  return { title: p.plate, sub: p.seen ? `${p.seen.type} · ${p.seen.color}` : 'Sin lecturas', facts: [['Lecturas en 7 días', String(p.reads.length)], ...(p.listed ? [['En lista', 'Sí'] as [string, string]] : [])] };
}

let storySeq = 1;
/** POST /v1/stories → auditado. Pide motivo, salvo que venga de una investigación (hereda el suyo y su ventana).
    Si ya hay historia del sujeto con el mismo origen (la misma investigación, o ninguna), la devuelve sin auditar. */
export function openStory(s: StorySubject, reason: string, user: User, from?: { invId: string }): Story | null {
  const inv = from ? state.investigations.find((k) => k.id === from.invId) : undefined;
  const why = inv ? inv.reason : reason.trim();
  if (!why || !canOpenStory(s)) return null;
  // Una historia abierta desde una investigación es otra que la abierta suelta: hereda motivo y ventana.
  const had = state.stories.find((x) => sameSubject(x.subject, s) && x.invId === inv?.id);
  if (had) return had;
  const st: Story = {
    id: 'HIS-' + String(storySeq++).padStart(4, '0'), subject: s, title: storySubjectLabel(s).title, reason: why,
    createdAt: Date.now(), createdBy: user.name, invId: inv?.id, window: inv ? { from: inv.from, to: inv.to } : undefined, added: [], keyOverrides: {},
  };
  commit({ stories: [st, ...state.stories] });
  audit(user, 'Abrir historia', st.id, st.title, why);
  return st;
}

const camOf = (id?: string) => (id ? state.cameras.find((c) => c.id === id) : undefined);
const near2 = (a: number, b: number) => Math.abs(a - b) < 120_000;
/** Los capítulos de la historia, en orden. `ventana` limita a lo de la investigación; `todo` no. */
export function storyChapters(st: Story, range: 'ventana' | 'todo'): StoryChapter[] {
  const s = st.subject;
  const window = range === 'ventana' ? st.window : undefined;
  let sights: Sight[] = [], priors: Prior[] = [], others: Other[] = [], alertAt: { at: number; alertId: string } | undefined;
  const sightsOf = (list: FacialDetection[]): Sight[] => list.map((d) => ({
    at: d.at, cameraId: d.cameraId, place: d.place, lat: d.lat, lon: d.lon, confidence: d.score,
    evidence: d.capture ? { type: 'imagen', src: d.capture, caption: 'Captura del punto de control' } : { type: 'pendiente', caption: 'Captura del punto de control' },
  }));
  if (s.k === 'placa') {
    const np = normalizePlate(s.plate);
    const p = vehicleProfile(s.plate);
    sights = p.reads.map((x) => ({ at: x.at, cameraId: x.cameraId, place: x.street, lat: x.lat, lon: x.lon, confidence: x.confidence, evidence: x.evidence }));
    const inv = st.invId ? state.investigations.find((k) => k.id === st.invId) : undefined;
    const plates = inv ? inv.plates.filter((q) => normalizePlate(q) !== np) : p.companions.map((c) => c.plate);
    others = plates.map((q) => ({ label: q, sights: readsOf(q).map((x) => ({ at: x.at, cameraId: x.cameraId })) }));
  } else if (s.k === 'persona') {
    const m = faceMatches().find((x) => x.id === s.matchId);
    if (m) {
      sights = sightsOf(m.detections);
      priors = m.story.map((e) => {
        const c = camOf(e.src);
        return { at: e.at, label: e.label, src: e.src ?? 'Historial', camera: c ? { id: c.id, lat: c.lat, lon: c.lon, place: c.street } : undefined };
      });
      const al = state.alerts.find((a) => a.id === m.id);
      if (al) alertAt = { at: al.createdAt, alertId: al.id };
    }
  } else {
    const u = unknownFaces().find((x) => x.id === s.faceId);
    if (u) sights = sightsOf(u.sights);
  }

  const chs = buildChapters(sights, priors, st.added, { alertAt, others, keyOverrides: st.keyOverrides, window });

  // Con quién se lo vio: la otra cara (sin identificar o de lista) en la misma cámara a menos de 2 min.
  const twin: { mentions: StorySubject; sights: { at: number; cameraId: string }[] }[] = [];
  if (s.k === 'persona') for (const u of unknownFaces()) if (u.seenWith === s.matchId) twin.push({ mentions: { k: 'sin_identificar', faceId: u.id }, sights: u.sights });
  if (s.k === 'sin_identificar') {
    const u = unknownFaces().find((x) => x.id === s.faceId), m = u && faceMatches().find((x) => x.id === u.seenWith);
    if (m) twin.push({ mentions: { k: 'persona', matchId: m.id }, sights: m.detections });
  }
  return chs.map((c) => {
    const clip = c.cameraId ? cameraClip(c.cameraId) : null;
    const evidence: Evidence[] = clip && !c.evidence.some((e) => e.type === 'clip' && e.src === clip.src)
      ? [...c.evidence, { type: 'clip', src: clip.src, poster: clip.poster, caption: 'Video de la cámara ' + c.cameraId }] : c.evidence;
    const hit = c.cameraId ? twin.find((t) => t.sights.some((x) => x.cameraId === c.cameraId && near2(x.at, c.at))) : undefined;
    return { ...c, evidence, ...(hit ? { mentions: hit.mentions } : {}) };
  });
}

const patchStory = (id: string, f: (x: Story) => Story) => commit({ stories: state.stories.map((x) => (x.id === id ? f(x) : x)) });
let evSeq = 1;
/** POST /v1/stories/{id}/evidence → auditado: el analista suma un capítulo propio. */
export function addStoryEvidence(id: string, ch: Omit<StoryChapter, 'id' | 'source' | 'addedBy' | 'reads'>, user: User): string | null {
  const st = state.stories.find((x) => x.id === id); if (!st) return null;
  const c: StoryChapter = { ...ch, id: `analista-${ch.at}-${evSeq++}`, source: 'analista', addedBy: user.name, addedAt: Date.now(), reads: 0 };
  patchStory(id, (x) => ({ ...x, added: [...x.added, c] }));
  audit(user, 'Agregar evidencia', id, `${c.lat === null ? 'Sin lugar' : c.place} · ${c.evidence[0]?.caption ?? ''}`, st.reason);
  return c.id;
}
/** PATCH /v1/stories/{id} { saved } → auditado: lo que se está investigando pasa a ser una investigación con nombre. */
export function saveStory(id: string, name: string, user: User): void {
  const st = state.stories.find((x) => x.id === id); if (!st || !name.trim()) return;
  patchStory(id, (x) => ({ ...x, saved: { name: name.trim(), at: Date.now(), by: user.name } }));
  audit(user, 'Guardar investigación', id, name.trim(), st.reason);
}

/* Investigaciones de ejemplo (simulado): el analista entra y ya tiene casos trabajados, con su recorrido y
   evidencias agregadas. Se arman sobre placas que tienen lecturas reales en el seed. */
let sampled = false;
export function sampleInvestigations(): void {
  if (sampled) return; sampled = true;
  const now = Date.now(), counts = new Map<string, number>();
  for (const r of seed.reads) if (r.at <= now) counts.set(r.plate, (counts.get(r.plate) ?? 0) + 1);
  const plates = [...counts.entries()].filter(([, n]) => n >= 4).sort((a, b) => Number(!!seed.plateWatch[b[0]]) - Number(!!seed.plateWatch[a[0]]) || b[1] - a[1]).map(([p]) => p);
  const CASES = [
    { name: 'Robo de vehículo con conductor', reason: 'Denuncia por robo', caseId: 'FGR-2026-1184', ev: [['Externa', 'Video', 'Video de un vecino', 'Particular (vecino o testigo)'], ['Interna', 'Documento', 'Denuncia de la víctima en sede policial', 'Lista de la PNC']] },
    { name: 'Placa en lista: seguimiento de recorridos', reason: 'Seguimiento de vehículo en lista', caseId: 'EXP-0412', ev: [['Externa', 'Imagen', 'Cámara privada de un comercio', 'Comercio o cámara privada'], ['Externa', 'Documento', 'Informe de Aduanas: cruce de frontera', 'Aduanas']] },
    { name: 'Vehículo visto en dos hechos', reason: 'Requerimiento fiscal', caseId: 'FGR-2026-1201', ev: [['Externa', 'Documento', 'Requerimiento fiscal', 'Fiscalía'], ['Externa', 'Video', 'Video de un colectivo', 'Empresa de transporte']] },
  ];
  const made: Story[] = [];
  CASES.forEach((k, i) => {
    const plate = plates[i]; if (!plate || state.stories.some((x) => x.saved && x.subject.k === 'placa' && x.subject.plate === plate)) return;
    const reads = vehicleProfile(plate).reads; if (!reads.length) return;
    const st: Story = {
      id: 'HIS-' + String(storySeq++).padStart(4, '0'), subject: { k: 'placa', plate }, title: plate, reason: k.reason, caseId: k.caseId,
      createdAt: now - (i + 1) * 12 * 60_000, createdBy: 'Analista de turno', added: [], keyOverrides: {},
      saved: { name: k.name, at: now - (i + 1) * 10 * 60_000, by: 'Analista de turno' },
    };
    // Las evidencias de tipo Documento no tienen lugar en el mapa: en la reproducción salen como una escena.
    st.added = k.ev.map(([, kind, caption, src], j) => {
      const r = reads[Math.min(reads.length - 1, Math.floor(((j + 1) * reads.length) / (k.ev.length + 1)))];
      const at = r.at + 4 * 60_000, addedAt = Math.max(at + 60_000, st.saved!.at - (k.ev.length - j) * 60_000);
      const base = { id: `analista-${at}-${evSeq++}`, at, evidence: [{ type: 'pendiente' as const, caption }], source: 'analista' as const, addedBy: 'Analista de turno', addedAt, reads: 0, srcLabel: src };
      if (kind === 'Documento') return { ...base, lat: null, lon: null, place: 'Sin lugar en el mapa' };
      const lat = r.lat + 0.0012 * (j % 2 ? -1 : 1), lon = r.lon + 0.0015;
      return { ...base, lat, lon, place: placeLabel(lat, lon) };
    });
    made.push(st);
  });
  if (made.length) commit({ stories: [...state.stories, ...made] });
  samplePerson();
}
/* Una investigación de ejemplo sobre una persona de lista (si el reconocimiento facial ya cargó): su
   recorrido sale de las detecciones; se le suman las fotos del DUI, que no tienen lugar en el mapa. */
let sampledPerson = false;
export function samplePerson(): void {
  if (sampledPerson) return;
  const m = faceMatches().find((x) => x.status !== 'descartada' && x.detections.length > 1); if (!m) return;
  sampledPerson = true;
  if (state.stories.some((x) => x.saved && x.subject.k === 'persona' && x.subject.matchId === m.id)) return;
  const now = Date.now(), first = m.detections[0];
  const st: Story = {
    id: 'HIS-' + String(storySeq++).padStart(4, '0'), subject: { k: 'persona', matchId: m.id }, title: m.name, reason: 'Seguimiento de persona con orden de captura', caseId: m.listRef,
    createdAt: now - 40 * 60_000, createdBy: 'Analista de turno', keyOverrides: {},
    saved: { name: `Seguimiento de ${m.name}`, at: now - 30 * 60_000, by: 'Analista de turno' },
    added: [{ id: `analista-${first.at}-${evSeq++}`, at: first.at - 20 * 60_000, lat: null, lon: null, place: 'Sin lugar en el mapa', evidence: [{ type: 'pendiente', caption: 'Fotos del DUI y ficha de la persona' }], source: 'analista', addedBy: 'Analista de turno', addedAt: now - 35 * 60_000, reads: 0, srcLabel: 'DUI (RNPN)' }],
  };
  commit({ stories: [...state.stories, st] });
}
/** PATCH /v1/stories/{id}/key-moments/{chapterId} { key }: marca (true) o desmarca (false) un momento clave.
    El valor lo da la fila tal como se ve (en la ventana o en todo), así se puede quitar uno automático. */
export function toggleKeyMoment(id: string, chapterId: string, value: boolean): void {
  if (!state.stories.some((x) => x.id === id)) return;
  patchStory(id, (x) => ({ ...x, keyOverrides: { ...x.keyOverrides, [chapterId]: value } }));
}
