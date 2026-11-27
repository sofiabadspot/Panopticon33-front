/* Elegir archivos: un botón de la consola (no el control gris del navegador) y, al lado, qué se eligió.
   El input queda oculto a la vista pero no al teclado: Tab llega, Enter o espacio abren el selector,
   y el anillo de foco se ve sobre el botón (.file-btn en app.css). */
import { useId, useState } from 'react';
import { Icon } from './kit';

export function FileInput({ label, accept, multiple = false, onFiles, id: idProp, size = 'sm', variant = 'secondary', icon = 'arrow_upward', 'aria-describedby': describedBy }: {
  /** Texto del botón antes de elegir ("Subir archivo"). Después dice "Cambiar archivo(s)". */
  label: string; accept?: string; multiple?: boolean; onFiles: (files: File[]) => void;
  id?: string; size?: 'xs' | 'sm'; variant?: 'secondary' | 'ghost'; icon?: string; 'aria-describedby'?: string;
}) {
  const auto = useId(); const id = idProp ?? auto;
  const [names, setNames] = useState<string[]>([]);
  return (
    <div className="file-input">
      <label className={`btn ${variant} ${size} file-btn`} htmlFor={id}>
        <Icon name={icon} />{names.length ? (multiple ? 'Cambiar archivos' : 'Cambiar archivo') : label}
        <input id={id} type="file" className="sr" accept={accept} multiple={multiple} aria-describedby={describedBy}
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; setNames(fs.map((f) => f.name)); onFiles(fs); e.target.value = ''; }} />
      </label>
      <span className={`file-names ${names.length ? '' : 'dim'}`} aria-live="polite">
        {names.length === 0 ? 'Ningún archivo elegido' : names.length === 1 ? names[0] : `${names.length} archivos: ${names.join(', ')}`}
      </span>
    </div>
  );
}
