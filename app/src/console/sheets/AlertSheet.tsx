/* Ficha de alerta — el operador 911 decide en dos clics sin salir del mapa:
   confirmar es un clic (va a Maic); descartar pide un motivo de una lista corta.
   Tras decidir, la ficha pasa sola a la siguiente alerta por revisar. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audit, confirmAlert, discardAlert, forOperator, openAlert, readsOf, useApi } from '../../api';
import { ago, dateTime, dec1, fmt, fmtCrowd, hhmm, pct } from '../../api/format';
import { DISCARD_REASONS, KIND_LABEL, KIND_PHRASE } from '../../api/labels';
import type { Alert, Zone } from '../../api/types';
import { useSession } from '../../shell/session';
import { Unattended } from '../../ui/Unattended';
import { Evidence, Icon, Sparkline, StatusChip, useNow, useToast } from '../../ui/kit';
import { ImageViewer, Inspectable } from '../../ui/ImageInspect';
import type { Evidence as Ev } from '../../api/types';
import { byUrgency } from '../../views/shared';
import { useConsole } from '../ctx';
import { SheetHead, useSheetGo } from './SheetHead';
import type { RouteStop } from '../../map/MapView';

export function AlertSheet({ id }: { id: string }) {
  const { user, role } = useSession();
  const c = useConsole();
  // Abrir otra ficha: en la consola, el lateral; dentro del muro de video, el muro decide (SheetNav).
  const go = useSheetGo();
  const toast = useToast();
  const now = useNow(5000);
  const alerts = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const cameras = useApi((s) => s.cameras);
  const [discarding, setDiscarding] = useState(false);
  const a = alerts.find((x) => x.id === id);
  const prev = useMemo(() => (a?.plate ? readsOf(a.plate.listed).filter((x) => x.at <= a.createdAt).sort((x, y) => y.at - x.at) : []), [a?.plate, a?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (a) openAlert(a.id, user); }, [a?.id, user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Recorrido de la placa: el usuario lo pide y el mapa dibuja todas las lecturas en orden,
     numeradas y con hora, terminando en la lectura de esta alerta. Queda en la bitácora. */
  const [trace, setTrace] = useState(false);
  const [sent, setSent] = useState(false);
  const [txSolo, setTxSolo] = useState(false); // la transmisión a Maic ocupa sola la ficha
  useEffect(() => { setTrace(false); setSent(false); }, [id]);
  const traceReads = useMemo(() => [...prev].sort((x, y) => x.at - y.at), [prev]);
  useEffect(() => {
    if (!trace || !a) return;
    const stops: RouteStop[] = traceReads.map((r, i) => ({ lat: r.lat, lon: r.lon, label: String(i + 1), time: hhmm(r.at), title: `${dateTime(r.at)} · ${r.cameraId} · ${r.street}`,
      snap: { camera: r.cameraId, street: r.street, evidence: r.evidence, confidence: r.confidence } }));
    stops.push({ lat: a.lat, lon: a.lon, label: String(stops.length + 1), time: hhmm(a.createdAt), title: `Ahora · lectura de esta alerta · ${a.cameraId}`,
      snap: { camera: a.cameraId, street: 'Lectura de esta alerta', evidence: a.evidence } });
    c.setOverlay({ route: stops, routeLabel: a.plate?.listed, fit: { points: stops.map((s) => [s.lon, s.lat]), key: `recorrido-${a.id}` } });
    return () => c.setOverlay({});
  }, [trace, a?.id, traceReads]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTrace = () => {
    if (!a?.plate) return;
    if (!trace) audit(user, 'Ver recorrido de placa', a.plate.listed, `${traceReads.length + 1} lecturas en el mapa`);
    setTrace(!trace);
  };

  const canDecide = !!a && role === 'operator_911' && a.review === 'por_revisar';
  const next = () => alerts.filter((x) => forOperator(x) && x.review === 'por_revisar' && x.id !== id).sort(byUrgency)[0];
  const advance = () => { const n = next(); if (n) go({ k: 'alerta', id: n.id }); };
  const pendingCount = alerts.filter((x) => forOperator(x) && x.review === 'por_revisar' && x.id !== id).length;
  /* Confirmar: la ficha se queda en la alerta y muestra la transmisión a Maic paso a paso;
     en el mapa sale una emisión sobre el punto. El operador pasa a la siguiente cuando quiere. */
  const confirm = () => {
    if (!a) return; confirmAlert(a.id, user); setSent(true); setTrace(false);
    c.focus([[a.lon - 0.0025, a.lat - 0.0018], [a.lon + 0.0025, a.lat + 0.0018]], 'maic-' + a.id);
    const key = a.id + Date.now(); c.setSignal({ lat: a.lat, lon: a.lon, label: 'Enviada a Maic', key });
    setTimeout(() => c.setSignal(null), 6500);
  };
  const discard = (r: string) => { if (!a) return; discardAlert(a.id, r, user); toast(`${a.id} descartada: ${r}`); setDiscarding(false); advance(); };

  useEffect(() => {
    if (!canDecide) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      if (e.key === 'c' || e.key === 'C') confirm();
      else if (e.key === 'd' || e.key === 'D') setDiscarding(true);
      else if (discarding && /^[1-5]$/.test(e.key)) discard(DISCARD_REASONS[Number(e.key) - 1]);
      else if (e.key === 'Escape' && discarding) { e.preventDefault(); setDiscarding(false); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!a) return <><SheetHead kicker="Alerta" title="No encontrada" /><div className="empty">Esta alerta no existe o no está en tu territorio.</div></>;
  const zone = zones.find((z) => z.id === a.zoneId);
  const cam = cameras.find((x) => x.id === a.cameraId);
  const zs = zone ? status[zone.id] : null;

  return (
    <>
      {/* Un solo tiempo: si espera decisión, cuánto lleva sin gestionar; si no, hace cuánto llegó */}
      <SheetHead
        kicker={<><span className="mono">{a.id}</span>·{a.review === 'por_revisar' ? <Unattended since={a.createdAt} /> : <span>{ago(a.createdAt, now)}</span>}</>}
        title={KIND_PHRASE[a.kind]}
        sub={<>{zone ? <button className="linklike" onClick={() => go({ k: 'zona', id: zone.id })}>{zone.name}</button> : cam?.street}{cam && <> · <button className="linklike mono" onClick={() => go({ k: 'camara', id: cam.id })}>{cam.id}</button></>}</>}
        aside={a.review === 'por_revisar' && role !== 'analyst' ? undefined : <>
          {a.review !== 'por_revisar' && <StatusChip alert={a} />}
          {/* Analista: abrir una investigación con el lugar y la hora de esta alerta ya cargados */}
          {role === 'analyst' && <button className="chip outline" onClick={() => { c.setInvDraft({ title: `${KIND_PHRASE[a.kind]}${a.plate ? ` ${a.plate.listed}` : ''}`, lat: a.lat, lon: a.lon, label: cam?.street ?? zone?.name ?? a.cameraId, from: a.createdAt - 3600e3, to: a.createdAt + 1800e3 }); c.setPanel('investigar'); }}><Icon name="timeline" />Investigar esto</button>}
        </>}
      />
      <div className={`pb ${!sent ? '' : txSolo ? 'tx-alone' : 'tx-after'}`}>
        {!sent && a.review !== 'por_revisar' && <Resolved a={a} />}
        {sent && a.review === 'confirmada' && <Transmission a={a} onSolo={setTxSolo} />}
        {a.plate ? <PlateBlocks a={a} camId={cam?.id} place={zone?.name ?? cam?.street} onCamera={cam ? () => go({ k: 'camara', id: cam.id }) : undefined} />
          : (a.kind === 'aglomeracion' || a.kind === 'brecha_presencia') && zone ? <ZoneAlertBlocks a={a} zone={zone} camId={cam?.id} onCamera={cam ? () => go({ k: 'camara', id: cam.id }) : undefined} onZone={() => go({ k: 'zona', id: zone.id })} /> : (<>
          <Evidence ev={a.evidence} tag={<span className="chip"><Icon name="videocam" />{cam?.id}</span>} />
          <div className="box">
            <div className="bh"><h3>Regla que la disparó</h3></div>
            <div className="bb"><dl className="details">
              <dt>Regla</dt><dd>{a.rule.name}</dd>
              <dt>Umbral</dt><dd>{a.rule.threshold}</dd>
              <dt>Medido</dt><dd>{a.rule.measured}</dd>
              <dt>Observaciones</dt><dd><span className="mono">{a.observations}</span> {a.observations === 1 ? 'medición' : 'agrupadas'}</dd>
              {zs && zs.count != null && <><dt>Zona ahora</dt><dd>{pct(zs.occupancy!)} · {dec1(zs.densityPerM2!)} p/m²</dd></>}
            </dl></div>
          </div>
        </>)}

        {a.plate && (
          <div className="box flush">
            <div className="bh"><h3>Lecturas previas de la placa</h3><span className="sub">{prev.length} en 7 días</span>{role === 'analyst' && <button className="linklike" style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)' }} onClick={() => go({ k: 'vehiculo', id: a.plate!.listed })}>Ficha del vehículo</button>}</div>
            {prev.length > 0 && (
              <div className="bb trace-cta">
                <TraceCard on={trace} onToggle={toggleTrace}
                  pts={[...traceReads.map((r) => [r.lon, r.lat] as [number, number]), [a.lon, a.lat]]}
                  n={traceReads.length + 1} cams={new Set([...traceReads.map((r) => r.cameraId), a.cameraId]).size} since={traceReads[0].at} />
              </div>
            )}
            <ul className="list bb">
              {(trace ? prev : prev.slice(0, 5)).map((x) => (
                <li key={x.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => { c.setPin({ lat: x.lat, lon: x.lon, label: hhmm(x.at) }); c.focus([[x.lon - 0.0015, x.lat - 0.001], [x.lon + 0.0015, x.lat + 0.001]], 'previa'); }}>
                  <div>{trace && <span className="mk-stop inline">{traceReads.indexOf(x) + 1}</span>}<div className="t mono">{x.cameraId}</div><div className="s">{x.street}</div></div><div className="r"><span className="mono">{dateTime(x.at)}</span><span>{pct(x.confidence)}</span></div>
                </button></li>
              ))}
              {!prev.length && <li className="empty">Sin lecturas previas</li>}
            </ul>
          </div>
        )}

        <div className="box">
          <div className="bh"><h3>Línea de tiempo</h3>{a.maicId && <span className="sub mono">{a.maicId}</span>}</div>
          <div className="bb"><ol className="timeline">
            {a.timeline.map((t, i) => <li key={i} className={i === a.timeline.length - 1 ? 'now' : 'done'}><span className="b" aria-hidden /><div>{t.label}</div><div className="when">{hhmm(t.at)}{t.by && ` · ${t.by}`}</div></li>)}
            {a.review === 'por_revisar' && <li className="pending"><span className="b" aria-hidden /><div>Revisión del operador 911</div></li>}
          </ol></div>
        </div>
      </div>

      <div className="pf">
        {canDecide && !discarding && <>
          <button className="btn positive" style={{ flex: 1 }} onClick={confirm}><Icon name="send" />Confirmar y enviar a Maic<span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>C</span></button>
          <button className="btn secondary" onClick={() => setDiscarding(true)}><Icon name="close" />Descartar<span className="kbd">D</span></button>
        </>}
        {canDecide && discarding && <>
          <span style={{ fontSize: 'var(--fs-sm)', width: '100%', color: 'var(--ink-muted)' }}>Motivo del descarte</span>
          {DISCARD_REASONS.map((r, i) => <button key={r} className="btn secondary xs" onClick={() => discard(r)}><span className="kbd">{i + 1}</span>{r}</button>)}
          <button className="btn ghost xs" onClick={() => setDiscarding(false)}>Cancelar</button>
        </>}
        {!canDecide && a.review === 'por_revisar' && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}><Icon name="lock" /> Solo el operador 911 confirma o descarta.</span>}
        {a.review === 'confirmada' && sent && (pendingCount > 0
          ? <button className="btn primary" style={{ flex: 1 }} onClick={advance} autoFocus><Icon name="arrow_forward" />Siguiente alerta<span className="chip" style={{ marginLeft: 'auto' }}>{pendingCount} por revisar</span><span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>↵</span></button>
          : <span style={{ fontSize: 'var(--fs-sm)' }}><Icon name="check_circle" /> No quedan alertas por revisar.</span>)}
        {a.review === 'confirmada' && !sent && <span style={{ fontSize: 'var(--fs-sm)' }}><Icon name="check_circle" /> Confirmada por {a.reviewedBy}. El incidente sigue en Maic.</span>}
        {a.review === 'descartada' && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Descartada por {a.reviewedBy}: {a.discardReason}.</span>}
      </div>
    </>
  );
}

/* Transmisión a Maic: qué pasó con la alerta confirmada, paso a paso, a medida que Maic responde.
   Al confirmar ocupa sola la ficha, en el centro (el momento importa). Cuando Maic acusa recibo,
   sube a su lugar arriba de la ficha y el resto aparece debajo. Con movimiento reducido va directo arriba. */
const TX_SOLO_MIN_MS = 2400, TX_RISE_MS = 600;
function Transmission({ a, onSolo }: { a: Alert; onSolo?: (solo: boolean) => void }) {
  const online = useApi((s) => s.maic.connected);
  // En cola: Maic sin conexión, la confirmación todavía no salió
  const queued = !online && a.maic === 'enviada';
  const lvl = a.maic === 'cerrada' ? 5 : a.maic === 'despachada' ? 4 : a.maic === 'recibida' ? 3 : queued ? 1 : 2;
  const [boot, setBoot] = useState(1); // el paso "Transmitiendo" se ve un instante antes de marcarse
  useEffect(() => { const t = setTimeout(() => setBoot(2), 700); return () => clearTimeout(t); }, []);
  const done = Math.min(lvl, boot === 1 ? 1 : lvl);
  const at = (label: string) => a.timeline.find((t) => t.label.startsWith(label))?.at;
  // "Llegó U-12 · cerrada en Maic" → "U-12 · 13:42"
  const arrived = () => { const t = a.timeline.find((x) => x.label.startsWith('Llegó')); return t ? `${t.label.replace(/^Llegó (\S+).*/, '$1')} · ${hhmm(t.at)}` : 'Llegó la unidad'; };
  const steps = [
    { t: 'Confirmada por el operador', s: `${a.reviewedBy ?? ''}${at('Confirmada') ? ' · ' + hhmm(at('Confirmada')!) : ''}` },
    { t: queued ? 'En cola para Maic' : 'Transmitida a Maic', s: queued ? 'Maic sin conexión: sale cuando vuelva' : 'Canal cifrado' },
    { t: 'Recibida en Maic', s: lvl >= 3 && a.maicId ? `Caso ${a.maicId}` : 'Esperando acuse de Maic…' },
    { t: 'Despachada', s: lvl >= 4 ? 'Maic asignó unidades' : 'Maic asigna unidades…' },
    { t: 'Unidad en el lugar', s: lvl >= 5 ? arrived() : lvl >= 4 ? 'La unidad va en camino…' : 'Cuando Maic despache' },
  ];

  // Fase: sola en la ficha → arriba, con el resto debajo
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [solo, setSolo] = useState(!reduce);
  const [minDone, setMinDone] = useState(false);
  const el = useRef<HTMLElement>(null);
  const from = useRef<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setMinDone(true), TX_SOLO_MIN_MS); return () => clearTimeout(t); }, []);
  useEffect(() => { onSolo?.(solo); }, [solo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onSolo?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (solo && minDone && (lvl >= 3 || queued)) { from.current = el.current?.getBoundingClientRect().top ?? null; setSolo(false); }
  }, [solo, minDone, lvl]);
  // Sube desde donde estaba (FLIP): se mide la nueva posición y se anima la diferencia
  useLayoutEffect(() => {
    const n = el.current; if (solo || !n || from.current == null) return;
    const dy = from.current - n.getBoundingClientRect().top; from.current = null; if (!dy) return;
    n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: TX_RISE_MS, easing: 'cubic-bezier(.6,0,.2,1)' });
  }, [solo]);

  const body = (
    <>
      <div className="tx-hd"><span className="tx-eyebrow">Transmisión a Maic</span>{a.maicId && <span className="mono tx-id">{a.maicId}</span>}</div>
      <div className="tx-title"><span className="tx-orb" aria-hidden><i /><i /><b /></span><div><b>{queued ? 'En cola: Maic sin conexión' : lvl >= 5 ? 'Unidad en el lugar' : lvl >= 4 ? 'Despachada por Maic' : lvl >= 3 ? 'Maic recibió la alerta' : 'Enviando a Maic'}</b><small>{a.plate ? `Placa ${a.plate.listed}` : KIND_LABEL[a.kind]} · {a.id}</small></div></div>
      <div className="tx-beam" aria-hidden><i style={{ width: `${(done / 5) * 100}%` }} /></div>
      <ol className="tx-steps">
        {steps.map((s, i) => <li key={i} className={i < done ? 'done' : i === done ? 'now' : ''}><span className="tx-b" aria-hidden /><div><div>{s.t}</div><small>{s.s}</small></div></li>)}
      </ol>
    </>
  );
  return <section ref={el} className={`tx ${lvl >= 4 ? 'ok' : ''} ${solo ? 'tx-solo' : ''}`} role="status" aria-live="polite">{body}</section>;
}

