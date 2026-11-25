/* Estado de la consola única. Todo ocurre sobre el mapa: un panel a la izquierda
   (qué estoy mirando) y una ficha a la derecha (el detalle de lo que abrí).
   Nada cambia de vista; la URL solo guarda ?p=panel&s=ficha para poder volver
   con el botón Atrás y compartir un enlace. */
import { forOperator, useApi } from '../api';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LngLat, Role } from '../api/types';
import type { RouteStop } from '../map/MapView';
import { answerJules } from './jules';
import { useJulesStore, type JulesStore } from '../jules/store';

export interface InvDraft { title: string; lat: number; lon: number; label: string; from: number; to: number }
export type PanelId = 'estado' | 'alertas' | 'investigar' | 'eventos' | 'config' | 'bitacora' | 'verificacion';
export type Sheet =
  | { k: 'alerta'; id: string } | { k: 'zona'; id: string } | { k: 'evento'; id: string } | { k: 'evento-form'; id?: string }
  | { k: 'camara'; id: string } | { k: 'config'; tab?: string } | { k: 'bitacora'; tab?: string } | { k: 'jules' } | { k: 'facial'; id: string } | { k: 'vehiculo'; id: string };

const encode = (s: Sheet | null) => (!s ? '' : 'id' in s && s.id ? `${s.k}.${s.id}` : 'tab' in s && s.tab ? `${s.k}.${s.tab}` : s.k);
function decode(v: string | null): Sheet | null {
  if (!v) return null;
  const [k, ...rest] = v.split('.'); const id = rest.join('.');
  switch (k) {
    case 'alerta': case 'zona': case 'evento': case 'camara': case 'facial': case 'vehiculo': return id ? { k, id } as Sheet : null;
    case 'jules': return { k };
    case 'evento-form': return { k, id: id || undefined };
    case 'config': return { k, tab: id || undefined };
    case 'bitacora': return { k, tab: id || undefined };
    default: return null;
  }
}

/* ---------- Qué ve cada rol: pestañas con nombre en la columna izquierda ---------- */
export interface Tool { id: PanelId; label: string; phase?: string }
export const TOOLS: Record<Role, Tool[]> = {
  command: [{ id: 'estado', label: 'Estado' }, { id: 'alertas', label: 'Alertas' }, { id: 'eventos', label: 'Eventos' }],
  operator_911: [{ id: 'alertas', label: 'Alertas' }, { id: 'verificacion', label: 'Verificación' }, { id: 'estado', label: 'Estado' }],
  analyst: [{ id: 'investigar', label: 'Investigaciones' }, { id: 'alertas', label: 'Alertas' }, { id: 'estado', label: 'Estado' }, { id: 'eventos', label: 'Eventos' }],
  admin: [{ id: 'config', label: 'Configuración' }, { id: 'eventos', label: 'Eventos' }, { id: 'estado', label: 'Estado' }],
  auditor: [{ id: 'bitacora', label: 'Bitácora' }, { id: 'estado', label: 'Estado' }],
};
export const DEFAULT_PANEL: Record<Role, PanelId> = { command: 'estado', operator_911: 'alertas', analyst: 'investigar', admin: 'config', auditor: 'bitacora' };
export const DEFAULT_SHEET: Record<Role, Sheet | null> = { command: null, operator_911: null, analyst: null, admin: { k: 'config' }, auditor: { k: 'bitacora' } };

/** Qué fichas puede abrir cada rol. El rol define qué se ve. */
export function canOpenSheet(role: Role, s: Sheet): boolean {
  switch (s.k) {
    case 'config': return role === 'admin';
    case 'bitacora': return role === 'auditor';
    case 'evento-form': return role === 'admin';
    case 'alerta': return role !== 'admin';
    // Facial: decide el operador 911; el mando la ve (solo lectura), porque también es una alerta.
    case 'facial': return role === 'operator_911' || role === 'command';
    case 'vehiculo': return role === 'analyst';
    case 'jules': return role !== 'auditor';
    default: return true;
  }
}
export const canOpenPanel = (role: Role, p: PanelId) => TOOLS[role].some((t) => t.id === p);

