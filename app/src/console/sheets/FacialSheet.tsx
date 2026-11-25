/* Verificación facial (fase 3) — operador 911.
   Panel: coincidencias de los puntos de control, filtrables por lista (buscadas, en investigación,
   desaparecidas). Una sola por persona: las detecciones nuevas se suman a la misma.
   Ficha: la captura más reciente, la reconstrucción 3D del perfil (ya hecha, afinada con cada detección)
   y todas las fotos de la lista. El operador 911 tiene el veredicto final: confirma que es la persona
   (se genera la alerta y se avisa al agente) o la descarta. Nunca es una identificación automática. */
import { useEffect, useMemo, useState } from 'react';
import { audit } from '../../api';
import { ago, dateTime, hhmm, pct } from '../../api/format';
import { FACIAL_DISCARD, FACIAL_LISTS, FACIAL_SOURCES, confirmFacial, discardFacial, lastDetection, scoreOf, useFacial, type FacialList, type FacialMatch } from '../../api/facial';
import { useSession } from '../../shell/session';
import { FaceCloud } from '../../ui/FaceCloud';
import { useInspect } from '../../ui/ImageInspect';
import { EmptyState, Icon, useNow, useToast } from '../../ui/kit';
import type { RouteStop } from '../../map/MapView';
import { useConsole } from '../ctx';
import { SheetHead } from './SheetHead';

const STATUS: Record<FacialMatch['status'], string> = { por_revisar: 'Por revisar', confirmada: 'Confirmada', descartada: 'Descartada' };
const statusChip = (m: FacialMatch) => <span className={`chip ${m.status === 'por_revisar' ? 'outline' : m.status === 'confirmada' ? 'ok' : ''}`}>{STATUS[m.status]}</span>;

function Phase3Notice() {
  return <div className="notice"><Icon name="lock" /><span>Requiere base legal confirmada.</span></div>;
}

type ListFilter = FacialList | 'todas';
const LIST_KEY = 'p33.facial.lista';
const readList = (): ListFilter => { try { const v = localStorage.getItem(LIST_KEY); return v && (v === 'todas' || Object.hasOwn(FACIAL_LISTS, v)) ? (v as ListFilter) : 'todas'; } catch { return 'todas'; } };

