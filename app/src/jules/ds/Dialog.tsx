/* Jules usa el diálogo de la consola (src/ui/kit.tsx): mismo ancho, encabezado, pie, Esc y foco.
   Se mantiene la API de antes (open, actions, description). className "jules-ds" lleva los tokens
   de Jules al portal, para que el contenido (campos, etiquetas) se vea igual que adentro del panel. */
import type { ReactNode } from 'react';
import { Dialog as ConsoleDialog } from '../../ui/kit';

export function Dialog({ open, onClose, title, description, actions, className = '', children }: {
  open: boolean; onClose?: () => void; title?: string; description?: string; actions?: ReactNode; className?: string; children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <ConsoleDialog title={title ?? ''} description={description} onClose={() => onClose?.()} footer={actions} className={`jules-ds ${className}`.trim()}>
      {children}
    </ConsoleDialog>
  );
}
