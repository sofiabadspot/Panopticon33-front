/* Campo de formulario: etiqueta visible, ayuda y error debajo, enlazados al control.
   El control llega como función que recibe id, aria-describedby y aria-invalid: así sirve para
   input, select o textarea sin envolverlos en otro componente.
   Opcional se marca en la etiqueta: "(opcional)". Lo obligatorio no se marca. */
import { useId, type ReactNode } from 'react';
import { Icon } from './kit';
import { fromLocalInput, toLocalInput } from '../api/format';
import { DateTimeInput, display } from './DatePicker';

export interface ControlProps { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }

export function Field({ label, hint, error, optional, className = '', children }: {
  label: ReactNode; hint?: ReactNode; error?: string | null; optional?: boolean; className?: string;
  children: (p: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-h` : undefined, errId = error ? `${id}-e` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}{optional && <span className="dim"> (opcional)</span>}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? <span className="err" id={errId}><Icon name="error" />{error}</span> : hint ? <span className="hint" id={hintId}>{hint}</span> : null}
    </div>
  );
}

/* ---------- Fecha y hora ----------
   Selector propio (ui/DatePicker.tsx): 24 h fijas, en hora de El Salvador (UTC−6), con el aspecto del
   sistema. Toda fecha de la consola pasa por acá. */

/** Valor del campo (texto "aaaa-mm-ddThh:mm") ↔ instante. Vacío o incompleto: NaN. */
export const toField = (t: number | null | undefined) => (t == null || !Number.isFinite(t) ? '' : toLocalInput(t));
export const fromField = fromLocalInput;

export function DateTimeField({ label, value, onChange, error, hint, optional, min, max, size = 'sm' }: {
  label: ReactNode; value: string; onChange: (v: string) => void; error?: string | null; hint?: ReactNode; optional?: boolean;
  /** Límites como instante (ms). */ min?: number; max?: number; size?: 'sm' | 'md';
}) {
  const lo = min != null && Number.isFinite(min) ? toField(min) : undefined, hi = max != null && Number.isFinite(max) ? toField(max) : undefined;
  // Fuera de los límites: se avisa acá mismo, salvo que quien usa el campo ya tenga su propio error.
  const t = fromField(value);
  const range = !Number.isFinite(t) ? null : lo && value < lo ? `No puede ser anterior a ${display(lo)}.` : hi && value > hi ? `No puede ser posterior a ${display(hi)}.` : null;
  const err = error ?? range;
  return (
    <Field label={label} error={err} hint={hint} optional={optional}>
      {(p) => <DateTimeInput id={p.id} describedBy={p['aria-describedby']} invalid={!!err} value={value} onChange={onChange} min={lo} max={hi} size={size} />}
    </Field>
  );
}

/** Errores de un rango: vacío, y fin antes del inicio. Los mensajes no usan vos ni tú. */
export function rangeErrors(from: string, to: string, labels: [string, string] = ['el inicio', 'el fin']) {
  const a = fromField(from), b = fromField(to);
  const e: { from?: string; to?: string } = {};
  const bad = 'La fecha no es válida. Usa el formato dd/mm/aaaa hh:mm.';
  if (!Number.isFinite(a)) e.from = from.trim() ? bad : `Falta ${labels[0]}.`;
  if (!Number.isFinite(b)) e.to = to.trim() ? bad : `Falta ${labels[1]}.`;
  else if (Number.isFinite(a) && b <= a) e.to = `${labels[1][0].toUpperCase()}${labels[1].slice(1)} tiene que ser posterior a ${labels[0]}.`.replace(/ a el /, ' al ');
  return e;
}

export interface RangePreset { label: string; range: () => [number, number] }

/** Rango de fechas: dos campos lado a lado, error debajo de cada uno y atajos opcionales
    (p. ej., "Últimas 24 h"). showErrors: mostrar los errores (después del primer envío, o en vivo). */
export function DateRangeField({ from, to, onChange, labels = ['Desde', 'Hasta'], errorLabels, showErrors = true, presets }: {
  from: string; to: string; onChange: (r: { from: string; to: string }) => void;
  labels?: [ReactNode, ReactNode]; errorLabels?: [string, string]; showErrors?: boolean; presets?: RangePreset[];
}) {
  const e = showErrors ? rangeErrors(from, to, errorLabels) : {};
  return (
    <div className="date-range">
      {presets && presets.length > 0 && (
        <div className="date-presets" role="group" aria-label="Atajos de fecha">
          {presets.map((p) => <button key={p.label} type="button" className="btn ghost xs" onClick={() => { const [a, b] = p.range(); onChange({ from: toField(a), to: toField(b) }); }}>{p.label}</button>)}
        </div>
      )}
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <DateTimeField label={labels[0]} value={from} onChange={(v) => onChange({ from: v, to })} error={e.from} />
        <DateTimeField label={labels[1]} value={to} onChange={(v) => onChange({ from, to: v })} error={e.to} min={Number.isFinite(fromField(from)) ? fromField(from) : undefined} />
      </div>
    </div>
  );
}
