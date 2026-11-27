/* Selector de fecha y hora de la consola: 24 h siempre, en hora de El Salvador, con el aspecto del sistema
   (no el control del navegador, que mostraba "a.m./p.m." y cambiaba según el equipo).
   - Se puede escribir: dd/mm/aaaa hh:mm.
   - O elegir en el calendario (botón a la derecha): ← → ↑ ↓ mueven el día, Re Pág / Av Pág el mes,
     Enter elige, Esc cierra y el foco vuelve al campo.
   El valor que entra y sale es el de siempre: "aaaa-mm-ddThh:mm" (lo convierte ui/Field.tsx). */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './kit';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];
const DAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pad = (n: number) => String(n).padStart(2, '0');

interface Parts { y: number; m: number; d: number; h: number; mi: number }
/** "aaaa-mm-ddThh:mm" → partes (o null). */
export function partsOf(v: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const p = { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  return valid(p) ? p : null;
}
const valid = (p: Parts) => p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysIn(p.y, p.m) && p.h >= 0 && p.h <= 23 && p.mi >= 0 && p.mi <= 59;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (p: Parts) => `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
/** Texto que se ve: dd/mm/aaaa hh:mm. */
export const display = (v: string) => { const p = partsOf(v); return p ? `${pad(p.d)}/${pad(p.m)}/${p.y} ${pad(p.h)}:${pad(p.mi)}` : v; };
/** Lo que escribe la persona → "aaaa-mm-ddThh:mm", o el texto tal cual si no se puede leer (queda inválido). */
function parseTyped(t: string): string {
  const s = t.trim(); if (!s) return '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2})[:.](\d{2}))?$/.exec(s);
  if (!m) return s;
  const p = { y: +m[3], m: +m[2], d: +m[1], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 };
  return valid(p) ? iso(p) : s;
}
/** Orden de días para comparar con min/max sin pasar por zonas horarias. */
const dayKey = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;

export function DateTimeInput({ id, value, onChange, min, max, invalid, describedBy, size = 'sm' }: {
  id?: string; value: string; onChange: (v: string) => void;
  /** Límites como "aaaa-mm-ddThh:mm". */ min?: string; max?: string;
  invalid?: boolean; describedBy?: string; size?: 'sm' | 'md';
}) {
  const [text, setText] = useState(display(value));
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), btn = useRef<HTMLButtonElement>(null);
  // Si el valor cambia desde afuera (p. ej., un atajo), el texto lo sigue; mientras se escribe, no se pisa.
  const typing = useRef(false);
  useEffect(() => { if (!typing.current) setText(display(value)); }, [value]);
  const commitText = (t: string) => { typing.current = true; setText(t); onChange(parseTyped(t)); };
  const popId = useId();
  return (
    <div ref={wrap} className={`dt ${size} ${invalid ? 'invalid' : ''}`}>
      <input ref={input} id={id} className="dt-in mono" value={text} placeholder="dd/mm/aaaa hh:mm" inputMode="numeric" autoComplete="off" spellCheck={false}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onChange={(e) => commitText(e.target.value)} onBlur={() => { typing.current = false; if (partsOf(value)) setText(display(value)); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setOpen(true); } }} />
      <button ref={btn} type="button" className="iconbtn dt-btn" aria-label="Elegir en el calendario" title="Elegir en el calendario (Alt + ↓)"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined} onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar_today" />
      </button>
      {open && <Calendar id={popId} anchor={wrap} value={value} min={min} max={max}
        onPick={(v) => { typing.current = false; onChange(v); setText(display(v)); }}
        onClose={(focusBack) => { setOpen(false); if (focusBack) input.current?.focus(); }} />}
    </div>
  );
}

function Calendar({ id, anchor, value, min, max, onPick, onClose }: {
  id: string; anchor: { current: HTMLElement | null }; value: string; min?: string; max?: string;
  onPick: (v: string) => void; onClose: (focusBack: boolean) => void;
}) {
  const now = partsOf(nowField()) ?? { y: 2026, m: 1, d: 1, h: 0, mi: 0 };
  const cur = partsOf(value);
  const [view, setView] = useState({ y: (cur ?? now).y, m: (cur ?? now).m });
  const [focus, setFocus] = useState((cur ?? now).d);
  const [h, setH] = useState(pad(cur ? cur.h : now.h)), [mi, setMi] = useState(pad(cur ? cur.mi : now.mi));
  const [pos, setPos] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });
  const box = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null);
  const lo = partsOf(min ?? ''), hi = partsOf(max ?? '');
  const outOfRange = (y: number, m: number, d: number) => (lo && dayKey(y, m, d) < dayKey(lo.y, lo.m, lo.d)) || (hi && dayKey(y, m, d) > dayKey(hi.y, hi.m, hi.d));

  // Debajo del campo; si no entra, arriba. Fijo sobre la pantalla (no lo recorta el panel con scroll).
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect(), b = box.current?.getBoundingClientRect(); if (!a || !b) return;
    const below = a.bottom + 6 + b.height <= window.innerHeight;
    setPos({ position: 'fixed', top: below ? a.bottom + 6 : Math.max(8, a.top - 6 - b.height), left: Math.min(a.left, window.innerWidth - b.width - 8) });
  }, [anchor]);
  useEffect(() => { grid.current?.querySelector<HTMLButtonElement>(`[data-d="${focus}"]`)?.focus({ preventScroll: true }); }, [view, focus, pos]);
  useEffect(() => {
    const out = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose(false); };
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(false); };
    document.addEventListener('pointerdown', out); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', () => onClose(false), { once: true });
    return () => { document.removeEventListener('pointerdown', out); window.removeEventListener('scroll', scroll, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = (new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const total = daysIn(view.y, view.m);
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shiftMonth = (k: number, d = focus) => { const mm = view.m + k, y = view.y + Math.floor((mm - 1) / 12), m = ((mm - 1) % 12 + 12) % 12 + 1; setView({ y, m }); setFocus(Math.min(d, daysIn(y, m))); };
  const moveDay = (k: number) => { const d = focus + k; if (d < 1) { const pm = view.m === 1 ? 12 : view.m - 1, py = view.m === 1 ? view.y - 1 : view.y; shiftMonth(-1, daysIn(py, pm) + d); } else if (d > total) shiftMonth(1, d - total); else setFocus(d); };
  const time = () => { const hh = Math.min(23, Math.max(0, parseInt(h, 10) || 0)), mm = Math.min(59, Math.max(0, parseInt(mi, 10) || 0)); return { h: hh, mi: mm }; };
  const pick = (d: number) => { if (outOfRange(view.y, view.m, d)) return; onPick(iso({ y: view.y, m: view.m, d, ...time() })); onClose(true); };
  const gridKeys = (e: KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => moveDay(-1), ArrowRight: () => moveDay(1), ArrowUp: () => moveDay(-7), ArrowDown: () => moveDay(7),
      PageUp: () => shiftMonth(-1), PageDown: () => shiftMonth(1), Home: () => setFocus(1), End: () => setFocus(total),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); }
    if (e.key === 'Tab') { // el foco queda adentro mientras está abierto
      const f = [...(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input') ?? [])];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const sel = cur && cur.y === view.y && cur.m === view.m ? cur.d : null;
  const today = now.y === view.y && now.m === view.m ? now.d : null;
  return createPortal(
    <div ref={box} id={id} className="dtp" role="dialog" aria-modal="false" aria-label="Elegir fecha y hora" style={pos} onKeyDown={keys}>
      <div className="dtp-hd">
        <button type="button" className="iconbtn" onClick={() => shiftMonth(-1)} aria-label="Mes anterior" title="Mes anterior (Re Pág)"><Icon name="chevron_left" /></button>
        <b aria-live="polite">{MONTHS[view.m - 1]} {view.y}</b>
        <button type="button" className="iconbtn" onClick={() => shiftMonth(1)} aria-label="Mes siguiente" title="Mes siguiente (Av Pág)"><Icon name="chevron_right" /></button>
      </div>
      <div ref={grid} className="dtp-grid" role="grid" aria-label={`${MONTHS[view.m - 1]} de ${view.y}`} onKeyDown={gridKeys}>
        <div role="row" className="dtp-row">{DAYS.map((d, i) => <span key={d} role="columnheader" className="dtp-dow" aria-label={DAYS_LONG[i]}>{d}</span>)}</div>
        {Array.from({ length: cells.length / 7 }, (_, r) => (
          <div key={r} role="row" className="dtp-row">
            {cells.slice(r * 7, r * 7 + 7).map((d, i) => d === null ? <span key={i} role="gridcell" className="dtp-day empty" /> : (
              <span key={i} role="gridcell" aria-selected={d === sel}>
                <button type="button" data-d={d} tabIndex={d === focus ? 0 : -1} disabled={!!outOfRange(view.y, view.m, d)}
                  className={`dtp-day ${d === sel ? 'on' : ''} ${d === today ? 'today' : ''}`}
                  aria-label={`${d} de ${MONTHS[view.m - 1]} de ${view.y}${d === today ? ', hoy' : ''}`} onClick={() => pick(d)} onFocus={() => setFocus(d)}>{d}</button>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="dtp-time">
        <label htmlFor={`${id}-h`}>Hora</label>
        <input id={`${id}-h`} className="fld sm mono" inputMode="numeric" maxLength={2} value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ''))} aria-label="Hora (0 a 23)" />
        <span aria-hidden>:</span>
        <input className="fld sm mono" inputMode="numeric" maxLength={2} value={mi} onChange={(e) => setMi(e.target.value.replace(/\D/g, ''))} aria-label="Minutos (0 a 59)" />
        <span className="dim">24 h</span>
      </div>
      <div className="dtp-ft">
        <button type="button" className="btn ghost xs" onClick={() => { const n = partsOf(nowField()); if (n && !outOfRange(n.y, n.m, n.d)) { onPick(iso(n)); onClose(true); } }}>Ahora</button>
        <button type="button" className="btn primary xs" onClick={() => pick(focus)}>Listo</button>
      </div>
    </div>,
    document.body,
  );
}

/** "Ahora" en hora de El Salvador (UTC−6), como texto del campo. */
export const nowField = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 16);
