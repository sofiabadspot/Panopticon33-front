/* Menú desplegable de la consola (.sv-menu, estilos en app.css). Nació como copia del DS de Sync
   (sync-front/src/components/ds/Menu.jsx); ahora es el único menú: cuenta, Jules y barra del mapa.
   items: [{ label, onSelect, peligro?, separado?, marcado?, icono?, detalle? }]. align="end": se abre hacia la izquierda.
   marcado (true/false): la opción es de una sola elección (menuitemradio) y muestra la marca.
   encabezado: contenido fijo arriba de las opciones (p. ej., quién tiene la sesión).
   fijo: el menú se ubica sobre la pantalla (createPortal al final de la página) y se cierra
   al hacer scroll.
   Con teclado: Enter/espacio o ↓ abre, ↑ ↓ se mueven, Esc cierra y vuelve al botón. */
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem { label: string; onSelect?: () => void; peligro?: boolean; separado?: boolean; marcado?: boolean; icono?: ReactNode; detalle?: string }

export function Menu({ trigger, label, items, encabezado, align = 'start', fijo = false, className = '', triggerClassName = '', ...props }: {
  trigger: ReactNode; label: string; items: MenuItem[]; encabezado?: ReactNode; align?: 'start' | 'end'; fijo?: boolean; className?: string; triggerClassName?: string; 'data-tip'?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lugar, setLugar] = useState<CSSProperties | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const opciones = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  useEffect(() => {
    // Al abrir, el foco va a la opción marcada (si hay) o a la primera.
    if (abierto) opciones.current[Math.max(0, items.findIndex((item) => item.marcado))]?.focus();
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!abierto || !fijo || !boton.current) return undefined;
    const caja = boton.current.getBoundingClientRect();
    setLugar(align === 'end'
      ? { position: 'fixed', top: caja.bottom + 6, left: 'auto', right: window.innerWidth - caja.right }
      : { position: 'fixed', top: caja.bottom + 6, left: caja.left });
    const alMover = (evento: Event) => { if (!(evento.target instanceof Node && menu.current?.contains(evento.target))) setAbierto(false); };
    const alCambiarTamano = () => setAbierto(false);
    window.addEventListener('scroll', alMover, true);
    window.addEventListener('resize', alCambiarTamano);
    return () => {
      window.removeEventListener('scroll', alMover, true);
      window.removeEventListener('resize', alCambiarTamano);
    };
  }, [abierto, fijo, align]);

  useEffect(() => {
    if (!abierto) return undefined;
    function clicAfuera(evento: PointerEvent) {
      const destino = evento.target as Node;
      if (!contenedor.current?.contains(destino) && !menu.current?.contains(destino)) setAbierto(false);
    }
    document.addEventListener('pointerdown', clicAfuera);
    return () => document.removeEventListener('pointerdown', clicAfuera);
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    boton.current?.focus();
  }

  function teclaEnBoton(evento: KeyboardEvent) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setAbierto(true);
    }
  }

  function teclaEnMenu(evento: KeyboardEvent) {
    const actual = opciones.current.indexOf(document.activeElement as HTMLButtonElement);
    const ultimo = items.length - 1;
    const destinos: Record<string, number> = {
      ArrowDown: actual === ultimo ? 0 : actual + 1,
      ArrowUp: actual <= 0 ? ultimo : actual - 1,
      Home: 0,
      End: ultimo,
    };
    if (evento.key === 'Escape' || evento.key === 'Tab') {
      if (evento.key === 'Escape') evento.preventDefault();
      cerrar();
      return;
    }
    const siguiente = destinos[evento.key];
    if (siguiente === undefined) return;
    evento.preventDefault();
    opciones.current[siguiente]?.focus();
  }

  function elegir(item: MenuItem) {
    cerrar();
    item.onSelect?.();
  }

  const clasesContenido = ['sv-menu__content', align === 'end' && 'svx-menu__content--end'].filter(Boolean).join(' ');

  const contenido = (
    <div ref={menu} id={id} className={clasesContenido} role="menu" aria-label={label} hidden={!abierto} onKeyDown={teclaEnMenu} style={fijo ? lugar ?? undefined : undefined}>
      {encabezado && <div className="sv-menu__header">{encabezado}</div>}
      {items.map((item, indice) => (
        <Fragment key={item.label}>
          {item.separado && <div className="sv-menu__sep" role="separator" />}
          <button
            ref={(opcion) => { opciones.current[indice] = opcion; }}
            type="button"
            role={item.marcado === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.marcado === undefined ? undefined : item.marcado}
            tabIndex={-1}
            className={['sv-menu__item', item.peligro && 'sv-menu__item--danger', item.marcado && 'sv-menu__item--on'].filter(Boolean).join(' ')}
            onClick={() => elegir(item)}
          >
            {item.icono && <span className="sv-menu__icon" aria-hidden="true">{item.icono}</span>}
            <span className="sv-menu__label">{item.label}{item.detalle && <small>{item.detalle}</small>}</span>
            {item.marcado !== undefined && (
              <svg className="sv-menu__check" viewBox="0 0 16 16" aria-hidden="true" style={{ visibility: item.marcado ? 'visible' : 'hidden' }}>
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div ref={contenedor} className={['sv-menu', className].filter(Boolean).join(' ')} {...props}>
      <button
        ref={boton}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((antes) => !antes)}
        onKeyDown={teclaEnBoton}
      >
        {trigger}
      </button>
      {fijo ? createPortal(<div className="sv-menu">{contenido}</div>, document.body) : contenido}
    </div>
  );
}

/** El teclado de un menú para menús con otro aspecto (p. ej., el de la barra del mapa): al abrir,
    el foco va a la primera opción; ↑ ↓ Home End se mueven; Esc y Tab cierran y el foco vuelve al botón. */
export function useMenuKeyboard(open: boolean, menu: { current: HTMLElement | null }, trigger: { current: HTMLElement | null }, close: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    items()[0]?.focus();
    const k = (e: globalThis.KeyboardEvent) => {
      const list = items(); const i = list.indexOf(document.activeElement as HTMLElement);
      if (i < 0 && e.key !== 'Escape') return;
      const to: Record<string, number> = { ArrowDown: (i + 1) % list.length, ArrowUp: (i - 1 + list.length) % list.length, Home: 0, End: list.length - 1 };
      if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } close(); trigger.current?.focus(); return; }
      if (to[e.key] === undefined) return;
      e.preventDefault(); e.stopPropagation(); list[to[e.key]]?.focus();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
