/* Línea de tiempo de la investigación — debajo del mapa y de la ficha, a lo ancho.
   Muestra la ventana del hecho (o los 7 días) con un carril por vehículo fijado: cada punto es una
   lectura y la línea punteada entre dos es un tramo sin observar. Los encuentros (dos vehículos
   fijados en la misma cámara a menos de 90 s) tienen su fila. El cursor dice dónde se vio por última
   vez a cada uno en ese momento. La fila de persona espera a la fase 3.
   Además es dueña de lo que la investigación dibuja en el mapa: el círculo del lugar, el recorrido
   que se pida y el clic para mover el lugar. */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { addInvNote, audit, forOperator, moveInvestigation, placeLabel, useApi, vehicleProfile } from '../api';
import { dateTime, hhmm } from '../api/format';
import { KIND_PHRASE } from '../api/labels';
import { circleRing } from '../api/place';
import type { LngLat, PlateRead } from '../api/types';
import { useSession } from '../shell/session';
import { Icon } from '../ui/kit';
import { useConsole, type Overlay } from './ctx';
import { useOpenStory } from './story/OpenStory';

const MIN = 60_000;
const ENCOUNTER_S = 90;
type Range = 'ventana' | 'semana';
interface Encounter { at: number; read: PlateRead; plates: [string, string] }

function ticksFor(t0: number, t1: number) {
  const span = t1 - t0;
  const step = span <= 2 * 60 * MIN ? 15 * MIN : span <= 6 * 60 * MIN ? 60 * MIN : span <= 24 * 60 * MIN ? 3 * 60 * MIN : span <= 3 * 24 * 60 * MIN ? 12 * 60 * MIN : 24 * 60 * MIN;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
  return { out, label: (t: number) => (span <= 24 * 60 * MIN ? hhmm(t) : dateTime(t)) };
}

