/* Verificación facial (fase 3) — operador 911.
   Panel: coincidencias de los puntos de control, filtrables por lista (buscadas, en investigación,
   desaparecidas). Una sola por persona: las detecciones nuevas se suman a la misma.
   Ficha: para decidir rápido si es la persona. Arriba el puntaje; después el video, todas las imágenes
   juntas (capturas de hoy y fotos de la lista), una línea de recorrido, última ubicación y riesgo, y
   pedir la verificación en terreno. Después los metadatos (datos de la lista y señas registradas) y los estados. La 3D
   y las conexiones quedan en el expediente.
   El operador 911 tiene el veredicto final. Nunca es una identificación automática. */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { audit } from '../../api';
import { cameraClip } from '../../api/video';
import { ago, dateTime, hhmm, pct } from '../../api/format';
import { FACIAL_DISCARD, FACIAL_LISTS, bestDetection, confirmFacial, discardFacial, lastDetection, requestFieldCheck, scoreMeaning, useFacial, type FacialDetection, type FacialList, type FacialMatch } from '../../api/facial';
import { useSession } from '../../shell/session';
import { FacialDossier, Proofs, Shot, Viewer, proofItem, type ViewItem } from './FacialDossier';
import { EmptyState, Icon, useNow, useToast } from '../../ui/kit';
import type { RouteStop } from '../../map/MapView';
import { useConsole } from '../ctx';
import { SheetHead } from './SheetHead';

