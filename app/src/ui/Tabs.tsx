/* Pestañas: una sola implementación para toda la consola.
   · Semántica de tablist: el lector de pantalla dice "pestaña 2 de 4, seleccionada".
   · Teclado: Tab entra a la elegida; ← → recorren (y eligen), Inicio y Fin van a los extremos.
   · Dos aspectos, el mismo comportamiento:
       'line'  → pestañas de navegación (barra de tareas de la consola, secciones del expediente).
       'chips' → filtros de una lista que cambian lo que se ve debajo (bandeja, listas faciales).
     Quien la usa puede sumar su clase (p. ej. .ltabs, .dz-dock) para el lugar donde va.
   Para elegir un valor dentro de un formulario, no: eso es Segmented. */
import { useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Cantidad al costado (se lee junto al nombre). */
  count?: ReactNode;
  /** Algo extra dentro de la pestaña (insignia, fase…). */
  extra?: ReactNode;
  /** Nombre completo para el lector de pantalla, si label no alcanza. */
  ariaLabel?: string;
}

export function Tabs<T extends string>({ label, items, value, onChange, variant = 'line', className = '', panelId, idPrefix, listRef, before, as = 'div' }: {
  /** Nombre del grupo de pestañas (lo lee el lector de pantalla). */
  label: string;
  items: TabItem<T>[]; value: T; onChange: (v: T) => void;
  variant?: 'line' | 'chips'; className?: string;
  /** id del panel que muestran las pestañas (aria-controls). */
  panelId?: string;
  /** Prefijo de los ids de cada pestaña (para que el panel diga aria-labelledby). Si falta, se genera. */
  idPrefix?: string;
  listRef?: Ref<HTMLElement>;
  /** Algo decorativo antes de las pestañas (el indicador deslizante de la barra de la consola). */
  before?: ReactNode;
  as?: 'div' | 'nav';
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const n = items.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); onChange(items[to].id); refs.current[to]?.focus();
  };
  const Tag = as;
  return (
    <Tag className={`tablist tablist-${variant} ${className}`.trim()} role="tablist" aria-label={label} ref={listRef as Ref<HTMLDivElement>}>
      {before}
      {items.map((t, i) => {
        const on = t.id === value;
        return (
          <button key={t.id} ref={(b) => { refs.current[i] = b; }} type="button" role="tab" id={idPrefix ? idPrefix + t.id : tabId(base, t.id)}
            data-tab={t.id} aria-selected={on} aria-controls={panelId} aria-label={t.ariaLabel} tabIndex={on ? 0 : -1}
            className={`${variant === 'chips' ? 'fchip' : ''} ${on ? 'on' : ''}`.trim() || undefined}
            onClick={() => onChange(t.id)} onKeyDown={(e) => move(e, i)}>
            {t.label}{t.count != null && <b className="tab-count">{t.count}</b>}{t.extra}
          </button>
        );
      })}
    </Tag>
  );
}

/** id de la pestaña, para el aria-labelledby del panel. */
export const tabId = (base: string, id: string) => `${base}tab-${id}`;
