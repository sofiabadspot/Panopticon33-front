import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import icons from '../data/generated/icons.json';
import { Trend } from './Trend';
import type { Alert, Coverage, Evidence as Ev, Severity } from '../api/types';
import { COVERAGE_LABEL, KIND_ICON, MAIC_LABEL, REVIEW_LABEL, SEVERITY_LABEL } from '../api/labels';

const ICONS = icons as Record<string, string[]>;

/** Icono de Blueprint (Apache-2.0), mismo vocabulario que el prototipo. Decorativo salvo que lleve label. */
export function Icon({ name, label, className = '' }: { name: string; label?: string; className?: string }) {
  const paths = ICONS[name] ?? ICONS.radio_button_unchecked;
  return (
    <span className={`ms ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 20 20">{paths.map((d, i) => <path key={i} fillRule="evenodd" d={d} />)}</svg>
    </span>
  );
}

/** Severidad: forma + color + texto (rombo crítica, triángulo media, círculo baja). */
export function SeverityChip({ severity }: { severity: Severity }) {
  return <span className={`chip ${severity}`}><span className={`sev ${severity}`} aria-hidden />{SEVERITY_LABEL[severity]}</span>;
}

export function StatusChip({ alert }: { alert: Alert }) {
  if (alert.review === 'por_revisar') return <span className="chip outline">{REVIEW_LABEL.por_revisar}</span>;
  if (alert.review === 'descartada') return <span className="chip">Descartada</span>;
  /* Avance en Maic, cada paso distinto (el verde queda solo para "despachada": hay unidades en camino).
     Enviada: en curso (punto que late) · Recibida: Maic acusó recibo (borde) · Despachada: verde ·
     Cerrada: terminada, gris. Confirmada sin Maic: como enviada. */
  const m = alert.maic ?? 'enviada';
  if (m === 'despachada') return <span className="chip ok"><Icon name="done_all" />{MAIC_LABEL.despachada}</span>;
  if (m === 'cerrada') return <span className="chip closed"><Icon name="check" />{MAIC_LABEL.cerrada}</span>;
  if (m === 'recibida') return <span className="chip received"><Icon name="check" />{MAIC_LABEL.recibida}</span>;
  return <span className="chip sending"><span className="pulse-dot" aria-hidden />{alert.maic ? MAIC_LABEL.enviada : 'Confirmada'}</span>;
}

export function KindIcon({ alert }: { alert: Alert }) {
  return <span className={`ic ${alert.severity}`}><Icon name={KIND_ICON[alert.kind]} /></span>;
}

export function CoverageChip({ coverage }: { coverage: Coverage }) {
  if (coverage === 'medida') return <span className="chip ok"><span className="dot" aria-hidden />Medida</span>;
  return <span className="chip nodata"><Icon name="visibility_off" />{COVERAGE_LABEL[coverage]}</span>;
}

/** Regla de evidencia: solo material real. Si aún no hay, el marcador con el logo en B/N, nunca una imagen inventada. */
export function Evidence({ ev, small, tag }: { ev: Ev; small?: boolean; tag?: ReactNode }) {
  const body = ev.type === 'clip' ? <video src={ev.src} poster={ev.poster} autoPlay muted loop playsInline controls={!small} />
    : ev.type === 'imagen' ? <img src={ev.src} alt={ev.caption} />
    : <div className="ph-ev"><img src="/assets/logo-spotvision-bn.png" alt="" />{!small && ev.caption && <b>{ev.caption}</b>}</div>;
  if (small) return <span className="thumb" title={ev.caption}>{body}</span>;
  return <figure className="evidence" style={{ margin: 0 }}>{body}{tag && <span className="tag">{tag}</span>}</figure>;
}

/** Serie en el tiempo: ahora con ejes, umbral rotulado y detalle al pasar el mouse (ver Trend). */
export function Sparkline(p: { values: (number | null)[]; threshold?: number | null; height?: number; stepMin?: number }) {
  return <Trend {...p} />;
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal aria-label={title}>
        <div className="hd"><h2>{title}</h2><button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></div>
        <div className="bd">{children}</div>
        {footer && <div className="ft">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = (msg: string) => { const id = Date.now() + Math.random(); setItems((x) => [...x, { id, msg }]); setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3800); };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className="toast"><Icon name="check_circle" />{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** Reloj compartido para "hace X min" sin re-render por segundo en toda la app. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Estados de una lista: vacía y cargando ----------
   Vacía: un ícono, qué pasa en una frase y, si hay, qué se puede hacer. Nunca se ve como un error.
   Cargando: filas grises con la misma forma que las reales, para que nada salte cuando llegan. */
export function EmptyState({ icon, title, children, action, tone }: { icon: string; title: string; children?: ReactNode; action?: ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`empty-state ${tone ?? ''}`} role="status">
      <span className="es-ic" aria-hidden><Icon name={icon} /></span>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function SkeletonRows({ n = 4, thumb = false }: { n?: number; thumb?: boolean }) {
  return (
    <div className="skel-list" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`skel-row ${thumb ? 'sk-with-img' : ''}`}>
          {thumb && <i className="skel sk-img" />}
          <span><i className="skel sk-t" style={{ width: `${78 - (i % 3) * 14}%` }} /><i className="skel sk-s" />{thumb && <i className="skel sk-s short" />}</span>
        </div>
      ))}
    </div>
  );
}

/** Panel izquierdo mientras llegan los datos: la misma forma que el panel real (filtros, cifras, filas). */
export function PanelSkeleton({ kind }: { kind: 'lista' | 'imagenes' | 'estado' }) {
  return (
    <div className="pb sk-panel" aria-busy="true" aria-label="Cargando">
      {kind === 'estado'
        ? <div className="kpis sk-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><i className="skel sk-v" /><i className="skel sk-s" /></div>)}</div>
        : <div className="sk-chips">{[64, 86, 82, 52].map((w, i) => <i key={i} className="skel sk-chip" style={{ width: w }} />)}</div>}
      <div className="box flush"><SkeletonRows n={kind === 'estado' ? 4 : 6} thumb={kind === 'imagenes'} /></div>
    </div>
  );
}
/** Ficha lateral mientras llegan los datos: encabezado, imagen, cifras y filas. */
export function SheetSkeleton() {
  return (
    <div className="sk-sheet" aria-busy="true" aria-label="Cargando la ficha">
      <div className="sk-head"><i className="skel sk-s" style={{ width: 120 }} /><i className="skel sk-title" /><i className="skel sk-s" style={{ width: 180 }} /></div>
      <div className="pb">
        <i className="skel sk-media" />
        <div className="kpis sk-kpis">{[0, 1].map((i) => <div key={i} className="kpi"><i className="skel sk-v" /><i className="skel sk-s" /></div>)}</div>
        <div className="box flush"><SkeletonRows n={3} /></div>
      </div>
    </div>
  );
}