export function FacialPanel() {
  const c = useConsole();
  const now = useNow(10000);
  const all = useFacial();
  /* Filtro por lista: el operador 911 elige qué listas mira (p. ej. solo personas buscadas). Queda
     guardado en este navegador. El número es cuántas esperan decisión en cada lista. */
  const [list, setListRaw] = useState<ListFilter>(readList);
  const setList = (l: ListFilter) => { setListRaw(l); try { localStorage.setItem(LIST_KEY, l); } catch { /* sin almacenamiento */ } };
  const pending = (l: ListFilter) => all.filter((m) => m.status === 'por_revisar' && (l === 'todas' || m.list === l)).length;
  const matches = useMemo(() => all.filter((m) => list === 'todas' || m.list === list)
    .sort((a, b) => Number(b.status === 'por_revisar') - Number(a.status === 'por_revisar') || lastDetection(b).at - lastDetection(a).at), [all, list]);
  return (
    <>
      <Phase3Notice />
      <div className="fbar" role="group" aria-label="Listas">
        {(['todas', ...Object.keys(FACIAL_LISTS)] as ListFilter[]).map((l) => (
          <button key={l} aria-pressed={list === l} className={`fchip ${list === l ? 'on' : ''}`} onClick={() => setList(l)}
            aria-label={`${l === 'todas' ? 'Todas las listas' : FACIAL_LISTS[l].name}: ${pending(l)} por revisar`}>
            {l === 'todas' ? 'Todas las listas' : FACIAL_LISTS[l].name}<b>{pending(l)}</b>
          </button>
        ))}
      </div>
      {/* Vacía: no hubo coincidencias. Con coincidencias pero ninguna pendiente: se dice antes de la lista. */}
      {!matches.length && <EmptyState icon="visibility" title="Sin coincidencias">{list === 'todas' ? 'Los puntos de control no encontraron rostros de las listas. Si aparece uno, llega acá con un aviso.' : `Nada de ${FACIAL_LISTS[list].name.toLowerCase()}.`}</EmptyState>}
      {matches.length > 0 && !matches.some((m) => m.status === 'por_revisar') && <div className="es-inline"><span className="es-ic" aria-hidden><Icon name="done_all" /></span><span><b>Todo revisado.</b> Ninguna coincidencia espera decisión.</span></div>}
      <ul className="list pb flush">
        {matches.map((m) => {
          const d = lastDetection(m);
          return (
            <li key={m.id}>
              <button className={`item ${c.sheet?.k === 'facial' && c.sheet.id === m.id ? 'sel' : ''} ${m.status === 'descartada' ? 'done' : ''}`} style={{ gridTemplateColumns: '44px 1fr auto' }} onClick={() => c.open({ k: 'facial', id: m.id })}>
                <img src={d.capture} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
                <div><div className="t">Coincidencia {pct(d.score)}</div><div className="s">{FACIAL_LISTS[m.list].name} · {m.listRef}</div><div className="s">{d.place}{m.detections.length > 1 ? ` · ${m.detections.length} detecciones` : ''}</div></div>
                <div className="r"><span>{ago(d.at, now)}</span>{statusChip(m)}</div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="lfoot">Solo corre en puntos de control habilitados. Los rostros que no coinciden no se guardan.</div>
    </>
  );
}

export function FacialSheet({ id }: { id: string }) {
  const { user, role } = useSession();
  const c = useConsole();
  const toast = useToast();
  const now = useNow(5000);
  const m = useFacial().find((x) => x.id === id);
  const [discarding, setDiscarding] = useState(false);
  /* Comparar: la captura junto a una foto de la lista (la que más se parece, o la que elija el operador).
     Toda imagen se amplía con un clic (zoom, mover, girar) en el visor sobre el mapa. */
  const [cmp, setCmp] = useState(0);
  const insp = useInspect(m ? `${m.listRef} · ${lastDetection(m).cameraId} · ${dateTime(lastDetection(m).at)}` : '');

  /* Recorrido de la persona: cada detección en el mapa, en orden, con su captura. Queda en la bitácora. */
  const [trace, setTrace] = useState(false);
  // Al abrir la coincidencia, el recorrido (o el punto, si hay una sola detección) arranca solo. Queda en la bitácora.
  useEffect(() => {
    setDiscarding(false); setTrace(!!m); setCmp(0);
    if (m) audit(user, 'Ver recorrido de persona', m.listRef, 'Al abrir la coincidencia');
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trace || !m) return;
    const stops: RouteStop[] = m.detections.map((d, i) => ({ lat: d.lat, lon: d.lon, label: String(i + 1), time: hhmm(d.at), title: `${dateTime(d.at)} · ${d.cameraId} · ${d.place}`,
      snap: { camera: d.cameraId, street: d.place, evidence: { type: 'imagen', src: d.capture, caption: 'Captura de la detección' }, confidence: d.score } }));
    // Con una sola detección no hay recorrido: se marca el punto y el mapa va hacia él.
    if (stops.length === 1) {
      const s = stops[0];
      c.setPin({ lat: s.lat, lon: s.lon, label: s.time ?? '' }); c.focus([[s.lon - 0.0015, s.lat - 0.001], [s.lon + 0.0015, s.lat + 0.001]], 'persona');
      return () => c.setPin(null);
    }
    c.setOverlay({ route: stops, routeLabel: m.listRef, fit: { points: stops.map((s) => [s.lon, s.lat]), key: `persona-${m.id}-${stops.length}` } });
    return () => c.setOverlay({});
  }, [trace, m?.id, m?.detections.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return <SheetHead kicker="Verificación facial" title="No encontrada" />;
  const d = lastDetection(m);
  const L = FACIAL_LISTS[m.list];
  const toggleTrace = () => { if (!trace) audit(user, 'Ver recorrido de persona', m.listRef, `${m.detections.length} detecciones en el mapa`); setTrace(!trace); };
  const photos = [...m.listPhotos].sort((x, y) => y.score - x.score);
  const ph = photos[Math.min(cmp, photos.length - 1)];
  return (
    <>
      <SheetHead kicker={<><span className="mono">{m.id}</span>·<span>{ago(d.at, now)}</span></>} title={<>Coincidencia {pct(scoreOf(m))}</>} sub={`${L.name} · ${m.listRef} · ${d.place}`}
        aside={statusChip(m)} />
      {insp.viewer}
      <div className="pb">
        <div className="callout"><Icon name="info" /><span className="grow">Una coincidencia no es una identificación. Tú tienes la última palabra: confirma solo si es la persona.</span></div>
        <section className="fc-compare" aria-label="Comparar la captura con la lista">
          <div className="fc-pair">
            <figure>
              {insp.thumb('captura', { type: 'imagen', src: d.capture, caption: 'Captura de la detección' }, 'Captura', <span className="chip"><Icon name="videocam" />{d.cameraId}</span>)}
              <figcaption className="caption">Captura · {hhmm(d.at)}</figcaption>
            </figure>
            <figure>
              {insp.thumb('lista-' + ph.src, { type: 'imagen', src: ph.src, caption: ph.caption }, `${ph.caption} (${ph.year})`, <span className="chip">{pct(ph.score)}</span>)}
              <figcaption className="caption">{ph.caption} · {ph.year}</figcaption>
            </figure>
          </div>
          {photos.length > 1 && (
            <div className="fc-strip" role="group" aria-label={`Fotos en la lista (${photos.length})`}>
              {photos.map((x, i) => (
                <button key={x.src + i} className={i === cmp ? 'on' : ''} aria-pressed={i === cmp} onClick={() => setCmp(i)} title={`Comparar con ${x.caption.toLowerCase()} (${x.year})`}>
                  <img src={x.src} alt="" /><span>{x.caption}</span><b className="mono">{pct(x.score)}</b>
                </button>
              ))}
            </div>
          )}
          <p className="caption">Clic en una imagen para ampliarla.{photos.length > 1 ? ` La lista tiene ${photos.length} fotos: elige con cuál comparar.` : ''}</p>
        </section>
        <div className="box">
          <div className="bh"><h3>Reconstrucción 3D</h3><span className="sub">Afinada con {m.profile3d.detections} detecciones</span></div>
          <div className="bb fc-3d"><FaceCloud seed={[...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7)} label={`Reconstrucción 3D del perfil ${m.listRef}`} /></div>
        </div>
        <div className="box">
          <div className="bh"><h3>Señas para confirmar</h3></div>
          <div className="bb fc-marks">
            <div><h4>En la lista</h4><ul>{m.marks.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><h4>En la captura</h4><ul>{m.observed.map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
        </div>
        <div className="box"><div className="bb" style={{ paddingTop: 12 }}><dl className="details">
          <dt>Nombre</dt><dd>{m.name}</dd>
          <dt>Documento</dt><dd className="mono">{m.docId}</dd>
          <dt>Lista</dt><dd>{L.name} · <span className="mono">{m.listRef}</span></dd>
          <dt>Motivo</dt><dd>{m.reason}</dd>
          {m.orderUntil && <><dt>Vigencia de la orden</dt><dd>hasta el {m.orderUntil}</dd></>}
          <dt>Certeza</dt><dd className="mono">{pct(d.score)}</dd>
          <dt>Procesado en</dt><dd className="mono">{m.spotbox}</dd>
          <dt>Agente</dt><dd>{m.agent}</dd>
        </dl></div></div>
        <div className="box">
          <div className="bh"><h3>Fuentes para verificar</h3></div>
          <ul className="bb fc-src">
            {FACIAL_SOURCES.map((s) => <li key={s.name}><span>{s.name}</span><span className={`chip ${s.state === 'conectada' ? 'ok' : 'outline'}`}>{s.state === 'conectada' ? 'Conectada' : 'Por conectar'}</span></li>)}
          </ul>
        </div>
        <div className="box flush">
          <div className="bh"><h3>Detecciones</h3><span className="sub">{m.detections.length}</span>
            <button className="btn secondary sm" style={{ marginLeft: 'auto' }} onClick={toggleTrace}><Icon name={trace ? 'visibility_off' : 'route'} />{trace ? 'Ocultar recorrido' : m.detections.length > 1 ? 'Ver recorrido en el mapa' : 'Ver en el mapa'}</button>
          </div>
          <ul className="list bb">
            {[...m.detections].reverse().map((x, i) => (
              <li key={x.at}><div className="item" style={{ gridTemplateColumns: '36px 1fr auto', cursor: 'default' }}>
                <img src={x.capture} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 'var(--radius-xs)' }} />
                <div><div className="t mono">{x.cameraId}{i === 0 && <span className="muted"> · la más reciente</span>}</div><div className="s">{x.place}</div></div>
                <div className="r"><span className="mono">{dateTime(x.at)}</span><span>{pct(x.score)}</span></div>
              </div></li>
            ))}
          </ul>
        </div>
        <div className="box"><div className="bh"><h3>Contexto de la cámara</h3></div><div className="bb"><img src={m.scene} alt="Escena del punto de control" style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }} /></div></div>
        <div className="box"><div className="bh"><h3>Estados</h3></div><div className="bb"><ol className="timeline">
          {m.timeline.map((t, i) => <li key={i} className={i === m.timeline.length - 1 ? 'now' : 'done'}><span className="b" aria-hidden /><div>{t.label}</div><div className="when">{hhmm(t.at)}{t.by && ` · ${t.by}`}</div></li>)}
        </ol></div></div>
      </div>
      {role !== 'operator_911' && <div className="notice" style={{ background: 'var(--glass-hi)' }}><Icon name="lock" /><span>Solo lectura: confirma o descarta el operador 911.</span></div>}
      <div className="pf">
        {role === 'operator_911' && m.status === 'por_revisar' && !discarding && <>
          <button className="btn positive" style={{ flex: 1 }} onClick={() => { confirmFacial(m.id, user); toast('Identidad confirmada: alerta generada y agente avisado'); }}><Icon name="check" />Es la persona: confirmar</button>
          <button className="btn secondary" onClick={() => setDiscarding(true)}><Icon name="close" />No coincide</button>
        </>}
        {role === 'operator_911' && m.status === 'por_revisar' && discarding && <>
          <div role="group" aria-labelledby="fc-discard" style={{ display: 'contents' }}>
            <span id="fc-discard" style={{ fontSize: 'var(--fs-sm)', width: '100%', color: 'var(--ink-muted)' }}>Motivo del descarte</span>
            {FACIAL_DISCARD.map((r) => <button key={r} className="btn secondary xs" onClick={() => { discardFacial(m.id, r, user); setDiscarding(false); }}>{r}</button>)}
            <button className="btn ghost xs" onClick={() => setDiscarding(false)}>Cancelar</button>
          </div>
        </>}
        {m.status === 'confirmada' && <span style={{ fontSize: 'var(--fs-sm)' }}><Icon name="check_circle" /> Confirmada{m.reviewedBy ? ` por ${m.reviewedBy}` : ''}. El agente en el punto de control está avisado.</span>}
        {m.status === 'descartada' && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Descartada{m.discardReason ? `: ${m.discardReason.toLowerCase()}` : ''}. El rostro no se guarda.</span>}
      </div>
    </>
  );
}
