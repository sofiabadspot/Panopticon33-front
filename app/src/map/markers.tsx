/* Marcadores y fichas del mapa en lenguaje HUD.
   · Unidad suelta: hexágono negro con borde gris y su tipo adentro (patrulla, moto o agente a pie). Sin reporte = atenuada.
   · Grupo de unidades (al alejar el zoom): el escudo del botón "Unidades" con la cantidad.
   · Grupo: al alejar el zoom, lo que cae cerca en pantalla se junta con su cantidad.
   · Ficha: al pasar el mouse por una unidad, una cámara o un grupo. */
import type { Alert, Camera, LngLat, Unit, Zone } from '../api/types';
import { AGENTS } from '../api/seed';
import { Icon, useNow } from '../ui/kit';
import { cameraClip } from '../api/video';
import { hhmmss } from '../api/format';
import { AIRCRAFT, airAt, compass } from '../api/aircraft';
import { AirGlyph } from './icons';
import { unitAssignment, useApi, type UnitAssignment } from '../api';

/* ---------- Geometría de cámara ---------- */
export const CAM_FOV = 62;      // grados
export const CAM_REACH = 200;   // metros
const M_LAT = 111320;
/** El rumbo de la cámara viene del prototipo en radianes, en ejes locales (x = este, z = sur). */
function offset(lat: number, lon: number, eastM: number, southM: number): LngLat {
  return [lon + eastM / (M_LAT * Math.cos((lat * Math.PI) / 180)), lat - southM / M_LAT];
}
export function cone(c: Camera, steps = 14): LngLat[] {
  const fov = (CAM_FOV * Math.PI) / 180; const pts: LngLat[] = [[c.lon, c.lat]];
  for (let i = 0; i <= steps; i++) { const a = c.heading - fov / 2 + (fov * i) / steps; pts.push(offset(c.lat, c.lon, Math.cos(a) * CAM_REACH, Math.sin(a) * CAM_REACH)); }
  pts.push([c.lon, c.lat]); return pts;
}
/** Rumbo en grados desde el norte, en sentido horario. */
export const bearing = (c: Camera) => ((Math.atan2(Math.cos(c.heading), -Math.sin(c.heading)) * 180) / Math.PI + 360) % 360;

/* ---------- Unidad ---------- */
export function UnitGlyph({ type }: { type: Unit['type'] }) {
  const hole = { fill: 'var(--surface)' };
  if (type === 'Motorizada') return (
    // Moto de perfil: cubiertas gruesas, motor y tanque (la masa la separa de una bicicleta), horquilla y faro.
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="5.4" cy="16.4" r="3.3" fill="none" stroke="currentColor" strokeWidth="2.3" />
      <circle cx="18.6" cy="16.4" r="3.3" fill="none" stroke="currentColor" strokeWidth="2.3" />
      <path d="M6.6 11.6h4.6l1.6-2.4h3.4l.9 1.6-2.6 3.4H8.9z" fill="currentColor" />
      <rect x="9.6" y="13.4" width="4" height="3" rx=".6" fill="currentColor" />
      <path d="M5.4 16.4l3.4-3.6M18.6 16.4l-2.3-7.4M15.2 8.7l2.8-.7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <rect x="17.4" y="10" width="2.4" height="1.6" rx=".5" fill="currentColor" />
    </svg>
  );
  if (type === 'A pie') return (
    // Agente: gorra de visera y placa en el pecho (lo que lo hace policía y no una persona cualquiera).
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8.1 5.6c0-1.4 1.8-2.6 3.9-2.6s3.9 1.2 3.9 2.6v.7H8.1z" fill="currentColor" />
      <path d="M7.2 6.5h9.6l-1.1 1.3H8.3z" fill="currentColor" />
      <circle cx="12" cy="9.9" r="2.2" fill="currentColor" />
      <path d="M6.8 21v-5.4c0-2.3 2.2-3.9 5.2-3.9s5.2 1.6 5.2 3.9V21z" fill="currentColor" />
      <path d="M13.5 14.6h2.1v1.5c0 .8-.5 1.3-1.05 1.5-.55-.2-1.05-.7-1.05-1.5z" style={hole} />
    </svg>
  );
  return (
    // Patrulla de perfil con la barra de luces en el techo.
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="9.3" y="3.6" width="5.4" height="2" rx=".7" fill="currentColor" />
      <path fillRule="evenodd" fill="currentColor" d="M2.6 15.8v-3c0-.6.4-1.1 1-1.2l2.7-.5 1.9-3.2c.3-.5.8-.8 1.4-.8h4.8c.6 0 1.1.3 1.4.7l2.4 3.3 2.6.5c.6.1 1 .6 1 1.2v3zM9.5 8.4h2.3v2.8H7.8zM13.1 8.4h1.9l2 2.8h-3.9z" />
      <circle cx="7" cy="16.3" r="2.5" fill="currentColor" /><circle cx="7" cy="16.3" r="1" style={hole} />
      <circle cx="17" cy="16.3" r="2.5" fill="currentColor" /><circle cx="17" cy="16.3" r="1" style={hole} />
    </svg>
  );
}
export function UnitMarker({ u }: { u: Unit }) {
  const cls = u.status === 'sin_reporte' || u.status === 'desconocida' ? 'off' : '';
  return <span className={`mk-unit ${cls}`}><span className="hex"><UnitGlyph type={u.type} /></span></span>;
}

