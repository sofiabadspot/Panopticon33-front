import { createContext, useContext, type ReactNode } from 'react';
import type { Sheet } from '../ctx';
import { Icon } from '../../ui/kit';
import { useConsole } from '../ctx';

/** Ficha abierta fuera del lateral (p. ej., dentro del muro de video): quien la aloja decide qué hacen
    volver, cerrar y los enlaces a otras fichas. Sin esto, la ficha usa la consola (lateral e historial). */
export const SheetNav = createContext<{ close: () => void; go: (s: Sheet) => void } | null>(null);
export const useSheetGo = () => { const nav = useContext(SheetNav); const c = useConsole(); return nav?.go ?? c.open; };

/** Cabecera común de las fichas: volver (historial de la consola), título y cerrar. */
export function SheetHead({ kicker, title, sub, aside, className = '' }: { kicker: ReactNode; title: ReactNode; sub?: ReactNode; aside?: ReactNode; className?: string }) {
  const c = useConsole();
  const nav = useContext(SheetNav);
  const back = nav ? nav.close : () => ((history.state?.idx ?? 0) > 0 ? history.back() : c.close());
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
