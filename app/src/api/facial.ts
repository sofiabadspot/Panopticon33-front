/* Verificación facial (fase 3): solo en puntos de control habilitados con SpotBox, contra listas
   autorizadas (personas buscadas, en investigación, desaparecidas). Una coincidencia nunca es una
   identificación: el operador 911 tiene el veredicto final. Los rostros que no coinciden no se guardan.

   · Una sola coincidencia por persona: si la misma persona vuelve a pasar por un punto de control, se
     suma la detección a su coincidencia abierta (dónde está ahora, recorrido), no se crea otra.
   · Cada perfil de la lista ya tiene su reconstrucción 3D, que se afina con cada detección confirmada:
     no hay un paso de "reconstruir".
   · Si el 911 confirma la identidad, se genera la alerta y se envía a Maic (en este primer entregable,
     a mano; el escalamiento automático va después). Si no, la descarta con un motivo.

   Datos de ejemplo ficticios (media/demo, aportados por SPOTVISION).
   Endpoints previstos: GET /v1/checkpoints/matches · POST /v1/checkpoints/matches/{id}/confirm · /discard */
import { useSyncExternalStore } from 'react';
import { audit, snapshot, syncFaceAlerts } from './index';
import { placeAlert } from './place';
import type { Alert, User } from './types';

export type FacialStatus = 'por_revisar' | 'confirmada' | 'descartada';
export type FacialList = 'buscadas' | 'investigacion' | 'desaparecidas';
export const FACIAL_LISTS: Record<FacialList, { name: string; prefix: string }> = {
  buscadas: { name: 'Personas buscadas', prefix: 'LB' },
  investigacion: { name: 'En investigación', prefix: 'LI' },
  desaparecidas: { name: 'Personas desaparecidas', prefix: 'LD' },
};

/** Una vez que un punto de control vio a la persona: dónde, cuándo, con qué puntaje y la captura. */
export interface FacialDetection { at: number; cameraId: string; place: string; lat: number; lon: number; capture: string; score: number }
export interface FacialMatch {
  id: string; spotbox: string;
  list: FacialList; listRef: string; reason: string; orderUntil: string | null;
  /** Todas las fotos de la persona en la lista (no solo una). */
  listPhotos: string[];
  /** Reconstrucción 3D del perfil: ya existe y se afina con cada detección confirmada. */
  profile3d: { detections: number; updatedAt: number };
  scene: string;
  /** Detecciones de esta coincidencia: la primera la creó; la última es dónde está ahora. */
  detections: FacialDetection[];
  status: FacialStatus; reviewedBy?: string; discardReason?: string;
  /** Al confirmar: la alerta generada y su avance en Maic. */
  maic: null | 'enviada' | 'recibida'; maicId?: string;
  agent: string; timeline: { at: number; label: string; by?: string }[];
}
export const lastDetection = (m: FacialMatch) => m.detections[m.detections.length - 1];
export const scoreOf = (m: FacialMatch) => lastDetection(m).score;

const NOW = Date.now(), MIN = 60_000;
/** Cámaras del sector donde hay puntos de control (las peatonales y mixtas que funcionan). */
const spots = () => snapshot().cameras.filter((c) => c.kind !== 'vehicular' && c.status === 'operativa');
const det = (k: number, at: number, score: number, capture = '/media/demo/face.jpg'): FacialDetection => {
  const cams = spots(); const c = cams[k % cams.length];
  return { at, cameraId: c.id, place: c.street, lat: c.lat, lon: c.lon, capture, score };
};

