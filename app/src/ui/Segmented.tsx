/* Selector segmentado (.seg): una sola opción elegida entre pocas, siempre a la vista.
   Es un radiogroup: el lector de pantalla dice cuál está elegida; Tab entra a la elegida y
   ← → ↑ ↓ eligen la anterior o la siguiente (como un grupo de radios del navegador).
   Para filtros que se prenden y apagan por separado, no: eso son botones con aria-pressed. */
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T> { value: T; label: ReactNode; count?: number; title?: string; disabled?: boolean }

export function Segmented<T extends string | number>({ label, showLabel = false, options, value, onChange, className = '', style }: {
  /** Nombre del grupo (lo lee el lector de pantalla). Con showLabel, también se ve al principio. */
  label: string; showLabel?: boolean;
  options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void;
  className?: string; style?: CSSProperties;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const to = e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled[enabled.length - 1]
      : step ? enabled[(enabled.indexOf(i) + step + enabled.length) % enabled.length] : undefined;
    if (to === undefined) return;
    e.preventDefault(); onChange(options[to].value); refs.current[to]?.focus();
  };
  return (
    <div className={`seg ${className}`.trim()} role="radiogroup" aria-label={label} style={style}>
      {showLabel && <span className="seg-lbl" aria-hidden>{label}</span>}
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} ref={(b) => { refs.current[i] = b; }} type="button" role="radio" aria-checked={on}
            tabIndex={on ? 0 : -1} className={on ? 'on' : ''} disabled={o.disabled} title={o.title}
            onClick={() => onChange(o.value)} onKeyDown={(e) => move(e, i)}>
            {o.label}{o.count !== undefined && <b>{o.count}</b>}
          </button>
        );
      })}
    </div>
  );
}
