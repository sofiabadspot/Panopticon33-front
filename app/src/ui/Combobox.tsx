/* Combobox: campo de texto que filtra una lista y se elige una opción. Uno solo para toda la consola
   (el buscador de la barra y "Sumar una zona entera" del evento).
   Accesible como pide ARIA 1.2: el foco queda en el campo y la opción activa se anuncia con
   aria-activedescendant. ↑ ↓ recorren, Enter elige, Esc cierra la lista (y con la lista cerrada,
   borra lo escrito); el foco nunca se va al body. Clic afuera cierra.
   Las opciones se agrupan si traen `group` (el título del grupo se ve, no se elige). */
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Icon } from './kit';

export interface ComboOption { key: string; label: ReactNode; sub?: ReactNode; icon?: string; group?: string }

export function Combobox<O extends ComboOption>({ label, query, onQuery, options, onPick, placeholder, empty, hint, prefix, suffix,
  className = '', inClassName = 'cbx-in', inputClassName, inputId, inputRef, groupLabel, keepOpenOnFocus = true, describedBy, invalid }: {
  /** Nombre del campo para el lector de pantalla (si no hay <label> visible apuntando a inputId). */
  label?: string;
  query: string; onQuery: (q: string) => void;
  options: O[]; onPick: (o: O) => void;
  placeholder?: string;
  /** Qué decir cuando lo escrito no encuentra nada. */
  empty?: ReactNode;
  /** Qué decir cuando todavía no hay opciones que mostrar (p. ej., "escribe dos letras"). */
  hint?: ReactNode;
  prefix?: ReactNode; suffix?: ReactNode;
  className?: string; inClassName?: string; inputClassName?: string;
  inputId?: string; inputRef?: Ref<HTMLInputElement>;
  /** Título visible de cada grupo (por defecto, el nombre del grupo). */
  groupLabel?: (g: string) => string;
  keepOpenOnFocus?: boolean;
  describedBy?: string; invalid?: boolean;
}) {
  const base = useId();
  const listId = `${base}-list`;
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLInputElement | null>(null);
  const setInput = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof inputRef === 'function') inputRef(el); else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };
  useEffect(() => { setSel(0); }, [query, options.length]);
  useEffect(() => {
    if (!open) return undefined;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', out); return () => window.removeEventListener('mousedown', out);
  }, [open]);
  // La opción activa siempre a la vista.
  useEffect(() => { if (open) document.getElementById(optId(sel))?.scrollIntoView({ block: 'nearest' }); }, [sel, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const optId = (i: number) => `${base}-o${i}`;
  const pick = (o: O) => { onPick(o); setOpen(false); };
  const showList = open && (options.length > 0 || !!empty || !!hint);
  const active = showList && options[sel] ? optId(sel) : undefined;

  const keys: InputHTMLAttributes<HTMLInputElement>['onKeyDown'] = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setSel((s) => Math.min(options.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && open && options[sel]) { e.preventDefault(); pick(options[sel]); }
    else if (e.key === 'Escape') {
      // Esc no llega a la consola (no cierra la ficha): primero cierra la lista, después borra.
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      else if (query) { e.preventDefault(); e.stopPropagation(); onQuery(''); }
    }
  };

  let last: string | undefined;
  return (
    <div className={`cbx ${className}`.trim()} ref={box}>
      <div className={inClassName}>
        {prefix}
        <input ref={setInput} id={inputId} className={inputClassName} value={query} placeholder={placeholder} autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active}
          aria-label={label} aria-describedby={describedBy} aria-invalid={invalid || undefined}
          onFocus={() => keepOpenOnFocus && setOpen(true)} onChange={(e) => { onQuery(e.target.value); setOpen(true); }} onKeyDown={keys} />
        {suffix}
      </div>
      {showList && (
        <div className="search-pop" id={listId} role="listbox" aria-label={label}>
          {!options.length && (query.trim() ? empty : hint) && <div className="hint" role="presentation">{query.trim() ? empty : hint}</div>}
          {options.map((o, i) => {
            const head = o.group && o.group !== last ? <div className="grp" role="presentation" key={'g' + o.group}>{groupLabel ? groupLabel(o.group) : o.group}</div> : null;
            last = o.group;
            return [head, (
              <div key={o.key} id={optId(i)} role="option" aria-selected={i === sel} className={`res ${i === sel ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => pick(o)}>
                {o.icon ? <Icon name={o.icon} /> : <span />}<span>{o.label}{o.sub && <><br /><small>{o.sub}</small></>}</span>
                {i === sel && <span className="kbd" aria-hidden>↵</span>}
              </div>
            )];
          })}
        </div>
      )}
    </div>
  );
}