const seedMatches = (): FacialMatch[] => [
  { id: 'FC-7301', spotbox: 'SPOTBOX-PC-03', list: 'buscadas', listRef: 'LB-0291', reason: 'Orden de captura vigente', orderUntil: '15 ene 2027',
    listPhotos: ['/media/demo/portrait.jpg', '/media/demo/id.jpg'], profile3d: { detections: 14, updatedAt: NOW - 2 * 24 * 60 * MIN }, scene: '/media/demo/cctv.jpg',
    detections: [det(2, NOW - 19 * MIN, 0.88), det(5, NOW - 11 * MIN, 0.91), det(0, NOW - 3 * MIN, 0.96)],
    status: 'por_revisar', maic: null, agent: 'Agente PNC-224 (punto de control)',
    timeline: [{ at: NOW - 19 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 88 %)' }, { at: NOW - 11 * MIN, label: 'Nueva detección (91 %)' }, { at: NOW - 3 * MIN, label: 'Nueva detección (96 %)' }] },
  { id: 'FC-7302', spotbox: 'SPOTBOX-PC-05', list: 'investigacion', listRef: 'LI-1187', reason: 'Seguimiento por investigación de extorsión', orderUntil: null,
    listPhotos: ['/media/demo/id.jpg'], profile3d: { detections: 6, updatedAt: NOW - 9 * 24 * 60 * MIN }, scene: '/media/demo/cctv.jpg',
    detections: [det(7, NOW - 9 * MIN, 0.89)],
    status: 'por_revisar', maic: null, agent: 'Agente PNC-118 (punto de control)',
    timeline: [{ at: NOW - 9 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 89 %)' }] },
  { id: 'FC-7298', spotbox: 'SPOTBOX-PC-03', list: 'desaparecidas', listRef: 'LD-0044', reason: 'Denuncia de desaparición', orderUntil: null,
    listPhotos: ['/media/demo/portrait.jpg'], profile3d: { detections: 3, updatedAt: NOW - 30 * 24 * 60 * MIN }, scene: '/media/demo/cctv.jpg',
    detections: [det(3, NOW - 52 * MIN, 0.86)],
    status: 'descartada', reviewedBy: 'José Portillo', discardReason: 'No es la misma persona', maic: null, agent: 'Agente PNC-224 (punto de control)',
    timeline: [{ at: NOW - 52 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 86 %)' }, { at: NOW - 50 * MIN, label: 'Descartada: No es la misma persona', by: 'José Portillo' }] },
];

let base: FacialMatch[] = [];
let matches: FacialMatch[] = [];
/** Escenario de la consola (ver setScenario en index): sin coincidencias, o todas ya revisadas. */
function forScenario(sc: string | null): FacialMatch[] {
  if (!base.length) base = seedMatches();
  if (sc === 'sin_alertas' || sc === 'cargando') return [];
  if (sc === 'gestionadas') return base.map((m) => (m.status === 'por_revisar' ? { ...m, status: 'descartada', discardReason: 'No es la misma persona', timeline: [...m.timeline, { at: lastDetection(m).at + 2 * MIN, label: 'Descartada: No es la misma persona', by: 'Karla Méndez' }] } : m));
  return base;
}
const readSc = () => { try { return localStorage.getItem('p33.escenario'); } catch { return null; } };
matches = forScenario(readSc());
const subs = new Set<() => void>();
queueMicrotask(() => syncFaceAlerts(matches.map(toAlert)));
/* Cada coincidencia también es una alerta "Persona en lista" (bandeja y mapa). Esta es la fuente: la
   alerta se rearma desde acá cada vez que cambia algo. Su número es el de la coincidencia (FC-…). */
const SEV: Record<FacialList, Alert['severity']> = { buscadas: 'critica', investigacion: 'media', desaparecidas: 'media' };
function toAlert(m: FacialMatch): Alert {
  const first = m.detections[0], d = lastDetection(m);
  return placeAlert({
    id: m.id, kind: 'persona_en_lista', severity: SEV[m.list], createdAt: first.at, updatedAt: d.at, zoneId: null, cameraId: d.cameraId, lat: d.lat, lon: d.lon,
    rule: { id: 'R-FACIAL', name: `Persona en lista · ${FACIAL_LISTS[m.list].name}`, threshold: 'Puntaje ≥ 85 %', measured: `Puntaje ${Math.round(d.score * 100)} %`, persistence: 'Inmediata' },
    observations: m.detections.length, evidence: { type: 'imagen', src: d.capture, caption: 'Captura del punto de control' },
    review: m.status, reviewedBy: m.reviewedBy, discardReason: m.discardReason, maic: m.maic, maicId: m.maicId, timeline: m.timeline,
  }, snapshot().zones);
}
const emit = () => { syncFaceAlerts(matches.map(toAlert)); subs.forEach((f) => f()); };
if (typeof window !== 'undefined') window.addEventListener('p33:escenario', (e) => { matches = forScenario((e as CustomEvent<string>).detail); emit(); });
const set = (fn: (m: FacialMatch) => FacialMatch, id: string) => { matches = matches.map((m) => (m.id === id ? fn(m) : m)); emit(); };
export const useFacial = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => matches);

/* Demo: la persona de FC-7301 vuelve a pasar por otro punto de control a los 40 s. Si su coincidencia
   sigue abierta (sin descartar), la detección se suma a esa; sube al principio de la lista. */
if (typeof window !== 'undefined') setTimeout(() => {
  const d = det(9, Date.now(), 0.94);
  const add = (list: FacialMatch[]) => {
    const m = list.find((x) => x.listRef === 'LB-0291' && x.status !== 'descartada'); if (!m) return list;
    return [{ ...m, detections: [...m.detections, d], timeline: [...m.timeline, { at: d.at, label: `Nueva detección (${Math.round(d.score * 100)} %): ${d.cameraId} · ${d.place}` }] }, ...list.filter((x) => x.id !== m.id)];
  };
  // También en la base: si se cambia de escenario y se vuelve, la detección sigue ahí.
  base = add(base); matches = add(matches);
  emit();
}, 40_000);

let maicSeq = 77950;
/** El 911 confirma que es la persona: se genera la alerta, se avisa al agente en el punto de control y
    se envía a Maic. Maic acusa recibo unos segundos después (simulado). */
export function confirmFacial(id: string, user: User) {
  const maicId = 'MAIC-' + maicSeq++;
  set((m) => ({ ...m, status: 'confirmada', reviewedBy: user.name, maic: 'enviada', maicId, timeline: [...m.timeline,
    { at: Date.now(), label: 'Identidad confirmada por el operador 911: se genera la alerta', by: user.name },
    { at: Date.now(), label: 'Se avisa al agente con foto de referencia, motivo y certeza' },
    { at: Date.now(), label: 'Enviada a Maic' }] }), id);
  audit(user, 'Confirmar coincidencia facial', id, 'Verificación facial · enviada a Maic');
  setTimeout(() => set((m) => (m.maic === 'enviada' ? { ...m, maic: 'recibida', timeline: [...m.timeline, { at: Date.now(), label: `Recibida en Maic (${maicId})` }] } : m), id), 3000);
}
export function discardFacial(id: string, reason: string, user: User) {
  set((m) => ({ ...m, status: 'descartada', reviewedBy: user.name, discardReason: reason, timeline: [...m.timeline, { at: Date.now(), label: `Descartada: ${reason}`, by: user.name }] }), id);
  audit(user, 'Descartar coincidencia facial', id, 'Verificación facial', reason);
}
export const FACIAL_DISCARD = ['No es la misma persona', 'Imagen insuficiente', 'Duplicada'] as const;
