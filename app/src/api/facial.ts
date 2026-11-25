/* Verificación facial (fase 3): solo en puntos de control habilitados con SpotBox, contra listas
   autorizadas (personas buscadas, en investigación, desaparecidas). Una coincidencia nunca es una
   identificación: el operador 911 tiene el veredicto final. Los rostros que no coinciden no se guardan.

   · Una sola coincidencia por persona: si la misma persona vuelve a pasar por un punto de control, se
     suma la detección a su coincidencia abierta (dónde está ahora, recorrido), no se crea otra.
   · Cada perfil de la lista ya tiene su reconstrucción 3D, que se afina con cada detección confirmada:
     no hay un paso de "reconstruir".
   · Si el 911 confirma la identidad, se genera la alerta y se avisa al agente del punto de control; a
     Maic le llega el evento por el backend, sin que el operador haga nada. Si no, la descarta con un motivo.

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
/** Una foto de la persona en la lista: de dónde sale, de cuándo y cuánto se parece a la captura (0–1). */
export interface ListPhoto { src: string; caption: string; year: string; score: number }
/** Algo vinculado a la persona: un vehículo, otra persona, un lugar donde se la ve seguido o un caso.
    `weight` (0–1): qué tan fuerte es el vínculo (cuántas veces aparecen juntos, por ejemplo). */
