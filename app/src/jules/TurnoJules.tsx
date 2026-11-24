/* Un turno de Jules en la charla. Copia de sync-front/src/components/jules/TurnoJules.jsx.
   Mientras piensa, la Nebulosa va abajo de la pregunta con su texto al lado; cuando responde,
   la Nebulosa se va y la respuesta ocupa todo el ancho.
   estado: 'think' muestra la Nebulosa pensando; sin estado, solo la respuesta. */
import type { ReactNode } from 'react';
import { Nebulosa } from '../ui/Nebulosa';

export function TurnoJules({ estado, tamano = 24, className = '', children }: {
  estado?: 'think'; tamano?: number; className?: string; children: ReactNode;
}) {
  return (
    <div className={`jules-turno svx-entrar ${className}`}>
      {estado && (
        <span className="jules-turno__marca" aria-hidden="true">
          <Nebulosa state={estado} size={tamano} />
        </span>
      )}
      <div className="jules-turno__cuerpo">{children}</div>
    </div>
  );
}
