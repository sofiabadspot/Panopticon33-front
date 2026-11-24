/* «Trabajó 2 s», en gris arriba de una respuesta de Jules. Copia de
   sync-front/src/components/jules/Trabajo.jsx. Se abre para ver por qué pasos pasó mientras pensaba. */
import { useId, useState } from 'react';
import { Icon } from './ds/Icon';

export function Trabajo({ segundos, pasos = [] }: { segundos: number; pasos?: string[] }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const texto = `Trabajó ${segundos} s`;

  if (!pasos.length) return <p className="jules-trabajo">{texto}</p>;

  return (
    <div className="jules-trabajo">
      <button
        type="button"
        className="jules-trabajo__boton svx-interactivo"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((antes) => !antes)}
      >
        {texto}
        <Icon name={abierto ? 'chevron-down' : 'chevron-right'} />
      </button>
      {abierto && (
        <ul id={id} className="jules-trabajo__pasos svx-entrar">
          {pasos.map((paso) => (
            <li key={paso} className="jules-trabajo__paso">
              <Icon name="check" />
              {paso}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
