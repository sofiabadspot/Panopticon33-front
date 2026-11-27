/* Mapa de configuración (administrador). Muestra solo lo que sirve para configurar:
   dónde están las zonas, dónde están las cámaras y si funcionan,
   y las áreas de los eventos. Lo operativo (alertas, unidades, aeronaves, mapa de calor, ¿Quién llega?)
   no aparece: eso es de quien opera, no de quien configura.
   "Pendientes" deja a la vista solo los pendientes: zonas sin cámara y cámaras caídas,
   sin zona o sin presets. */
import type { Camera, CameraStatus, Zone } from '../api/types';
import { CAMERA_LABEL } from '../api/labels';
import { Icon } from '../ui/kit';
import { CameraNode } from '../map/icons';

export interface AdminLayers { zones: boolean; cameras: boolean; fov: boolean; events: boolean; pending: boolean }
export const ADMIN_LAYERS: AdminLayers = { zones: true, cameras: true, fov: false, events: true, pending: false };
/** Capas con que abre cada sección: solo lo de esa sección. Las demás se prenden a mano en la barra. */
export function layersFor(tab: string | null): AdminLayers {
  const off = { zones: false, cameras: false, fov: false, events: false, pending: false };
  switch (tab) {
    case 'zonas': return { ...off, zones: true };
    case 'camaras': return { ...off, cameras: true };
    case 'eventos': return { ...off, events: true };
    default: return ADMIN_LAYERS;
  }
}

/** Color de las zonas en el mapa de configuración (no es un color de estado): token --zone de app.css. */
export const zoneColor = () => getComputedStyle(document.documentElement).getPropertyValue('--zone').trim() || '#5B9CFF';
/** Lo que falta configurar. */
export const cameraPending = (c: Camera) => c.status !== 'operativa' || !c.zoneId || !c.presets.length;
export const zonePending = (z: Zone, cameras: Camera[]) => !cameras.some((c) => c.zoneId === z.id) && !z.cameras.length;

export function AdminMapLayers({ l, set, pendingZones, pendingCams }: {
  l: AdminLayers; set: (p: Partial<AdminLayers>) => void; pendingZones: number; pendingCams: number;
}) {
  const pend = pendingZones + pendingCams;
  return (
    <>
      <button className={`lchip ${l.zones ? 'on' : ''}`} aria-pressed={l.zones} onClick={() => set({ zones: !l.zones })}><Icon name="layers" />Zonas</button>
      <div className={`lchip-group ${l.cameras ? 'on' : ''}`} role="group" aria-label="Cámaras">
        <button className={`lchip ${l.cameras ? 'on' : ''}`} aria-pressed={l.cameras} onClick={() => set({ cameras: !l.cameras, fov: l.cameras ? false : l.fov })}><CameraNode status="operativa" size={15} />Cámaras</button>
        {l.cameras && <button className={`lchip sub ${l.fov ? 'on' : ''}`} aria-pressed={l.fov} onClick={() => set({ fov: !l.fov })} title="Hacia dónde mira cada cámara y hasta dónde ve">Visión</button>}
      </div>
      <button className={`lchip ${l.events ? 'on' : ''}`} aria-pressed={l.events} onClick={() => set({ events: !l.events })}><Icon name="flag" />Eventos</button>
      <span className="sep" />
      <button className={`lchip ${l.pending ? 'on' : ''}`} aria-pressed={l.pending} disabled={!pend && !l.pending} onClick={() => set(l.pending ? { pending: false } : { pending: true, zones: true, cameras: true })}
        title={pend ? `${pendingZones} zonas sin cámara · ${pendingCams} cámaras caídas, sin zona o sin presets` : 'Todo configurado'}>
        <Icon name={pend ? 'warning' : 'check'} />Pendientes<b>{pend}</b>
      </button>
    </>
  );
}

/** Leyenda sobre el mapa: qué dice el dibujo de cada cámara, y qué se ve con Pendientes. */
export function AdminMapLegend({ l, cameras }: { l: AdminLayers; cameras: Camera[] }) {
  const statuses = (['operativa', 'degradada', 'fuera_de_preset', 'caida'] as CameraStatus[]).filter((s) => cameras.some((c) => c.status === s));
  if (!l.cameras && !l.pending) return null;
  return (
    <div className="map-legend" aria-label="Leyenda del mapa">
      {l.pending && <div className="ml-note"><Icon name="warning" />Solo lo pendiente: zonas sin cámara y cámaras caídas, sin zona o sin presets.</div>}
      {l.cameras && statuses.length > 0 && <div className="ml-group"><div className="ml-ttl">Cámaras</div>
        {statuses.map((s) => <div key={s} className="ml-row"><CameraNode status={s} size={14} />{CAMERA_LABEL[s]}</div>)}</div>}
    </div>
  );
}
