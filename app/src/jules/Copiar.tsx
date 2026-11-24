/* Botón de ícono para copiar un texto (ej. la pregunta de la persona). Al copiar, muestra ✓ un
   momento. Copia de sync-front/src/components/jules/Copiar.jsx. */
import { useEffect, useState } from 'react';
import { Button } from './ds/Button';
import { Icon } from './ds/Icon';

const COPIADA = 1500;

export function Copiar({ texto, etiqueta, hecha }: { texto: string; etiqueta: string; hecha: string }) {
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    if (!hecho) return undefined;
    const vuelta = setTimeout(() => setHecho(false), COPIADA);
    return () => clearTimeout(vuelta);
  }, [hecho]);

  function alCopiar() {
    navigator.clipboard?.writeText(texto).then(() => setHecho(true), () => {});
  }

  return (
    <Button size="sm" variant="ghost" iconOnly className="jules-accion" aria-label={hecho ? hecha : etiqueta} data-tip={hecho ? hecha : etiqueta} onClick={alCopiar}>
      <Icon name={hecho ? 'check' : 'copiar'} />
    </Button>
  );
}
