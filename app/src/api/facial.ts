/* Verificación facial (fase 3): solo en puntos de control habilitados con SpotBox,
   contra la lista de personas buscadas. Una coincidencia nunca es una identificación:
   la revisan el operador 911 y el agente en sitio. Los rostros que no coinciden no se guardan.
   Datos de ejemplo ficticios (media/demo, aportados por SPOTVISION).
   Endpoints previstos: GET /v1/checkpoints/matches · POST /v1/checkpoints/matches/{id}/notify · /discard */
import { useSyncExternalStore } from 'react';
import { audit } from './index';
import type { User } from './types';

export type FacialStatus = 'por_revisar' | 'agente_avisado' | 'descartada' | 'confirmada_agente' | 'descartada_agente';
export interface FacialMatch {
  id: string; checkpoint: string; spotbox: string; at: number; score: number;
  listRef: string; listName: string; reason: string; orderUntil: string;
  capture: string; listPhoto: string; scene: string;
  status: FacialStatus; agent: string; timeline: { at: number; label: string; by?: string }[];
}

const NOW = Date.now();
let matches: FacialMatch[] = [
  { id: 'FC-7301', checkpoint: 'Punto de control · Acceso norte Plaza Salvador del Mundo', spotbox: 'SPOTBOX-PC-03', at: NOW - 3 * 60_000, score: 0.96,
    listRef: 'LB-0291', listName: 'Personas buscadas', reason: 'Orden de captura vigente', orderUntil: '15 ene 2027',
    capture: '/media/demo/face.jpg', listPhoto: '/media/demo/portrait.jpg', scene: '/media/demo/cctv.jpg',
    status: 'por_revisar', agent: 'Agente PNC-224 (en el punto de control)', timeline: [{ at: NOW - 3 * 60_000, label: 'Coincidencia creada en el SpotBox (puntaje 96 %)' }] },
];
const subs = new Set<() => void>();
const set = (fn: (m: FacialMatch) => FacialMatch, id: string) => { matches = matches.map((m) => (m.id === id ? fn(m) : m)); subs.forEach((f) => f()); };
export const useFacial = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => matches);

export function notifyAgent(id: string, user: User) {
  set((m) => ({ ...m, status: 'agente_avisado', timeline: [...m.timeline, { at: Date.now(), label: 'Probable: se avisa al agente con foto de referencia, motivo y certeza', by: user.name }] }), id);
  audit(user, 'Avisar al agente', id, 'Verificación facial · coincidencia probable');
  // Respuesta simulada del agente en sitio (en producción llega desde su celular)
  setTimeout(() => set((m) => ({ ...m, timeline: [...m.timeline, { at: Date.now(), label: 'El agente está verificando la identidad por otros medios (documento, entrevista)' }] }), id), 2500);
}
export function discardFacial(id: string, reason: string, user: User) {
  set((m) => ({ ...m, status: 'descartada', timeline: [...m.timeline, { at: Date.now(), label: `Descartada: ${reason}`, by: user.name }] }), id);
  audit(user, 'Descartar coincidencia facial', id, 'Verificación facial', reason);
}
export const FACIAL_DISCARD = ['No es la misma persona', 'Imagen insuficiente', 'Duplicada'] as const;
