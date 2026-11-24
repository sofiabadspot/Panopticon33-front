/* Investigaciones — analista. Una investigación parte de un hecho: dónde y cuándo pasó.
   El motivo se da una sola vez, al crearla, y cubre cada consulta que se hace dentro.
   Con una abierta, el mapa muestra solo ese lugar y esa ventana (modo histórico) y la pregunta
   es "¿Qué pasó acá?": vehículos leídos, alertas y cámaras con video. Lo que sirve se fija,
   y la línea de tiempo de abajo lo sigue (InvestigationDock). */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { audit, createInvestigation, grantVehicle, moveInvestigation, pinPlate, placeLabel, placePatterns, unpinPlate, useApi, whatHappened } from '../../api';
import { dateTime, fromLocalInput, hhmm, toLocalInput } from '../../api/format';
import { CAMERA_LABEL, KIND_PHRASE, SEARCH_REASONS } from '../../api/labels';
import { circleRing } from '../../api/place';
import type { Investigation, LngLat } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon, KindIcon, StatusChip } from '../../ui/kit';
import { useConsole, useOverlay } from '../ctx';

const RADII = [100, 250, 500];

export function InvestigatePanel() {
  const c = useConsole();
  const invs = useApi((s) => s.investigations);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (c.invDraft) { c.setInvId(null); setCreating(true); } }, [c.invDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  const inv = invs.find((x) => x.id === c.invId);
  if (inv) return <InvestigationView inv={inv} />;
  if (creating) return <NewInvestigation onClose={() => { setCreating(false); c.setInvDraft(null); }} />;
  return (
    <div className="pb">
      <p className="dim" style={{ margin: 0, fontSize: 12 }}>Una investigación parte de un hecho: dónde y cuándo pasó. Desde ahí ves qué registraron las cámaras en ese lugar y fijas lo que sirve.</p>
      <button className="btn solid sm" onClick={() => setCreating(true)}><Icon name="add" />Nueva investigación</button>
      <div className="box flush">
        <div className="bh"><h3>Investigaciones</h3><span className="sub">{invs.length}</span></div>
        <ul className="list bb">
          {!invs.length && <li className="empty">Todavía no hay investigaciones.</li>}
          {invs.map((k) => (
            <li key={k.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.setInvId(k.id)}>
              <div><div className="t">{k.title}</div><div className="s">{k.place.label} · {dateTime(k.from)}</div></div>
              <div className="r"><span className="mono">{k.id}</span><span>{k.plates.length} {k.plates.length === 1 ? 'vehículo' : 'vehículos'}</span></div>
            </button></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* Nueva investigación: el hecho (qué, dónde, cuándo) y el motivo. Desde una alerta llega con lugar y hora. */
function NewInvestigation({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const c = useConsole();
  const zones = useApi((s) => s.zones);
  const d = c.invDraft;
  const now = Date.now();
  const [f, setF] = useState({
    title: d?.title ?? '', from: toLocalInput(d?.from ?? now - 3 * 3600e3), to: toLocalInput(d?.to ?? now),
    reasonPick: '', reasonText: '', radiusM: 250,
  });
  const [pt, setPt] = useState<{ lat: number; lon: number; label: string } | null>(d ? { lat: d.lat, lon: d.lon, label: d.label } : null);
  const [picking, setPicking] = useState(false);
  const [tried, setTried] = useState(false);
  useOverlay({
    onMapClick: picking ? (p: LngLat) => { setPt({ lat: p[1], lon: p[0], label: placeLabel(p[1], p[0]) }); setPicking(false); } : undefined,
    sketch: pt ? circleRing(pt.lat, pt.lon, f.radiusM) : undefined,
    fit: pt ? { points: circleRing(pt.lat, pt.lon, f.radiusM * 2.5, 8), key: `nueva-${pt.lat}-${pt.lon}` } : undefined,
  }, [picking, pt?.lat, pt?.lon, f.radiusM]);

  const from = fromLocalInput(f.from), to = fromLocalInput(f.to);
  const errs = {
    title: f.title.trim() ? '' : 'Escribe qué pasó.',
    place: pt ? '' : 'Marca el lugar en el mapa o elige una zona.',
    window: to > from ? '' : 'La hora de fin debe ser posterior a la de inicio.',
    reason: f.reasonPick ? '' : 'El motivo es obligatorio: cubre todas las consultas de la investigación.',
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTried(true);
    if (errs.title || errs.place || errs.window || errs.reason || !pt) return;
    const k = createInvestigation({ title: f.title.trim(), reason: [f.reasonPick, f.reasonText.trim()].filter(Boolean).join(' · '), place: { ...pt, radiusM: f.radiusM }, from, to }, user);
    onClose(); c.setInvId(k.id);
  };
  const pickZone = (id: string) => {
    const z = zones.find((x) => x.id === id); if (!z) return;
    const lon = z.ring.reduce((s, p) => s + p[0], 0) / z.ring.length, lat = z.ring.reduce((s, p) => s + p[1], 0) / z.ring.length;
    setPt({ lat, lon, label: z.name }); setPicking(false);
  };

  return (
    <form className="pb" onSubmit={submit} noValidate>
      <button type="button" className="linklike" style={{ justifySelf: 'start', fontSize: 12 }} onClick={onClose}><Icon name="arrow_back" />Investigaciones</button>
      <div className="field">
        <label htmlFor="inv-t">Qué pasó</label>
        <input id="inv-t" className="fld" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Robo de vehículo con conductor" aria-invalid={tried && !!errs.title} autoFocus />
        {tried && errs.title && <span className="err"><Icon name="error" />{errs.title}</span>}
      </div>
      <div className="field">
        <label>Dónde</label>
        {pt && <div className="box" style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="location_on" /><span className="grow">{pt.label}</span></div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`btn ${picking ? 'primary' : 'secondary'} xs`} aria-pressed={picking} onClick={() => setPicking(!picking)}><Icon name="my_location" />{picking ? 'Haz clic en el mapa…' : pt ? 'Marcar otro punto' : 'Marcar en el mapa'}</button>
          <select className="fld sm" style={{ flex: 1, minWidth: 120 }} value="" onChange={(e) => pickZone(e.target.value)} aria-label="Elegir una zona">
            <option value="">o elegir una zona…</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: 12 }}>Radio</span>
          {RADII.map((r) => <button type="button" key={r} className={`lchip ${f.radiusM === r ? 'on' : ''}`} aria-pressed={f.radiusM === r} onClick={() => setF({ ...f, radiusM: r })}>{r} m</button>)}
        </div>
        {tried && errs.place && <span className="err"><Icon name="error" />{errs.place}</span>}
      </div>
      <div className="field">
        <label>Cuándo</label>
        <div className="form-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <input type="datetime-local" className="fld sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde" />
          <input type="datetime-local" className="fld sm" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta" />
        </div>
        {tried && errs.window && <span className="err"><Icon name="error" />{errs.window}</span>}
      </div>
      <div className="field">
        <label htmlFor="inv-r">Motivo</label>
        <select id="inv-r" className="fld sm" value={f.reasonPick} onChange={(e) => setF({ ...f, reasonPick: e.target.value })} aria-invalid={tried && !!errs.reason}>
          <option value="">Motivo de la investigación…</option>{SEARCH_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input className="fld sm" value={f.reasonText} onChange={(e) => setF({ ...f, reasonText: e.target.value })} placeholder="Número de caso (opcional)" aria-label="Número de caso" />
        {tried && errs.reason && <span className="err"><Icon name="error" />{errs.reason}</span>}
      </div>
      <button className="btn solid sm" type="submit"><Icon name="search" />Crear y ver qué pasó</button>
      <p className="dim" style={{ margin: 0, fontSize: 11 }}>Todo lo que consultes dentro queda en la bitácora con este motivo.</p>
    </form>
  );
}

type View = 'aca' | 'patrones';

function InvestigationView({ inv }: { inv: Investigation }) {
  const { user } = useSession();
  const c = useConsole();
  const [view, setView] = useState<View>('aca');
  useEffect(() => { audit(user, 'Abrir investigación', inv.id, inv.title, inv.reason); }, [inv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [win, setWin] = useState({ from: toLocalInput(inv.from), to: toLocalInput(inv.to) });
  useEffect(() => setWin({ from: toLocalInput(inv.from), to: toLocalInput(inv.to) }), [inv.from, inv.to]);
  const dirty = win.from !== toLocalInput(inv.from) || win.to !== toLocalInput(inv.to);
  const winOk = fromLocalInput(win.to) > fromLocalInput(win.from);

  return (
    <div className="pb">
      <button className="linklike" style={{ justifySelf: 'start', fontSize: 12 }} onClick={() => c.setInvId(null)}><Icon name="arrow_back" />Investigaciones</button>
      <div>
        <div className="kicker"><span className="mono">{inv.id}</span></div>
        <h2 style={{ margin: '2px 0 0' }}>{inv.title}</h2>
        <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Motivo: {inv.reason}</div>
      </div>

      <div className="box"><div className="bb" style={{ paddingTop: 10, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="location_on" /><span className="grow">{inv.place.label}</span>
          <button className={`btn ${c.invPick ? 'primary' : 'secondary'} xs`} aria-pressed={c.invPick} onClick={() => c.setInvPick(!c.invPick)}><Icon name="my_location" />{c.invPick ? 'Haz clic en el mapa…' : 'Mover'}</button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: 12 }}>Radio</span>
          {RADII.map((r) => <button key={r} className={`lchip ${inv.place.radiusM === r ? 'on' : ''}`} aria-pressed={inv.place.radiusM === r} onClick={() => moveInvestigation(inv.id, { place: { ...inv.place, radiusM: r } }, user)}>{r} m</button>)}
        </div>
        <div className="form-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <input type="datetime-local" className="fld sm" value={win.from} onChange={(e) => setWin({ ...win, from: e.target.value })} aria-label="Desde" />
          <input type="datetime-local" className="fld sm" value={win.to} onChange={(e) => setWin({ ...win, to: e.target.value })} aria-label="Hasta" />
        </div>
        {dirty && (winOk
          ? <button className="btn secondary xs" style={{ justifySelf: 'start' }} onClick={() => moveInvestigation(inv.id, { from: fromLocalInput(win.from), to: fromLocalInput(win.to) }, user)}><Icon name="check" />Aplicar ventana</button>
          : <span className="err" style={{ fontSize: 12 }}><Icon name="error" />La hora de fin debe ser posterior a la de inicio.</span>)}
      </div></div>

      <div className="fbar" role="tablist" aria-label="Vista de la investigación">
        <button role="tab" aria-selected={view === 'aca'} className={`fchip ${view === 'aca' ? 'on' : ''}`} onClick={() => setView('aca')}><Icon name="location_on" />¿Qué pasó acá?</button>
        <button role="tab" aria-selected={view === 'patrones'} className={`fchip ${view === 'patrones' ? 'on' : ''}`} onClick={() => setView('patrones')}><Icon name="insights" />Patrones</button>
      </div>
      {view === 'aca' ? <WhatHere inv={inv} /> : <Patterns inv={inv} />}
    </div>
  );
}

function WhatHere({ inv }: { inv: Investigation }) {
  const { user } = useSession();
  const c = useConsole();
  const alertsLive = useApi((s) => s.alerts);
  const r = useMemo(() => whatHappened(inv.place, inv.from, inv.to), [inv.place, inv.from, inv.to, alertsLive]); // eslint-disable-line react-hooks/exhaustive-deps
  const openVehicle = (plate: string) => { grantVehicle(plate, inv.reason, user, `Abrir ficha de vehículo · ${inv.id}`); c.open({ k: 'vehiculo', id: plate }); };
  const vehicular = r.cameras.filter((x) => x.kind !== 'peatonal');

  return (
    <>
      <div className="dim" style={{ fontSize: 12 }}>{r.vehicles.length} vehículos · {r.reads} lecturas · {r.alerts.length} alertas · {r.cameras.length} cámaras en el radio</div>

      <div className="box flush">
        <div className="bh"><h3>Vehículos</h3><span className="sub">leídos en el lugar y la ventana</span></div>
        <ul className="list bb">
          {!r.vehicles.length && <li className="empty">{vehicular.length ? 'Ninguna lectura de placa en esta ventana.' : 'No hay cámaras vehiculares en el radio: amplíalo o mueve el lugar.'}</li>}
          {r.vehicles.slice(0, 40).map((v) => {
            const pinned = inv.plates.includes(v.plate);
            return (
              <li key={v.plate} className="item" style={{ gridTemplateColumns: '1fr auto' }}>
                <button className="linklike" style={{ textAlign: 'left', display: 'grid', gap: 2 }} onClick={() => openVehicle(v.plate)}>
                  <span className="t"><span className="plate">{v.plate}</span>{v.listed && <span className="chip critica" style={{ height: 18, fontSize: 10 }}>En lista</span>}</span>
                  <span className="s">{v.reads.length} {v.reads.length === 1 ? 'lectura' : 'lecturas'} · {hhmm(v.reads[0].at)}{v.reads.length > 1 && `–${hhmm(v.reads[v.reads.length - 1].at)}`} · {v.reads[0].cameraId}</span>
                </button>
                {pinned
                  ? <button className="btn ghost xs" onClick={() => unpinPlate(inv.id, v.plate, user)} title="Quitar de la investigación"><Icon name="check" />Fijado</button>
                  : <button className="btn secondary xs" onClick={() => pinPlate(inv.id, v.plate, user)}><Icon name="pin_drop" />Fijar</button>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="box flush">
        <div className="bh"><h3>Alertas</h3><span className="sub">{r.alerts.length}</span></div>
        <ul className="list bb">
          {!r.alerts.length && <li className="empty">Sin alertas en el lugar y la ventana.</li>}
          {r.alerts.map((a) => <li key={a.id}><button className="item" onClick={() => c.open({ k: 'alerta', id: a.id })}><KindIcon alert={a} /><div><div className="t">{KIND_PHRASE[a.kind]}{a.plate && <span className="plate">{a.plate.listed}</span>}</div><div className="s">{dateTime(a.createdAt)}</div></div><div className="r"><StatusChip alert={a} /></div></button></li>)}
        </ul>
      </div>

      <div className="box flush">
        <div className="bh"><h3>Cámaras en el radio</h3><span className="sub">{r.cameras.length}</span></div>
        <ul className="list bb">
          {!r.cameras.length && <li className="empty">Ninguna cámara cubre este radio. Que no haya registros no significa que no pasó nada.</li>}
          {r.cameras.map((x) => (
            <li key={x.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'camara', id: x.id })}>
              <div><div className="t mono">{x.id}</div><div className="s">{x.street}</div></div>
              <div className="r"><span className={`chip ${x.status === 'operativa' ? 'ok' : x.status === 'caida' ? 'critica' : x.status === 'degradada' ? 'media' : 'nodata'}`}>{CAMERA_LABEL[x.status]}</span><span>{x.kind === 'peatonal' ? 'Peatonal' : 'Lee placas'}</span></div>
            </button></li>
          ))}
        </ul>
      </div>
    </>
  );
}

/* Patrones del lugar en los últimos 7 días: a qué hora pasa más tránsito y a qué hora hay alertas.
   Las horas de la ventana de la investigación van marcadas. */
function Patterns({ inv }: { inv: Investigation }) {
  const c = useConsole();
  const p = useMemo(() => placePatterns(inv.place), [inv.place]);
  const h = (t: number) => Number(new Date(t).toLocaleString('en-US', { timeZone: 'America/El_Salvador', hour: 'numeric', hourCycle: 'h23' }));
  const h0 = h(inv.from), h1 = h(inv.to);
  const inWin = (i: number) => (h0 <= h1 ? i >= h0 && i <= h1 : i >= h0 || i <= h1);
  return (
    <>
      <HourBars title="Lecturas de placas por hora" values={p.reads} inWin={inWin} />
      <HourBars title="Alertas por hora" values={p.alerts} inWin={inWin} />
      <p className="dim" style={{ margin: 0, fontSize: 11 }}>Barras oscuras: las horas de la ventana del hecho. Se ve si lo que pasó es habitual en ese lugar a esa hora.</p>
      <div className="box flush">
        <div className="bh"><h3>Alertas en el lugar</h3><span className="sub">7 días</span></div>
        <ul className="list bb">
          {!p.list.length && <li className="empty">Sin alertas en el lugar en 7 días.</li>}
          {p.list.map((a) => <li key={a.id}><button className="item" onClick={() => c.open({ k: 'alerta', id: a.id })}><KindIcon alert={a} /><div><div className="t">{KIND_PHRASE[a.kind]}</div><div className="s">{dateTime(a.createdAt)}</div></div><div className="r"><StatusChip alert={a} /></div></button></li>)}
        </ul>
      </div>
    </>
  );
}

function HourBars({ title, values, inWin }: { title: string; values: number[]; inWin: (h: number) => boolean }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <div className="box">
      <div className="bh"><h3>{title}</h3><span className="sub">{total} en 7 días</span></div>
      <div className="bb">
        <div className="hbars" role="img" aria-label={`${title}: ${total} en 7 días`}>
          {values.map((v, i) => <span key={i} className={inWin(i) ? 'win' : ''} style={{ height: `${v ? Math.max(8, (v / max) * 100) : 0}%` }} title={`${String(i).padStart(2, '0')} h · ${v}`} />)}
        </div>
        <div className="hbars-x"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>
      </div>
    </div>
  );
}
