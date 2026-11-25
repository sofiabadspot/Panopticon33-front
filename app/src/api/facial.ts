/* Verificación facial (fase 3): solo en puntos de control habilitados con SpotBox, contra listas
   autorizadas (personas buscadas, en investigación, desaparecidas). Una coincidencia nunca es una
   identificación: el operador 911 tiene el veredicto final. Los rostros que no coinciden no se guardan.

   · Una sola coincidencia por persona: si la misma persona vuelve a pasar por un punto de control, se
     suma la detección a su coincidencia abierta (dónde está ahora, recorrido), no se crea otra.
   · Cada perfil de la lista ya tiene su reconstrucción 3D, que se afina con cada detección confirmada:
     no hay un paso de "reconstruir".
   · Si el 911 confirma la identidad, se genera la alerta y se avisa al agente del punto de control; a
     Maic le llega el evento por el backend, sin que el operador haga nada. Si no, la descarta con un motivo.

   Datos de ejemplo ficticios y sin imágenes: las capturas y fotos se muestran como lugar reservado.
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
/** Una foto de la persona en la lista: de dónde sale, de cuándo y cuánto se parece a la captura (0–1). */
export interface ListPhoto { src: string; caption: string; year: string; score: number }
/** Algo vinculado a la persona: un vehículo, otra persona, un lugar donde se la ve seguido o un caso.
    `weight` (0–1): qué tan fuerte es el vínculo (cuántas veces aparecen juntos, por ejemplo). */
export type LinkKind = 'vehiculo' | 'persona' | 'lugar' | 'caso';
/** Un hecho de la historia de la persona: cuándo, qué pasó, dónde, de qué fuente sale y qué conexiones
    involucra (por id). La historia es una sola para todas las conexiones, así los hechos quedan en orden
    entre sí (primero el robo, después se reconoce el vehículo, después la imputación…). */
export interface LinkEvent { at: number; label: string; place?: string; src?: string; links: string[] }
export interface PersonLink {
  id: string; kind: LinkKind; label: string; sub: string; weight: number;
  /** Datos de lo vinculado (marca y color del vehículo, lista de la persona, estado del caso…). */
  facts: [string, string][];
  /** Los hechos de la historia que la involucran (se arman desde `story`). */
  events: LinkEvent[];
}
/** Señas: cada una con lo que dice la lista y lo que se ve en la captura (null = no está o no se ve). */
export type TraitGroup = 'cuerpo' | 'rostro' | 'marcas' | 'vestimenta';
export const TRAIT_GROUPS: Record<TraitGroup, string> = { cuerpo: 'Cuerpo', rostro: 'Rostro', marcas: 'Tatuajes y cicatrices', vestimenta: 'Ropa y accesorios' };
export interface Trait { group: TraitGroup; label: string; list: string | null; seen: string | null; note?: string }
/** Fuentes contra las que se puede verificar la identidad. Las del Gobierno llegan directo (no por Maic). */
export const FACIAL_SOURCES: { name: string; state: 'conectada' | 'por_conectar' }[] = [
  { name: 'Lista de la PNC', state: 'conectada' }, { name: 'DUI (RNPN)', state: 'conectada' },
  { name: 'Aduanas', state: 'por_conectar' }, { name: 'Interpol', state: 'por_conectar' }, { name: 'PDI', state: 'por_conectar' }, { name: 'Fiscalía', state: 'por_conectar' },
];
export interface FacialMatch {
  id: string; spotbox: string;
  list: FacialList; listRef: string; reason: string; orderUntil: string | null;
  /** Datos mínimos de la persona en la lista (identificador, fotos y nombre). El documento va enmascarado. */
  name: string; docId: string;
  /** Todas las fotos de la persona en la lista (no solo una), cada una con cuánto se parece a la captura. */
  listPhotos: ListPhoto[];
  /** Señas: lo registrado en la lista frente a lo que se ve en la captura, por grupo. */
  traits: Trait[];
  /** Conexiones: vehículos, personas, lugares y casos vinculados (de la lista, de las detecciones y del análisis). */
  links: PersonLink[];
  /** La historia completa, en orden de fecha. */
  story: LinkEvent[];
  /** Reconstrucción 3D del perfil: ya existe y se afina con cada detección confirmada. */
  profile3d: { detections: number; updatedAt: number };
  scene: string;
  /** Detecciones de esta coincidencia: la primera la creó; la última es dónde está ahora. */
  detections: FacialDetection[];
  status: FacialStatus; reviewedBy?: string; discardReason?: string;
  agent: string; timeline: { at: number; label: string; by?: string }[];
}
export const lastDetection = (m: FacialMatch) => m.detections[m.detections.length - 1];
export const scoreOf = (m: FacialMatch) => lastDetection(m).score;

