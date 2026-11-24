/* 👍 y 👎 de una respuesta de Jules. Copia de sync-front/src/components/jules/Opinion.jsx.
   Cualquiera abre un diálogo con un comentario opcional; al enviar, el ícono queda marcado y
   aparece el aviso. Se puede cambiar de opinión. PROTOTIPO: la opinión no se guarda. */
import { useId, useState, type FormEvent } from 'react';
import { useToast } from '../ui/kit';
import { Button } from './ds/Button';
import { Dialog } from './ds/Dialog';
import { Icon } from './ds/Icon';
import { Textarea } from './ds/basicos';

const TEXTOS = {
  bien: {
    boton: 'Me sirvió',
    titulo: '¿Qué te sirvió de esta respuesta?',
    ayuda: 'Ej.: fue al punto, el gráfico era el correcto.',
  },
  mal: {
    boton: 'No me sirvió',
    titulo: '¿Qué le faltó a esta respuesta?',
    ayuda: 'Ej.: el dato estaba mal, no respondió lo que pregunté.',
  },
  etiqueta: 'Contanos más (opcional)',
  cancelar: 'Cancelar',
  enviar: 'Enviar',
  gracias: 'Gracias, lo vamos a tener en cuenta.',
};

type Cual = 'bien' | 'mal';

export function Opinion() {
  const mostrarAviso = useToast();
  const [elegida, setElegida] = useState<Cual | null>(null);
  const [abierta, setAbierta] = useState<Cual | null>(null);
  const [comentario, setComentario] = useState('');
  const id = useId();

  function abrir(cual: Cual) {
    setComentario('');
    setAbierta(cual);
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    setElegida(abierta);
    setAbierta(null);
    mostrarAviso(TEXTOS.gracias);
  }

  const textos = abierta ? TEXTOS[abierta] : null;

  return (
    <>
      {(['bien', 'mal'] as const).map((cual) => (
        <Button
          key={cual}
          size="sm"
          variant="ghost"
          iconOnly
          className="jules-accion"
          aria-label={TEXTOS[cual].boton}
          aria-pressed={elegida === cual}
          data-tip={TEXTOS[cual].boton}
          onClick={() => abrir(cual)}
        >
          <Icon name={cual === 'bien' ? 'me-gusta' : 'no-me-gusta'} />
        </Button>
      ))}

      <Dialog
        open={Boolean(abierta)}
        onClose={() => setAbierta(null)}
        title={textos?.titulo}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setAbierta(null)}>{TEXTOS.cancelar}</Button>
            <Button type="submit" form={id}>{TEXTOS.enviar}</Button>
          </>
        )}
      >
        <form id={id} className="sv-field jules-opinion" onSubmit={enviar}>
          <label className="sv-label" htmlFor={`${id}-texto`}>{TEXTOS.etiqueta}</label>
          <Textarea
            id={`${id}-texto`}
            rows={3}
            placeholder={textos?.ayuda}
            value={comentario}
            onChange={(evento) => setComentario(evento.target.value)}
          />
        </form>
      </Dialog>
    </>
  );
}
