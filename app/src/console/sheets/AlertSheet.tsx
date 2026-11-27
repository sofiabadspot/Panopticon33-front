/* Ficha de alerta — el operador 911 decide sin salir del mapa:
   confirmar abre los refuerzos (cuántas unidades y cuáles: las más cercanas o elegidas a mano) y los
   manda desde acá, sin Maic; descartar pide un motivo de una lista corta. A Maic le llega el evento
   por el backend. Tras decidir, la ficha ofrece pasar a la siguiente alerta por revisar. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audit, AVAIL_LABEL, confirmAlert, discardAlert, reopenAlert, forOperator, inScope, nearestFree, openAlert, readsOf, sightingsOf, suggestedUnits, unitOptions, useApi } from '../../api';
import { ago, dateTime, dec1, fmt, fmtCrowd, hhmm, pct } from '../../api/format';
import { DISCARD_REASONS, DISPATCH_LABEL, KIND_LABEL, KIND_PHRASE } from '../../api/labels';
import type { Alert, PlateRead, Zone } from '../../api/types';
import { useSession } from '../../shell/session';
import { Unattended } from '../../ui/Unattended';
import { Evidence, Icon, Sparkline, StatusChip, useNow, useToast } from '../../ui/kit';
import { useInspect } from '../../ui/ImageInspect';
import type { Evidence as Ev } from '../../api/types';
import { byUrgency } from '../../views/shared';
import { useConsole } from '../ctx';
import { SheetHead, useSheetGo, SheetNotFound } from './SheetHead';
import { useOpenStory } from '../story/OpenStory';
import type { RouteStop } from '../../map/MapView';
import { UnitHex } from '../../map/icons';
import { usePermissions } from '../permissions';

export function AlertSheet({ id, inWall = false }: { id: string; inWall?: boolean }) {
  const { user } = useSession();
  const perm = usePermissions();
  const c = useConsole();
  // Abrir otra ficha: en la consola, el lateral; dentro del muro de video, el muro decide (SheetNav).
  const go = useSheetGo();
  const toast = useToast();
  const openStory = useOpenStory();
  const now = useNow(5000);
  const alerts = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const cameras = useApi((s) => s.cameras);
  const [discarding, setDiscarding] = useState(false);
  // Solo lo que está en el alcance del rol: un enlace o una búsqueda no abren alertas de otro territorio.
  const a = alerts.find((x) => x.id === id && inScope(x, user));
  /* Lecturas de la placa antes de la última: las de los 7 días anteriores a la alerta y las que la alerta
     fue sumando (una placa tiene una sola alerta; cada lectura nueva se suma a esta). La última es dónde
     está ahora: la posición de la alerta. */
  const sights = a ? sightingsOf(a) : [];
  const last = sights[sights.length - 1];
  const prev = useMemo(() => {
    if (!a?.plate) return [];
    const first = sights[0]?.at ?? a.createdAt;
    const before = readsOf(a.plate.listed).filter((x) => x.at < first);
    const since: PlateRead[] = sights.slice(0, -1).map((x, i) => ({ id: `${a.id}-${i}`, plate: a.plate!.listed, at: x.at, cameraId: x.cameraId, street: x.street, lat: x.lat, lon: x.lon, confidence: x.confidence, normalized: false, listed: true, evidence: x.evidence }));
    return [...before, ...since].sort((x, y) => y.at - x.at);
  }, [a?.plate, a?.createdAt, sights.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (a) openAlert(a.id, user); }, [a?.id, user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Recorrido de la placa: el usuario lo pide y el mapa dibuja todas las lecturas en orden,
     numeradas y con hora, terminando en la lectura de esta alerta. Queda en la bitácora. */
  const [trace, setTrace] = useState(false);
  const [sent, setSent] = useState(false);
  const [txSolo, setTxSolo] = useState(false); // el avance del despacho ocupa sola la ficha
  const [composing, setComposing] = useState(false); // eligiendo los refuerzos antes de confirmar
  // Al abrir una alerta de placa, el recorrido arranca solo (no hace falta pedirlo). Queda en la bitácora.
  useEffect(() => {
    setSent(false); const on = !!a?.plate; setTrace(on);
    if (on) audit(user, 'Ver recorrido de placa', a!.plate!.listed, 'Al abrir la alerta');
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const traceReads = useMemo(() => [...prev].sort((x, y) => x.at - y.at), [prev]);
  useEffect(() => {
    if (!trace || !a) return;
    const stops: RouteStop[] = traceReads.map((r, i) => ({ lat: r.lat, lon: r.lon, label: String(i + 1), time: hhmm(r.at), title: `${dateTime(r.at)} · ${r.cameraId} · ${r.street}`,
      snap: { camera: r.cameraId, street: r.street, evidence: r.evidence, confidence: r.confidence } }));
    stops.push({ lat: a.lat, lon: a.lon, label: String(stops.length + 1), time: hhmm(last?.at ?? a.createdAt), title: `Ahora · última lectura · ${a.cameraId}`,
      snap: { camera: a.cameraId, street: last?.street || 'Última lectura', evidence: last?.evidence ?? a.evidence, confidence: last?.confidence } });
    c.setOverlay({ route: stops, routeLabel: a.plate?.listed, fit: { points: stops.map((s) => [s.lon, s.lat]), key: `recorrido-${a.id}` } });
    return () => c.setOverlay({});
  }, [trace, a?.id, traceReads, a?.lat, a?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTrace = () => {
    if (!a?.plate) return;
    if (!trace) audit(user, 'Ver recorrido de placa', a.plate.listed, `${traceReads.length + 1} lecturas en el mapa`);
    setTrace(!trace);
  };

  // Una alerta de persona se decide en la ficha facial (ahí está la verificación), no acá.
  const canDecide = !!a && perm.can('decidir') && a.review === 'por_revisar' && a.kind !== 'persona_en_lista';
  const next = () => alerts.filter((x) => forOperator(x) && inScope(x, user) && x.review === 'por_revisar' && x.id !== id).sort(byUrgency)[0];
  const advance = () => { const n = next(); if (n) go({ k: 'alerta', id: n.id }); };
  const pendingCount = alerts.filter((x) => forOperator(x) && inScope(x, user) && x.review === 'por_revisar' && x.id !== id).length;
  /* Confirmar: primero se eligen los refuerzos (si el tipo de alerta los lleva). Al mandarlos, la ficha
     se queda en la alerta y muestra el despacho paso a paso; en el mapa sale una emisión sobre el punto.
     El operador pasa a la siguiente cuando quiere. */
  const startConfirm = () => { if (!a) return; if (suggestedUnits(a) === 0) confirm([]); else setComposing(true); };
  const confirm = (unitIds: string[]) => {
    if (!a) return; confirmAlert(a.id, user, unitIds); setSent(true); setTrace(false); setComposing(false);
    c.focus([[a.lon - 0.0025, a.lat - 0.0018], [a.lon + 0.0025, a.lat + 0.0018]], 'refuerzo-' + a.id);
    const key = a.id + Date.now(); c.setSignal({ lat: a.lat, lon: a.lon, label: unitIds.length ? DISPATCH_LABEL.en_camino : 'Confirmada', key });
    setTimeout(() => c.setSignal(null), 6500);
  };
  const discard = (r: string) => {
    if (!a) return; const aid = a.id; discardAlert(aid, r, user); setDiscarding(false); advance();
    toast(`${aid} descartada: ${r}`, { undo: () => { reopenAlert(aid, user); go({ k: 'alerta', id: aid }); } });
  };

  useEffect(() => {
    if (!canDecide) return;
    const k = (e: KeyboardEvent) => {
      if (composing) { if (e.key === 'Escape') { e.preventDefault(); setComposing(false); } return; }
      if ((e.target as HTMLElement).closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
      /* Solo decide la ficha que está a la vista: con el muro abierto, la del muro; nunca con un diálogo,
         un menú o una lista desplegada encima. */
      if (!inWall && document.querySelector('.wall')) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]') || (e.target as HTMLElement).closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      if ((e.key === 'c' || e.key === 'C') && !discarding) startConfirm();
      else if (e.key === 'd' || e.key === 'D') setDiscarding(true);
      else if (discarding && /^[1-5]$/.test(e.key)) discard(DISCARD_REASONS[Number(e.key) - 1]);
      else if (e.key === 'Escape' && discarding) { e.preventDefault(); setDiscarding(false); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!a) return <SheetNotFound kicker="Alerta" what="esta alerta" />;
  const zone = zones.find((z) => z.id === a.zoneId);
  const cam = cameras.find((x) => x.id === a.cameraId);
  const zs = zone ? status[zone.id] : null;
  // Eligiendo refuerzos: la ficha muestra ese paso (el mapa queda libre al lado), con volver a la alerta.
  if (canDecide && composing) return <Reinforcements a={a} onConfirm={confirm} onCancel={() => setComposing(false)} />;

  return (
    <>
      {/* Un solo tiempo: si espera decisión, cuánto lleva sin gestionar; si no, hace cuánto llegó */}
      <SheetHead
        kicker={<><span className="mono">{a.id}</span>·{a.review === 'por_revisar' ? <Unattended since={a.createdAt} /> : <span>{ago(a.createdAt, now)}</span>}</>}
        title={KIND_PHRASE[a.kind]}
        sub={<>{zone ? <button className="linklike" onClick={() => go({ k: 'zona', id: zone.id })}>{zone.name}</button> : cam?.street}{cam && <> · <button className="linklike mono" onClick={() => go({ k: 'camara', id: cam.id })}>{cam.id}</button></>}</>}
        aside={a.review === 'por_revisar' && !perm.has('investigar') ? undefined : <>
          {a.review !== 'por_revisar' && <StatusChip alert={a} />}
          {/* Analista: abrir una investigación con el lugar y la hora de esta alerta ya cargados */}
          {perm.has('investigar') && <button className="chip outline" onClick={() => { c.setInvDraft({ title: `${KIND_PHRASE[a.kind]}${a.plate ? ` ${a.plate.listed}` : ''}`, lat: a.lat, lon: a.lon, label: cam?.street ?? zone?.name ?? a.cameraId, from: a.createdAt - 3600e3, to: a.createdAt + 1800e3 }); c.setPanel('investigar'); }}><Icon name="timeline" />Investigar esto</button>}
          {/* Analista: la historia de la placa (pide motivo). Las alertas de persona no son suyas. */}
          {perm.has('investigar') && a.plate && <button className="chip outline" onClick={() => openStory({ k: 'placa', plate: a.plate!.listed })}><Icon name="play_arrow" />Ver recorrido</button>}
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
            <div className="bh"><h3>Lecturas previas de la placa</h3><span className="sub">{prev.length} en 7 días</span>{perm.has('investigar') && <button className="linklike" style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)' }} onClick={() => go({ k: 'vehiculo', id: a.plate!.listed })}>Ficha del vehículo</button>}</div>
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
          <div className="bh"><h3>Línea de tiempo</h3></div>
          <div className="bb"><ol className="timeline">
            {a.timeline.map((t, i) => <li key={i} className={i === a.timeline.length - 1 ? 'now' : 'done'}><span className="b" aria-hidden /><div>{t.label}</div><div className="when">{hhmm(t.at)}{t.by && ` · ${t.by}`}</div></li>)}
            {a.review === 'por_revisar' && <li className="pending"><span className="b" aria-hidden /><div>Revisión del operador 911</div></li>}
          </ol></div>
        </div>
      </div>

      <div className="pf">
        {canDecide && !discarding && !composing && <>
          <button className="btn positive" style={{ flex: 1 }} onClick={startConfirm}><Icon name="check" />Confirmar{suggestedUnits(a) > 0 ? ' y enviar refuerzos' : ''}<span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>C</span></button>
          <button className="btn secondary" onClick={() => setDiscarding(true)}><Icon name="close" />Descartar<span className="kbd">D</span></button>
        </>}
        {canDecide && discarding && <>
          <span style={{ fontSize: 'var(--fs-sm)', width: '100%', color: 'var(--ink-muted)' }}>Motivo del descarte</span>
          {DISCARD_REASONS.map((r, i) => <button key={r} className="btn secondary xs" onClick={() => discard(r)}><span className="kbd">{i + 1}</span>{r}</button>)}
          <button className="btn ghost xs" onClick={() => setDiscarding(false)}>Cancelar</button>
        </>}
        {!canDecide && a.review === 'por_revisar' && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}><Icon name="lock" /> Solo lectura: tu rol no confirma ni descarta alertas.</span>}
        {a.review === 'confirmada' && sent && (pendingCount > 0
          ? <button className="btn primary" style={{ flex: 1 }} onClick={advance} autoFocus><Icon name="arrow_forward" />Siguiente alerta<span className="chip" style={{ marginLeft: 'auto' }}>{pendingCount} por revisar</span><span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>↵</span></button>
          : <span style={{ fontSize: 'var(--fs-sm)' }}><Icon name="check_circle" /> No quedan alertas por revisar.</span>)}
        {a.review === 'confirmada' && !sent && <span style={{ fontSize: 'var(--fs-sm)' }}><Icon name="check_circle" /> Confirmada por {a.reviewedBy}.</span>}
        {a.review === 'descartada' && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Descartada por {a.reviewedBy}: {a.discardReason}.</span>}
      </div>
    </>
  );
}

/* Refuerzos: un paso de la misma ficha al confirmar (no un modal: el mapa queda libre para ver dónde
   están las unidades). Volver lleva de nuevo a la alerta.
   · "Las más cercanas" (por defecto): cuántas unidades (sugeridas para el tipo de alerta) y, debajo, las
     que van, como fichas con su tiempo de llegada. Toma primero las disponibles; si no alcanzan, las ocupadas.
   · "Elegir": el listado con un buscador, de altura fija (se desplaza adentro, no empuja nada). Cada unidad
     dice qué está haciendo: disponible, ocupada (se está haciendo cargo de algo), asignada (ya va a otro
     lugar), sin reporte… Las que no se pueden mandar se ven apagadas. */
function Reinforcements({ a, onConfirm, onCancel }: { a: Alert; onConfirm: (ids: string[]) => void; onCancel: () => void }) {
  const units$ = useApi((s) => s.units);
  const all = useMemo(() => unitOptions(a), [a, units$]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = all.filter((o) => o.avail === 'en_lugar');
  const opts = all.filter((o) => o.avail !== 'en_lugar');
  const free = opts.filter((o) => o.free);
  const [mode, setMode] = useState<'cercanas' | 'elegir'>('cercanas');
  const [n, setN] = useState(() => Math.min(suggestedUnits(a), free.length));
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const nearest = useMemo(() => nearestFree(a, n), [a, n, units$]); // eslint-disable-line react-hooks/exhaustive-deps
  // Solo las que siguen libres: otra persona puede haber mandado una mientras el modal estaba abierto.
  const chosen = mode === 'cercanas' ? nearest : picked.filter((id) => free.some((o) => o.unit.id === id));
  const byId = (id: string) => opts.find((o) => o.unit.id === id);
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const shown = useMemo(() => {
    const w = norm(q.trim()).split(/\s+/).filter(Boolean);
    return opts.filter((o) => !w.length || w.every((x) => norm([o.unit.id, o.unit.type, AVAIL_LABEL[o.avail], o.detail ?? ''].join(' ')).includes(x)));
  }, [opts, q]);
  const min = (o: { eta: number }) => `${Math.max(1, Math.round(o.eta))} min`;
  const busy = chosen.map(byId).filter((o) => o?.avail === 'ocupada');
  const k = chosen.length;
  return (<>
    <SheetHead kicker={<><span className="mono">{a.id}</span>·<span>{KIND_LABEL[a.kind]}</span></>} title="Enviar refuerzos" sub={KIND_PHRASE[a.kind]} />
    <div className="pb rf-pane">
      <button className="linklike rf-back" onClick={onCancel}><Icon name="arrow_back" />Volver a la alerta</button>
      <div className="seg rf-seg" role="group" aria-label="Qué unidades">
        <button className={mode === 'cercanas' ? 'on' : ''} aria-pressed={mode === 'cercanas'} onClick={() => setMode('cercanas')}>Las más cercanas</button>
        <button className={mode === 'elegir' ? 'on' : ''} aria-pressed={mode === 'elegir'} onClick={() => { setMode('elegir'); setPicked(nearest); }}>Elegir</button>
      </div>
      {mode === 'cercanas' ? <>
        <div className="rf-count">
          <button className="rf-step" aria-label="Una menos" disabled={n <= 1} onClick={() => setN(n - 1)}><Icon name="remove" /></button>
          <div><b className="mono" aria-live="polite">{n}</b><span>{n === 1 ? 'unidad' : 'unidades'}</span></div>
          <button className="rf-step" aria-label="Una más" disabled={n >= free.length} onClick={() => setN(n + 1)}><Icon name="add" /></button>
        </div>
        <p className="rf-hint">Sugeridas para {KIND_LABEL[a.kind].toLowerCase()}: {suggestedUnits(a)}</p>
        {k > 0
          ? <ul className="rf-chips" aria-label="Van">{chosen.map((id) => { const o = byId(id)!; return (
              <li key={id} className={o.avail === 'ocupada' ? 'busy' : ''}><UnitHex type={o.unit.type} size={18} /><span className="mono">{id}</span><small>{min(o)}</small></li>
            ); })}</ul>
          : <p className="rf-hint">No hay unidades para mandar.</p>}
      </> : <>
        <input type="search" className="fld" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar unidad, tipo o estado" aria-label="Buscar unidades" autoFocus />
        <ul className="rf-list">
          {shown.map((o) => {
            const on = chosen.includes(o.unit.id);
            return (
              <li key={o.unit.id}>
                <label className={`rf-u ${on ? 'on' : ''} ${o.free ? '' : 'off'}`}>
                  <input type="checkbox" checked={on} disabled={!o.free} onChange={() => toggle(o.unit.id)} />
                  <UnitHex type={o.unit.type} size={18} />
                  <span className="rf-id"><b className="mono">{o.unit.id}</b><small>{o.unit.type}{o.detail ? ` · ${o.detail}` : ''}</small></span>
                  <span className={`av av-${o.avail}`}>{AVAIL_LABEL[o.avail]}</span>
                  <span className="rf-eta mono">{min(o)}</span>
                </label>
              </li>
            );
          })}
          {!shown.length && <li className="empty">Ninguna unidad coincide con «{q}».</li>}
        </ul>
      </>}
      {busy.length > 0 && <p className="rf-warn"><Icon name="info" />{busy.length === 1 ? `${busy[0]!.unit.id} está ocupada: deja lo que hace para ir.` : `${busy.map((o) => o!.unit.id).join(', ')} están ocupadas: dejan lo que hacen para ir.`}</p>}
      {here.length > 0 && <p className="rf-hint">{here.length === 1 ? '1 unidad ya está' : `${here.length} unidades ya están`} en el lugar.</p>}
    </div>
    <div className="pf">
      <button className="btn positive" style={{ flex: 1 }} disabled={!k} onClick={() => onConfirm(chosen)}><Icon name="send" />Confirmar y enviar {k} {k === 1 ? 'unidad' : 'unidades'}</button>
      <button className="btn secondary" onClick={() => onConfirm([])}>Sin refuerzos</button>
    </div>
  </>);
}

/* Despacho: qué pasó con la alerta confirmada, paso a paso, a medida que llegan las unidades.
   Al confirmar ocupa sola la ficha, en el centro (el momento importa); después sube a su lugar arriba
   de la ficha y el resto aparece debajo. Con movimiento reducido va directo arriba. */
const TX_SOLO_MIN_MS = 2400, TX_RISE_MS = 600;
function Transmission({ a, onSolo }: { a: Alert; onSolo?: (solo: boolean) => void }) {
  // Las que van y las que ya llegaron
  const going = useApi((s) => s.units).filter((u) => u.enRoute?.alertId === a.id);
  // "Llegó U-12" / "Llegó U-12 · refuerzos en el lugar" → "U-12"
  const landed = a.timeline.filter((x) => x.label.startsWith('Llegó'));
  const total = going.length + landed.length;
  const lvl = !a.dispatch ? 1 : a.dispatch === 'en_lugar' ? 3 : 2;
  const units = (k: number) => `${k} ${k === 1 ? 'unidad' : 'unidades'}`;
  const at = (label: string) => a.timeline.find((t) => t.label.startsWith(label))?.at;
  const ids = going.map((u) => u.id).join(', ');
  const steps = a.dispatch ? [
    { t: 'Confirmada por el operador', s: `${a.reviewedBy ?? ''}${at('Confirmada') ? ' · ' + hhmm(at('Confirmada')!) : ''}` },
    { t: 'Refuerzos en camino', s: going.length ? `${units(going.length)}: ${ids}` : landed.length ? 'Todas llegaron' : units(total) },
    { t: 'En el lugar', s: landed.length ? `${landed.length} de ${total}${landed.length < total ? ` · ${going.length} en camino` : ` · ${hhmm(landed[landed.length - 1].at)}`}` : 'Cuando llegue la primera' },
  ] : [{ t: 'Confirmada sin refuerzos', s: `${a.reviewedBy ?? ''}${at('Confirmada') ? ' · ' + hhmm(at('Confirmada')!) : ''}` }];
  const done = Math.min(steps.length, lvl);

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
    if (solo && minDone) { from.current = el.current?.getBoundingClientRect().top ?? null; setSolo(false); }
  }, [solo, minDone]);
  // Sube desde donde estaba (FLIP): se mide la nueva posición y se anima la diferencia
  useLayoutEffect(() => {
    const n = el.current; if (solo || !n || from.current == null) return;
    const dy = from.current - n.getBoundingClientRect().top; from.current = null; if (!dy) return;
    n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: TX_RISE_MS, easing: 'cubic-bezier(.6,0,.2,1)' });
  }, [solo]);

  const title = !a.dispatch ? 'Confirmada' : a.dispatch === 'en_lugar' ? (total > 1 ? 'Unidades en el lugar' : 'Unidad en el lugar') : DISPATCH_LABEL.en_camino;
  const body = (
    <>
      <div className="tx-hd"><span className="tx-eyebrow">Despacho</span></div>
      <div className="tx-title"><span className="tx-orb" aria-hidden><i /><i /><b /></span><div><b>{title}</b><small>{a.plate ? `Placa ${a.plate.listed}` : KIND_LABEL[a.kind]} · {a.id}</small></div></div>
      <div className="tx-beam" aria-hidden><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="tx-steps">
        {steps.map((s, i) => <li key={i} className={i < done ? 'done' : i === done ? 'now' : ''}><span className="tx-b" aria-hidden /><div><div>{s.t}</div><small>{s.s}</small></div></li>)}
      </ol>
    </>
  );
  return <section ref={el} className={`tx ${lvl >= 2 ? 'ok' : ''} ${solo ? 'tx-solo' : ''}`} role="status" aria-live="polite">{body}</section>;
}

/* Alerta de placa, con jerarquía:
   1. Placas: la leída frente a la de la lista, grandes, con el nivel de certeza de la lectura.
   2. Imagen frente a registro: lo que vio la cámara (placa y vehículo) al lado de lo que dice la lista.
   3. Detalles de la lectura: todos los metadatos juntos (cuándo, dónde, regla).
   Después siguen las lecturas previas y la línea de tiempo (en AlertSheet). */
function PlateBlocks({ a, camId, place, onCamera }: { a: Alert; camId?: string; place?: string; onCamera?: () => void }) {
  const p = a.plate!;
  const same = p.read === p.listed;
  // Una placa suma lecturas a su alerta: lo que se muestra es la última (dónde y con qué certeza se leyó).
  const reads = sightingsOf(a), lastRead = reads[reads.length - 1];
  const conf = Math.round((lastRead?.confidence ?? p.confidence) * 100);
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
          <dt>Fecha y hora</dt><dd className="mono">{dateTime(lastRead?.at ?? a.createdAt)}</dd>
          {camId && <><dt>Cámara</dt><dd>{onCamera ? <button className="linklike mono" onClick={onCamera}>{camId}</button> : <span className="mono">{camId}</span>}</dd></>}
          {place && <><dt>Lugar</dt><dd>{place}</dd></>}
          <dt>Dirección</dt><dd>{p.direction}</dd>
          <dt>Regla</dt><dd>{a.rule.name}</dd>
          <dt>Umbral</dt><dd>{a.rule.threshold}</dd>
          {/* "Medido" es la certeza de la lectura: ya está arriba, junto a las placas. */}
          <dt>Lecturas</dt><dd><span className="mono">{a.observations}</span> {a.observations === 1 ? 'lectura' : 'lecturas'} desde que se creó la alerta</dd>
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
/* Alerta ya gestionada: arriba de todo, un sello de "resuelta" con quién, cuándo y cómo terminó.
   Confirmada: check verde (y cómo van los refuerzos). Descartada: check gris con el motivo. */
function Resolved({ a }: { a: Alert }) {
  const ok = a.review === 'confirmada';
  const at = a.timeline.find((t) => t.label.startsWith(ok ? 'Confirmada' : 'Descartada'))?.at;
  const how = a.dispatch ? DISPATCH_LABEL[a.dispatch].toLowerCase() : 'sin refuerzos';
  return (
    <section className={`resolved ${ok ? 'ok' : 'off'}`} role="status">
      <span className="rs-check" aria-hidden><svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 6.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      <div className="rs-txt">
        <span className="rs-eyebrow">Resuelta</span>
        <b>{ok ? `Confirmada · ${how}` : `Descartada: ${a.discardReason ?? 'sin motivo'}`}</b>
        <small>{a.reviewedBy ? `por ${a.reviewedBy}` : ''}{at ? ` · ${dateTime(at)}` : ''}</small>
      </div>
    </section>
  );
}