/* ---------- Grupo ---------- */
export type GroupCat = 'units' | 'cameras' | 'alerts';
export function GroupMarker({ cat, n, sev }: { cat: GroupCat; n: number; sev?: string }) {
  return <span className={`mk-group g-${cat} ${sev ?? ''}`}><i>{cat === 'units' && <Icon name="local_police" />}</i><b>{n}</b></span>;
}

/* ---------- Ficha ---------- */
export type Hover =
  | { kind: 'unit'; id: string; x: number; y: number }
  | { kind: 'air'; id: string; x: number; y: number }
  | { kind: 'camera'; id: string; x: number; y: number }
  | { kind: 'group'; cat: GroupCat; ids: string[]; x: number; y: number };

const UNIT_STATUS: Record<Unit['status'], string> = { disponible: 'Disponible', en_servicio: 'En servicio', sin_reporte: 'Sin reporte', desconocida: 'Sin identificar' };
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'hace segundos' : `hace ${m} min`; };
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="mc-row"><span>{k}</span><b>{v}</b></div>;

export function MapCard({ h, units, cameras, zones, alerts }: { h: Hover; units: Unit[]; cameras: Camera[]; zones: Zone[]; alerts: Alert[] }) {
  const zoneName = (id: string | null) => zones.find((z) => z.id === id)?.name;
  let body: React.ReactNode = null;
  if (h.kind === 'unit') {
    const u = units.find((q) => q.id === h.id); if (!u) return null;
    body = (<>
      <div className="mc-hd"><span className="mc-eyebrow">Unidad PNC · MAIC</span>{u.enRoute ? <span className="mc-state go"><i />En camino</span> : <span className={`mc-state ${u.status === 'en_servicio' ? 'busy' : u.status === 'disponible' ? '' : 'off'}`}><i />{UNIT_STATUS[u.status]}</span>}</div>
      <div className="mc-title"><span className="mc-ic"><UnitGlyph type={u.type} /></span><div><b>{u.type}</b><small>{u.id}</small></div></div>
      <UnitAssigned u={u} />
      <div className="mc-grid">
        <Row k="Placa" v={u.plate ? <span className="plate">{u.plate}</span> : '—'} />
        <Row k="Agentes" v={AGENTS[u.type]} />
        <Row k="Zona" v={zoneName(u.zoneId) ?? 'Sin zona'} />
        <Row k="Último GPS" v={ago(u.lastReportAt)} />
      </div>
      <div className="mc-foot">{u.lat.toFixed(5)}, {u.lon.toFixed(5)}</div>
    </>);
  } else if (h.kind === 'air') {
    const a = AIRCRAFT.find((q) => q.id === h.id); if (!a) return null;
    body = <AirCard id={a.id} />;
  } else if (h.kind === 'camera') {
    const c = cameras.find((q) => q.id === h.id); if (!c) return null;
    const clip = c.status === 'caida' ? null : cameraClip(c.id);
    // Solo el video: lo que ve la cámara ahora, con su sobreimpresión (código, en vivo y hora). Los datos van en su ficha.
    body = (
      <div className="mc-live solo">
        {clip ? <video src={clip.src} poster={clip.poster} muted loop autoPlay playsInline />
          : <div className="mc-live-off"><img src="/assets/logo-spotvision-bn.png" alt="" /><span>{c.status === 'caida' ? 'Sin señal' : 'Video en vivo no disponible'}</span></div>}
        {clip && <span className="mc-live-tag"><i aria-hidden />En vivo</span>}
        <span className="mc-live-id mono">{c.id}</span>
        {clip && <LiveClock />}
      </div>
    );
  } else {
    const n = h.ids.length;
    if (h.cat === 'units') {
      const list = units.filter((u) => h.ids.includes(u.id)); const by = (t: Unit['type']) => list.filter((u) => u.type === t).length;
      body = (<><div className="mc-hd"><span className="mc-eyebrow">Grupo · {n} unidades</span></div><div className="mc-grid"><Row k="Patrullas" v={by('Patrulla')} /><Row k="Motorizadas" v={by('Motorizada')} /><Row k="A pie" v={by('A pie')} /><Row k="En servicio" v={list.filter((u) => u.status === 'en_servicio').length} /></div><div className="mc-foot">Clic para acercar</div></>);
    } else if (h.cat === 'cameras') {
      const list = cameras.filter((c) => h.ids.includes(c.id)); const by = (s: Camera['status']) => list.filter((c) => c.status === s).length;
      body = (<><div className="mc-hd"><span className="mc-eyebrow">Grupo · {n} cámaras</span></div><div className="mc-grid"><Row k="Operativas" v={by('operativa')} /><Row k="Degradadas" v={by('degradada') + by('fuera_de_preset')} /><Row k="Caídas" v={by('caida')} /></div><div className="mc-foot">Clic para acercar</div></>);
    } else {
      const list = alerts.filter((a) => h.ids.includes(a.id)); const by = (k: Alert['kind']) => list.filter((a) => a.kind === k).length;
      // Sin niveles: el grupo dice qué tipo de alertas junta
      body = (<><div className="mc-hd"><span className="mc-eyebrow">Grupo · {n} alertas</span></div><div className="mc-grid"><Row k="Placas" v={by('placa_en_lista')} /><Row k="Personas" v={by('persona_en_lista')} /><Row k="Aglomeración" v={by('aglomeracion')} /><Row k="Falta de policías" v={by('brecha_presencia')} /><Row k="Cámaras sin video" v={by('camara_caida')} /></div><div className="mc-foot">Clic para acercar</div></>);
    }
  }
  const w = h.kind === 'camera' ? 320 : 280;
  const left = Math.min(h.x + 18, window.innerWidth - w - 12), top = Math.min(h.y + 18, window.innerHeight - (h.kind === 'camera' ? 200 : h.kind === 'unit' ? 350 : 280));
  return <div className="mapcard" role="tooltip" style={{ left, top, width: w }}>{body}</div>;
}

