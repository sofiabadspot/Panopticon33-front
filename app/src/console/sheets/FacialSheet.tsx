/* Verificación facial (fase 3) — operador 911.
   Panel: coincidencias de los puntos de control, filtrables por lista (buscadas, en investigación,
   desaparecidas). Una sola por persona: las detecciones nuevas se suman a la misma.
   Ficha: solo lo que el operador 911 necesita para decidir si es la persona, en este orden: si la
   captura sirve, la comparación con la foto de la lista, qué significa el puntaje, las señas que no
   cambian, si el recorrido de hoy cierra, el video, el riesgo y qué pasa al confirmar, dónde está ahora
   y pedir la verificación en terreno. Lo demás (3D, conexiones) queda en el expediente.
   El operador 911 tiene el veredicto final. Nunca es una identificación automática. */
import { useEffect, useMemo, useState } from 'react';
import { audit } from '../../api';
import { ago, dateTime, hhmm, pct } from '../../api/format';
import { FACIAL_DISCARD, FACIAL_LISTS, POSE_LABEL, SHARP_LABEL, bestDetection, confirmFacial, discardFacial, lastDetection, requestFieldCheck, scoreMeaning, usable, useFacial, type FacialDetection, type FacialList, type FacialMatch } from '../../api/facial';
import { useSession } from '../../shell/session';
import { useInspect } from '../../ui/ImageInspect';
import { FacialDossier, Shot, Traits } from './FacialDossier';
import { EmptyState, Icon, useNow, useToast } from '../../ui/kit';
import type { RouteStop } from '../../map/MapView';
import { useConsole } from '../ctx';
import { SheetHead } from './SheetHead';

