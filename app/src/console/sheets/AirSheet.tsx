/* Ficha de un dron o helicóptero (clic en el ícono del mapa), en el lateral como las demás fichas.
   Arriba la transmisión de la cámara de a bordo, con el mismo visor que la evidencia de placas y rostros:
   lupa al pasar el mouse y, con un clic, la imagen en grande sobre el mapa (la ficha sigue abierta al lado).
   Abajo la telemetría, que se refresca cada segundo.
   El Gobierno ya tiene acceso al video de drones y helicópteros (reunión del 25/11). Hasta conectarlo no hay
   material real: se muestra "Esperando enlace de video" (regla de evidencia: nunca se inventa). */
import { useState } from 'react';
import { AIRCRAFT, airAt, compass } from '../../api/aircraft';
import type { Evidence as Ev } from '../../api/types';
import { hhmmss } from '../../api/format';
import { AirGlyph } from '../../map/icons';
import { ImageViewer, Inspectable } from '../../ui/ImageInspect';
import { useNow } from '../../ui/kit';
import { SheetHead } from './SheetHead';

export function AirSheet({ id }: { id: string }) {
  const now = useNow(1000);
  const [big, setBig] = useState(false);
  const [rot, setRot] = useState(0);
  const a = AIRCRAFT.find((x) => x.id === id);
  if (!a) return <SheetHead kicker="Medio aéreo" title="No encontrado" />;
  const f = airAt(a, now);
  const what = a.type === 'Dron' ? 'dron' : 'helicóptero';
  const ev: Ev = a.stream ? { type: 'clip', src: a.stream.src, poster: a.stream.poster, caption: `Transmisión del ${what} ${a.id}` }
    : { type: 'pendiente', caption: 'Esperando enlace de video' };
  const tag = <span className="air-tx-tag">{a.stream ? <><i className="as-live" aria-hidden />En vivo</> : 'Sin enlace'}<em className="mono">{hhmmss(now)}</em></span>;
  return (
    <>
      <SheetHead kicker={<><span>Medio aéreo PNC</span>·<span>simulado</span></>}
        title={<><span className="air-sheet-ic" aria-hidden><AirGlyph type={a.type} /></span>{a.type} <span className="mono">{a.id}</span></>}
        sub={a.mission} aside={<span className="chip ok">En vuelo</span>} />
      <div className="pb">
        <Inspectable ev={ev} tag={tag} title={`la transmisión del ${what}`} rotation={rot} onRotate={() => setRot((r) => (r + 90) % 360)} onExpand={() => setBig(true)} />
        {!a.stream && <p className="sub" style={{ margin: '6px 0 0' }}>La imagen llega del sistema de la PNC cuando el {what} transmite.</p>}
        <dl className="details">
          <dt>Altitud</dt><dd className="mono">{f.altM} m</dd>
          <dt>Velocidad</dt><dd className="mono">{a.speedKmh} km/h</dd>
          <dt>Rumbo</dt><dd className="mono">{compass(f.heading)} · {Math.round(f.heading)}°</dd>
          <dt>Video</dt><dd>{a.stream ? 'En vivo' : 'Sin enlace'}</dd>
          <dt>Coordenadas</dt><dd className="mono">{f.lat.toFixed(5)}, {f.lon.toFixed(5)}</dd>
        </dl>
      </div>
      {big && <ImageViewer ev={ev} title={`${a.type} ${a.id} · transmisión`} sub={`${a.mission} · ALT ${f.altM} m · ${compass(f.heading)} ${Math.round(f.heading)}°`}
        rotation={rot} onRotate={setRot} onClose={() => { setBig(false); setRot(0); }} />}
    </>
  );
}
