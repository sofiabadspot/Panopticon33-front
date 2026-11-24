/* Hoja de referencia del sistema iconográfico (/iconos).
   Muestra cada categoría con todos sus tipos y estados, y una vista "en contexto" sobre fondo de mapa.
   Se revisa acá antes de aplicarlo al mapa: lo que se ve en esta hoja es exactamente lo que va al mapa. */
import { Fragment } from 'react';
import { AlertMark, CameraNode, GroupChip, UnitHex } from '../map/icons';
import type { AlertKind, CameraStatus, UnitType } from '../api/types';

const KINDS: [AlertKind, string, string][] = [
  ['placa_en_lista', 'Placa en lista', 'Una cámara leyó una placa con reporte (robo, orden de captura).'],
  ['aglomeracion', 'Aglomeración', 'Una zona supera su capacidad o la densidad permitida.'],
  ['brecha_presencia', 'Brecha de presencia', 'Hay demasiadas personas por cada policía en una zona.'],
  ['camara_caida', 'Cámara sin video', 'Una cámara dejó de enviar imagen y deja un punto ciego.'],
];
const UNITS: [UnitType, string][] = [['Patrulla', 'Patrulla'], ['Motorizada', 'Motorizada'], ['A pie', 'Agente a pie']];
const CAMS: [CameraStatus, string, string][] = [
  ['operativa', 'Operativa', 'Envía video y mide.'],
  ['degradada', 'Degradada', 'Envía con pocos cuadros por segundo.'],
  ['fuera_de_preset', 'Fuera de preset', 'Es PTZ y no apunta a donde mide.'],
  ['caida', 'Sin video', 'No envía imagen.'],
];

export function IconSheet() {
  return (
    <main className="isheet">
      <header className="is-head">
        <span className="is-lbl">Panóptico 33 · Sistema iconográfico</span>
        <h1>Cada cosa en el mapa se reconoce por su forma</h1>
        <ol className="is-rules">
          <li><b>La forma de afuera dice la categoría.</b> Alerta: mira de fijación con asta. Unidad: hexágono. Cámara: nodo con mira.</li>
          <li><b>El dibujo de adentro dice el tipo.</b> Placa, multitud, falta de presencia o cámara; patrulla, moto o agente.</li>
          <li><b>El rojo es solo para alertas que esperan una decisión.</b> Todas se ven igual: no hay niveles en el mapa. Las que ya se enviaron a Maic o se descartaron salen del mapa.</li>
        </ol>
      </header>

      <section className="is-sec">
        <h2 className="is-lbl">Alertas · mira de fijación</h2>
        <div className="is-table" style={{ gridTemplateColumns: 'minmax(220px, 1.4fr) minmax(96px, 1fr) 2fr' }}>
          {KINDS.map(([k, name, desc]) => (<Fragment key={k}>
            <div key={k + 'n'} className="is-name"><b>{name}</b><span>{desc}</span></div>
            <span className="is-cell"><AlertMark kind={k} /></span>
            <span />
          </Fragment>))}
        </div>
      </section>

      <section className="is-sec">
        <h2 className="is-lbl">Unidades · hexágono</h2>
        <div className="is-table" style={{ gridTemplateColumns: 'minmax(220px, 1.4fr) repeat(2, minmax(76px, 1fr)) 2fr' }}>
          <span /><span className="is-col">Reporta</span><span className="is-col">Sin reporte</span><span />
          {UNITS.map(([t, name]) => (<Fragment key={t}>
            <div key={t + 'n'} className="is-name"><b>{name}</b></div>
            <span key={t + 'a'} className="is-cell"><UnitHex type={t} /></span>
            <span key={t + 'b'} className="is-cell"><UnitHex type={t} status="sin_reporte" /></span>
            <span key={t + 'c'} />
          </Fragment>))}
        </div>
        <p className="is-note">Todas las unidades se ven igual: el estado (disponible, en servicio), la placa y los agentes están en la ficha al pasar el mouse.</p>
      </section>

      <section className="is-sec">
        <h2 className="is-lbl">Cámaras · nodo con mira</h2>
        <div className="is-row">
          {CAMS.map(([s, name, desc]) => <div key={s} className="is-item"><CameraNode status={s} size={22} /><div><b>{name}</b><span>{desc}</span></div></div>)}
        </div>
        <p className="is-note">La cámara no usa color para su salud: cambia el dibujo. El color queda reservado a lo que pasa en el territorio.</p>
      </section>

      <section className="is-sec">
        <h2 className="is-lbl">Grupos · al alejar el zoom</h2>
        <div className="is-row">
          <div className="is-item"><GroupChip cat="alerts" n={4} /><div><b>Alertas</b><span>Cuántas esperan decisión en ese lugar.</span></div></div>
          <div className="is-item"><GroupChip cat="units" n={12} /><div><b>Unidades</b><span>Todas las de una zona juntas.</span></div></div>
          <div className="is-item"><GroupChip cat="cameras" n={6} /><div><b>Cámaras</b></div></div>
        </div>
      </section>

      <section className="is-sec">
        <h2 className="is-lbl">En contexto · sobre el mapa</h2>
        <div className="is-map">
          <span style={{ left: '18%', top: '30%' }}><AlertMark kind="placa_en_lista" /></span>
          <span style={{ left: '27%', top: '38%' }}><UnitHex type="Patrulla" /></span>
          <span style={{ left: '34%', top: '26%' }}><CameraNode status="operativa" /></span>
          <span style={{ left: '52%', top: '48%' }}><AlertMark kind="aglomeracion" /></span>
          <span style={{ left: '60%', top: '58%' }}><UnitHex type="A pie" /></span>
          <span style={{ left: '64%', top: '40%' }}><UnitHex type="Motorizada" /></span>
          <span style={{ left: '74%', top: '28%' }}><AlertMark kind="brecha_presencia" /></span>
          <span style={{ left: '82%', top: '62%' }}><AlertMark kind="camara_caida" /></span>
          <span style={{ left: '44%', top: '70%' }}><CameraNode status="caida" /></span>
          <span style={{ left: '12%', top: '68%' }}><GroupChip cat="units" n={12} /></span>
        </div>
        <p className="is-note">La placa (alerta) y la patrulla (unidad) ya no se confunden: una es una mira roja con asta, la otra un hexágono negro.</p>
      </section>
    </main>
  );
}
