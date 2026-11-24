/* Modal del DS de Sync (dialog.sv-dialog). Copia de sync-front/src/components/ds/Dialog.jsx.
   Esc lo cierra (onClose). actions: los botones de abajo. */
import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';

export function Dialog({ open, onClose, title, description, actions, className = '', children }: {
  open: boolean; onClose?: () => void; title?: string; description?: string; actions?: ReactNode; className?: string; children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (open && !dialogo.open) dialogo.showModal();
    if (!open && dialogo.open) dialogo.close();
  }, [open]);

  function cancelar(evento: SyntheticEvent) {
    evento.preventDefault();
    onClose?.();
  }

  return (
    <dialog ref={ref} className={['sv-dialog', className].filter(Boolean).join(' ')} onCancel={cancelar} aria-label={title}>
      {open && (
        <div className="sv-dialog__inner">
          <button type="button" className="sv-dialog__close" aria-label="Cerrar" onClick={onClose}>
            <svg className="sv-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {title && <h2 className="sv-dialog__title">{title}</h2>}
          {description && <p className="sv-dialog__desc">{description}</p>}
          {children}
          {actions && <div className="sv-dialog__actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}
