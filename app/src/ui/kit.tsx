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
  return <span className="chip ok"><Icon name={alert.maic === 'despachada' || alert.maic === 'cerrada' ? 'done_all' : 'check'} />{alert.maic ? MAIC_LABEL[alert.maic] : 'Confirmada'}</span>;
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
