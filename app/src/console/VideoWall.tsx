/* Muro de video — flujo aparte, se abre con el botón junto al buscador.
   Viene del prototipo de Julio (panopticon33-consola, js/video-wall.js): todas las cámaras en una
   rejilla ordenada por lo que exige atención, filtros, tamaños de rejilla, filtros de imagen,
   ronda automática y la vista de una cámara con sus vecinas.
   Adaptado al sistema iconográfico de la consola: la alerta es roja; la salud de la cámara se
   muestra con el nodo (dibujo), no con color. */
import { useEffect, useMemo, useState } from 'react';
import { forOperator, useApi } from '../api';
import { hhmmss } from '../api/format';
import { KIND_PHRASE } from '../api/labels';
import type { Alert, Camera } from '../api/types';
import { cameraClip } from '../api/video';
import { CameraNode } from '../map/icons';
import { CAM_FOV, CAM_REACH } from '../map/markers';
import { Evidence, Icon, useNow } from '../ui/kit';
import { useConsole } from './ctx';

const GRIDS: [number, number][] = [[2, 2], [3, 3], [4, 3], [5, 4]];
const LOOKS = [['normal', 'Normal'], ['flir', 'Térmico'], ['nvg', 'Nocturno']] as const;
type Look = (typeof LOOKS)[number][0];
const STATUS: Record<Camera['status'], string> = { operativa: 'En línea', degradada: 'Degradada', caida: 'Sin señal', fuera_de_preset: 'Fuera de preset' };
let collated = false; // la entrada "reuniendo señales" se ve una vez por sesión

