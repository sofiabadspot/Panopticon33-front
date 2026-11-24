/* Eventos masivos — el comandante los sigue, el administrador los registra.
   Abrir un evento lo muestra en la ficha y encuadra sus zonas en el mapa. */
import { eventStatus, useApi } from '../../api';
import { dateShort, fmt, hhmm, inTime } from '../../api/format';
import { useSession } from '../../shell/session';
import { EmptyState, Icon, useNow } from '../../ui/kit';
import { useConsole } from '../ctx';

export const EVENT_STATUS = { programado: 'Programado', en_curso: 'En curso', finalizado: 'Finalizado' } as const;
export const EventTag = ({ s }: { s: keyof typeof EVENT_STATUS }) =>
  <span className={`chip ${s === 'en_curso' ? 'ok' : 'outline'}`}>{s === 'en_curso' && <span className="dot" aria-hidden />}{EVENT_STATUS[s]}</span>;

export function EventsPanel() {
  const { role } = useSession();
  const c = useConsole();
  const now = useNow(10000);
  const events = useApi((s) => s.events);
  const zones = useApi((s) => s.zones);
  const order = { en_curso: 0, programado: 1, finalizado: 2 };
  const sorted = [...events].sort((a, b) => order[eventStatus(a, now)] - order[eventStatus(b, now)] || a.start - b.start);
  return (
    <>
      {role === 'admin' && events.length > 0 && <div className="fbar"><button className="fchip on" onClick={() => c.open({ k: 'evento-form' })}><Icon name="add" />Registrar evento</button></div>}
      {!events.length && <EmptyState icon="flag" title="Sin eventos registrados" action={role === 'admin' ? <button className="btn secondary sm" onClick={() => c.open({ k: 'evento-form' })}><Icon name="add" />Registrar evento</button> : undefined}>
        Un evento masivo agrupa zonas y les da umbrales propios mientras dure. {role === 'admin' ? 'Registralo antes de que empiece.' : 'Los registra el administrador.'}
      </EmptyState>}
      {events.length > 0 && !sorted.some((e) => eventStatus(e, now) === 'en_curso') && (() => {
        const next = sorted.find((e) => eventStatus(e, now) === 'programado');
        return <div className="es-inline neutral"><span className="es-ic" aria-hidden><Icon name="schedule" /></span><span><b>Ningún evento en curso.</b> {next ? `El próximo, ${next.name.split(' · ')[0]}, empieza ${inTime(next.start, now)}.` : 'No hay eventos programados.'}</span></div>;
      })()}
      <ul className="list pb flush">
        {sorted.map((e, i) => {
          const st = eventStatus(e, now);
          return (
            <li key={e.id}>
              <button className={`item ${c.sheet?.k === 'evento' && c.sheet.id === e.id ? 'sel' : ''} ${st === 'finalizado' ? 'done' : ''}`} style={{ gridTemplateColumns: '1fr auto', borderTop: i ? undefined : 0 }} onClick={() => c.open({ k: 'evento', id: e.id })}>
                <div>
                  <div className="t">{e.name}</div>
                  <div className="s">{dateShort(e.start)} · {hhmm(e.start)}–{hhmm(e.end)}{st === 'en_curso' ? ` · termina ${inTime(e.end, now)}` : st === 'programado' ? ` · empieza ${inTime(e.start, now)}` : ''} · {e.zoneIds.map((id) => zones.find((z) => z.id === id)?.name).join(', ')}</div>
                  <div className="s">{fmt(e.expected)} esperados · {fmt(e.plannedOfficers)} policías planificados{e.thresholds && ' · umbrales propios'}</div>
                </div>
                <div className="r"><EventTag s={st} /></div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