/* Alerta de placa, con jerarquía:
   1. Placas: la leída frente a la de la lista, grandes, con el nivel de certeza de la lectura.
   2. Imagen frente a registro: lo que vio la cámara (placa y vehículo) al lado de lo que dice la lista.
   3. Detalles de la lectura: todos los metadatos juntos (cuándo, dónde, regla).
   Después siguen las lecturas previas y la línea de tiempo (en AlertSheet). */
function PlateBlocks({ a, camId, place, onCamera }: { a: Alert; camId?: string; place?: string; onCamera?: () => void }) {
  const p = a.plate!;
  const same = p.read === p.listed;
  const conf = Math.round(p.confidence * 100);
  const insp = useInspect(`${p.listed} · ${camId ?? ''} · ${dateTime(a.createdAt)}`);
  return (
    <>
      {insp.viewer}
      {/* La imagen va primero y sola: es lo que el operador mira para decidir. Los datos, después. */}
      <section className="al-media" aria-label="Lo que vio la cámara">
        {insp.thumb('vehiculo', VEHICLE_EV, 'Foto del vehículo', <span className="chip"><Icon name="videocam" />{camId}</span>)}
        <div className="al-inset">{insp.thumb('placa', PLATE_EV, 'Recorte de la placa', <span className="chip">Placa</span>)}</div>
      </section>

      <section className="pl-match" aria-label="Coincidencia de placa">
        <div className="pl-plates">
          <div className="pl-plate"><span className="pl-lbl">Placa leída</span><PlateTag text={p.read} other={p.listed} /></div>
          <span className={`pl-vs ${same ? 'ok' : 'warn'}`}><Icon name={same ? 'check' : 'swap_horiz'} label={same ? 'Coinciden' : 'Difieren'} /></span>
          <div className="pl-plate"><span className="pl-lbl">Placa en la lista</span><PlateTag text={p.listed} /></div>
        </div>
        <div className="pl-conf">
          <div className="pl-conf-hd"><span>Nivel de certeza de la lectura</span><b className="mono">{conf} %</b></div>
          <div className="pl-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={conf} aria-label="Nivel de certeza"><i style={{ width: `${conf}%` }} /></div>
        </div>
        {!same && <div className="callout warn"><Icon name="warning" /><span className="grow">La lectura difiere en algún carácter (marcado arriba). Revisa la imagen antes de confirmar.</span></div>}
      </section>

      <div className="box">
        <div className="bh"><h3>Registro en la lista</h3></div>
        <div className="bb"><dl className="pl-reg cols">
          <div><dt>Vehículo</dt><dd>{p.vehicle.type}</dd></div>
          <div><dt>Marca</dt><dd>{p.vehicle.make}</dd></div>
          <div><dt>Color</dt><dd>{p.vehicle.color}</dd></div>
          <div><dt>Motivo</dt><dd>{p.reason}</dd></div>
          <div><dt>Desde</dt><dd>{p.since}</dd></div>
          <div><dt>Caso</dt><dd className="mono">{p.caseId}</dd></div>
        </dl></div>
      </div>

      <div className="box">
        <div className="bh"><h3>Detalles de la lectura</h3></div>
        <div className="bb"><dl className="details">
          <dt>Fecha y hora</dt><dd className="mono">{dateTime(a.createdAt)}</dd>
          {camId && <><dt>Cámara</dt><dd>{onCamera ? <button className="linklike mono" onClick={onCamera}>{camId}</button> : <span className="mono">{camId}</span>}</dd></>}
          {place && <><dt>Lugar</dt><dd>{place}</dd></>}
          <dt>Dirección</dt><dd>{p.direction}</dd>
          <dt>Regla</dt><dd>{a.rule.name}</dd>
          <dt>Umbral</dt><dd>{a.rule.threshold}</dd>
          {/* "Medido" es la certeza de la lectura: ya está arriba, junto a las placas. */}
          <dt>Observaciones</dt><dd><span className="mono">{a.observations}</span> {a.observations === 1 ? 'lectura' : 'agrupadas'}</dd>
        </dl></div>
      </div>
    </>
  );
}

