/* Ficha de vehículo — analista. "¿Qué sé de este auto y con quién se mueve?"
   Junta lo que hoy está suelto: la lista de robados, lo que ve la cámara, dónde y a qué hora
   suele pasar, y los vehículos que viajan con él. Verla exige motivo y queda en la bitácora.
   El titular registrado sale del registro vehicular (sin conectar): no es quien maneja. */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { audit, forOperator, grantVehicle, pinPlate, unpinPlate, useApi, vehicleProfile, vehicleReason } from '../../api';
import { ago, dateTime, hhmm, pct } from '../../api/format';
import { KIND_PHRASE, SEARCH_REASONS } from '../../api/labels';
import { useSession } from '../../shell/session';
import { Icon, KindIcon, StatusChip, useNow } from '../../ui/kit';
import { useConsole } from '../ctx';
import { SheetHead } from './SheetHead';
import { useOpenStory } from '../story/OpenStory';
import { usePermissions } from '../permissions';
import { Field } from '../../ui/Field';

export function VehicleSheet({ id }: { id: string }) {
  const { user } = useSession();
  const [reason, setReason] = useState(() => vehicleReason(id));
  const p = useMemo(() => vehicleProfile(id), [id]);
  if (!reason) return <ReasonGate plate={p.plate} n={p.reads.length} onGrant={(r) => { grantVehicle(p.plate, r, user); setReason(r); }} />;
  return <Profile p={p} reason={reason} />;
}

/* Sin motivo no hay ficha: el mismo criterio que la búsqueda de placas. */
function ReasonGate({ plate, n, onGrant }: { plate: string; n: number; onGrant: (reason: string) => void }) {
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTried(true); if (!pick) return;
    onGrant([pick, text.trim()].filter(Boolean).join(' · '));
  };
  return (
    <>
      <SheetHead kicker="Vehículo" title={<span className="plate">{plate}</span>} />
      <form className="pb" onSubmit={submit} noValidate>
        <div className="callout"><Icon name="lock" /><span className="grow">La ficha muestra {n ? `${n} lecturas de 7 días` : 'las lecturas de 7 días'}, la lista de robados y los vehículos asociados. Ver la ficha queda en la bitácora con su motivo.</span></div>
        <Field label="Motivo de la consulta" error={tried && !pick ? 'El motivo es obligatorio: sin motivo no hay ficha.' : null}>{(p) => <>
          <select {...p} className="fld sm" value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
            <option value="">Elegir un motivo…</option>{SEARCH_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input className="fld sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Número de caso (opcional)" aria-label="Número de caso" />
        </>}</Field>
        <button className="btn primary sm" type="submit"><Icon name="directions_car" />Ver ficha</button>
      </form>
    </>
  );
}

