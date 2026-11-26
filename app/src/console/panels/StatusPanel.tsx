/* Estado — cómo anda la ciudad, de un vistazo (mando, y lectura para los demás roles).
   Una frase arriba dice si hay algo que mirar. Debajo, cuatro bloques con la misma forma: una cifra
   grande, una línea que la explica y el detalle. Personas → Eventos → Alertas → Recursos.
   Los eventos viven acá (antes tenían su pestaña). Cada fila abre su ficha sobre el mapa. */
import { eventStatus, forOperator, inScope, useApi } from '../../api';
import { fmtCrowd, hhmm, inTime, pct } from '../../api/format';
import { KIND_LABEL } from '../../api/labels';
import type { AlertKind, MassEvent, Severity } from '../../api/types';
import { AlertTile, overdueMin, SeverityBars } from '../../map/icons';
import { useSession } from '../../shell/session';
import { EmptyState, Icon, useNow } from '../../ui/kit';
import { useZoneSeverity, waitingSince } from '../../views/shared';
import { canOpenPanel, useConsole } from '../ctx';
import { EventTag } from './EventsPanel';

const SEVS: Severity[] = ['critica', 'media', 'baja'];
const SEV_WORD: Record<Severity, string> = { critica: 'Críticas', media: 'Medias', baja: 'Bajas' };

