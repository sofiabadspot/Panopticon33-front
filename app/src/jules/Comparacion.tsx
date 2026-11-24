/* Comparación de dos períodos dentro de una respuesta de Jules. Copia de
   sync-front/src/components/jules/Comparacion.jsx: por cada medida, dos barras finas lado a lado
   con su cifra, y la diferencia en un badge verde o rojo según si mejoró o empeoró.
   mejor: si es bueno que suba ('mas') o que baje ('menos'). */
import { Badge, numero } from './ds/basicos';

export interface ComparacionProps {
  antes: string; ahora: string;
  medidas: { nombre: string; antes: number; ahora: number; unidad?: string; mejor: 'mas' | 'menos' }[];
}

export function Comparacion({ antes, ahora, medidas }: ComparacionProps) {
  return (
    <figure className="jules-comparacion">
      <figcaption className="jules-comparacion__leyenda">
        <span className="jules-comparacion__clave jules-comparacion__clave--antes">{antes}</span>
        <span className="jules-comparacion__clave jules-comparacion__clave--ahora">{ahora}</span>
      </figcaption>
      <dl className="jules-comparacion__medidas">
        {medidas.map((m) => {
          const tope = Math.max(m.antes, m.ahora) || 1;
          const cambio = m.antes ? Math.round(((m.ahora - m.antes) / m.antes) * 100) : 0;
          const mejoro = cambio === 0 ? null : (cambio > 0) === (m.mejor === 'mas');
          const conUnidad = (valor: number) => `${numero(valor)}${m.unidad ? ` ${m.unidad}` : ''}`;
          const filas: ['antes' | 'ahora', number, string][] = [['antes', m.antes, antes], ['ahora', m.ahora, ahora]];
          return (
            <div key={m.nombre} className="jules-comparacion__medida">
              <dt className="jules-comparacion__nombre">
                {m.nombre}
                <Badge tone={mejoro == null ? 'neutral' : mejoro ? 'positive' : 'negative'}>
                  {cambio > 0 ? '+' : ''}{cambio} %
                </Badge>
              </dt>
              <dd className="jules-comparacion__barras">
                {filas.map(([cual, valor, periodo]) => (
                  <div key={cual} className={`jules-comparacion__fila jules-comparacion__fila--${cual}`}>
                    <span className="jules-comparacion__pista" aria-hidden="true">
                      <span className="jules-comparacion__barra" style={{ inlineSize: `${(valor / tope) * 100}%` }} />
                    </span>
                    <span className="jules-comparacion__valor">
                      <span className="sv-sr">{periodo}: </span>{conUnidad(valor)}
                    </span>
                  </div>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
    </figure>
  );
}
