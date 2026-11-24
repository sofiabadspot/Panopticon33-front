/* Lo que responde Jules, en partes. Copia de sync-front/src/components/jules/RespuestaJules.jsx.
   conclusion: la idea principal, en una línea destacada (opcional). texto: el detalle.
   datos: cifras clave, una por ficha (opcional). comparacion: dos períodos lado a lado (opcional).
   acciones: qué hace en la pantalla (en Sync es un solo botón; acá puede haber más de uno,
     en fila como los accesos de la bienvenida de Sync).
   copiar / copiada: textos del botón para copiar la respuesta. hora: al final de la barra.
   opinar: suma 👍 y 👎. escribir: la respuesta recién llegada se escribe palabra por palabra:
     primero la conclusión, después el texto, y al final entran las cifras y el pie.
     onTermina avisa cuando terminó; onEscribe avisa con cada palabra. */
import { useCallback, useEffect, useState } from 'react';
import { TextoJules } from '../ui/TextoJules';
import { Button } from './ds/Button';
import { Icon } from './ds/Icon';
import { Comparacion, type ComparacionProps } from './Comparacion';
import { Opinion } from './Opinion';

const COPIADA = 1500;
const ESCRITURA = 1600;
const RITMO_MIN = 20;
const RITMO_MAX = 45;
const cuantas = (texto?: string) => (texto ? texto.split(' ').length : 0);

export interface Dato { valor: string; etiqueta: string }

export function RespuestaJules({
  conclusion, texto, datos = [], comparacion, fuente, acciones = [], copiar, copiada, hora, opinar = false,
  escribir = false, onTermina, onEscribe,
}: {
  conclusion?: string; texto?: string; datos?: Dato[]; comparacion?: ComparacionProps; fuente?: string;
  acciones?: { label: string; onClick: () => void }[]; copiar?: string; copiada?: string; hora?: string; opinar?: boolean;
  escribir?: boolean; onTermina?: () => void; onEscribe?: () => void;
}) {
  const ritmo = Math.min(RITMO_MAX, Math.max(RITMO_MIN, ESCRITURA / Math.max(1, cuantas(conclusion) + cuantas(texto))));
  const [hecho, setHecho] = useState(false);
  // 0: escribe la conclusión, 1: escribe el texto, 2: ya se ve todo.
  const [paso, setPaso] = useState(() => (!escribir ? 2 : conclusion ? 0 : 1));

  useEffect(() => {
    if (!hecho) return undefined;
    const vuelta = setTimeout(() => setHecho(false), COPIADA);
    return () => clearTimeout(vuelta);
  }, [hecho]);

  const terminoConclusion = useCallback(() => setPaso((antes) => Math.max(antes, texto ? 1 : 2)), [texto]);
  const terminoTexto = useCallback(() => setPaso(2), []);

  useEffect(() => {
    if (escribir && paso === 2) onTermina?.();
  }, [escribir, paso, onTermina]);

  function alCopiar() {
    const plano = [conclusion, texto, ...datos.map((d) => `${d.etiqueta}: ${d.valor}`)].filter(Boolean).join('\n');
    navigator.clipboard?.writeText(plano).then(() => setHecho(true), () => {});
  }

  const lista = paso === 2;
  const barra = copiar || opinar || fuente || hora;
  const entrar = escribir ? ' svx-entrar' : '';
  return (
    <div className="jules-respuesta">
      <div className="jules-respuesta__textos">
        {conclusion && (escribir
          ? <TextoJules texto={conclusion} className="jules-respuesta__conclusion" ritmo={ritmo} onPalabra={onEscribe} onTermina={terminoConclusion} />
          : <p className="jules-respuesta__conclusion">{conclusion}</p>)}
        {texto && paso >= 1 && (escribir
          ? <TextoJules texto={texto} className="jules-lateral__texto" ritmo={ritmo} onPalabra={onEscribe} onTermina={terminoTexto} />
          : <p className="jules-lateral__texto">{texto}</p>)}
      </div>

      {lista && comparacion && (
        <div className={`jules-respuesta__visual${entrar}`}><Comparacion {...comparacion} /></div>
      )}

      {lista && datos.length > 0 && (
        <dl className={`jules-respuesta__datos${entrar}`}>
          {datos.map((d) => (
            <div key={d.etiqueta} className="jules-respuesta__dato">
              <dt className="jules-respuesta__etiqueta">{d.etiqueta}</dt>
              <dd className="jules-respuesta__valor">{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {lista && acciones.length > 0 && (
        <div className={`jules-respuesta__botones${entrar}`}>
          {acciones.map((a) => (
            <Button key={a.label} size="sm" variant="secondary" onClick={a.onClick}>{a.label}</Button>
          ))}
        </div>
      )}

      {lista && barra && (
        <div className={`jules-respuesta__pie${entrar}`}>
          <div className="jules-respuesta__acciones">
            {copiar && (
              <Button size="sm" variant="ghost" iconOnly className="jules-accion" aria-label={hecho ? copiada : copiar} data-tip={hecho ? copiada : copiar} onClick={alCopiar}>
                <Icon name={hecho ? 'check' : 'copiar'} />
              </Button>
            )}
            {opinar && <Opinion />}
          </div>
          {(fuente || hora) && (
            <span className="jules-respuesta__fuente">{[fuente, hora].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      )}
    </div>
  );
}