export function StatusPanel() {
  const c = useConsole();
  const { role, user } = useSession();
  const now = useNow(5000);
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const cameras = useApi((s) => s.cameras);
  const alerts = useApi((s) => s.alerts);
  const events = useApi((s) => s.events);
  const units = useApi((s) => s.units);
  const policeSource = useApi((s) => s.policeSource);
  const sevOf = useZoneSeverity(alerts);

  /* Alertas */
  const canSeeAlerts = role !== 'admin';
  const waiting = alerts.filter((a) => forOperator(a) && inScope(a, user) && a.review === 'por_revisar');
  const late = waiting.filter((a) => overdueMin(a.severity, waitingSince(a), now) > 0);
  const bySev = SEVS.map((s) => [s, waiting.filter((a) => a.severity === s).length] as const);
  const byKind = (Object.keys(KIND_LABEL) as AlertKind[]).map((k) => [k, waiting.filter((a) => a.kind === k).length] as const).filter(([, n]) => n);
  const going = units.filter((u) => u.enRoute).length;

  /* Personas */
  const measured = zones.filter((z) => status[z.id]?.count != null);
  const sum = (k: 'count' | 'low' | 'high') => measured.reduce((n, z) => n + (status[z.id][k] ?? 0), 0);
  const ranked = [...zones].sort((a, b) => (status[b.id]?.occupancy ?? -1) - (status[a.id]?.occupancy ?? -1));
  const over = measured.filter((z) => (status[z.id].occupancy ?? 0) >= 1);

  /* Eventos */
  const order = { en_curso: 0, programado: 1, finalizado: 2 };
  const evs = [...events].sort((a, b) => order[eventStatus(a, now)] - order[eventStatus(b, now)] || a.start - b.start);
  const live = evs.filter((e) => eventStatus(e, now) === 'en_curso');
  const next = evs.filter((e) => eventStatus(e, now) === 'programado');

  /* Recursos */
  const camsOk = cameras.filter((x) => x.status === 'operativa' || x.status === 'degradada').length;
  const camsDown = cameras.filter((x) => x.status === 'caida').length;
  const free = units.filter((u) => u.status === 'disponible' && !u.enRoute).length;
  const busy = units.filter((u) => u.status === 'en_servicio' && !u.enRoute).length;
  const lost = units.filter((u) => u.status === 'sin_reporte' || u.status === 'desconocida').length;

  /* La frase de arriba: lo primero que hay que mirar, o que todo está en orden. */
  const issues = [
    canSeeAlerts && late.length ? `${late.length} ${late.length === 1 ? 'alerta atrasada' : 'alertas atrasadas'}` : '',
    over.length ? `${over.length} ${over.length === 1 ? 'zona llena' : 'zonas llenas'}` : '',
    camsDown ? `${camsDown} ${camsDown === 1 ? 'cámara caída' : 'cámaras caídas'}` : '',
  ].filter(Boolean);
  const tone = issues.length ? (late.length || over.length ? 'bad' : 'warn') : 'ok';

  return (
    <div className="pb st-panel">
      <header className={`st-head ${tone}`}>
        <p className="st-verdict"><i aria-hidden />{issues.length ? <b>{issues.join(' · ')}</b> : <b>Todo en orden en San Salvador</b>}</p>
      </header>

      <section className="st-block">
        <div className="st-top static">
          <span className="st-ttl">Personas</span>
          <span className="st-big">{fmtCrowd(sum('count'))}</span>
          <span className="st-line">en {measured.length} zonas{over.length ? <> · <b className="st-late">{over.length === 1 ? '1 llena' : `${over.length} llenas`}</b></> : ''}</span>
        </div>
        <ul className="list st-zones">
          {ranked.map((z) => {
            const s = status[z.id]; const sev = sevOf(z.id); const nd = !s || s.count == null;
            return (
              <li key={z.id}>
                <button className={`item ${c.sheet?.k === 'zona' && c.sheet.id === z.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'zona', id: z.id })}>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{sev && <span className={`sev ${sev}`} aria-label={sev === 'critica' ? 'Crítica' : 'Media'} />}{z.name}</div>
                    <div className={`cap ${nd ? 'nodata' : ''}`} aria-hidden>{!nd && <i className={sev ?? ''} style={{ width: `${Math.min(100, s.occupancy! * 100)}%` }} />}</div>
                  </div>
                  <div className="r">{nd ? <span className="chip nodata">Sin medición</span> : <><b className="mono st-num">{fmtCrowd(s.count!)}</b><span>{pct(s.occupancy!)}</span></>}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="st-block">
        <div className="st-top static">
          <span className="st-ttl">Eventos</span>
          <span className="st-big">{live.length}</span>
          <span className="st-line">{live.length ? 'en curso' : 'ninguno en curso'}{next[0] ? ` · el próximo ${inTime(next[0].start, now)}` : ''}</span>
          {role === 'admin' && <button className="btn ghost xs st-act" onClick={() => c.open({ k: 'evento-form' })}><Icon name="add" />Registrar</button>}
        </div>
        {!events.length ? (
          <div className="st-body"><EmptyState icon="flag" title="Sin eventos registrados">Un evento masivo agrupa zonas y les da umbrales propios mientras dure. {role === 'admin' ? 'Registralo antes de que empiece.' : 'Los registra el administrador.'}</EmptyState></div>
        ) : (
          <ul className="list st-events">
            {[...live, ...next].map((e) => <EventRow key={e.id} e={e} now={now} />)}
          </ul>
        )}
      </section>

      {canSeeAlerts && (
        <section className="st-block">
          <button className="st-top" onClick={() => canOpenPanel(role, 'alertas') && c.setPanel('alertas')} disabled={!canOpenPanel(role, 'alertas')}>
            <span className="st-ttl">Alertas</span>
            <span className={`st-big ${late.length ? 'bad' : ''}`}>{waiting.length}</span>
            <span className="st-line">{waiting.length ? <>esperan decisión{late.length ? <> · <b className="st-late">{late.length === waiting.length ? 'todas atrasadas' : `${late.length} atrasadas`}</b></> : ''}</> : going ? `ninguna espera decisión · ${going} ${going === 1 ? 'unidad' : 'unidades'} en camino` : 'ninguna espera decisión'}</span>
            {canOpenPanel(role, 'alertas') && <Icon name="chevron_right" className="st-go" />}
          </button>
          {waiting.length > 0 && (
            <div className="st-body">
              <div className="st-sevs">
                {bySev.map(([s, n]) => (
                  <span key={s} className={`st-sev ${n ? '' : 'zero'}`}><SeverityBars severity={s} muted={!n} /><b className="mono">{n}</b><span>{SEV_WORD[s]}</span></span>
                ))}
              </div>
              <div className="st-kinds">
                {byKind.map(([k, n]) => <span key={k} className="st-kind" title={KIND_LABEL[k]}><AlertTile kind={k} size={22} muted /><span>{KIND_LABEL[k]}</span><b className="mono">{n}</b></span>)}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="st-block">
        <div className="st-top static"><span className="st-ttl">Recursos</span></div>
        <div className="st-res">
          <span className="st-sub">Unidades</span>
          {policeSource ? (
            <div className="st-stats c2x2">
              <Stat n={free} l="Disponibles" />
              <Stat n={busy} l="En servicio" />
              <Stat n={going} l="En camino" />
              <Stat n={lost} l="Sin reporte" warn />
            </div>
          ) : <div className="callout"><span className="grow">Sin acceso a la ubicación policial: no hay capa de unidades ni alertas de falta de policía.</span></div>}
          <span className="st-sub">Cámaras</span>
          <div className="st-stats c2">
            <Stat n={camsOk} l="En línea" of={cameras.length} />
            <Stat n={camsDown} l={camsDown === 1 ? 'Caída' : 'Caídas'} warn />
          </div>
        </div>
      </section>
    </div>
  );
}

/** Una cifra con su rótulo. "warn": en amarillo cuando hay alguna (sin reporte, caídas). */
function Stat({ n, l, of, warn = false }: { n: number; l: string; of?: number; warn?: boolean }) {
  return <span className={`st-stat ${warn && n ? 'warn' : ''} ${n ? '' : 'zero'}`}><b className="mono">{n}{of != null && <small>/{of}</small>}</b><span>{l}</span></span>;
}

/** Un evento: nombre, horario, cuánto falta y, si está en curso, cuánta gente hay contra lo esperado. */
function EventRow({ e, now }: { e: MassEvent; now: number }) {
  const c = useConsole();
  const status = useApi((s) => s.zoneStatus);
  const st = eventStatus(e, now);
  const people = e.zoneIds.reduce((n, id) => n + (status[id]?.count ?? 0), 0);
  const elapsed = Math.min(1, Math.max(0, (now - e.start) / (e.end - e.start)));
  return (
    <li>
      <button className={`item st-ev ${c.sheet?.k === 'evento' && c.sheet.id === e.id ? 'sel' : ''} ${st === 'finalizado' ? 'done' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'evento', id: e.id })}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{e.name.split(' · ')[0]}</div>
          <div className="s">{st === 'en_curso' ? `Hasta las ${hhmm(e.end)} · termina ${inTime(e.end, now)}` : `Empieza ${inTime(e.start, now)}, a las ${hhmm(e.start)}`}</div>
          {st === 'en_curso' && <>
            <div className="cap" aria-label={`Lleva ${pct(elapsed)} del horario`}><i style={{ width: `${elapsed * 100}%` }} /></div>
            <div className="s"><b className={`st-ev-n ${people > e.expected ? 'st-late' : ''}`}>{fmtCrowd(people)} personas</b> · esperaban {fmtCrowd(e.expected)}</div>
          </>}
        </div>
        {st !== 'en_curso' && <div className="r"><EventTag s={st} /></div>}
      </button>
    </li>
  );
}
