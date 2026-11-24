/* Estado ahora — estratega y comandante. El país en 10 segundos.
   Cada fila abre su ficha sobre el mapa; nada cambia de vista. */
import { eventStatus, forOperator, useApi } from '../../api';
import { ago, fmtCrowd, pct } from '../../api/format';
import { KIND_LABEL, KIND_PHRASE } from '../../api/labels';
import type { AlertKind } from '../../api/types';
import { KindIcon, StatusChip, useNow } from '../../ui/kit';
import { useZoneSeverity } from '../../views/shared';
import { useSession } from '../../shell/session';
import { canOpenPanel, useConsole } from '../ctx';

export function StatusPanel() {
  const c = useConsole();
  const now = useNow(5000);
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const cameras = useApi((s) => s.cameras);
  const alerts = useApi((s) => s.alerts);
  const events = useApi((s) => s.events);
  const policeSource = useApi((s) => s.policeSource);
  const sevOf = useZoneSeverity(alerts);

  const measured = zones.filter((z) => status[z.id]?.count != null);
  const sum = (k: 'count' | 'low' | 'high') => measured.reduce((n, z) => n + (status[z.id][k] ?? 0), 0);
  const noData = zones.length - measured.length;
  const active = alerts.filter((a) => forOperator(a) && (a.review === 'por_revisar' || (a.review === 'confirmada' && a.maic !== 'cerrada')));
  const byKind = (Object.keys(KIND_LABEL) as AlertKind[]).map((k) => [k, active.filter((a) => a.kind === k).length] as const).filter(([, n]) => n);
  const live = events.filter((e) => eventStatus(e, now) === 'en_curso');
  const camsOk = cameras.filter((x) => x.status === 'operativa' || x.status === 'degradada').length;
  const ranked = [...zones].sort((a, b) => (status[b.id]?.occupancy ?? -1) - (status[a.id]?.occupancy ?? -1));
  const recent = alerts.filter(forOperator).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const { role } = useSession();
  const canSeeAlerts = role !== 'admin';

  return (
    <>
      <div className="pb">
        <div className="kicker caption">El Salvador · San Salvador · ahora</div>
        <div className="kpis" style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div className="kpi">
            <div className="v">{fmtCrowd(sum('count'))}</div><div className="l">Personas en zonas vigiladas</div>
            <div className="x">entre {fmtCrowd(sum('low'))} y {fmtCrowd(sum('high'))}</div>
            {noData > 0 && <div className="x" style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span className="legend"><span className="sw" /></span>{noData} sin cobertura</div>}
          </div>
          <div className={`kpi ${active.some((a) => a.review === 'por_revisar') ? 'alert' : ''}`}>
            <div className="v">{active.length}</div><div className="l">Alertas activas</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{byKind.map(([k, n]) => <span key={k} className="chip" style={{ height: 20, fontSize: 11 }}>{KIND_LABEL[k]} <b className="mono">{n}</b></span>)}</div>
          </div>
          <button className="kpi" style={{ textAlign: 'left' }} onClick={() => (live[0] ? c.open({ k: 'evento', id: live[0].id }) : c.setPanel('eventos'))}>
            <div className="v">{live.length}</div><div className="l">Eventos en curso</div>
            {live[0] && <div className="x" style={{ fontFamily: 'var(--font-sans)' }}>{live[0].name.split(' · ')[0]}</div>}
          </button>
          <div className="kpi"><div className="v">{camsOk}<small>/ {cameras.length}</small></div><div className="l">Cámaras operativas</div><div className="x">{cameras.length - camsOk} sin medir</div></div>
        </div>
        {!policeSource && <div className="callout"><span className="grow">Sin acceso a la ubicación policial: no hay capa de unidades ni brecha de presencia.</span></div>}

        <div className="box flush">
          <div className="bh"><h3>Zonas</h3><span className="sub">por ocupación</span></div>
          <ul className="list bb">
            {ranked.map((z) => {
              const s = status[z.id]; const sev = sevOf(z.id); const nd = !s || s.count == null;
              return (
                <li key={z.id}>
                  <button className={`item ${c.sheet?.k === 'zona' && c.sheet.id === z.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'zona', id: z.id })}>
                    <div>
                      <div className="t">{sev && <span className={`sev ${sev}`} aria-label={sev === 'critica' ? 'Crítica' : 'Media'} />}{z.name}</div>
                      <div className={`cap ${nd ? 'nodata' : ''}`} aria-hidden>{!nd && <i className={sev ?? ''} style={{ width: `${Math.min(100, s.occupancy! * 100)}%` }} />}</div>
                    </div>
                    <div className="r">{nd ? <span className="chip nodata">Sin cobertura</span> : <><b className="mono" style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 500 }}>{fmtCrowd(s.count!)}</b><span>{pct(s.occupancy!)}</span></>}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {canSeeAlerts && (
          <div className="box flush">
            <div className="bh"><h3>Alertas recientes</h3>{canOpenPanel(role, 'alertas') && <button className="btn ghost xs" onClick={() => c.setPanel('alertas')}>Ver bandeja</button>}</div>
            <ul className="list bb">
              {recent.map((a) => (
                <li key={a.id}>
                  <button className={`item ${a.review === 'descartada' ? 'done' : ''}`} onClick={() => c.open({ k: 'alerta', id: a.id })}>
                    <KindIcon alert={a} />
                    <div><div className="t">{KIND_PHRASE[a.kind]}{a.plate && <span className="plate">{a.plate.listed}</span>}</div><div className="s">{zones.find((z) => z.id === a.zoneId)?.name ?? a.cameraId}</div></div>
                    <div className="r"><span>{ago(a.updatedAt, now)}</span><StatusChip alert={a} /></div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
