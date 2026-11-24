/* Bitácora de auditoría — auditor. Ficha ancha sobre el mapa.
   "¿Quién vio, consultó o decidió qué?" Registro completo, sin edición posible,
   filtrable por usuario, acción, objeto y fecha. */
import { useEffect, useMemo, useState } from 'react';
import { audit as log, useApi } from '../../api';
import { dateTime, fromLocalInput, toLocalInput } from '../../api/format';
import { ROLE_LABEL } from '../../api/labels';
import { useSession } from '../../shell/session';
import { Icon, download } from '../../ui/kit';
import { useConsole, type Sheet } from '../ctx';
import { SheetHead } from './SheetHead';

const PAGE = 50;
let logged = false;

export function AuditSheet({ action = '' }: { action?: string }) {
  const { user } = useSession();
  const c = useConsole();
  const target = (o: string): Sheet | null => o.startsWith('AL-') ? { k: 'alerta', id: o } : /^Z-\d/.test(o) ? { k: 'zona', id: o } : o.startsWith('EV-') ? { k: 'evento', id: o } : /^SM-/.test(o) ? { k: 'camara', id: o } : null;
  const entries = useApi((s) => s.audit);
  const [f, setF] = useState({ user: '', action, object: '', from: toLocalInput(Date.now() - 2 * 24 * 3600e3), to: toLocalInput(Date.now() + 3600e3) });
  const [page, setPage] = useState(0);
  useEffect(() => { setF((x) => ({ ...x, action })); setPage(0); }, [action]);
  useEffect(() => { if (!logged) { logged = true; log(user, 'Consultar bitácora', 'Bitácora', 'Apertura de la vista'); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const usersList = useMemo(() => [...new Set(entries.map((e) => e.user))].sort(), [entries]);
  const actions = useMemo(() => [...new Set(entries.map((e) => e.action))].sort(), [entries]);
  const from = fromLocalInput(f.from), to = fromLocalInput(f.to);
  const rows = entries.filter((e) => (!f.user || e.user === f.user) && (!f.action || e.action === f.action)
    && (!f.object || e.object.toLowerCase().includes(f.object.toLowerCase())) && e.at >= from && e.at <= to);
  const shown = rows.slice(page * PAGE, (page + 1) * PAGE);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(0); };

  const exportCsv = () => {
    const csv = ['id,fecha_hora,usuario,rol,accion,objeto,detalle,motivo', ...rows.map((e) => [e.id, new Date(e.at).toISOString(), e.user, e.role, e.action, e.object, `"${e.detail}"`, `"${e.reason ?? ''}"`].join(','))].join('\n');
    download('bitacora.csv', csv);
    log(user, 'Exportar bitácora', 'Bitácora', `${rows.length} registros`);
  };

  return (
    <>
      <SheetHead kicker="Solo lectura · nadie puede editarla ni borrarla" title="Bitácora de auditoría" aside={<button className="btn secondary xs" onClick={exportCsv}><Icon name="download" />Exportar</button>} />
      <div className="pb">
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="bd" style={{ paddingTop: 14 }}>
          <div className="form-row">
            <div className="field"><label htmlFor="au">Usuario</label><select id="au" className="fld sm" value={f.user} onChange={set('user')}><option value="">Todos</option>{usersList.map((u) => <option key={u}>{u}</option>)}</select></div>
            <div className="field"><label htmlFor="aa">Acción</label><select id="aa" className="fld sm" value={f.action} onChange={set('action')}><option value="">Todas</option>{actions.map((a) => <option key={a}>{a}</option>)}</select></div>
            <div className="field"><label htmlFor="ao">Objeto</label><input id="ao" className="fld sm" value={f.object} onChange={set('object')} placeholder="AL-4107, P512884, Z-01…" /></div>
            <div className="field"><label htmlFor="af">Desde</label><input id="af" type="datetime-local" className="fld sm" value={f.from} onChange={set('from')} /></div>
            <div className="field"><label htmlFor="at">Hasta</label><input id="at" type="datetime-local" className="fld sm" value={f.to} onChange={set('to')} /></div>
          </div>
        </div>
      </div>
      <div className="panel flush tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Objeto</th><th>Detalle</th><th>Motivo</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="empty">Ningún registro con estos filtros.</td></tr>}
            {shown.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                <td>{e.user}</td>
                <td className="dim">{ROLE_LABEL[e.role]}</td>
                <td>{e.action}</td>
                <td className="mono">{target(e.object) ? <button className="linklike" onClick={() => c.open(target(e.object)!)}>{e.object}</button> : e.object}</td>
                <td className="muted">{e.detail}</td>
                <td>{e.reason ?? <span className="dim">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 'var(--fs-sm)', color: 'var(--ink-subtle)' }}>
        <span>{rows.length} registros</span>
        {rows.length > PAGE && <>
          <button className="btn ghost xs" style={{ marginLeft: 'auto' }} disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevron_left" />Anteriores</button>
          <span className="mono">{page + 1} / {Math.ceil(rows.length / PAGE)}</span>
          <button className="btn ghost xs" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Siguientes<Icon name="chevron_right" /></button>
        </>}
      </div>
      </div>
    </>
  );
}
