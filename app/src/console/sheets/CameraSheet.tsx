/* Ficha de cámara: estado, presets, zona que cubre y lecturas recientes (si es vehicular). */
import { setCameraPreset, useApi } from '../../api';
import { ago } from '../../api/format';
import { CAMERA_LABEL } from '../../api/labels';
import { useSession } from '../../shell/session';
import { Evidence, Icon, useNow, useToast } from '../../ui/kit';
import { useConsole } from '../ctx';
import { SheetHead, SheetNotFound } from './SheetHead';
import { usePermissions } from '../permissions';

export function CameraSheet({ id }: { id: string }) {
  const { user } = useSession();
  const perm = usePermissions();
  const c = useConsole();
  const toast = useToast();
  const now = useNow(10000);
  const cameras = useApi((s) => s.cameras);
  const zones = useApi((s) => s.zones);
  const cam = cameras.find((x) => x.id === id);
  if (!cam) return <SheetNotFound kicker="Cámara" what="esta cámara" />;
  const zone = zones.find((z) => z.id === cam.zoneId);
  const chip = `chip ${cam.status === 'operativa' ? 'ok' : cam.status === 'caida' ? 'critica' : cam.status === 'degradada' ? 'media' : 'nodata'}`;
  return (
    <>
      <SheetHead kicker={<><span>{cam.kind === 'mixta' ? 'Mixta' : cam.kind === 'vehicular' ? 'Vehicular' : 'Peatonal'}{cam.ptz && ' · PTZ'}</span>·<span>{cam.compute}</span></>}
        title={<span className="mono">{cam.id}</span>} sub={cam.street} aside={<span className={chip}>{CAMERA_LABEL[cam.status]}</span>} />
      <div className="pb">
        {/* Orden de toda ficha: avisos, imagen, cifras, detalle, relacionados, línea de tiempo y acciones al pie. */}
        {cam.status === 'fuera_de_preset' && <div className="callout"><Icon name="info" /><span className="grow">En movimiento la cámara solo detecta: no mide la zona ni lee placas.</span></div>}
        <Evidence ev={{ type: 'pendiente', caption: cam.status === 'caida' ? 'Sin video' : 'Video en vivo de la cámara' }} />
        <dl className="details">
          <dt>Zona</dt><dd>{zone ? <button className="linklike" onClick={() => c.open({ k: 'zona', id: zone.id })}>{zone.name}</button> : '—'}</dd>
          <dt>Último cuadro</dt><dd className="mono">{ago(cam.lastFrameAt, now)}</dd>
          <dt>Cuadros por segundo</dt><dd className="mono">{cam.status === 'caida' ? '—' : cam.fps}</dd>
          <dt>Coordenadas</dt><dd className="mono">{cam.lat.toFixed(5)}, {cam.lon.toFixed(5)}</dd>
        </dl>
        <div className="box flush">
          <div className="bh"><h3>Presets</h3><span className="sub">{cam.presets.length}</span></div>
          <ul className="list bb">
            {!cam.presets.length && <li className="empty">Sin presets: la cámara no mide su zona.</li>}
            {cam.presets.map((p) => (
              <li key={p} className="item" style={{ gridTemplateColumns: '1fr auto' }}>
                <span className="t">{p}</span>
                {perm.config && cam.status === 'fuera_de_preset' && <button className="btn secondary xs" onClick={() => { setCameraPreset(cam.id, p, user); toast(`${cam.id} en ${p}: la zona vuelve a medirse`); }}>Volver a este preset</button>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