export function InvestigationDock({ id }: { id: string }) {
  const { user } = useSession();
  const c = useConsole();
  const inv = useApi((s) => s.investigations.find((x) => x.id === id));
  const alerts = useApi((s) => s.alerts);
  const [range, setRange] = useState<Range>('ventana');
  const openStory = useOpenStory();
  const plates = inv?.plates ?? [];
  const profiles = useMemo(() => plates.map((p) => vehicleProfile(p)), [plates.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const [t0, t1] = useMemo((): [number, number] => {
    if (!inv) return [Date.now() - 60 * MIN, Date.now()];
    if (range === 'ventana') { const pad = (inv.to - inv.from) * 0.03; return [inv.from - pad, inv.to + pad]; }
    return [Date.now() - 7 * 24 * 60 * MIN, Date.now()];
  }, [inv?.from, inv?.to, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const inRange = (t: number) => t >= t0 && t <= t1;
  const lanes = profiles.map((p) => ({ ...p, shown: p.reads.filter((r) => inRange(r.at)) }));

  const encounters = useMemo(() => {
    const out: Encounter[] = [];
    for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++)
      for (const a of lanes[i].shown) for (const b of lanes[j].shown)
        if (a.cameraId === b.cameraId && Math.abs(a.at - b.at) <= ENCOUNTER_S * 1000) out.push({ at: Math.min(a.at, b.at), read: a, plates: [lanes[i].plate, lanes[j].plate] });
    return out.sort((x, y) => x.at - y.at);
  }, [profiles, t0, t1]); // eslint-disable-line react-hooks/exhaustive-deps
  const caseAlerts = alerts.filter((a) => forOperator(a) && inRange(a.createdAt) && a.plate && plates.includes(a.plate.listed));
  const notes = (inv?.notes ?? []).filter((n) => inRange(n.at));
  const x = (t: number) => `${((t - t0) / (t1 - t0)) * 100}%`;
  const ticks = ticksFor(t0, t1);

  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => setCursor(null), [range]);
  const at = cursor ?? t1;
  const lastBefore = (rs: PlateRead[], t: number) => { let r: PlateRead | null = null; for (const q of rs) if (q.at <= t) r = q; return r; };
  const [traced, setTraced] = useState<string | null>(null);
  const pinLane = lanes.find((l) => l.plate === traced) ?? lanes[0];
  useEffect(() => {
    if (cursor == null || !pinLane) return;
    const r = lastBefore(pinLane.shown, cursor);
    c.setPin(r ? { lat: r.lat, lon: r.lon, label: `${pinLane.plate} · ${hhmm(r.at)}` } : null);
  }, [cursor, pinLane?.plate]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Lo que la investigación pone en el mapa. Si otra ficha lo reemplaza (p. ej. el recorrido de un
     vehículo) y después lo limpia, se vuelve a poner. */
  const ring = inv ? circleRing(inv.place.lat, inv.place.lon, inv.place.radiusM) : undefined;
  const traceLane = lanes.find((l) => l.plate === traced);
  const mine: Overlay = !inv ? {} : {
    sketch: ring,
    route: traceLane && traceLane.shown.length ? traceLane.shown.map((r, i) => ({ lat: r.lat, lon: r.lon, label: String(i + 1), time: hhmm(r.at), title: `${dateTime(r.at)} · ${r.cameraId} · ${r.street}` })) : undefined,
    routeLabel: traced ?? undefined,
    onMapClick: c.invPick ? (p: LngLat) => { moveInvestigation(inv.id, { place: { ...inv.place, lat: p[1], lon: p[0], label: placeLabel(p[1], p[0]) } }, user); c.setInvPick(false); } : undefined,
  };
  const mineKey = JSON.stringify([inv?.place, traced, range, traceLane?.shown.length, c.invPick]);
  useEffect(() => { c.setOverlay(mine); }, [mineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!c.overlay.sketch && !c.overlay.route && !c.overlay.onMapClick) c.setOverlay(mine); }, [c.overlay]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { c.setOverlay({}); c.setPin(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Al abrir (o mover) la investigación, el mapa va al lugar.
  useEffect(() => { if (inv) c.focus(circleRing(inv.place.lat, inv.place.lon, inv.place.radiusM * 2.5, 8), 'inv'); }, [inv?.id, inv?.place.lat, inv?.place.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTrace = (plate: string, n: number) => {
    if (traced !== plate && inv) audit(user, 'Ver recorrido de placa', plate, `${n} lecturas en el mapa · ${inv.id}`, inv.reason);
    setTraced(traced === plate ? null : plate);
  };
  const goTo = (r: PlateRead) => { setCursor(r.at); c.setPin({ lat: r.lat, lon: r.lon, label: `${hhmm(r.at)} · ${r.cameraId}` }); c.focus([[r.lon - 0.0015, r.lat - 0.001], [r.lon + 0.0015, r.lat + 0.001]], 'inv-lectura'); };

  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState(false);
  const submitNote = (e: FormEvent) => { e.preventDefault(); if (!inv) return; if (!note.trim()) { setNoteErr(true); return; } addInvNote(inv.id, note.trim(), user); setNote(''); setNoteErr(false); };

  if (!inv) return null;
  const cursorLine = <span className="cd-cursor" style={{ left: x(at) }} aria-hidden />;

  return (
    <section className="case-dock" aria-label={`Línea de tiempo de ${inv.id}`}>
      <div className="cd-hd">
        <Icon name="timeline" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="t">Línea de tiempo · {inv.title}</div>
          <div className="s">{inv.plates.length} {inv.plates.length === 1 ? 'vehículo fijado' : 'vehículos fijados'} · {encounters.length} {encounters.length === 1 ? 'encuentro' : 'encuentros'}</div>
        </div>
        <div className="seg" role="group" aria-label="Rango de la línea de tiempo">
          <button className={range === 'ventana' ? 'on' : ''} aria-pressed={range === 'ventana'} onClick={() => setRange('ventana')}>Ventana del hecho</button>
          <button className={range === 'semana' ? 'on' : ''} aria-pressed={range === 'semana'} onClick={() => setRange('semana')}>7 días</button>
        </div>
        <form onSubmit={submitNote} className="cd-note" noValidate>
          <input className="fld sm" value={note} onChange={(e) => { setNote(e.target.value); setNoteErr(false); }} placeholder="Nota en la investigación" aria-label="Nota en la investigación" aria-invalid={noteErr} />
          <button className="btn secondary xs" type="submit"><Icon name="edit_note" />Anotar</button>
          {noteErr && <span className="err"><Icon name="error" />Escribe la nota.</span>}
        </form>
      </div>

      <div className="cd-body">
        <div className="cd-lbl cd-axis-lbl"><span className="mono">{cursor == null ? 'Final' : dateTime(at)}</span></div>
        <div className="cd-axis">
          {range === 'semana' && <span className="cd-win" style={{ left: x(inv.from), width: `calc(${x(inv.to)} - ${x(inv.from)})` }} title="Ventana del hecho" />}
          {ticks.out.map((t) => <span key={t} style={{ left: x(t) }}>{ticks.label(t)}</span>)}
        </div>

        {!lanes.length && <><div className="cd-lbl"><span>Vehículos</span></div><div className="cd-track"><span className="cd-empty">Fija vehículos desde «¿Qué pasó acá?» para seguirlos en el tiempo.</span></div></>}
        {lanes.map((l) => {
          const here = lastBefore(l.shown, at);
          const outside = l.reads.length - l.shown.length;
          return [
            <div key={l.plate + '-l'} className="cd-lbl">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="linklike plate" onClick={() => c.open({ k: 'vehiculo', id: l.plate })}>{l.plate}</button>
                {l.listed && <span className="sev critica" title="En lista" />}
                <button className={`iconbtn cd-trace ${traced === l.plate ? 'on' : ''}`} aria-pressed={traced === l.plate} onClick={() => toggleTrace(l.plate, l.shown.length)} title={traced === l.plate ? 'Ocultar recorrido' : 'Ver recorrido en el mapa'} aria-label={`Recorrido de ${l.plate}`}><Icon name="route" /></button>
                <button className="iconbtn cd-trace" onClick={() => openStory({ k: 'placa', plate: l.plate }, { invId: inv.id })} title="Ver historia" aria-label={`Historia de ${l.plate}`}><Icon name="play_arrow" /></button>
              </div>
              <small>{here ? `${here.cameraId} · ${hhmm(here.at)}` : 'Sin lecturas hasta acá'}{outside > 0 && ` · ${outside} fuera`}</small>
            </div>,
            <div key={l.plate + '-t'} className="cd-track">
              {l.shown.slice(1).map((r, i) => <span key={r.id + 'g'} className="cd-gap" style={{ left: x(l.shown[i].at), width: `calc(${x(r.at)} - ${x(l.shown[i].at)})` }} aria-hidden />)}
              {l.shown.map((r) => <button key={r.id} className={`cd-dot ${r.at > at ? 'after' : ''}`} style={{ left: x(r.at) }} onClick={() => goTo(r)} title={`${dateTime(r.at)} · ${r.cameraId} · ${r.street}`} aria-label={`${l.plate}, ${dateTime(r.at)}, ${r.cameraId}`} />)}
              {cursorLine}
            </div>,
          ];
        })}

        <div className="cd-lbl"><span>Encuentros</span><small>misma cámara, menos de 90 s</small></div>
        <div className="cd-track">
          {encounters.map((e, i) => <button key={i} className="cd-enc" style={{ left: x(e.at) }} onClick={() => goTo(e.read)} title={`${dateTime(e.at)} · ${e.read.cameraId} · ${e.plates.join(' y ')}`} aria-label={`Encuentro ${e.plates.join(' y ')} en ${e.read.cameraId}`}><Icon name="link" /></button>)}
          {!encounters.length && <span className="cd-empty">{lanes.length < 2 ? 'Con dos vehículos fijados se ven sus encuentros' : 'Sin encuentros en este rango'}</span>}
          {cursorLine}
        </div>

        <div className="cd-lbl"><span>Alertas y notas</span><small>{caseAlerts.length} {caseAlerts.length === 1 ? 'alerta' : 'alertas'} · {notes.length} {notes.length === 1 ? 'nota' : 'notas'}</small></div>
        <div className="cd-track">
          {caseAlerts.map((a) => <button key={a.id} className="cd-mark" style={{ left: x(a.createdAt) }} onClick={() => c.open({ k: 'alerta', id: a.id })} title={`${dateTime(a.createdAt)} · ${KIND_PHRASE[a.kind]} · ${a.id}`} aria-label={`Alerta ${a.id}`}><span className={`sev ${a.severity}`} /></button>)}
          {notes.map((n, i) => <span key={i} className="cd-mark note" style={{ left: x(n.at) }} title={`${dateTime(n.at)} · ${n.by}: ${n.text}`}><Icon name="edit_note" /></span>)}
          {cursorLine}
        </div>

        <div className="cd-lbl cd-off"><span>Persona</span><small>Reconocimiento facial · fase 3</small></div>
        <div className="cd-track cd-off-track" aria-hidden />

        <div />
        <div className="cd-scrub">
          <input type="range" min={Math.round(t0)} max={Math.round(t1)} step={MIN} value={Math.round(at)} onChange={(e) => setCursor(Number(e.target.value))} aria-label="Momento de la investigación" aria-valuetext={dateTime(at)} />
          {cursor != null && <button className="btn ghost xs" onClick={() => { setCursor(null); c.setPin(null); }}>Ir al final</button>}
        </div>
      </div>
      <p className="cd-foot">Línea punteada: tramo sin lecturas, no sabemos por dónde pasó. Los puntos claros son posteriores al cursor.</p>
    </section>
  );
}
