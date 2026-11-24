/* Ficha de zona — comandante: "¿dónde refuerzo y con qué?".
   Personas con rango, densidad, ocupación, tendencia, personas por policía,
   unidades presentes, cámaras y alertas. El mapa encuadra la zona. */
import { useEffect } from 'react';
import { eventStatus, forOperator, openZone, presence, useApi } from '../../api';
import { ago, dec1, fmt, fmtCrowd, pct, hhmm } from '../../api/format';
import { CAMERA_LABEL, KIND_PHRASE, UNIT_LABEL } from '../../api/labels';
import { useSession } from '../../shell/session';
import { CoverageChip, Icon, KindIcon, Sparkline, StatusChip, useNow } from '../../ui/kit';
import { useZoneSeverity } from '../../views/shared';
import { useConsole } from '../ctx';
import { SheetHead } from './SheetHead';

export function ZoneSheet({ id }: { id: string }) {
  const { user, role } = useSession();
  const c = useConsole();
  const now = useNow(5000);
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const cameras = useApi((s) => s.cameras);
  const units = useApi((s) => s.units);
  const alerts = useApi((s) => s.alerts);
  const events = useApi((s) => s.events);
  const rules = useApi((s) => s.rules);
  const policeSource = useApi((s) => s.policeSource);
  const sevOf = useZoneSeverity(alerts);
  const zone = zones.find((z) => z.id === id);
  useEffect(() => { if (zone) openZone(zone.id, zone.name, user); }, [zone?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!zone) return <><SheetHead kicker="Zona" title="No encontrada" /></>;

  const s = status[zone.id]; const sev = sevOf(zone.id); const nd = !s || s.count == null;
  const ev = events.find((e) => e.zoneIds.includes(zone.id) && eventStatus(e, now) === 'en_curso');
  const occMax = ev?.thresholds?.occupancyPct ?? rules.find((r) => r.id === 'R-AGL-OCUP')!.threshold!;
  const perMax = ev?.thresholds?.perOfficer ?? rules.find((r) => r.id === 'R-BRECHA')!.threshold!;
  const zcams = cameras.filter((x) => zone.cameras.includes(x.id));
  const zunits = units.filter((u) => u.zoneId === zone.id);
  const zalerts = alerts.filter((a) => a.zoneId === zone.id && forOperator(a) && a.review !== 'descartada').sort((a, b) => b.updatedAt - a.updatedAt);
  const t = s?.trend.filter((v): v is number => v != null) ?? [];
  const delta = t.length > 5 ? t[t.length - 1] - t[t.length - 6] : null;

  return (
    <>
      <SheetHead
        kicker={<><span className="mono">{zone.id}</span>·<span>{fmt(zone.areaM2)} m²</span>·<span>capacidad {fmt(zone.capacity)}</span></>}
        title={<>{sev && <span className={`sev ${sev}`} aria-hidden />}{zone.name}</>}
        aside={<>{s && <CoverageChip coverage={s.coverage} />}{ev && <button className="chip outline" onClick={() => c.open({ k: 'evento', id: ev.id })}><Icon name="flag" />{ev.name.split(' · ')[0]} · hasta {hhmm(ev.end)}</button>}</>}
      />
      <div className="pb">
        {nd && <div className="callout"><Icon name="visibility_off" /><span className="grow"><b>{s?.coverage === 'sin_cobertura' ? 'Sin cobertura.' : 'Sin datos.'}</b> {s?.coverage === 'sin_cobertura' ? 'La cámara PTZ está fuera de su preset: se detectan personas pero la zona no se mide.' : 'Ninguna cámara de la zona envía video.'} No significa que esté vacía.</span></div>}
        <div className="kpis" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div className={`kpi ${nd ? 'nodata' : ''}`}><div className="v">{nd ? 'Sin medición' : fmtCrowd(s.count!)}</div><div className="l">Personas</div>{!nd && <div className="x">entre {fmtCrowd(s.low!)} y {fmtCrowd(s.high!)}</div>}</div>
          <div className={`kpi ${nd ? 'nodata' : s.occupancy! * 100 > occMax ? 'alert' : ''}`}>
            <div className="v">{nd ? '—' : pct(s.occupancy!)}</div><div className="l">Ocupación · {nd ? '' : `${dec1(s.densityPerM2!)} p/m²`}</div>
            <div className={`cap ${nd ? 'nodata' : ''}`} aria-hidden>{!nd && <i className={sev ?? ''} style={{ width: `${Math.min(100, s.occupancy! * 100 / 1.5)}%` }} />}<span className="mark" style={{ left: `${occMax / 1.5}%` }} /></div>
            <div className="x">umbral {occMax} %</div>
          </div>
          <div className={`kpi ${!policeSource || s?.perOfficer == null ? 'nodata' : s.perOfficer > perMax ? 'alert' : ''}`}>
            <div className="v">{!policeSource ? 'Sin fuente' : s?.perOfficer == null ? '—' : fmt(s.perOfficer)}</div><div className="l">Personas por policía</div>
            <div className="x">{policeSource ? `${s?.officers ?? 0} policías · máx. ${fmt(perMax)}` : ev ? `${ev.plannedOfficers} planificados` : 'sin ubicación policial'}</div>
          </div>
          <div className={`kpi ${nd ? 'nodata' : ''}`}><div className="v">{nd || delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${fmtCrowd(Math.abs(delta))}`}</div><div className="l">Últimos 10 min</div>{!nd && s.flowIn != null && <div className="x">entran {fmt(s.flowIn)}/min · salen {fmt(s.flowOut!)}/min</div>}</div>
        </div>
        <div className="box"><div className="bh"><h3>Personas en la última hora</h3></div><div className="bb"><Sparkline values={s?.trend ?? []} threshold={(zone.capacity * occMax) / 100} height={160} /></div></div>

        {role !== 'admin' && role !== 'auditor' && (
          <div className="box flush">
            <div className="bh"><h3>Alertas de la zona</h3><span className="sub">{zalerts.length}</span></div>
            <ul className="list bb">
              {!zalerts.length && <li className="empty">Sin alertas abiertas.</li>}
              {zalerts.map((a) => <li key={a.id}><button className="item" onClick={() => c.open({ k: 'alerta', id: a.id })}><KindIcon alert={a} /><div><div className="t">{KIND_PHRASE[a.kind]}</div><div className="s">{a.rule.measured}</div></div><div className="r"><span>{ago(a.createdAt, now)}</span><StatusChip alert={a} /></div></button></li>)}
            </ul>
          </div>
        )}

        <div className="box flush">
          <div className="bh"><h3>Unidades presentes</h3><span className="sub">{presence.radiusM} m · {presence.windowMin} min</span></div>
          {!policeSource ? <div className="bb"><span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Sin acceso a la ubicación policial.{ev && ` Referencia: ${ev.plannedOfficers} policías planificados.`}</span></div> : (
            <ul className="list bb">
              {!zunits.length && <li className="empty">Ninguna unidad en la zona.</li>}
              {zunits.map((u) => (
                <li key={u.id}><button className="item" style={{ opacity: u.status === 'sin_reporte' ? 0.5 : 1 }} onClick={() => { c.setPin({ lat: u.lat, lon: u.lon, label: u.id }); }}>
                  <span className="ic"><Icon name={u.type === 'Motorizada' ? 'two_wheeler' : u.type === 'A pie' ? 'directions_walk' : 'local_police'} /></span>
                  <div><div className="t mono">{u.id}</div><div className="s">{u.type}</div></div><div className="r"><span>{UNIT_LABEL[u.status]}</span><span>{ago(u.lastReportAt, now)}</span></div>
                </button></li>
              ))}
            </ul>
          )}
        </div>

        <div className="box flush">
          <div className="bh"><h3>Cámaras que la cubren</h3><span className="sub">{zcams.length}</span></div>
          <ul className="list bb">
            {zcams.map((x) => (
              <li key={x.id}><button className="item" onClick={() => c.open({ k: 'camara', id: x.id })}>
                <span className="ic"><Icon name={x.status === 'caida' ? 'videocam_off' : 'videocam'} /></span>
                <div><div className="t"><span className="mono">{x.id}</span>{x.ptz && <span className="chip" style={{ height: 18, fontSize: 'var(--fs-2xs)' }}>PTZ</span>}</div><div className="s">{x.street}</div></div>
                <div className="r"><span className={`chip ${x.status === 'operativa' ? 'ok' : x.status === 'caida' ? 'critica' : x.status === 'degradada' ? 'media' : 'nodata'}`}>{CAMERA_LABEL[x.status]}</span></div>
              </button></li>
            ))}
          </ul>
        </div>
        <p className="dim" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>El refuerzo se ordena por Maic o por radio. Si varias cámaras cubren la zona, cuenta la de mayor cobertura.</p>
      </div>
    </>
  );
}