export function VideoWall({ onClose }: { onClose: () => void }) {
  const c = useConsole();
  const now = useNow(1000);
  const cameras = useApi((s) => s.cameras);
  const alerts = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const [filter, setFilter] = useState<'all' | 'alert' | 'video'>('all');
  const [grid, setGrid] = useState(0);
  const [page, setPage] = useState(0);
  const [look, setLook] = useState<Look>('normal');
  const [auto, setAuto] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [intro, setIntro] = useState(!collated);
  useEffect(() => { if (!intro) return undefined; collated = true; const t = setTimeout(() => setIntro(false), 1500); return () => clearTimeout(t); }, [intro]);

  /** Alerta que espera decisión en la cámara (o en su zona, sobre la primera cámara de la zona). */
  const alertOf = useMemo(() => (cam: Camera): Alert | null => alerts.find((a) => forOperator(a) && a.review === 'por_revisar'
    && (a.cameraId === cam.id || (!!a.zoneId && a.zoneId === cam.zoneId && zones.find((z) => z.id === a.zoneId)?.cameras[0] === cam.id))) ?? null, [alerts, zones]);
  const hasVideo = (cam: Camera) => cam.status !== 'caida' && !!cameraClip(cam.id);
  const list = useMemo(() => cameras.map((cam) => ({ cam, a: alertOf(cam), v: hasVideo(cam) }))
    .filter((t) => (filter === 'alert' ? t.a : filter === 'video' ? t.v : true))
    .sort((p, q) => Number(!!q.a) - Number(!!p.a) || Number(q.v) - Number(p.v) || p.cam.id.localeCompare(q.cam.id)), [cameras, alertOf, filter]);
  const [cols, rows] = GRIDS[grid]; const per = cols * rows; const pages = Math.max(1, Math.ceil(list.length / per));
  const pg = Math.min(page, pages - 1);
  useEffect(() => { if (!auto) return undefined; const t = setInterval(() => setPage((p) => (p + 1) % pages), 7000); return () => clearInterval(t); }, [auto, pages]);

  // ESC: de la cámara al muro; del muro, se cierra. ← → cambian de página.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') { e.preventDefault(); if (focus) setFocus(null); else onClose(); }
      if (!focus && e.key === 'ArrowRight') setPage((p) => (p + 1) % pages);
      if (!focus && e.key === 'ArrowLeft') setPage((p) => (p + pages - 1) % pages);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [focus, pages, onClose]);

  const n = cameras.length, live = cameras.filter((x) => x.status !== 'caida').length, vid = cameras.filter(hasVideo).length, al = cameras.filter((x) => alertOf(x)).length;
  const time = hhmmss(now);
  const feed = (cam: Camera, big = false) => {
    if (cam.status === 'caida') return <Evidence ev={{ type: 'pendiente', caption: 'Sin señal · técnico notificado' }} />;
    const clip = cameraClip(cam.id);
    return clip ? <video src={clip.src} poster={clip.poster} muted loop autoPlay playsInline controls={big} /> : <Evidence ev={{ type: 'pendiente', caption: big ? 'Sin video disponible' : '' }} />;
  };
  const coords = (cam: Camera) => `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}`;
  const seg = <T extends string | number,>(items: [T, string][], cur: T, set: (v: T) => void, label: string) => (
    <div className="seg" role="group" aria-label={label}>{items.map(([id, l]) => <button key={String(id)} className={cur === id ? 'on' : ''} aria-pressed={cur === id} onClick={() => set(id)}>{l}</button>)}</div>
  );
  const looks = seg(LOOKS.map(([id, l]) => [id, l] as [Look, string]), look, setLook, 'Filtro de imagen');

  if (intro) return (
    <section className="wall" aria-label="Muro de video">
      <div className="w-collate"><div>
        <h3>Reuniendo señales disponibles</h3>
        <p>{n} cámaras del sector · {vid} con video</p>
        <div className="w-prog"><i style={{ width: '100%' }} /></div>
        <div className="w-prog"><i style={{ width: `${Math.round((vid / n) * 100)}%` }} /></div>
      </div></div>
    </section>
  );

  if (focus) {
    const cam = cameras.find((x) => x.id === focus)!;
    const camAlerts = alerts.filter((a) => a.cameraId === cam.id && a.review === 'por_revisar').slice(0, 4);
    const near = cameras.filter((x) => x.id !== cam.id).map((x) => ({ x, d: Math.hypot((x.lon - cam.lon) * 108000, (x.lat - cam.lat) * 111320) })).sort((p, q) => p.d - q.d).slice(0, 4);
    return (
      <section className="wall" aria-label={`Cámara ${cam.id}`}>
        <div className="w-bar">
          <button className="btn secondary sm" onClick={() => setFocus(null)}><Icon name="arrow_back" />Volver al muro</button>
          <div className="w-title"><h2>{cam.id} · {cam.street}</h2><span>{coords(cam)}</span></div>
          <span title="Filtro de visualización sobre la imagen. No es un sensor térmico ni infrarrojo.">{looks}</span>
          <button className="iconbtn" onClick={onClose} aria-label="Cerrar muro de video"><Icon name="close" /></button>
        </div>
        <div className="w-focus">
          <div className={`wt big ${cam.status}`}>
            <div className={`feed look-${look}`}>{feed(cam, true)}</div>
            <footer><span>{cam.id}</span><span>{coords(cam)}</span><span>{time}</span></footer>
          </div>
          <aside>
            <dl className="details">
              <dt>Estado</dt><dd><CameraNode status={cam.status} size={14} /> {STATUS[cam.status]}{cam.status !== 'caida' && ` · ${cam.fps} fps`}</dd>
              <dt>Cómputo</dt><dd>{cam.compute}</dd>
              <dt>Montaje</dt><dd>{cam.ptz ? `PTZ · ${cam.presets.length} presets` : 'Fija'}</dd>
              <dt>Campo de visión</dt><dd>{CAM_FOV}° · alcance {CAM_REACH} m</dd>
            </dl>
            <div><div className="caption">Alertas de esta cámara</div>
              {camAlerts.length ? <ul className="w-alerts">{camAlerts.map((a) => <li key={a.id}><button onClick={() => { onClose(); c.open({ k: 'alerta', id: a.id }); }}><span className="w-al-dot" />{KIND_PHRASE[a.kind]}{a.plate && <span className="plate">{a.plate.listed}</span>}<Icon name="arrow_forward" /></button></li>)}</ul>
                : <p className="dim" style={{ fontSize: 13, margin: 0 }}>Sin alertas esperando decisión.</p>}
            </div>
            <div><div className="caption">Cámaras vecinas</div>
              <div className="w-near">{near.map(({ x, d }) => <button key={x.id} className="w-near-t" onClick={() => setFocus(x.id)} title={x.street}><div className={`feed look-${look}`}>{feed(x)}</div><span>{x.id} · {Math.round(d)} m</span></button>)}</div>
            </div>
            <button className="btn secondary" onClick={() => { onClose(); c.open({ k: 'camara', id: cam.id }); }}><Icon name="map" />Ver en el mapa</button>
          </aside>
        </div>
      </section>
    );
  }

  const shown = list.slice(pg * per, pg * per + per);
  return (
    <section className="wall" aria-label="Muro de video">
      <div className="w-bar">
        <div className="w-title"><h2>Muro de video</h2><span>{live} de {n} cámaras con señal · {vid} con video · {al} con alerta</span></div>
        {seg<'all' | 'alert' | 'video'>([['all', `Todas ${n}`], ['alert', `Con alerta ${al}`], ['video', `Con video ${vid}`]], filter, (v) => { setFilter(v); setPage(0); }, 'Filtro')}
        {seg(GRIDS.map(([a, b], i) => [i, `${a}×${b}`] as [number, string]), grid, (v) => { setGrid(v); setPage(0); }, 'Rejilla')}
        <span title="Filtro de visualización sobre la imagen. No es un sensor térmico ni infrarrojo.">{looks}</span>
        <button className={`btn secondary sm ${auto ? 'on' : ''}`} aria-pressed={auto} onClick={() => setAuto(!auto)} title="Recorre las páginas del muro cada 7 segundos"><Icon name={auto ? 'pause' : 'play_arrow'} />Ronda</button>
        <span className="w-pager"><button className="iconbtn" onClick={() => setPage((pg + pages - 1) % pages)} aria-label="Página anterior"><Icon name="chevron_left" /></button><b>{list.length ? pg + 1 : 0} / {pages}</b><button className="iconbtn" onClick={() => setPage((pg + 1) % pages)} aria-label="Página siguiente"><Icon name="chevron_right" /></button></span>
        <button className="iconbtn" onClick={onClose} aria-label="Cerrar muro de video" title="Cerrar (Esc)"><Icon name="close" /></button>
      </div>
      <div className="w-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {shown.map(({ cam, a }) => (
          <button key={cam.id} className={`wt ${a ? 'has-alert' : ''} ${cam.status}`} onClick={() => setFocus(cam.id)} title={cam.street}>
            <header><CameraNode status={cam.status} size={13} /><b>{cam.id}</b><span className="st">{cam.street}</span></header>
            <div className={`feed look-${look}`}>{feed(cam)}</div>
            {a && <div className="al"><Icon name="warning" />{KIND_PHRASE[a.kind]}{a.plate ? ` · ${a.plate.listed}` : ''}</div>}
            <footer><span>{coords(cam)}</span><span>{cam.status === 'caida' ? '— fps' : `${cam.fps} fps`}</span><span>{time}</span></footer>
          </button>
        ))}
        {!shown.length && <div className="w-empty">{filter === 'alert' ? 'Ninguna cámara tiene alertas esperando decisión.' : 'Ninguna cámara en este filtro.'}</div>}
      </div>
    </section>
  );
}
