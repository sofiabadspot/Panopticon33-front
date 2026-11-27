/* Anatomía única de las fichas (toda ficha nueva o revisada sigue este orden):
   1. SheetHead: volver, qué es (kicker), título, estado (aside) y navegar a otra cosa (ver, investigar, editar).
   2. Avisos de estado: .callout (sin medición, lista, diferencia de lectura…).
   3. Imagen o video.
   4. Cifras (.kpis).
   5. Detalle (dl.details, .box).
   6. Relacionados (alertas, unidades, cámaras, lecturas).
   7. Línea de tiempo.
   8. Zona de peligro (.danger-zone) al final del cuerpo: eliminar, cancelar, terminar.
   9. Pie (.pf): decidir y guardar. Si el rol no puede decidir, ahí va ReadOnlyNote (ui/kit).
   Ficha que no existe: SheetNotFound. Lista vacía: <li className="empty">. */
import { createContext, useContext, type ReactNode } from 'react';
import type { Sheet } from '../ctx';
import { EmptyState, Icon } from '../../ui/kit';
import { useConsole } from '../ctx';

/** Ficha abierta fuera del lateral (p. ej., dentro del muro de video): quien la aloja decide qué hacen
    volver, cerrar y los enlaces a otras fichas. Sin esto, la ficha usa la consola (lateral e historial). */
export const SheetNav = createContext<{ close: () => void; go: (s: Sheet) => void } | null>(null);
export const useSheetGo = () => { const nav = useContext(SheetNav); const c = useConsole(); return nav?.go ?? c.open; };

/** Cabecera común de las fichas: volver (historial de la consola), título y cerrar. */
export function SheetHead({ kicker, title, sub, aside, className = '' }: { kicker: ReactNode; title: ReactNode; sub?: ReactNode; aside?: ReactNode; className?: string }) {
  const c = useConsole();
  const nav = useContext(SheetNav);
  const back = nav ? nav.close : () => c.guardNav(() => ((history.state?.idx ?? 0) > 0 ? history.back() : c.close()));
  const close = nav ? nav.close : c.close;
  return (
    <div className={`ph ${className}`} style={{ alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
      <button className="iconbtn" onClick={back} aria-label="Volver" title="Volver"><Icon name="arrow_back" /></button>
      <div className="grow">
        <div className="kicker">{kicker}</div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>{title}</h2>
        {sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}
        {aside && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{aside}</div>}
      </div>
      <button className="iconbtn" onClick={close} aria-label="Cerrar ficha" title="Cerrar"><Icon name="close" /></button>
    </div>
  );
}

/** Ficha de algo que no está: un enlace viejo, algo que se borró o que no está en el alcance del rol.
    Siempre dice por qué puede pasar y ofrece salir (antes, cada ficha mostraba solo el título). */
export function SheetNotFound({ kicker, title = 'No encontrada', what }: { kicker: string; title?: string; what: string }) {
  const c = useConsole();
  const nav = useContext(SheetNav);
  return (
    <>
      <SheetHead kicker={kicker} title={title} />
      <div className="pb">
        <EmptyState icon="search" title={`No se encuentra ${what}`} action={<button className="btn secondary sm" onClick={nav ? nav.close : c.close}>Cerrar la ficha</button>}>
          Puede que se haya eliminado o que no esté en el alcance de este rol.
        </EmptyState>
      </div>
    </>
  );
}
