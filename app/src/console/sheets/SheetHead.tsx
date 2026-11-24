import type { ReactNode } from 'react';
import { Icon } from '../../ui/kit';
import { useConsole } from '../ctx';

/** Cabecera común de las fichas: volver (historial de la consola), título y cerrar. */
export function SheetHead({ kicker, title, sub, aside, className = '' }: { kicker: ReactNode; title: ReactNode; sub?: ReactNode; aside?: ReactNode; className?: string }) {
  const c = useConsole();
  return (
    <div className={`ph ${className}`} style={{ alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
      <button className="iconbtn" onClick={() => ((history.state?.idx ?? 0) > 0 ? history.back() : c.close())} aria-label="Volver" title="Volver"><Icon name="arrow_back" /></button>
      <div className="grow">
        <div className="kicker">{kicker}</div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>{title}</h2>
        {sub && <div className="sub" style={{ marginTop: 2 }}>{sub}</div>}
        {aside && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{aside}</div>}
      </div>
      <button className="iconbtn" onClick={c.close} aria-label="Cerrar ficha" title="Cerrar"><Icon name="close" /></button>
    </div>
  );
}