/* ---------- Capas temporales que un panel pone sobre el mapa ---------- */
export interface Overlay {
  route?: RouteStop[];
  routeLabel?: string;
  sketch?: LngLat[];
  onMapClick?: (p: LngLat) => void;
  onZoneClick?: (id: string) => void;
  highlightZones?: string[];
  /** Encuadre pedido por el panel (p. ej. un recorrido). */
  fit?: { points: LngLat[]; key: string };
}

/* ---------- Búsquedas recientes ---------- */
export interface Recent { q: string; label: string; kind: string; ref: string }

export interface JulesMsg { from: 'user' | 'jules'; text: string; datos?: { valor: string; etiqueta: string }[]; actions?: { label: string; sheet?: Sheet; panel?: PanelId }[] }

interface Ctx {
  panel: PanelId; sheet: Sheet | null;
  setPanel: (p: PanelId) => void;
  open: (s: Sheet) => void; close: () => void;
  overlay: Overlay; setOverlay: (o: Overlay) => void;
  pin: { lat: number; lon: number; label: string } | null; setPin: (p: Ctx['pin']) => void;
  /** Emisión en el mapa al confirmar una alerta (anillos y haz sobre el punto). */
  signal: { lat: number; lon: number; label: string; key: string } | null; setSignal: (s: Ctx['signal']) => void;
  /** Alerta bajo el mouse (en la lista o en el mapa): se destaca en los dos lugares. */
  hoverAlert: string | null; setHoverAlert: (id: string | null) => void;
  /** Alertas que llegaron durante la sesión y todavía nadie abrió (se ven como "Nueva"). */
  fresh: string[]; arrival: string | null; dismissArrival: () => void; sound: boolean; setSound: (on: boolean) => void;
  focus: (points: LngLat[], key: string) => void; fitReq: { points: LngLat[]; key: string } | null;
  recents: Recent[]; remember: (r: Recent) => void;
  /** Investigación abierta (analista): el mapa pasa a su lugar y su ventana, y abajo va su línea de tiempo. */
  invId: string | null; setInvId: (id: string | null) => void;
  /** Esperando un clic en el mapa para mover el lugar de la investigación abierta. */
  invPick: boolean; setInvPick: (on: boolean) => void;
  /** Datos para empezar una investigación desde otra ficha (p. ej. una alerta): lugar y hora ya cargados. */
  invDraft: InvDraft | null; setInvDraft: (d: InvDraft | null) => void;
  /** Charla con Jules (src/jules/store.ts): sigue igual al abrir fichas y volver. */
  jules: JulesStore; askJules: (q: string) => void;
}
const C = createContext<Ctx | null>(null);
export const useConsole = () => useContext(C)!;