export type LinkKind = 'vehiculo' | 'persona' | 'lugar' | 'caso';
/** Un momento en la historia de una conexión: cuándo, qué pasó, dónde y de qué fuente sale. */
export interface LinkEvent { at: number; label: string; place?: string; src?: string }
export interface PersonLink {
  id: string; kind: LinkKind; label: string; sub: string; weight: number;
  /** Datos de lo vinculado (marca y color del vehículo, lista de la persona, estado del caso…). */
  facts: [string, string][];
  /** Su historia con esta persona, en orden de fecha. */
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
const det = (k: number, at: number, score: number, capture = '/media/demo/face.jpg'): FacialDetection => {
  const cams = spots(); const c = cams[k % cams.length];
  return { at, cameraId: c.id, place: c.street, lat: c.lat, lon: c.lon, capture, score };
};

const seedMatches = (): FacialMatch[] => [
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
      { id: 'v1', kind: 'vehiculo', label: 'P 512-884', sub: 'Pickup gris · reporte de robo · visto juntos 3 veces', weight: 0.9,
        facts: [['Vehículo', 'Toyota Hilux · gris'], ['Año', '2019'], ['Estado', 'Reporte de robo'], ['Lectoras', '11 lecturas en 30 días']],
        events: [
          { at: NOW - 24 * DAY, label: 'Denuncia de robo del vehículo', src: 'Fiscalía' },
          { at: NOW - 21 * DAY, label: 'Visto junto a la persona', place: 'Plaza Salvador del Mundo', src: 'CAM-014' },
          { at: NOW - 9 * DAY, label: 'Visto junto a la persona', place: 'Mercado Central', src: 'CAM-031' },
          { at: NOW - 19 * MIN, label: 'La persona baja del vehículo', place: 'Punto de control', src: 'SPOTBOX-PC-03' },
        ] },
      { id: 'p1', kind: 'persona', label: 'LB-0377', sub: 'Coimputado en el mismo caso', weight: 0.7,
        facts: [['Lista', 'Personas buscadas'], ['Vínculo', 'Coimputado'], ['Caso', 'DEN-2026-114827']],
        events: [
          { at: NOW - 12 * DAY, label: 'Imputados juntos en el caso', src: 'Fiscalía' },
          { at: NOW - 9 * DAY, label: 'Detectados juntos', place: 'Mercado Central', src: 'CAM-031' },
        ] },
      { id: 'p2', kind: 'persona', label: 'Persona sin identificar', sub: 'Aparece con él en 2 detecciones', weight: 0.45,
        facts: [['Identidad', 'Sin identificar'], ['Reconstrucción 3D', 'Parcial (2 detecciones)']],
        events: [
          { at: NOW - 9 * DAY, label: 'Detectados juntos', place: 'Mercado Central', src: 'CAM-031' },
          { at: NOW - 2 * DAY, label: 'Detectados juntos', place: 'Plaza Salvador del Mundo', src: 'CAM-014' },
        ] },
      { id: 'l1', kind: 'lugar', label: 'Plaza Salvador del Mundo', sub: '5 detecciones en 30 días', weight: 0.8,
        facts: [['Zona', 'Z-01 Centro'], ['Horario habitual', '17:00–20:00'], ['Cámaras', 'CAM-014 · CAM-015']],
        events: [
          { at: NOW - 28 * DAY, label: 'Detección', src: 'CAM-015' },
          { at: NOW - 21 * DAY, label: 'Detección (con P 512-884)', src: 'CAM-014' },
          { at: NOW - 14 * DAY, label: 'Detección', src: 'CAM-014' },
          { at: NOW - 6 * DAY, label: 'Detección', src: 'CAM-015' },
          { at: NOW - 2 * DAY, label: 'Detección (con persona sin identificar)', src: 'CAM-014' },
        ] },
      { id: 'l2', kind: 'lugar', label: 'Mercado Central', sub: '2 detecciones en 30 días', weight: 0.4,
        facts: [['Zona', 'Z-07 Mercado Central'], ['Cobertura', 'Sin medición: faltan cámaras'], ['Cámaras', 'CAM-031']],
        events: [
          { at: NOW - 9 * DAY, label: 'Detección (con LB-0377 y P 512-884)', src: 'CAM-031' },
          { at: NOW - 3 * DAY, label: 'Detección', src: 'CAM-031' },
        ] },
      { id: 'c1', kind: 'caso', label: 'DEN-2026-114827', sub: 'Robo de vehículo · Fiscalía', weight: 0.85,
        facts: [['Delito', 'Robo de vehículo'], ['Organismo', 'Fiscalía'], ['Estado', 'En investigación'], ['Imputados', '2']],
        events: [
          { at: NOW - 24 * DAY, label: 'Denuncia recibida', src: 'Fiscalía' },
          { at: NOW - 12 * DAY, label: 'Imputado junto a LB-0377', src: 'Fiscalía' },
        ] },
      { id: 'c2', kind: 'caso', label: 'CAP-2026-0291', sub: 'Orden de captura vigente', weight: 1,
        facts: [['Tipo', 'Orden de captura'], ['Emitida por', 'Juzgado 4.º de Instrucción'], ['Vigencia', 'hasta el 15 ene 2027']],
        events: [
          { at: NOW - 10 * DAY, label: 'Orden de captura emitida', src: 'Juzgado' },
          { at: NOW - 10 * DAY + 3 * 60 * MIN, label: 'Ingresa a la lista de personas buscadas', src: 'PNC' },
        ] },
    ],
    listPhotos: [{ src: '/media/demo/portrait.jpg', caption: 'Ficha policial', year: '2025', score: 0.96 }, { src: '/media/demo/id.jpg', caption: 'Foto del DUI', year: '2021', score: 0.91 }],
    profile3d: { detections: 14, updatedAt: NOW - 2 * 24 * 60 * MIN }, scene: '/media/demo/cctv.jpg',
    detections: [det(2, NOW - 19 * MIN, 0.88), det(5, NOW - 11 * MIN, 0.91), det(0, NOW - 3 * MIN, 0.96)],
    status: 'por_revisar', agent: 'Agente PNC-224 (punto de control)',
    timeline: [{ at: NOW - 19 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 88 %)' }, { at: NOW - 11 * MIN, label: 'Nueva detección (91 %)' }, { at: NOW - 3 * MIN, label: 'Nueva detección (96 %)' }] },
  { id: 'FC-7302', spotbox: 'SPOTBOX-PC-05', list: 'investigacion', listRef: 'LI-1187', reason: 'Seguimiento por investigación de extorsión', orderUntil: null,
    name: 'Persona de ejemplo B', docId: 'DUI ••••••-8', traits: [
      { group: 'cuerpo', label: 'Estatura', list: '1,68 m', seen: '1,66–1,70 m (estimada)' },
      { group: 'rostro', label: 'Lunar', list: 'Mejilla izquierda', seen: 'Mejilla izquierda' },
      { group: 'vestimenta', label: 'Torso', list: null, seen: 'Camisa blanca' },
      { group: 'vestimenta', label: 'Accesorios', list: null, seen: 'Lentes oscuros en la mano' },
    ],
    links: [
      { id: 'p1', kind: 'persona', label: 'LI-1102', sub: 'Mismo caso de extorsión', weight: 0.75,
        facts: [['Lista', 'En investigación'], ['Vínculo', 'Mismo caso']],
        events: [{ at: NOW - 15 * DAY, label: 'Vinculados al mismo caso', src: 'Fiscalía' }] },
      { id: 'l1', kind: 'lugar', label: 'Calle el Progreso', sub: '3 detecciones en 7 días', weight: 0.6,
        facts: [['Zona', 'Z-03'], ['Horario habitual', '07:00–09:00']],
        events: [
          { at: NOW - 6 * DAY, label: 'Detección', src: 'CAM-022' },
          { at: NOW - 4 * DAY, label: 'Detección', src: 'CAM-022' },
          { at: NOW - 1 * DAY, label: 'Detección', src: 'CAM-023' },
        ] },
      { id: 'c1', kind: 'caso', label: 'EXT-2026-0412', sub: 'Extorsión · en investigación', weight: 0.9,
        facts: [['Delito', 'Extorsión'], ['Organismo', 'Fiscalía'], ['Estado', 'En investigación']],
        events: [{ at: NOW - 20 * DAY, label: 'Denuncia recibida', src: 'Fiscalía' }, { at: NOW - 15 * DAY, label: 'Ingresa a la lista en investigación', src: 'PNC' }] },
    ],
    listPhotos: [{ src: '/media/demo/id.jpg', caption: 'Foto del DUI', year: '2023', score: 0.89 }],
    profile3d: { detections: 6, updatedAt: NOW - 9 * 24 * 60 * MIN }, scene: '/media/demo/cctv.jpg',
    detections: [det(7, NOW - 9 * MIN, 0.89)],
    status: 'por_revisar', agent: 'Agente PNC-118 (punto de control)',
    timeline: [{ at: NOW - 9 * MIN, label: 'Coincidencia creada en el SpotBox (puntaje 89 %)' }] },
  { id: 'FC-7298', spotbox: 'SPOTBOX-PC-03', list: 'desaparecidas', listRef: 'LD-0044', reason: 'Denuncia de desaparición', orderUntil: null,
    name: 'Persona de ejemplo C', docId: 'DUI ••••••-1', traits: [
      { group: 'cuerpo', label: 'Estatura', list: '1,60 m', seen: '1,58–1,62 m (estimada)' },
      { group: 'vestimenta', label: 'Accesorios', list: 'Mochila roja (según la denuncia)', seen: 'Mochila roja' },
    ],
    links: [
      { id: 'l1', kind: 'lugar', label: 'Avenida Olímpica', sub: 'Último lugar donde se la vio', weight: 0.7,
        facts: [['Según', 'La denuncia']], events: [{ at: NOW - 4 * DAY, label: 'Último lugar donde se la vio', src: 'Denuncia' }] },
      { id: 'c1', kind: 'caso', label: 'DES-2026-0044', sub: 'Denuncia de desaparición', weight: 1,
        facts: [['Tipo', 'Desaparición'], ['Denunciante', 'Familia']], events: [{ at: NOW - 3 * DAY, label: 'Denuncia de desaparición', src: 'PNC' }] },
    ],
    listPhotos: [{ src: '/media/demo/portrait.jpg', caption: 'Foto aportada por la familia', year: '2026', score: 0.86 }],
    profile3d: { detections: 3, updatedAt: NOW - 30 * 24 * 60 * MIN }, scene: '/media/demo/cctv.jpg',
    detections: [det(3, NOW - 52 * MIN, 0.86)],
    status: 'descartada', reviewedBy: 'José Portillo', discardReason: 'No es la misma persona', agent: 'Agente PNC-224 (punto de control)',
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
