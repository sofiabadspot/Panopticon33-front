/* Ficha de evento masivo y su alta/edición. El mapa encuadra las zonas del evento;
   en el formulario, las zonas se eligen haciendo clic en el mismo mapa. */
import { useState, type FormEvent } from 'react';
import { eventStatus, newEventId, newZoneId, saveEvent, saveZone, territoryAt, useApi } from '../../api';
import { cellsArea, cellsShape, toggleCell, zoneHexes, zonesTouching } from '../../api/coverage';
import { closeUp, HexPicker } from './configPlace';
import { dateShort, fmt, fmtCrowd, fromLocalInput, hhmm, pct, toLocalInput, inTime } from '../../api/format';
import { KIND_PHRASE } from '../../api/labels';
import type { MassEvent } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon, KindIcon, StatusChip, useNow, useToast } from '../../ui/kit';
import { useZoneSeverity } from '../../views/shared';
import { useConsole, useOverlay, useUnsavedGuard } from '../ctx';
import { EventTag } from '../panels/EventsPanel';
import { SheetHead, SheetNotFound } from './SheetHead';
import { usePermissions } from '../permissions';
import { DateRangeField, rangeErrors } from '../../ui/Field';

export function EventSheet({ id }: { id: string }) {
  const perm = usePermissions();
  const c = useConsole();
  const now = useNow(5000);
  const events = useApi((s) => s.events);
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const alerts = useApi((s) => s.alerts);
  const rules = useApi((s) => s.rules);
  const policeSource = useApi((s) => s.policeSource);
  const sevOf = useZoneSeverity(alerts);
  const ev = events.find((e) => e.id === id);
  // Con área propia (hexágonos), el mapa muestra esa área; los eventos anteriores, sus zonas.
  useOverlay(ev?.cells?.length ? { fit: { points: cellsShape(ev.cells).ring, key: 'ev' + ev.id } } : { highlightZones: ev?.zoneIds }, [ev?.id]);
  if (!ev) return <SheetNotFound kicker="Evento" title="No encontrado" what="este evento" />;

  const st = eventStatus(ev, now);
  const ez = zones.filter((z) => ev.zoneIds.includes(z.id));
  const measured = ez.filter((z) => status[z.id]?.count != null);
  const sum = (k: 'count' | 'low' | 'high') => measured.reduce((n, z) => n + (status[z.id][k] ?? 0), 0);
  const officers = policeSource ? ez.reduce((n, z) => n + (status[z.id]?.officers ?? 0), 0) : null;
  const occ = ev.thresholds?.occupancyPct ?? rules.find((r) => r.id === 'R-AGL-OCUP')!.threshold!;
  const per = ev.thresholds?.perOfficer ?? rules.find((r) => r.id === 'R-BRECHA')!.threshold!;
  const evAlerts = alerts.filter((a) => (a.eventId === ev.id || (a.zoneId && ev.zoneIds.includes(a.zoneId) && a.createdAt >= ev.start)) && a.review !== 'descartada' && a.kind !== 'camara_caida');

  return (
    <>
      <SheetHead kicker={<><span className="mono">{ev.id}</span>·<span>{dateShort(ev.start)} {hhmm(ev.start)}–{hhmm(ev.end)}</span></>} title={ev.name} sub={`${ev.venue} · registrado por ${ev.createdBy}`}
        aside={<><EventTag s={st} />{perm.config && <button className="btn secondary xs" onClick={() => c.open({ k: 'evento-form', id: ev.id })}><Icon name="edit_note" />Editar</button>}</>} />
      <div className="pb">
        {/* Cuándo: lo primero que se pregunta de un evento en curso es hasta qué hora dura */}
        <div className={`ev-when ${st}`}>
          <Icon name="schedule" />
          {st === 'en_curso' ? <span>Termina a las <b>{hhmm(ev.end)}</b> · {inTime(ev.end, now)} <small>(empezó a las {hhmm(ev.start)})</small></span>
            : st === 'programado' ? <span>Empieza el {dateShort(ev.start)} a las <b>{hhmm(ev.start)}</b> · {inTime(ev.start, now)} <small>(termina a las {hhmm(ev.end)})</small></span>
            : <span>Terminó el {dateShort(ev.end)} a las <b>{hhmm(ev.end)}</b></span>}
        </div>
        <div className="kpis" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div className={`kpi ${st !== 'en_curso' ? 'nodata' : ''}`}><div className="v">{st === 'en_curso' ? fmtCrowd(sum('count')) : st === 'programado' ? 'Aún no empieza' : 'Finalizado'}</div><div className="l">Personas ahora</div>{st === 'en_curso' && <div className="x">entre {fmtCrowd(sum('low'))} y {fmtCrowd(sum('high'))}</div>}</div>
          <div className="kpi"><div className="v">{fmtCrowd(ev.expected)}<small>/ {fmtCrowd(ev.capacity ?? ez.reduce((n, z) => n + z.capacity, 0))}</small></div><div className="l">Esperadas / aforo máximo</div>{st === 'en_curso' && <div className="x">{pct(sum('count') / ev.expected)} de lo esperado</div>}</div>
          <div className={`kpi ${officers == null ? 'nodata' : ''}`}><div className="v">{officers == null ? 'Sin fuente' : fmt(officers)}<small>/ {fmt(ev.plannedOfficers)}</small></div><div className="l">Policías presentes / previstos</div></div>
          <div className={`kpi ${evAlerts.some((a) => a.review === 'por_revisar') ? 'alert' : ''}`}><div className="v">{evAlerts.filter((a) => a.review === 'por_revisar').length}</div><div className="l">Alertas por revisar</div></div>
        </div>
        <div className="box flush">
          <div className="bh"><h3>Zonas del evento</h3><span className="sub">umbrales {ev.thresholds ? 'propios' : 'de cada zona'}: {occ} % · {fmt(per)} p/policía</span></div>
          <ul className="list bb">
            {ez.map((z) => { const s = status[z.id]; const nd = !s || s.count == null; const sev = sevOf(z.id); return (
              <li key={z.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'zona', id: z.id })}>
                <div><div className="t">{sev && <span className={`sev ${sev}`} />}{z.name}</div><div className={`cap ${nd ? 'nodata' : ''}`}>{!nd && <i className={sev ?? ''} style={{ width: `${Math.min(100, s.occupancy! * 100 / 1.5)}%` }} />}<span className="mark" style={{ left: `${occ / 1.5}%` }} /></div></div>
                <div className="r">{nd ? <span className="chip nodata">Sin medición</span> : <><b className="mono" style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmtCrowd(s.count!)}</b><span>{pct(s.occupancy!)}{s.perOfficer != null && ` · ${fmt(s.perOfficer)}/pol.`}</span></>}</div>
              </button></li>
            ); })}
          </ul>
        </div>
        {perm.seesAlerts && (
          <div className="box flush">
            <div className="bh"><h3>Alertas del evento</h3><span className="sub">{evAlerts.length}</span></div>
            <ul className="list bb">
              {!evAlerts.length && <li className="empty">Sin alertas.</li>}
              {evAlerts.map((a) => <li key={a.id}><button className="item" onClick={() => c.open({ k: 'alerta', id: a.id })}><KindIcon alert={a} /><div><div className="t">{KIND_PHRASE[a.kind]}</div><div className="s">{zones.find((z) => z.id === a.zoneId)?.name} · {a.rule.measured}</div></div><div className="r"><span>{hhmm(a.createdAt)}</span><StatusChip alert={a} /></div></button></li>)}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

export function EventFormSheet({ id }: { id?: string }) {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const events = useApi((s) => s.events);
  const zones = useApi((s) => s.zones);
  const ex = events.find((e) => e.id === id);
  const base = Date.now() + 24 * 3600e3;
  const [f, setF] = useState({
    name: ex?.name ?? '', venue: ex?.venue ?? '',
    // El área del evento son hexágonos. Un evento anterior arranca con los hexágonos de sus zonas.
    cells: ex?.cells ?? (ex ? zoneHexes(zones.filter((z) => ex.zoneIds.includes(z.id))) : [] as string[]),
    start: toLocalInput(ex?.start ?? base), end: toLocalInput(ex?.end ?? base + 5 * 3600e3),
    expected: String(ex?.expected ?? ''), planned: String(ex?.plannedOfficers ?? ''), capacity: ex?.capacity != null ? String(ex.capacity) : '', own: !!ex?.thresholds,
    occ: String(ex?.thresholds?.occupancyPct ?? 110), per: String(ex?.thresholds?.perOfficer ?? 2000), pers: String(ex?.thresholds?.persistenceMin ?? 3),
  });
  const [tried, setTried] = useState(false);
  const [initial] = useState(() => JSON.stringify(f));
  const release = useUnsavedGuard(JSON.stringify(f) !== initial);
  const setCells = (cells: string[]) => setF((p) => ({ ...p, cells }));
  // Encuadre al abrir: el área del evento si ya tiene, o de cerca el centro del sector (para ver la grilla).
  const [fitPts] = useState(() => (f.cells.length ? cellsShape(f.cells).ring : closeUp(zones)));
  useOverlay({ pickCells: f.cells, onMapClick: (pt) => setCells(toggleCell(f.cells, pt)), fit: { points: fitPts, key: 'form' } }, [f.cells.join()]);
  /** Las zonas del evento son las que toca su área: ahí se cuenta la gente y los policías. */
  const touched = zonesTouching(f.cells, zones);
  /** Sumar una zona entera al área (atajo para no elegir hexágono por hexágono). */
  const addZone = (zid: string) => { const z = zones.find((x) => x.id === zid); if (z) setCells([...new Set([...f.cells, ...zoneHexes([z])])]); };

  const errors: Record<string, string> = {};
  if (!f.name.trim()) errors.name = 'Escribe el nombre del evento.';
  if (!f.cells.length) errors.zones = 'Elige en el mapa los hexágonos donde ocurre el evento.';
  // Fechas: vacías o fin antes del inicio (las mismas reglas en toda la consola, ui/Field.tsx).
  const re = rangeErrors(f.start, f.end, ['el inicio', 'el fin']);
  if (re.from) errors.start = re.from;
  if (re.to) errors.end = re.to;
  if (!(Number(f.expected) > 0)) errors.expected = 'Indica la asistencia esperada.';
  if (f.planned === '' || !(Number(f.planned) >= 0)) errors.planned = 'Indica cuántos policías habrá.';
  if (f.capacity !== '' && !(Number(f.capacity) > 0)) errors.capacity = 'El aforo tiene que ser un número mayor que 0.';
  if (f.own) {
    if (!(Number(f.occ) > 0)) errors.occ = 'Tiene que ser un número mayor que 0.';
    if (!(Number(f.per) > 0)) errors.per = 'Tiene que ser un número mayor que 0.';
    if (f.pers === '' || !(Number(f.pers) >= 0)) errors.pers = 'Tiene que ser 0 o más minutos.';
  }
  const zonesCap = touched.length ? touched.reduce((n, z) => n + z.capacity, 0) : Math.round((cellsArea(f.cells) * 4) / 100) * 100;
  const err = (k: string) => (tried && errors[k] ? <span className="err"><Icon name="error" />{errors[k]}</span> : null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault(); setTried(true);
    if (Object.keys(errors).length) { requestAnimationFrame(() => (document.querySelector('#evform [aria-invalid="true"]') as HTMLElement | null)?.focus()); return; }
    // Si el área no toca ninguna zona, se crea una con esos hexágonos: sin zona no se cuenta la gente.
    let zoneIds = touched.map((z) => z.id);
    if (!zoneIds.length) {
      const shape = cellsShape(f.cells), a = cellsArea(f.cells), zid = newZoneId();
      saveZone({ id: zid, name: f.venue.trim() || f.name.trim(), lat: shape.lat, lon: shape.lon, ring: shape.ring, cells: f.cells, areaM2: a, capacity: Math.round((a * 4) / 100) * 100, cameras: [], territory: territoryAt(shape.lat, shape.lon) }, user); // hoy siempre San Salvador
      zoneIds = [zid];
    }
    const ev: MassEvent = { id: ex?.id ?? newEventId(), name: f.name.trim(), venue: f.venue.trim() || f.name.trim(), cells: f.cells, zoneIds, start: fromLocalInput(f.start), end: fromLocalInput(f.end),
      expected: Number(f.expected), plannedOfficers: Number(f.planned), capacity: f.capacity === '' ? null : Number(f.capacity), createdBy: ex?.createdBy ?? user.name,
      thresholds: f.own ? { occupancyPct: Number(f.occ), perOfficer: Number(f.per), persistenceMin: Number(f.pers) } : null };
    saveEvent(ev, user); release(); toast(ex ? 'Evento guardado' : 'Evento registrado. Sus zonas usan su aforo y sus umbrales mientras dure.'); c.open({ k: 'evento', id: ev.id });
  };

  return (
    <>
      <SheetHead kicker={ex ? ex.id : 'Nuevo evento'} title={ex ? 'Editar evento' : 'Registrar evento'} />
      <form className="pb" onSubmit={submit} noValidate id="evform">
        <div className="field"><label htmlFor="en">Nombre</label><input id="en" className="fld sm" value={f.name} onChange={set('name')} aria-invalid={tried && !!errors.name} placeholder="Festividades de diciembre" />{err('name')}</div>
        <div className="field"><label htmlFor="ev">Lugar</label><input id="ev" className="fld sm" value={f.venue} onChange={set('venue')} /></div>
        <DateRangeField labels={['Inicio', 'Fin']} errorLabels={['el inicio', 'el fin']} from={f.start} to={f.end} showErrors={tried}
          onChange={(r) => setF({ ...f, start: r.from, end: r.to })} />
        <div className="box"><div className="bh"><h3>Dónde ocurre</h3><span className="sub">{f.cells.length} hexágonos</span></div><div className="bb grid">
          <HexPicker cells={f.cells} onChange={setCells} allowSplit hint="Puede abarcar varias zonas, y también lugares separados." />
          {err('zones')}
          <div className="field"><label htmlFor="eaz">Sumar una zona entera</label>
            <select id="eaz" className="fld sm" value="" onChange={(e) => addZone(e.target.value)}>
              <option value="">Elegir zona…</option>
              {zones.filter((z) => !touched.includes(z)).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select></div>
          <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
            {touched.length ? <>Zonas que toca: <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{touched.map((z) => z.name).join(', ')}</b>. Ahí se cuentan las personas y los policías.</>
              : f.cells.length ? 'No toca ninguna zona: al guardar se crea una con estos hexágonos para poder contar a la gente.' : null}
          </div>
        </div></div>
        <div className="box"><div className="bh"><h3>Personas y policías</h3></div><div className="bb grid">
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="ecap">Aforo máximo (personas)</label><input id="ecap" inputMode="numeric" className="fld sm mono" value={f.capacity} onChange={set('capacity')} placeholder={zonesCap ? fmt(zonesCap) : ''} aria-invalid={tried && !!errors.capacity} />
              {err('capacity') ?? <span className="hint dim" style={{ fontSize: 'var(--fs-xs)' }}>{f.capacity === '' ? (zonesCap ? `Vacío: la suma de sus zonas (${fmt(zonesCap)})` : 'Vacío: la suma de sus zonas') : 'Reemplaza a la capacidad de sus zonas'}</span>}</div>
            <div className="field"><label htmlFor="ex">Asistencia esperada</label><input id="ex" inputMode="numeric" className="fld sm mono" value={f.expected} onChange={set('expected')} aria-invalid={tried && !!errors.expected} />{err('expected')}</div>
            <div className="field"><label htmlFor="ep">Policías previstos</label><input id="ep" inputMode="numeric" className="fld sm mono" value={f.planned} onChange={set('planned')} aria-invalid={tried && !!errors.planned} />{err('planned') ?? <span className="hint dim" style={{ fontSize: 'var(--fs-xs)' }}>Se muestran si no hay ubicación policial en vivo</span>}</div>
          </div>
        </div></div>
        <div className="box"><div className="bh"><h3>Cuándo avisar durante el evento</h3></div><div className="bb grid">
          <label className="toggle"><input type="checkbox" checked={f.own} onChange={(e) => setF({ ...f, own: e.target.checked })} />Usar umbrales propios mientras dure</label>
          {!f.own && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Apagado: sus zonas usan los umbrales de Reglas y criticidad.</span>}
          {f.own && <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="field"><label htmlFor="to">Aglomeración desde (% del aforo)</label><input id="to" inputMode="numeric" className="fld sm mono" value={f.occ} onChange={set('occ')} aria-invalid={tried && !!errors.occ} />{err('occ')}</div>
            <div className="field"><label htmlFor="tp">Falta policía desde (personas por policía)</label><input id="tp" inputMode="numeric" className="fld sm mono" value={f.per} onChange={set('per')} aria-invalid={tried && !!errors.per} />{err('per')}</div>
            <div className="field"><label htmlFor="tm">Tiene que durar (min)</label><input id="tm" inputMode="numeric" className="fld sm mono" value={f.pers} onChange={set('pers')} aria-invalid={tried && !!errors.pers} />{err('pers')}</div>
          </div>}
        </div></div>
      </form>
      <div className="pf"><button type="button" className="btn ghost sm" onClick={() => (ex ? c.open({ k: 'evento', id: ex.id }) : c.open({ k: 'config', tab: 'eventos' }))}>Cancelar</button><button type="submit" form="evform" className="btn primary sm" style={{ marginLeft: 'auto' }}>{ex ? 'Guardar cambios' : 'Registrar evento'}</button></div>
    </>
  );
}