/** Placa como chapa: caracteres en mono y, si se compara con otra, los que difieren marcados. */
function PlateTag({ text, other }: { text: string; other?: string }) {
  return (
    <span className="plate-tag" aria-label={text}>
      {[...text].map((ch, i) => <span key={i} className={other !== undefined && other[i] !== ch ? 'diff' : undefined} aria-hidden>{ch}</span>)}
    </span>
  );
}

/* Tarjeta para ver el recorrido de la placa en el mapa.
   Lleva una miniatura del recorrido (las lecturas unidas en orden; la última, la de esta alerta, en rojo)
   para que se entienda qué se va a ver antes de pedirlo. Con el recorrido en el mapa, la tarjeta lo dice
   y ofrece ocultarlo. */
function TraceCard({ on, onToggle, pts, n, cams, since }: { on: boolean; onToggle: () => void; pts: [number, number][]; n: number; cams: number; since: number }) {
  const W = 92, H = 56, P = 8;
  const k = Math.cos((pts[0][1] * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sc = Math.min((W - P * 2) / (x1 - x0 || 1), (H - P * 2) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
  const q = pts.map((_, i) => [ox + (xs[i] - x0) * sc, H - (oy + (ys[i] - y0) * sc)] as const);
  const d = q.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = q[q.length - 1];
  return (
    <div className={`trace-card ${on ? 'on' : ''}`}>
      <button className="tc-main" aria-pressed={on} onClick={on ? undefined : onToggle} disabled={on}>
        <svg className="tc-mini" viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <path className="tc-grid" d={`M0 ${H / 3}H${W}M0 ${(2 * H) / 3}H${W}M${W / 3} 0V${H}M${(2 * W) / 3} 0V${H}`} />
          <path className="tc-path" d={d} pathLength={1} />
          {q.slice(0, -1).map(([x, y], i) => <circle key={i} className="tc-dot" cx={x} cy={y} r={2.2} />)}
          <circle className="tc-end-ring" cx={last[0]} cy={last[1]} r={5} />
          <circle className="tc-end" cx={last[0]} cy={last[1]} r={2.8} />
        </svg>
        <span className="tc-txt">
          <span className="tc-eyebrow">{on ? <><i className="tc-live" aria-hidden />En el mapa</> : 'Recorrido de la placa'}</span>
          <b>{on ? 'Siguiendo el recorrido' : 'Ver recorrido en el mapa'}</b>
          <small title={`Desde ${dateTime(since)} hasta ahora`}>{n} lecturas · {cams} cámaras · desde {ago(since)}</small>
        </span>
        {!on && <span className="tc-go" aria-hidden><Icon name="arrow_forward" /></span>}
      </button>
      {on && <button className="tc-hide" onClick={onToggle}><Icon name="visibility_off" />Ocultar</button>}
    </div>
  );
}

/* Alertas de gente (aglomeración y falta de policías), con la misma jerarquía que la de placa:
   1. La medición frente a su límite, grande, con la barra de cuánto se pasa.
   2. Imagen frente a registro: lo que ve la cámara al lado de los datos fijos de la zona.
   3. Evolución de la última hora, con el umbral.
   4. Detalles: todos los metadatos juntos.
   Después siguen la línea de tiempo (en AlertSheet). */
function ZoneAlertBlocks({ a, zone, camId, onCamera, onZone }: { a: Alert; zone: Zone; camId?: string; onCamera?: () => void; onZone: () => void }) {
  const zs = useApi((s) => s.zoneStatus)[zone.id];
  const rules = useApi((s) => s.rules);
  const crowd = a.kind === 'aglomeracion';
  const occMax = rules.find((x) => x.id === 'R-AGL-OCUP')?.threshold ?? 75;
  const perMax = rules.find((x) => x.id === 'R-BRECHA')?.threshold ?? 2500;
  const measured = !!zs && zs.count != null;
  const sev = a.severity === 'critica' ? 'critica' : a.severity === 'media' ? 'media' : '';

  // La barra va de 0 a 1,5 veces el límite; la marca blanca es el límite.
  const value = !measured ? null : crowd ? zs!.occupancy! * 100 : zs!.perOfficer;
  const limit = crowd ? occMax : perMax;
  const over = value != null ? value / limit : null;
  const insp = useInspect(`${zone.name} · ${camId ?? ''} · ${dateTime(a.createdAt)}`);

  return (
    <>
      {insp.viewer}
      {/* La imagen va primero y sola; la medición y los datos de la zona, después. */}
      <section className="al-media" aria-label="Lo que ve la cámara">
        {insp.thumb('camara', a.evidence, 'Imagen de la cámara', <span className="chip"><Icon name="videocam" />{camId}</span>)}
      </section>

      <section className="pl-match" aria-label="Medición frente al límite">
        <div className="pl-plates">
          <div className="pl-plate">
            <span className="pl-lbl">{crowd ? 'Personas ahora' : 'Personas por policía'}</span>
            <span className={`zm-big ${sev}`}>{!measured ? '—' : crowd ? fmtCrowd(zs!.count!) : zs!.perOfficer != null ? fmt(zs!.perOfficer) : '—'}</span>
          </div>
          <span className="zm-vs" aria-hidden>/</span>
          <div className="pl-plate">
            <span className="pl-lbl">{crowd ? 'Capacidad de la zona' : 'Máximo aceptable'}</span>
            <span className="zm-big ref">{crowd ? fmt(zone.capacity) : fmt(perMax)}</span>
          </div>
        </div>
        {measured && over != null && (
          <div className="pl-conf">
            <div className="pl-conf-hd">
              <span>{crowd ? `Ocupación · umbral ${occMax} %` : `Presencia · ${zs!.officers ?? 0} policías para ${fmtCrowd(zs!.count!)} personas`}</span>
              <b className="mono">{crowd ? pct(zs!.occupancy!) : `${Math.round(over * 100)} % del máximo`}</b>
            </div>
            <div className="cap zm-cap" aria-hidden><i className={sev} style={{ width: `${Math.min(100, (over / 1.5) * 100)}%` }} /><span className="mark" style={{ left: `${100 / 1.5}%` }} /></div>
            <span className="zm-range">Estimación entre {fmtCrowd(zs!.low!)} y {fmtCrowd(zs!.high!)} personas · {dec1(zs!.densityPerM2!)} p/m²</span>
          </div>
        )}
        {!measured && <div className="callout"><Icon name="visibility_off" /><span className="grow">Sin medición ahora en esta zona. No significa que esté vacía.</span></div>}
      </section>

      <div className="box">
        <div className="bh"><h3>Registro de la zona</h3></div>
        <div className="bb"><dl className="pl-reg cols">
          <div><dt>Zona</dt><dd><button className="linklike" onClick={onZone}>{zone.name}</button></dd></div>
          <div><dt>Superficie</dt><dd>{fmt(zone.areaM2)} m²</dd></div>
          <div><dt>Capacidad</dt><dd>{fmt(zone.capacity)} personas</dd></div>
          <div><dt>Cámaras</dt><dd>{zone.cameras.length}</dd></div>
          {zs?.officers != null && <div><dt>Policías presentes</dt><dd>{zs.officers}</dd></div>}
          {zs?.flowIn != null && <div><dt>Entran / salen</dt><dd>+{fmt(zs.flowIn)} / −{fmt(zs.flowOut ?? 0)}</dd></div>}
        </dl></div>
      </div>

      {measured && (
        <div className="box">
          <div className="bh"><h3>Personas en la última hora</h3></div>
          <div className="bb"><Sparkline values={zs!.trend} threshold={crowd ? (zone.capacity * occMax) / 100 : null} height={96} /></div>
        </div>
      )}

      <div className="box">
        <div className="bh"><h3>Detalles de la medición</h3></div>
        <div className="bb"><dl className="details">
          <dt>Fecha y hora</dt><dd className="mono">{dateTime(a.createdAt)}</dd>
          {camId && <><dt>Cámara</dt><dd>{onCamera ? <button className="linklike mono" onClick={onCamera}>{camId}</button> : <span className="mono">{camId}</span>}</dd></>}
          <dt>Lugar</dt><dd>{zone.name}</dd>
          <dt>Regla</dt><dd>{a.rule.name}</dd>
          <dt>Umbral</dt><dd>{a.rule.threshold}</dd>
          <dt>Medido</dt><dd>{a.rule.measured}</dd>
          <dt>Persistencia</dt><dd>{a.rule.persistence}</dd>
          <dt>Observaciones</dt><dd><span className="mono">{a.observations}</span> {a.observations === 1 ? 'medición' : 'agrupadas'}</dd>
        </dl></div>
      </div>
    </>
  );
}

/* Material de la placa: todavía no hay recortes reales para estas alertas (regla de evidencia). */
const VEHICLE_EV: Ev = { type: 'pendiente', caption: 'Foto del vehículo' };
const PLATE_EV: Ev = { type: 'pendiente', caption: 'Recorte de la placa' };

/** Miniaturas con lupa y giro, y el visor ampliado sobre el mapa (uno a la vez; el giro se comparte). */
function useInspect(sub: string) {
  const [rot, setRot] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<{ key: string; ev: Ev; title: string } | null>(null);
  const setR = (key: string, deg: number) => setRot((r) => ({ ...r, [key]: deg }));
  const thumb = (key: string, ev: Ev, title: string, tag?: ReactNode) => (
    <Inspectable key={key} ev={ev} title={title} tag={tag} rotation={rot[key] ?? 0}
      onRotate={() => setR(key, ((rot[key] ?? 0) + 90) % 360)} onExpand={() => setOpen({ key, ev, title })} />
  );
  const viewer = open && (
    <ImageViewer ev={open.ev} title={open.title} sub={sub} rotation={rot[open.key] ?? 0} onRotate={(d) => setR(open.key, d)} onClose={() => setOpen(null)} />
  );
  return { thumb, viewer };
}

/* Alerta ya gestionada: arriba de todo, un sello de "resuelta" con quién, cuándo y cómo terminó.
   Confirmada: check verde (y el estado en Maic). Descartada: check gris con el motivo. */
function Resolved({ a }: { a: Alert }) {
  const ok = a.review === 'confirmada';
  const at = a.timeline.find((t) => t.label.startsWith(ok ? 'Confirmada' : 'Descartada'))?.at;
  const maic = a.maic === 'despachada' ? 'despachada por Maic' : a.maic === 'cerrada' ? 'cerrada en Maic' : a.maic === 'recibida' ? 'recibida en Maic' : 'enviada a Maic';
  return (
    <section className={`resolved ${ok ? 'ok' : 'off'}`} role="status">
      <span className="rs-check" aria-hidden><svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 6.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      <div className="rs-txt">
        <span className="rs-eyebrow">Resuelta</span>
        <b>{ok ? `Confirmada y ${maic}` : `Descartada: ${a.discardReason ?? 'sin motivo'}`}</b>
        <small>{a.reviewedBy ? `por ${a.reviewedBy}` : ''}{at ? ` · ${dateTime(at)}` : ''}</small>
      </div>
    </section>
  );
}