/** A qué está asignada la unidad: lo primero que se lee en su ficha (si se la puede mandar o ya tiene algo).
    Los eventos vienen del estado vivo, así que la ficha se actualiza al empezar o terminar uno. */
const ASSIGN_LABEL: Record<UnitAssignment['k'], string> = { alerta: 'Asignada a una alerta', evento: 'Asignada a un evento', tarea: 'Asignada a una tarea', zona: 'Cuida su zona', libre: 'Sin asignar' };
function UnitAssigned({ u }: { u: Unit }) {
  useApi((s) => s.events); // se vuelve a leer al cambiar los eventos
  const a = unitAssignment(u);
  const what = a.k === 'libre' ? 'Disponible para despacho' : a.label;
  const sub = a.k === 'alerta' ? `En camino ${ago(a.since)}` : a.k === 'evento' ? `Cubre ${a.zone}` : a.k === 'tarea' ? `Desde ${ago(a.since)}` : a.k === 'zona' ? 'Sin evento en curso' : null;
  return (
    <div className={`mc-assign k-${a.k}`}>
      <span className="mc-assign-lbl"><Icon name={a.k === 'alerta' ? 'local_police' : a.k === 'evento' ? 'flag' : a.k === 'tarea' ? 'edit_note' : a.k === 'zona' ? 'location_on' : 'check_circle'} />{ASSIGN_LABEL[a.k]}</span>
      <b>{what}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Ficha de monitoreo de un dron o helicóptero (al pasar el mouse): se refresca cada segundo porque se mueve
    mientras se mira. Dice si su cámara está transmitiendo; con un clic se abre la transmisión. */
function AirCard({ id }: { id: string }) {
  const now = useNow(1000);
  const a = AIRCRAFT.find((q) => q.id === id)!; const f = airAt(a, now);
  return (<>
    <div className="mc-hd"><span className="mc-eyebrow">Monitoreo aéreo PNC · simulado</span><span className="mc-state busy"><i />En vuelo</span></div>
    <div className="mc-title"><span className="mc-ic"><AirGlyph type={a.type} /></span><div><b>{a.type}</b><small>{a.id}</small></div></div>
    <div className="mc-grid">
      <Row k="Misión" v={a.mission} />
      <Row k="Altitud" v={`${f.altM} m`} />
      <Row k="Velocidad" v={`${a.speedKmh} km/h`} />
      <Row k="Rumbo" v={`${compass(f.heading)} · ${Math.round(f.heading)}°`} />
      <Row k="Video" v={a.stream ? <span className="mc-go">En vivo</span> : 'Esperando enlace'} />
    </div>
    <div className="mc-foot">Clic para ver la transmisión</div>
  </>);
}

/** Hora del cuadro en vivo, como la sobreimpresión de la cámara. */
function LiveClock() {
  const now = useNow(1000);
  return <span className="mc-live-clock mono">{hhmmss(now)}</span>;
}
