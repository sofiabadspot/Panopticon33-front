/* Ficha de evento masivo y su alta/edición. El mapa encuadra las zonas del evento;
   en el formulario, las zonas se eligen haciendo clic en el mismo mapa. */
import { useState, type FormEvent } from 'react';
import { eventStatus, newEventId, saveEvent, useApi } from '../../api';
import { dateShort, fmt, fmtCrowd, fromLocalInput, hhmm, pct, toLocalInput } from '../../api/format';
import { KIND_PHRASE } from '../../api/labels';
import type { MassEvent } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon, KindIcon, StatusChip, useNow, useToast } from '../../ui/kit';
import { useZoneSeverity } from '../../views/shared';
import { useConsole, useOverlay } from '../ctx';
import { EventTag } from '../panels/EventsPanel';
import { SheetHead } from './SheetHead';

export function EventSheet({ id }: { id: string }) {
  const { role } = useSession();
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
  useOverlay({ highlightZones: ev?.zoneIds }, [ev?.id]);
  if (!ev) return <SheetHead kicker="Evento" title="No encontrado" />;

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
        aside={<><EventTag s={st} />{role === 'admin' && <button className="btn secondary xs" onClick={() => c.open({ k: 'evento-form', id: ev.id })}><Icon name="edit_note" />Editar</button>}</>} />
      <div className="pb">
        <div className="kpis" style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div className={`kpi ${st !== 'en_curso' ? 'nodata' : ''}`}><div className="v">{st === 'en_curso' ? fmtCrowd(sum('count')) : st === 'programado' ? 'Aún no empieza' : 'Finalizado'}</div><div className="l">Personas ahora</div>{st === 'en_curso' && <div className="x">entre {fmtCrowd(sum('low'))} y {fmtCrowd(sum('high'))}</div>}</div>
          <div className="kpi"><div className="v">{fmtCrowd(ev.expected)}</div><div className="l">Esperadas</div>{st === 'en_curso' && <div className="x">{pct(sum('count') / ev.expected)} de lo esperado</div>}</div>
          <div className={`kpi ${officers == null ? 'nodata' : ''}`}><div className="v">{officers == null ? 'Sin fuente' : fmt(officers)}<small>/ {fmt(ev.plannedOfficers)}</small></div><div className="l">Policías presentes / planificados</div></div>
          <div className={`kpi ${evAlerts.some((a) => a.review === 'por_revisar') ? 'alert' : ''}`}><div className="v">{evAlerts.filter((a) => a.review === 'por_revisar').length}</div><div className="l">Alertas por revisar</div></div>
        </div>
        <div className="box flush">
          <div className="bh"><h3>Zonas del evento</h3><span className="sub">umbrales {ev.thresholds ? 'propios' : 'de cada zona'}: {occ} % · {fmt(per)} p/policía</span></div>
          <ul className="list bb">
            {ez.map((z) => { const s = status[z.id]; const nd = !s || s.count == null; const sev = sevOf(z.id); return (
              <li key={z.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'zona', id: z.id })}>
                <div><div className="t">{sev && <span className={`sev ${sev}`} />}{z.name}</div><div className={`cap ${nd ? 'nodata' : ''}`}>{!nd && <i className={sev ?? ''} style={{ width: `${Math.min(100, s.occupancy! * 100 / 1.5)}%` }} />}<span className="mark" style={{ left: `${occ / 1.5}%` }} /></div></div>
                <div className="r">{nd ? <span className="chip nodata">Sin cobertura</span> : <><b className="mono" style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmtCrowd(s.count!)}</b><span>{pct(s.occupancy!)}{s.perOfficer != null && ` · ${fmt(s.perOfficer)}/pol.`}</span></>}</div>
              </button></li>
            ); })}
          </ul>
        </div>
        {role !== 'admin' && (
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
    name: ex?.name ?? '', venue: ex?.venue ?? '', zoneIds: ex?.zoneIds ?? [] as string[],
    start: toLocalInput(ex?.start ?? base), end: toLocalInput(ex?.end ?? base + 5 * 3600e3),
    expected: String(ex?.expected ?? ''), planned: String(ex?.plannedOfficers ?? ''), own: !!ex?.thresholds,
    occ: String(ex?.thresholds?.occupancyPct ?? 110), per: String(ex?.thresholds?.perOfficer ?? 2000), pers: String(ex?.thresholds?.persistenceMin ?? 3),
  });
  const [tried, setTried] = useState(false);
  const toggleZone = (zid: string) => setF((p) => ({ ...p, zoneIds: p.zoneIds.includes(zid) ? p.zoneIds.filter((x) => x !== zid) : [...p.zoneIds, zid] }));
  useOverlay({ onZoneClick: toggleZone, highlightZones: f.zoneIds.length ? f.zoneIds : undefined, fit: { points: zones.flatMap((z) => z.ring), key: 'form' } }, [f.zoneIds.join()]);

  const errors: Record<string, string> = {};
  if (!f.name.trim()) errors.name = 'Escribe el nombre del evento.';
  if (!f.zoneIds.length) errors.zones = 'Elige al menos una zona en el mapa o en la lista.';
  if (fromLocalInput(f.end) <= fromLocalInput(f.start)) errors.end = 'El fin debe ser posterior al inicio.';
  if (!(Number(f.expected) > 0)) errors.expected = 'Indica la asistencia esperada.';
  if (f.planned === '' || !(Number(f.planned) >= 0)) errors.planned = 'Indica los policías planificados.';
  const err = (k: string) => (tried && errors[k] ? <span className="err"><Icon name="error" />{errors[k]}</span> : null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault(); setTried(true); if (Object.keys(errors).length) return;
    const ev: MassEvent = { id: ex?.id ?? newEventId(), name: f.name.trim(), venue: f.venue.trim() || f.name.trim(), zoneIds: f.zoneIds, start: fromLocalInput(f.start), end: fromLocalInput(f.end),
      expected: Number(f.expected), plannedOfficers: Number(f.planned), createdBy: ex?.createdBy ?? user.name,
      thresholds: f.own ? { occupancyPct: Number(f.occ), perOfficer: Number(f.per), persistenceMin: Number(f.pers) } : null };
    saveEvent(ev, user); toast(ex ? 'Evento actualizado' : 'Evento registrado'); c.open({ k: 'evento', id: ev.id });
  };

  return (
    <>
      <SheetHead kicker={ex ? ex.id : 'Nuevo evento'} title={ex ? 'Editar evento' : 'Registrar evento'} />
      <form className="pb" onSubmit={submit} noValidate id="evform">
        <div className="field"><label htmlFor="en">Nombre</label><input id="en" className="fld sm" value={f.name} onChange={set('name')} aria-invalid={tried && !!errors.name} placeholder="Festividades de diciembre" />{err('name')}</div>
        <div className="field"><label htmlFor="ev">Lugar</label><input id="ev" className="fld sm" value={f.venue} onChange={set('venue')} /></div>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="es">Inicio</label><input id="es" type="datetime-local" className="fld sm" value={f.start} onChange={set('start')} /></div>
          <div className="field"><label htmlFor="ee">Fin</label><input id="ee" type="datetime-local" className="fld sm" value={f.end} onChange={set('end')} aria-invalid={tried && !!errors.end} />{err('end')}</div>
          <div className="field"><label htmlFor="ex">Asistencia esperada</label><input id="ex" inputMode="numeric" className="fld sm mono" value={f.expected} onChange={set('expected')} aria-invalid={tried && !!errors.expected} />{err('expected')}</div>
          <div className="field"><label htmlFor="ep">Policías planificados</label><input id="ep" inputMode="numeric" className="fld sm mono" value={f.planned} onChange={set('planned')} aria-invalid={tried && !!errors.planned} />{err('planned')}</div>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>Zonas · haz clic en el mapa o marca aquí</legend>
          <div className="grid" style={{ gap: 6 }}>
            {zones.map((z) => <label key={z.id} className="check"><input type="checkbox" checked={f.zoneIds.includes(z.id)} onChange={() => toggleZone(z.id)} /><span>{z.name} <span className="dim" style={{ fontSize: 11 }}>· capacidad {fmt(z.capacity)}</span></span></label>)}
          </div>{err('zones')}
        </fieldset>
        <label className="toggle"><input type="checkbox" checked={f.own} onChange={(e) => setF({ ...f, own: e.target.checked })} />Umbrales propios (reemplazan a los de cada zona)</label>
        {f.own && <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="field"><label htmlFor="to">Ocupación %</label><input id="to" className="fld sm mono" value={f.occ} onChange={set('occ')} /></div>
          <div className="field"><label htmlFor="tp">Pers./policía</label><input id="tp" className="fld sm mono" value={f.per} onChange={set('per')} /></div>
          <div className="field"><label htmlFor="tm">Persist. min</label><input id="tm" className="fld sm mono" value={f.pers} onChange={set('pers')} /></div>
        </div>}
      </form>
      <div className="pf"><button type="button" className="btn ghost sm" onClick={() => (ex ? c.open({ k: 'evento', id: ex.id }) : c.close())}>Cancelar</button><button type="submit" form="evform" className="btn solid sm" style={{ marginLeft: 'auto' }}>{ex ? 'Guardar cambios' : 'Registrar evento'}</button></div>
    </>
  );
}
