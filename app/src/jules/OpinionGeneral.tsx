/* Opinión general sobre Jules (botón del encabezado). Copia de
   sync-front/src/components/jules/OpinionGeneral.jsx: pestañas para elegir el tipo, un
   comentario y Enviar. PROTOTIPO: no se guarda; al enviar, avisa (onEnviar). */
import { useId, useState, type FormEvent } from 'react';
import { Button } from './ds/Button';
import { Dialog } from './ds/Dialog';
import { Tabs } from './ds/Tabs';
import { Textarea } from './ds/basicos';

const TEXTOS = {
  titulo: 'Contanos cómo te va con Jules',
  bajada: 'Lo leemos para mejorarlo.',
  tipo: 'Tipo de opinión',
  tipos: [
    { value: 'problema', label: 'Algo no anda', pregunta: '¿Qué pasó?', ayuda: 'Ej.: le pregunté por el andén 4 y me respondió sobre otro.' },
    { value: 'idea', label: 'Una idea', pregunta: '¿Qué te gustaría que haga Jules?', ayuda: 'Ej.: que me avise cuando un andén pase la meta.' },
    { value: 'comentario', label: 'Un comentario', pregunta: '¿Cómo podemos mejorar Jules?', ayuda: 'Escribí lo que quieras contarnos.' },
  ] as const,
  enviar: 'Enviar',
};

type Tipo = (typeof TEXTOS.tipos)[number]['value'];

export function OpinionGeneral({ open, onClose, onEnviar }: { open: boolean; onClose: () => void; onEnviar?: () => void }) {
  const [tipo, setTipo] = useState<Tipo>('comentario');
  const [texto, setTexto] = useState('');
  const id = useId();
  const actual = TEXTOS.tipos.find((t) => t.value === tipo)!;

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!texto.trim()) return;
    setTexto('');
    onEnviar?.();
  }

  return (
    <Dialog open={open} onClose={onClose} title={TEXTOS.titulo} description={TEXTOS.bajada}>
      <form className="jules-opinion-general" onSubmit={enviar}>
        <Tabs label={TEXTOS.tipo} items={TEXTOS.tipos.map(({ value, label }) => ({ value, label }))} value={tipo} onChange={setTipo} />
        <div className="sv-field">
          <label className="sv-label" htmlFor={id}>{actual.pregunta}</label>
          <Textarea id={id} rows={4} placeholder={actual.ayuda} value={texto} onChange={(evento) => setTexto(evento.target.value)} />
        </div>
        <Button type="submit" disabled={!texto.trim()}>{TEXTOS.enviar}</Button>
      </form>
    </Dialog>
  );
}