/** Años desde el año de una foto. */
const age = (year: string) => (/^\d{4}$/.test(year) ? new Date().getFullYear() - Number(year) : 0);
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
/** Hacia dónde iba, según las dos últimas detecciones. */
function headingOf(ds: FacialDetection[]) {
  if (ds.length < 2) return null;
  const a = ds[ds.length - 2], b = ds[ds.length - 1];
  if (distM(a, b) < 30) return null;
  const deg = (Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;
  const dirs = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  return `Hacia el ${dirs[Math.round(((deg + 360) % 360) / 45) % 8]} (desde ${a.cameraId})`;
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
  const [cmp, setCmp] = useState(0);
  /** Expediente a pantalla completa: todo junto, con la 3D para girar, señas para marcar y conexiones. */
  const [dossier, setDossier] = useState(false);
  const insp = useInspect(m ? `${m.listRef} · ${bestDetection(m).cameraId} · ${dateTime(bestDetection(m).at)}` : '');

  /* Recorrido de la persona: cada detección en el mapa, en orden, con su captura. Queda en la bitácora. */
  const [trace, setTrace] = useState(false);
  // Al abrir la coincidencia, el recorrido (o el punto, si hay una sola detección) arranca solo. Queda en la bitácora.
  useEffect(() => {
    setDiscarding(false); setTrace(!!m); setCmp(0); setDossier(false);
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
  const ph = photos[Math.min(cmp, photos.length - 1)] ?? { src: '', caption: 'Sin fotos en la lista', year: '—', score: 0 };
  const best = bestDetection(m);
  const meaning = scoreMeaning(best.score);
  const cams = new Set(m.detections.map((x) => x.cameraId)).size;
  const trip = tripCheck(m.detections);
  const heading = headingOf(m.detections);
  return (
    <>
      <SheetHead kicker={<><span className="mono">{m.id}</span>·<span>{ago(d.at, now)}</span></>} title={<>Coincidencia {pct(best.score)}</>} sub={`${m.name} · ${m.docId} · ${L.name} · ${m.listRef}`}
        aside={statusChip(m)} />
      {insp.viewer}
      <div className="pb">
        <div className="callout"><Icon name="info" /><span className="grow">Una coincidencia no es una identificación. Tú tienes la última palabra: confirma solo si es la persona.</span></div>

        {/* 1. ¿La captura sirve para comparar? */}
        <div className="box">
          <div className="bh"><h3>1 · La captura</h3><span className="sub">la mejor de hoy · {hhmm(best.at)} · {best.cameraId}</span></div>
          <div className="bb fc-q">
            <span className={`chip ${best.quality.pose === 'perfil' ? 'media' : 'ok'}`}>{POSE_LABEL[best.quality.pose]}</span>
            <span className={`chip ${best.quality.sharp === 'borrosa' ? 'media' : best.quality.sharp === 'nitida' ? 'ok' : ''}`}>{SHARP_LABEL[best.quality.sharp]}</span>
            {best.quality.covered.length ? best.quality.covered.map((x) => <span key={x} className="chip media">Tapa: {x.toLowerCase()}</span>) : <span className="chip ok">Cara descubierta</span>}
            <p className={`fc-verdict ${usable(best.quality) ? 'ok' : 'warn'}`}><Icon name={usable(best.quality) ? 'check_circle' : 'warning'} />{usable(best.quality) ? 'Sirve para comparar.' : `Captura pobre: no alcanza para confirmar. ${role === 'operator_911' ? 'Pide' : 'Hace falta'} la verificación en terreno.`}</p>
          </div>
        </div>

        {/* 2. Comparar la captura con la foto de la lista más parecida y reciente. */}
        <div className="box">
          <div className="bh"><h3>2 · Comparar</h3><span className="sub">rasgos que no cambian: cara, nariz, orejas, cejas</span></div>
          <div className="bb fc-compare">
            <div className="fc-pair">
              <figure>
                {insp.thumb('captura', { type: 'pendiente', caption: 'Captura de la detección' }, 'Captura', <span className="chip"><Icon name="videocam" />{best.cameraId}</span>)}
                <figcaption className="caption">Captura · hoy {hhmm(best.at)}</figcaption>
              </figure>
              <figure>
                {insp.thumb('lista-' + cmp, { type: 'pendiente', caption: ph.caption }, `${ph.caption} (${ph.year})`, <span className="chip">{pct(ph.score)}</span>)}
                <figcaption className="caption">{ph.caption} · {ph.year}{age(ph.year) >= 5 ? ` · tiene ${age(ph.year)} años` : ''}</figcaption>
              </figure>
            </div>
            {photos.length > 1 && (
              <div className="fc-strip" role="group" aria-label={`Fotos en la lista (${photos.length})`}>
                {photos.map((x, i) => (
                  <button key={i} className={i === cmp ? 'on' : ''} aria-pressed={i === cmp} onClick={() => setCmp(i)} title={`Comparar con ${x.caption.toLowerCase()} (${x.year})`}>
                    <span className="fc-ph"><Shot /></span><span>{x.caption} · {x.year}</span><b className="mono">{pct(x.score)}</b>
                  </button>
                ))}
              </div>
            )}
            <p className="caption">Toca una imagen para ampliarla.</p>
          </div>
        </div>

        {/* 3. Qué significa el puntaje. */}
        <div className="box">
          <div className="bh"><h3>3 · El puntaje</h3><span className={`chip ${meaning.band === 'Alta' ? 'ok' : meaning.band === 'Baja' ? 'media' : ''}`} style={{ marginLeft: 'auto' }}>{meaning.band} · {pct(best.score)}</span></div>
          <div className="bb fc-meaning">
            <p>De cada 100 coincidencias con este puntaje, <b>unas {meaning.of100}</b> resultaron ser la persona.</p>
            <p>{m.detections.length > 1 ? <>Hoy la vieron <b>{m.detections.length} veces en {cams} cámaras</b>: varias detecciones que coinciden pesan más que una sola.</> : 'Hoy hay una sola detección.'}</p>
            {m.similarDiscarded > 0 && <p className="fc-warn"><Icon name="warning" />Ya se descartaron {m.similarDiscarded} {m.similarDiscarded === 1 ? 'coincidencia' : 'coincidencias'} con esta persona de la lista: hay alguien que se le parece.</p>}
          </div>
        </div>

        {/* 4. Señas que no cambian. */}
        <div className="box">
          <div className="bh"><h3>4 · Señas permanentes</h3><span className="sub">la ropa no sirve para confirmar</span></div>
          <div className="bb fc-traits"><Traits m={m} only={['cuerpo', 'rostro', 'marcas']} /></div>
        </div>

        {/* 5. ¿El recorrido de hoy cierra? (se dibuja en el mapa) */}
        <div className="box flush">
          <div className="bh"><h3>5 · Recorrido de hoy</h3>
            <button className="btn secondary sm" style={{ marginLeft: 'auto' }} onClick={toggleTrace}><Icon name={trace ? 'visibility_off' : 'route'} />{trace ? 'Ocultar del mapa' : 'Ver en el mapa'}</button>
          </div>
          <p className={`fc-verdict fc-trip ${trip.ok ? 'ok' : 'warn'}`}><Icon name={trip.ok ? 'check_circle' : 'warning'} />{trip.text}</p>
          <ul className="list bb">
            {[...m.detections].map((x, i) => ({ x, i })).reverse().map(({ x, i }) => (
              <li key={x.at}><div className="item" style={{ gridTemplateColumns: '24px 1fr auto', cursor: 'default' }}>
                <span className="fc-n mono">{i + 1}</span>
                <div><div className="t mono">{hhmm(x.at)} · {x.cameraId}</div><div className="s">{x.place} · {POSE_LABEL[x.quality.pose].toLowerCase()}, {SHARP_LABEL[x.quality.sharp].toLowerCase()}</div></div>
                <div className="r"><span className="mono">{pct(x.score)}</span>{i > 0 && <span>{gapMin(x.at - m.detections[i - 1].at)} después</span>}</div>
              </div></li>
            ))}
          </ul>
        </div>

        {/* 6. Video de la detección y la cámara en vivo. */}
        <div className="box">
          <div className="bh"><h3>6 · Video</h3><span className="sub">el andar y los gestos ayudan a decidir</span></div>
          <div className="bb fc-video">
            <span className="fc-ph"><Shot label={`Video de la captura de las ${hhmm(best.at)} en ${best.cameraId} (5 s antes y después)`} /></span>
            <button className="btn secondary sm" onClick={() => c.open({ k: 'camara', id: d.cameraId })}><Icon name="videocam" />Ver en vivo {d.cameraId}, donde la vieron por última vez</button>
          </div>
        </div>

        {/* 7. Riesgo y qué pasa si confirma. */}
        <div className="box">
          <div className="bh"><h3>7 · Si confirmas</h3><span className={`chip ${m.risk.level === 'alto' ? 'critica' : m.risk.level === 'medio' ? 'media' : 'baja'}`} style={{ marginLeft: 'auto' }}>Riesgo {m.risk.level}</span></div>
          <div className="bb">
            <dl className="details">
              <dt>Persona</dt><dd>{m.name} · <span className="mono">{m.docId}</span></dd>
              <dt>Motivo</dt><dd>{m.reason}</dd>
              {m.orderUntil && <><dt>Orden</dt><dd>Vigente hasta el {m.orderUntil}</dd></>}
              <dt>Lista</dt><dd>{L.name} · <span className="mono">{m.listRef}</span></dd>
            </dl>
            <ul className="fc-risk">{m.risk.notes.map((x) => <li key={x}><Icon name="warning" />{x}</li>)}</ul>
            <p className="fc-then">Al confirmar: se genera la alerta, se avisa al {m.agent.split(' (')[0]} con la foto, el motivo y la certeza, y puedes enviar refuerzos desde la alerta.</p>
          </div>
        </div>

        {/* 8. Dónde está ahora y 9. verificación en terreno. */}
        <div className="box">
          <div className="bh"><h3>8 · Dónde está ahora</h3><span className="sub">{ago(d.at, now)}</span></div>
          <div className="bb">
            <dl className="details">
              <dt>Última cámara</dt><dd><span className="mono">{d.cameraId}</span> · {d.place}</dd>
              {heading && <><dt>Iba</dt><dd>{heading}</dd></>}
              <dt>Cerca</dt><dd>{m.agent}</dd>
            </dl>
          </div>
        </div>

        {m.status === 'por_revisar' && (
          <div className="box">
            <div className="bh"><h3>9 · Verificación en terreno</h3><span className="sub">la confirmación más fuerte</span></div>
            <div className="bb">
              {m.fieldCheck
                ? <p className="fc-verdict ok"><Icon name="schedule" />Verificación pedida {ago(m.fieldCheck.at, now)}: el agente revisa el documento <span className="mono">{m.docId}</span>.</p>
                : role === 'operator_911'
                  ? <button className="btn secondary fc-check" onClick={() => { requestFieldCheck(m.id, user); toast('Pedido enviado al agente: verificar el documento'); }}><Icon name="badge" />Pedir al agente que verifique el documento</button>
                  : <p className="fc-verdict"><Icon name="lock" />La pide el operador 911.</p>}
            </div>
          </div>
        )}

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