const NOW = Date.now(), MIN = 60_000, DAY = 24 * 60 * MIN;
/** Cámaras del sector donde hay puntos de control (las peatonales y mixtas que funcionan). */
const spots = () => snapshot().cameras.filter((c) => c.kind !== 'vehicular' && c.status === 'operativa');
const det = (k: number, at: number, score: number, capture = ''): FacialDetection => {
  const cams = spots(); const c = cams[k % cams.length];
  return { at, cameraId: c.id, place: c.street, lat: c.lat, lon: c.lon, capture, score };
};

const lk = (id: string, kind: LinkKind, label: string, sub: string, weight: number, facts: [string, string][]): PersonLink => ({ id, kind, label, sub, weight, facts, events: [] });
/** Cada conexión toma de la historia los hechos que la involucran (una sola fuente, siempre en orden). */
const tell = (m: FacialMatch): FacialMatch => {
  const story = [...m.story].sort((a, b) => a.at - b.at);
  return { ...m, story, links: m.links.map((l) => ({ ...l, events: story.filter((e) => e.links.includes(l.id)) })) };
};
const rawMatches = (): FacialMatch[] => [
  { id: 'FC-7301', spotbox: 'SPOTBOX-PC-03', list: 'buscadas', listRef: 'LB-0291', reason: 'Orden de captura vigente', orderUntil: '15 ene 2027',
    name: 'Persona de ejemplo A', docId: 'DUI ••••••-3', traits: [
      { group: 'cuerpo', label: 'Estatura', list: '1,74 m', seen: '1,72–1,76 m (estimada)' },
      { group: 'cuerpo', label: 'Contextura', list: 'Media', seen: 'Media' },
      { group: 'rostro', label: 'Vello facial', list: 'Barba (foto 2025)', seen: 'Barba corta' },
      { group: 'rostro', label: 'Cicatriz', list: 'Sobre la ceja derecha', seen: null, note: 'la tapa la gorra' },
      { group: 'marcas', label: 'Tatuaje', list: 'Antebrazo izquierdo', seen: null, note: 'manga larga' },
      { group: 'vestimenta', label: 'Cabeza', list: null, seen: 'Gorra oscura' },
      { group: 'vestimenta', label: 'Torso', list: null, seen: 'Chaqueta gris' },
    ],
    links: [
      lk('v1', 'vehiculo', 'P 512-884', 'Pickup gris · robado · 3 veces con la persona', 0.9, [['Vehículo', 'Toyota Hilux · gris'], ['Año', '2019'], ['Estado', 'Robado · denuncia vigente'], ['Desde el robo', 'leído 4 veces']]),
      lk('p1', 'persona', 'LB-0377', 'Coimputado en el robo del pickup', 0.7, [['Lista', 'Personas buscadas'], ['Vínculo', 'Coimputado'], ['Caso', 'DEN-2026-114827']]),
      lk('p2', 'persona', 'Persona sin identificar', 'Aparece con ella en 2 detecciones', 0.45, [['Identidad', 'Sin identificar'], ['Reconstrucción 3D', 'Parcial (2 detecciones)']]),
      lk('l1', 'lugar', 'Plaza Salvador del Mundo', '4 detecciones en 30 días', 0.8, [['Zona', 'Z-01 Centro'], ['Horario habitual', '17:00–20:00'], ['Cámaras', 'CAM-014 · CAM-015']]),
      lk('l2', 'lugar', 'Mercado Central', '2 detecciones en 30 días', 0.4, [['Zona', 'Z-07 Mercado Central'], ['Cobertura', 'Sin medición: faltan cámaras'], ['Cámaras', 'CAM-031']]),
      lk('c1', 'caso', 'DEN-2026-114827', 'Robo del pickup · Fiscalía', 0.85, [['Delito', 'Robo de vehículo'], ['Organismo', 'Fiscalía'], ['Estado', 'En investigación'], ['Imputados', '2']]),
      lk('c2', 'caso', 'CAP-2026-0291', 'Orden de captura vigente', 1, [['Tipo', 'Orden de captura'], ['Emitida por', 'Juzgado 4.º de Instrucción'], ['Vigencia', 'hasta el 15 ene 2027']]),
    ],
    story: [
      { at: NOW - 40 * DAY, label: 'Roban el pickup P 512-884 y se abre la denuncia', src: 'Fiscalía', links: ['v1', 'c1'] },
      { at: NOW - 33 * DAY, label: 'Una lectora de placas lee el pickup robado', place: 'Plaza Salvador del Mundo', src: 'CAM-014', links: ['v1', 'l1'] },
      { at: NOW - 28 * DAY, label: 'La persona es reconocida manejando el pickup', place: 'Plaza Salvador del Mundo', src: 'CAM-015', links: ['v1', 'l1'] },
      { at: NOW - 21 * DAY, label: 'Llega en el pickup junto a LB-0377', place: 'Mercado Central', src: 'CAM-031', links: ['v1', 'p1', 'l2'] },
      { at: NOW - 14 * DAY, label: 'Fiscalía la imputa por el robo, junto a LB-0377', src: 'Fiscalía', links: ['c1', 'p1'] },
      { at: NOW - 10 * DAY, label: 'Se emite la orden de captura', src: 'Juzgado 4.º de Instrucción', links: ['c2'] },
      { at: NOW - 10 * DAY + 3 * 60 * MIN, label: 'Entra a la lista de personas buscadas', src: 'PNC', links: ['c2'] },
      { at: NOW - 6 * DAY, label: 'Detectada con una persona sin identificar', place: 'Plaza Salvador del Mundo', src: 'CAM-014', links: ['l1', 'p2'] },
      { at: NOW - 3 * DAY, label: 'Detectada sola', place: 'Mercado Central', src: 'CAM-031', links: ['l2'] },
      { at: NOW - 2 * DAY, label: 'Otra vez con la persona sin identificar', place: 'Plaza Salvador del Mundo', src: 'CAM-014', links: ['l1', 'p2'] },
      { at: NOW - 19 * MIN, label: 'Baja del pickup frente al punto de control', place: 'Punto de control', src: 'SPOTBOX-PC-03', links: ['v1'] },
    ],
    listPhotos: [{ src: '', caption: 'Ficha policial', year: '2025', score: 0.96 }, { src: '', caption: 'Foto del DUI', year: '2021', score: 0.91 }],
    profile3d: { detections: 14, updatedAt: NOW - 2 * 24 * 60 * MIN }, scene: '',
    detections: [det(4, NOW - 190 * MIN, 0.79), det(6, NOW - 105 * MIN, 0.84), det(2, NOW - 19 * MIN, 0.88), det(5, NOW - 11 * MIN, 0.91), det(0, NOW - 3 * MIN, 0.96)],
    status: 'por_revisar', agent: 'Agente PNC-224 (punto de control)',
    timeline: [{ at: NOW - 190 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 79 %)' }, { at: NOW - 105 * MIN, label: 'Nueva detección (84 %)' }, { at: NOW - 19 * MIN, label: 'Nueva detección (88 %)' }, { at: NOW - 11 * MIN, label: 'Nueva detección (91 %)' }, { at: NOW - 3 * MIN, label: 'Nueva detección (96 %)' }] },
  { id: 'FC-7302', spotbox: 'SPOTBOX-PC-05', list: 'investigacion', listRef: 'LI-1187', reason: 'Seguimiento por investigación de extorsión', orderUntil: null,
    name: 'Persona de ejemplo B', docId: 'DUI ••••••-8', traits: [
      { group: 'cuerpo', label: 'Estatura', list: '1,68 m', seen: '1,66–1,70 m (estimada)' },
      { group: 'rostro', label: 'Lunar', list: 'Mejilla izquierda', seen: 'Mejilla izquierda' },
      { group: 'vestimenta', label: 'Torso', list: null, seen: 'Camisa blanca' },
      { group: 'vestimenta', label: 'Accesorios', list: null, seen: 'Lentes oscuros en la mano' },
    ],
    links: [
      lk('p1', 'persona', 'LI-1102', 'Mismo caso de extorsión', 0.75, [['Lista', 'En investigación'], ['Vínculo', 'Mismo caso']]),
      lk('l1', 'lugar', 'Calle el Progreso', '3 detecciones en 7 días', 0.6, [['Zona', 'Z-03'], ['Horario habitual', '07:00–09:00']]),
      lk('c1', 'caso', 'EXT-2026-0412', 'Extorsión · en investigación', 0.9, [['Delito', 'Extorsión'], ['Organismo', 'Fiscalía'], ['Estado', 'En investigación']]),
    ],
    story: [
      { at: NOW - 20 * DAY, label: 'Denuncia de extorsión', src: 'Fiscalía', links: ['c1'] },
      { at: NOW - 15 * DAY, label: 'Se la vincula al caso junto a LI-1102', src: 'Fiscalía', links: ['c1', 'p1'] },
      { at: NOW - 15 * DAY + 2 * 60 * MIN, label: 'Entra a la lista en investigación', src: 'PNC', links: ['c1'] },
      { at: NOW - 6 * DAY, label: 'Detectada', place: 'Calle el Progreso', src: 'CAM-022', links: ['l1'] },
      { at: NOW - 4 * DAY, label: 'Detectada junto a LI-1102', place: 'Calle el Progreso', src: 'CAM-022', links: ['l1', 'p1'] },
      { at: NOW - 1 * DAY, label: 'Detectada', place: 'Calle el Progreso', src: 'CAM-023', links: ['l1'] },
    ],
    listPhotos: [{ src: '', caption: 'Foto del DUI', year: '2023', score: 0.89 }],
    profile3d: { detections: 6, updatedAt: NOW - 9 * 24 * 60 * MIN }, scene: '',
    detections: [det(7, NOW - 9 * MIN, 0.89)],
    status: 'por_revisar', agent: 'Agente PNC-118 (punto de control)',
    timeline: [{ at: NOW - 9 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 89 %)' }] },
  { id: 'FC-7298', spotbox: 'SPOTBOX-PC-03', list: 'desaparecidas', listRef: 'LD-0044', reason: 'Denuncia de desaparición', orderUntil: null,
    name: 'Persona de ejemplo C', docId: 'DUI ••••••-1', traits: [
      { group: 'cuerpo', label: 'Estatura', list: '1,60 m', seen: '1,58–1,62 m (estimada)' },
      { group: 'vestimenta', label: 'Accesorios', list: 'Mochila roja (según la denuncia)', seen: 'Mochila roja' },
    ],
    links: [
      lk('l1', 'lugar', 'Avenida Olímpica', 'Último lugar donde se la vio', 0.7, [['Según', 'La denuncia']]),
      lk('c1', 'caso', 'DES-2026-0044', 'Denuncia de desaparición', 1, [['Tipo', 'Desaparición'], ['Denunciante', 'Familia']]),
    ],
    story: [
      { at: NOW - 4 * DAY, label: 'La familia la ve por última vez', place: 'Avenida Olímpica', src: 'Denuncia', links: ['l1'] },
      { at: NOW - 3 * DAY, label: 'Denuncia de desaparición', src: 'PNC', links: ['c1'] },
    ],
    listPhotos: [{ src: '', caption: 'Foto aportada por la familia', year: '2026', score: 0.86 }],
    profile3d: { detections: 3, updatedAt: NOW - 30 * 24 * 60 * MIN }, scene: '',
    detections: [det(3, NOW - 52 * MIN, 0.86)],
    status: 'descartada', reviewedBy: 'José Portillo', discardReason: 'No es la misma persona', agent: 'Agente PNC-224 (punto de control)',
    timeline: [{ at: NOW - 52 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 86 %)' }, { at: NOW - 50 * MIN, label: 'Descartada: No es la misma persona', by: 'José Portillo' }] },
];
const seedMatches = () => rawMatches().map(tell);

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
    observations: m.detections.length, evidence: { type: 'pendiente', caption: 'Captura del punto de control' },
    review: m.status, reviewedBy: m.reviewedBy, discardReason: m.discardReason, dispatch: null, timeline: m.timeline,
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

/** El 911 confirma que es la persona: se genera la alerta y se avisa al agente en el punto de control. */
export function confirmFacial(id: string, user: User) {
  set((m) => ({ ...m, status: 'confirmada', reviewedBy: user.name, timeline: [...m.timeline,
    { at: Date.now(), label: 'Identidad confirmada por el operador 911: se genera la alerta', by: user.name },
    { at: Date.now(), label: 'Se avisa al agente con foto de referencia, motivo y certeza' }] }), id);
  audit(user, 'Confirmar coincidencia facial', id, 'Verificación facial · alerta generada');
}
export function discardFacial(id: string, reason: string, user: User) {
  set((m) => ({ ...m, status: 'descartada', reviewedBy: user.name, discardReason: reason, timeline: [...m.timeline, { at: Date.now(), label: `Descartada: ${reason}`, by: user.name }] }), id);
  audit(user, 'Descartar coincidencia facial', id, 'Verificación facial', reason);
}
export const FACIAL_DISCARD = ['No es la misma persona', 'Imagen insuficiente', 'Duplicada'] as const;