export function ConsoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const pRaw = params.get('p') as PanelId | null;
  const panel: PanelId = pRaw && canOpenPanel(role, pRaw) ? pRaw : DEFAULT_PANEL[role];
  const sRaw = decode(params.get('s'));
  const sheet = params.has('s') ? (sRaw && canOpenSheet(role, sRaw) ? sRaw : null) : DEFAULT_SHEET[role];

  const write = useCallback((p: PanelId | null | undefined, s: Sheet | null | undefined) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (p !== undefined) n.set('p', p ?? '');
      if (s !== undefined) n.set('s', encode(s));
      return n;
    });
  }, [setParams]);

  const [overlay, setOverlay] = useState<Overlay>({});
  const [pin, setPin] = useState<Ctx['pin']>(null);
  const [signal, setSignal] = useState<Ctx['signal']>(null);
  const [hoverAlert, setHoverAlert] = useState<string | null>(null);
  /* Llegada de alertas nuevas: se detectan las que aparecen después de abrir la consola.
     Quedan "frescas" hasta que alguien las abre; la última se anuncia arriba del mapa. */
  const allAlerts = useApi((s) => s.alerts);
  /** Alertas ya vistas y cuántas lecturas tenía cada una: una placa que vuelve a leerse también avisa. */
  const known = useRef<Map<string, number> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [arrival, setArrival] = useState<string | null>(null);
  const [sound, setSoundState] = useState(() => { try { return localStorage.getItem('p33.sound') !== 'off'; } catch { return true; } });
  const setSound = useCallback((on: boolean) => { setSoundState(on); try { localStorage.setItem('p33.sound', on ? 'on' : 'off'); } catch { /* sin almacenamiento */ } }, []);
  useEffect(() => {
    // Lecturas de una placa, detecciones de una persona: cada una nueva avisa.
    const seen = (a: (typeof allAlerts)[number]) => (a.kind === 'persona_en_lista' ? a.observations : a.sightings?.length ?? 1);
    if (!known.current) { known.current = new Map(allAlerts.map((a) => [a.id, seen(a)])); return; }
    const nuevas = allAlerts.filter((a) => (!known.current!.has(a.id) || seen(a) > known.current!.get(a.id)!) && a.review === 'por_revisar' && forOperator(a));
    allAlerts.forEach((a) => known.current!.set(a.id, seen(a)));
    if (!nuevas.length) return;
    setFresh((f) => [...nuevas.map((a) => a.id), ...f.filter((x) => !nuevas.some((a) => a.id === x))]);
    setArrival(nuevas[0].id);
    if (sound) chime();
  }, [allAlerts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fitReq, setFitReq] = useState<Ctx['fitReq']>(null);
  const [invId, setInvIdRaw] = useState<string | null>(null);
  const [invPick, setInvPick] = useState(false);
  const [invDraft, setInvDraft] = useState<InvDraft | null>(null);
  const setInvId = useCallback((id: string | null) => { setInvIdRaw(id); setInvPick(false); }, []);
  const jules = useJulesStore();
  const key = `p33.recent.${role}`;
  const [recents, setRecents] = useState<Recent[]>(() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } });
  useEffect(() => { try { setRecents(JSON.parse(localStorage.getItem(key) || '[]')); } catch { setRecents([]); } }, [key]);
  const remember = useCallback((r: Recent) => {
    setRecents((prev) => {
      const next = [r, ...prev.filter((x) => x.ref !== r.ref)].slice(0, 6);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      return next;
    });
  }, [key]);

  const value = useMemo<Ctx>(() => ({
    panel, sheet,
    setPanel: (p) => write(p, undefined),
    // Una alerta "Persona en lista" abre la ficha facial (ahí está la decisión del 911).
    open: (s0) => { const s: Sheet = s0.k === 'alerta' && s0.id.startsWith('FC-') ? { k: 'facial', id: s0.id } : s0; if (canOpenSheet(role, s)) { write(undefined, s); if (s0.k === 'alerta' || s.k === 'facial') { const id = s.k === 'facial' ? s.id : s0.k === 'alerta' ? s0.id : ''; setFresh((f) => f.filter((x) => x !== id)); setArrival((a) => (a === id ? null : a)); } } },
    close: () => write(undefined, null),
    overlay, setOverlay, pin, setPin, signal, setSignal, hoverAlert, setHoverAlert,
    fresh, arrival, dismissArrival: () => setArrival(null), sound, setSound,
    focus: (points, k) => setFitReq({ points, key: k + Date.now() }), fitReq,
    recents, remember, invId, setInvId, invPick, setInvPick, invDraft, setInvDraft,
    jules,
    // Mando tiene a Jules fijo en el lateral: se cierra lo que haya abierto para verlo. Los demás roles lo abren como ficha.
    askJules: (q) => {
      if (jules.estado === 'think') return;
      const ans = answerJules(q, role);
      jules.preguntar(q, { texto: ans.text, datos: ans.datos, acciones: ans.actions });
      write(undefined, role === 'command' ? null : { k: 'jules' });
    },
  }), [panel, sheet, write, role, overlay, pin, signal, hoverAlert, fresh, arrival, sound, setSound, fitReq, recents, remember, invId, setInvId, invPick, invDraft, jules]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

/** Un panel pone capas sobre el mapa mientras está abierto, y las quita al cerrarse. */
export function useOverlay(o: Overlay, deps: unknown[]) {
  const { setOverlay } = useConsole();
  useEffect(() => { setOverlay(o); return () => setOverlay({}); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/* Aviso sonoro corto de alerta nueva (dos tonos, Web Audio, sin archivos). */
function chime() {
  try {
    const W = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const ctx = new (window.AudioContext || W.webkitAudioContext!)();
    [[880, 0], [660, 0.16]].forEach(([f, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + at; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.start(t0); o.stop(t0 + 0.25);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* sin audio */ }
}