function Profile({ p, reason }: { p: ReturnType<typeof vehicleProfile>; reason: string }) {
  const { user } = useSession();
  const c = useConsole();
  const now = useNow(10000);
  const alerts = useApi((s) => s.alerts);
  const related = alerts.filter((a) => forOperator(a) && a.plate && (a.plate.listed === p.plate || a.plate.read === p.plate)).sort((a, b) => b.createdAt - a.createdAt);
  const first = p.reads[0], last = p.reads[p.reads.length - 1];
  const latest = useMemo(() => [...p.reads].reverse(), [p.reads]);

  /* Recorrido: lo pide el analista; el mapa dibuja las lecturas en orden. Queda en la bitácora. */
  const [trace, setTrace] = useState(false);
  useEffect(() => {
    if (!trace || !p.reads.length) return;
    const stops = p.reads.map((r, i) => ({ lat: r.lat, lon: r.lon, label: String(i + 1), time: hhmm(r.at), title: `${dateTime(r.at)} · ${r.cameraId} · ${r.street}`,
      snap: { camera: r.cameraId, street: r.street, evidence: r.evidence, confidence: r.confidence } }));
    c.setOverlay({ route: stops, routeLabel: p.plate, fit: { points: stops.map((s) => [s.lon, s.lat]), key: `vehiculo-${p.plate}` } });
    return () => c.setOverlay({});
  }, [trace, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTrace = () => { if (!trace) audit(user, 'Ver recorrido de placa', p.plate, `${p.reads.length} lecturas en el mapa`, reason); setTrace(!trace); };
  const openCompanion = (plate: string) => { grantVehicle(plate, reason, user, 'Abrir ficha de vehículo asociado'); c.open({ k: 'vehiculo', id: plate }); };

  /* Con una investigación abierta, el vehículo se fija en ella para seguirlo en su línea de tiempo. */
  const openInv = useApi((s) => s.investigations.find((x) => x.id === c.invId));
  const pinned = !!openInv?.plates.includes(p.plate);
  /* Historia: con una investigación abierta hereda su motivo; si no, la pide. */
  const perm = usePermissions();
  const openStory = useOpenStory();
  const story = perm.has('investigar') ? () => openStory({ k: 'placa', plate: p.plate }, openInv ? { invId: openInv.id } : undefined) : null;


  return (
    <>
      <SheetHead
        kicker={<><span>Vehículo</span>·<span>{p.reads.length} {p.reads.length === 1 ? 'lectura' : 'lecturas'} en 7 días</span></>}
        title={<span className="plate">{p.plate}</span>}
        sub={<>Motivo: {reason}</>}
        aside={<>
          {p.listed && <span className="chip critica"><Icon name="warning" />En lista</span>}
          {p.mismatch && <span className="chip media"><Icon name="swap_horiz" />No coincide con la lista</span>}
          {!p.reads.length && <span className="chip nodata">Sin lecturas</span>}
          {openInv && <button className="chip outline" aria-pressed={pinned} onClick={() => (pinned ? unpinPlate(openInv.id, p.plate, user) : pinPlate(openInv.id, p.plate, user))} title={pinned ? 'Quitar de la investigación' : `Fijar en ${openInv.id}`}><Icon name={pinned ? 'check' : 'pin_drop'} />{pinned ? `Fijado en ${openInv.id}` : 'Fijar en la investigación'}</button>}
        </>}
      />
      <div className="pb">
        {p.listed && <div className="callout danger"><Icon name="warning" /><span className="grow"><b>{p.listed.reason}</b> desde el {p.listed.since} · caso <span className="mono">{p.listed.case}</span></span></div>}
        {p.mismatch && <div className="callout warn"><Icon name="swap_horiz" /><span className="grow">La cámara ve otro vehículo que el de la lista. Puede ser una placa clonada: revisa las fotos de las lecturas antes de concluir.</span></div>}

        <div className="kpis" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div className="kpi"><div className="v">{p.reads.length}</div><div className="l">Lecturas</div><div className="x">en {p.cameras.length} {p.cameras.length === 1 ? 'cámara' : 'cámaras'}</div></div>
          <div className={`kpi ${last ? '' : 'nodata'}`}><div className="v">{last ? ago(last.at, now) : '—'}</div><div className="l">Última lectura</div>{last && <div className="x">{last.street}</div>}</div>
          <div className={`kpi ${first ? '' : 'nodata'}`}><div className="v">{first ? dateTime(first.at) : '—'}</div><div className="l">Primera lectura</div></div>
          <div className={`kpi ${p.usualHours ? '' : 'nodata'}`}><div className="v">{p.usualHours ? `${p.usualHours[0]}–${p.usualHours[1]} h` : '—'}</div><div className="l">Franja habitual</div><div className="x">{p.usualHours ? '8 de cada 10 lecturas' : 'Pocas lecturas para un patrón'}</div></div>
        </div>

        <div className="box">
          <div className="bh"><h3>Vehículo</h3></div>
          <div className="bb"><dl className="details">
            {p.listed && <><dt>Según la lista</dt><dd>{p.listed.vehicle.type} · {p.listed.vehicle.make} · {p.listed.vehicle.color}</dd></>}
            <dt>Visto por cámara</dt><dd>{p.seen ? `${p.seen.type} · ${p.seen.color}` : 'Sin lecturas'}</dd>
            <dt>Titular registrado</dt><dd><span className="chip nodata">Registro vehicular sin conectar</span></dd>
          </dl></div>
        </div>

        <div className="box flush">
          <div className="bh"><h3>Viaja junto a</h3><span className="sub">a menos de 90 s, en 2 cámaras o más</span></div>
          <ul className="list bb">
            {!p.companions.length && <li className="empty">Ningún vehículo se repite a su lado.</li>}
            {p.companions.map((x) => (
              <li key={x.plate}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => openCompanion(x.plate)}>
                <div><div className="t"><span className="plate">{x.plate}</span>{x.listed && <span className="chip critica" style={{ height: 18, fontSize: 'var(--fs-2xs)' }}>En lista</span>}</div><div className="s">{x.times} {x.times === 1 ? 'vez' : 'veces'} en {x.cameras} cámaras</div></div>
                <div className="r"><Icon name="chevron_right" /></div>
              </button></li>
            ))}
          </ul>
        </div>

        <div className="box flush">
          <div className="bh"><h3>Alertas</h3><span className="sub">{related.length}</span></div>
          <ul className="list bb">
            {!related.length && <li className="empty">Sin alertas de esta placa.</li>}
            {related.map((a) => <li key={a.id}><button className="item" onClick={() => c.open({ k: 'alerta', id: a.id })}><KindIcon alert={a} /><div><div className="t">{KIND_PHRASE[a.kind]}</div><div className="s mono">{a.id}</div></div><div className="r"><span>{ago(a.createdAt, now)}</span><StatusChip alert={a} /></div></button></li>)}
          </ul>
        </div>

        <div className="box flush">
          <div className="bh"><h3>Dónde se lo ve</h3><span className="sub">{p.cameras.length}</span></div>
          <ul className="list bb">
            {!p.cameras.length && <li className="empty">Sin lecturas en 7 días.</li>}
            {p.cameras.slice(0, 5).map((x) => (
              <li key={x.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'camara', id: x.id })}>
                <div><div className="t mono">{x.id}</div><div className="s">{x.street}</div></div><div className="r"><span className="mono">{x.n}</span></div>
              </button></li>
            ))}
          </ul>
        </div>

        <div className="box flush">
          <div className="bh"><h3>Lecturas</h3><span className="sub">{p.reads.length} en 7 días</span></div>
          {(p.reads.length > 1 || story) && (
            <div className="bb trace-cta">
              <div style={{ display: 'flex', gap: 8 }}>
                {p.reads.length > 1 && <button className={`btn ${trace ? 'secondary' : 'primary'} sm`} aria-pressed={trace} onClick={toggleTrace} style={{ flex: 1 }}>
                  <Icon name={trace ? 'visibility_off' : 'route'} />{trace ? 'Ocultar recorrido' : 'Ver recorrido en el mapa'}
                </button>}
                {story && <button className="btn secondary sm" onClick={story} style={{ flex: 1 }}><Icon name="play_arrow" />Abrir investigación</button>}
              </div>
              {trace && <p className="trace-sum">El número de cada parada es el orden en que pasó el vehículo. Entre dos lecturas puede haber calles sin cámara.</p>}
            </div>
          )}
          <ul className="list bb">
            {!latest.length && <li className="empty">Sin lecturas en 7 días.</li>}
            {latest.slice(0, trace ? 40 : 8).map((x) => (
              <li key={x.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => { c.setPin({ lat: x.lat, lon: x.lon, label: `${p.plate} · ${hhmm(x.at)}` }); c.focus([[x.lon - 0.0015, x.lat - 0.001], [x.lon + 0.0015, x.lat + 0.001]], 'lectura'); }}>
                <div>{trace && <span className="mk-stop inline">{p.reads.indexOf(x) + 1}</span>}<div className="t mono">{x.cameraId}</div><div className="s">{x.street}</div></div>
                <div className="r"><span className="mono">{dateTime(x.at)}</span><span style={{ color: x.confidence < 0.85 ? 'var(--status-alert)' : undefined }}>{pct(x.confidence)}</span></div>
              </button></li>
            ))}
          </ul>
        </div>
        <p className="dim" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>El titular registrado no es necesariamente quien maneja. Que no haya lecturas no significa que el vehículo no circuló: puede haber pasado por calles sin cámara.</p>
      </div>
    </>
  );
}