const gapMin = (ms: number) => { const mn = Math.round(ms / 60000); return mn < 60 ? `${mn} min` : `${Math.floor(mn / 60)} h${mn % 60 ? ` ${mn % 60} min` : ''}`; };
const distM = (a: FacialDetection, b: FacialDetection) => {
  const R = 6371e3, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** ¿El recorrido de hoy es posible para una persona? Si entre dos detecciones habría que ir a más de
    60 km/h (o estar en dos lugares a la vez), no cierra: puede ser otra persona o un error. */
function tripCheck(ds: FacialDetection[]): { ok: boolean; text: string } {
  if (ds.length < 2) return { ok: true, text: 'Una sola detección hoy: no hay recorrido para comparar.' };
  for (let i = 1; i < ds.length; i++) {
    const h = (ds[i].at - ds[i - 1].at) / 3600e3, km = distM(ds[i - 1], ds[i]) / 1000;
    if ((h <= 0 && km > 0.2) || (h > 0 && km / h > 60)) return { ok: false, text: `No cierra: de ${ds[i - 1].cameraId} a ${ds[i].cameraId} hay ${km.toFixed(1)} km en ${gapMin(ds[i].at - ds[i - 1].at)}. Puede ser otra persona.` };
  }
  return { ok: true, text: `Cierra: ${ds.length} detecciones en orden y a distancias posibles, de ${hhmm(ds[0].at)} a ${hhmm(ds[ds.length - 1].at)}.` };
}

/** Coincidencias cuyo recorrido ya quedó en la bitácora en esta sesión. */
const traced = new Set<string>();

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
                <span className="fc-ph" style={{ width: 44, height: 44 }}><Shot /></span>
                <div><div className="t">Coincidencia {pct(bestDetection(m).score)}</div><div className="s">{FACIAL_LISTS[m.list].name} · {m.listRef}</div><div className="s">{d.place}{m.detections.length > 1 ? ` · ${m.detections.length} detecciones` : ''}</div></div>
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
  /** Expediente a pantalla completa: todo junto, con la 3D para girar, señas para marcar y conexiones. */
  const [dossier, setDossier] = useState(false);
  /** El recuadro de video muestra la grabación de la captura o la cámara en vivo, sin salir de la ficha. */
  const [live, setLive] = useState(false);
  /** Visor grande abierto: índice de la imagen (o del respaldo) que se ve. */
  const [view, setView] = useState<number | null>(null);
  const [docView, setDocView] = useState<number | null>(null);

  /* Recorrido de la persona: cada detección en el mapa, en orden, con su captura. Queda en la bitácora. */
  const [trace, setTrace] = useState(false);
  // Al abrir la coincidencia, el recorrido (o el punto, si hay una sola detección) arranca solo. Queda en la bitácora.
  useEffect(() => {
    setDiscarding(false); setTrace(!!m); setDossier(false); setLive(false); setView(null); setDocView(null);
    // Una sola vez por coincidencia en la sesión (volver desde la cámara no repite el registro).
    if (m && !traced.has(m.id)) { traced.add(m.id); audit(user, 'Ver recorrido de persona', m.listRef, 'Al abrir la coincidencia'); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trace || !m) return;
    const stops: RouteStop[] = m.detections.map((d, i) => ({ lat: d.lat, lon: d.lon, label: String(i + 1), time: hhmm(d.at), title: `${dateTime(d.at)} · ${d.cameraId} · ${d.place}`,
      snap: { camera: d.cameraId, street: d.place, evidence: { type: 'pendiente', caption: 'Captura de la detección' }, confidence: d.score } }));
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
  const openDossier = () => { setDossier(true); audit(user, 'Abrir expediente facial', m.listRef, m.id); };
  const photos = [...m.listPhotos].sort((x, y) => y.score - x.score);
  const best = bestDetection(m);
  const meaning = scoreMeaning(best.score);
  const cams = new Set(m.detections.map((x) => x.cameraId)).size;
  const trip = tripCheck(m.detections);
  // Todas las imágenes, de la más reciente a la más vieja y después las fotos de la lista: se navegan en grande.
  const imgs: ViewItem[] = [
    ...[...m.detections].reverse().map((x) => ({ src: '', tag: 'Hoy', icon: 'videocam', title: `${hhmm(x.at)} · ${pct(x.score)}`, sub: `${x.cameraId} · ${x.place}` })),
    ...photos.map((x) => ({ src: '', tag: 'Lista', icon: 'badge', title: `${x.caption} · ${x.year}`, sub: `Parecido ${pct(x.score)}` })),
  ];
  const liveClip = cameraClip(d.cameraId);
  return (
    <>
      <SheetHead kicker={<><span className="mono">{m.id}</span>·<span>{ago(d.at, now)}</span></>} title={<>Coincidencia {pct(best.score)} <span className={`chip ${meaning.band === 'Alta' ? 'ok' : meaning.band === 'Baja' ? 'media' : ''}`}>{meaning.band}</span></>} sub={`${m.name} · ${m.reason}`}
        aside={statusChip(m)} />
      <div className="pb">
        {/* Video primero: el andar y los gestos son lo que más ayuda a decidir. */}
        {/* Grabación de la mejor captura o la cámara en vivo donde la vieron por última vez, ahí mismo. */}
        <div className="fc-video">
          <div className="seg fc-vseg" role="group" aria-label="Video">
            <button aria-pressed={!live} className={!live ? 'on' : ''} onClick={() => setLive(false)}>Grabación · {hhmm(best.at)} · {best.cameraId}</button>
            <button aria-pressed={live} className={live ? 'on' : ''} onClick={() => { if (!live) audit(user, 'Ver cámara en vivo', d.cameraId, m.listRef); setLive(true); }}><span className="live-dot" aria-hidden />En vivo · {d.cameraId}</button>
          </div>
          <span className="fc-ph">
            {live
              ? (liveClip ? <video src={liveClip.src} poster={liveClip.poster} muted loop autoPlay playsInline controls aria-label={`En vivo, ${d.cameraId}`} /> : <Shot label={`En vivo · ${d.cameraId} · sin señal de video`} />)
              : <Shot label={`Grabación · ${hhmm(best.at)} · ${best.cameraId} (5 s antes y después)`} />}
          </span>
        </div>

        {/* Todas las imágenes juntas: las capturas de hoy y las fotos de la lista. */}
        <div className="fc-gallery">
          {imgs.map((x, i) => (
            <button key={i} className={`fc-tile ${x.tag === 'Lista' ? 'lista' : ''}`} onClick={() => setView(i)} aria-label={`Ver en grande: ${x.tag} · ${x.title}`}>
              <span className="fc-ph"><Shot /></span>
              <span className={`chip ${x.tag === 'Lista' ? 'ok' : ''}`}>{x.title}</span>
            </button>
          ))}
        </div>
        {view != null && <Viewer standalone items={imgs} index={view} onIndex={setView} onClose={() => setView(null)} compare={imgs.find((x) => x.tag === 'Lista') ?? null} />}
        {docView != null && <Viewer standalone items={m.docs.map(proofItem)} index={docView} onIndex={setDocView} onClose={() => setDocView(null)} />}

        <ul className="fc-facts">
          <li className={trip.ok ? '' : 'warn'}><Icon name="route" /><span>{m.detections.length} {m.detections.length === 1 ? 'detección' : 'detecciones'} hoy en {cams} {cams === 1 ? 'cámara' : 'cámaras'}{trip.ok ? '' : ' · el recorrido no cierra'}</span>
            <button className="btn ghost xs" onClick={toggleTrace}>{trace ? 'Ocultar' : 'Ver en el mapa'}</button></li>
          <li><Icon name="location_on" /><span>Última: {d.place} · {ago(d.at, now)}</span></li>
          <li className={m.risk.level === 'alto' ? 'danger' : m.risk.level === 'medio' ? 'warn' : ''}><Icon name="warning" /><span>Riesgo {m.risk.level}: {m.risk.notes[0]}</span></li>
          {m.similarDiscarded > 0 && <li className="warn"><Icon name="group" /><span>Hay alguien que se le parece: {m.similarDiscarded} ya {m.similarDiscarded === 1 ? 'descartada' : 'descartadas'}</span></li>}
        </ul>

        {m.status === 'por_revisar' && (m.fieldCheck
          ? <p className="fc-asked"><Icon name="schedule" />El agente está verificando el documento ({ago(m.fieldCheck.at, now)}).</p>
          : role === 'operator_911' && <button className="btn secondary fc-check" onClick={() => { requestFieldCheck(m.id, user); toast('Pedido enviado al agente: verificar el documento'); }}><Icon name="badge" />Pedir al agente que verifique el documento</button>)}

        <div className="box">
          <div className="bh"><h3>Metadatos</h3></div>
          <div className="bb">
            <dl className="details">
              <dt>Persona</dt><dd>{m.name}</dd>
              <dt>Documento</dt><dd className="mono">{m.docId}</dd>
              <dt>Motivo</dt><dd>{m.reason}</dd>
              {m.orderUntil && <><dt>Orden</dt><dd>Vigente hasta el {m.orderUntil}</dd></>}
              <dt>Lista</dt><dd>{L.name} · <span className="mono">{m.listRef}</span></dd>
              {m.traits.filter((x) => x.list).map((x, i) => <Fragment key={i}><dt>{x.label}</dt><dd>{x.list}</dd></Fragment>)}
              {m.risk.notes.slice(1).map((x) => <Fragment key={x}><dt>Ojo</dt><dd>{x}</dd></Fragment>)}
              <dt>Agente cerca</dt><dd>{m.agent}</dd>
              <dt>Procesado en</dt><dd className="mono">{m.spotbox}</dd>
            </dl>
            {m.docs.length > 0 && <div style={{ marginTop: 12 }}><Proofs items={m.docs} onOpen={setDocView} /></div>}
          </div>
        </div>

        <div className="box"><div className="bh"><h3>Estados</h3></div><div className="bb"><ol className="timeline">
          {m.timeline.map((t, i) => <li key={i} className={i === m.timeline.length - 1 ? 'now' : 'done'}><span className="b" aria-hidden /><div>{t.label}</div><div className="when">{hhmm(t.at)}{t.by && ` · ${t.by}`}</div></li>)}
        </ol></div></div>
      </div>
      {dossier && <FacialDossier m={m} canDecide={role === 'operator_911' && m.status === 'por_revisar'} onClose={() => setDossier(false)}
        onConfirm={() => { confirmFacial(m.id, user); toast('Identidad confirmada: alerta generada y agente avisado'); setDossier(false); }}
        onDiscard={() => { setDossier(false); setDiscarding(true); }} />}
      {role !== 'operator_911' && <div className="notice" style={{ background: 'var(--glass-hi)' }}><Icon name="lock" /><span>Solo lectura: confirma o descarta el operador 911.</span></div>}
      <div className="pf">
        <button className="fc-open" onClick={openDossier}>
          <i aria-hidden><Icon name="open_in_full" /></i>
          <span><b>Abrir expediente completo</b><small>Reconstrucción 3D, conexiones y todas las imágenes · {m.links.length} vínculos</small></span>
          <Icon name="arrow_forward" />
        </button>
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
