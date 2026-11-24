/* Columna izquierda del administrador y del auditor: navegación y filtros.
   La tabla o el formulario se abre a la derecha, con el mapa siempre visible. */
import { isListStale, useApi } from '../../api';
import { useNow } from '../../ui/kit';
import { Icon } from '../../ui/kit';
import { useConsole } from '../ctx';
import { TABS } from '../sheets/configSections';

export function ConfigNav() {
  const c = useConsole();
  const now = useNow(10000);
  const cameras = useApi((s) => s.cameras);
  const lists = useApi((s) => s.lists);
  const rules = useApi((s) => s.rules);
  const zones = useApi((s) => s.zones);
  const users = useApi((s) => s.users);
  const policeSource = useApi((s) => s.policeSource);
  const current = c.sheet?.k === 'config' ? c.sheet.tab ?? 'camaras' : null;
  const info: Record<string, [string, 'media' | 'ok' | '']> = {
    camaras: [`${cameras.filter((x) => x.status === 'operativa').length} de ${cameras.length} operativas`, cameras.some((x) => x.status !== 'operativa') ? 'media' : 'ok'],
    zonas: [`${zones.length} zonas dibujadas`, ''],
    reglas: [`${rules.filter((r) => r.source === 'supuesto').length} umbrales por confirmar`, rules.some((r) => r.source === 'supuesto') ? 'media' : 'ok'],
    listas: [lists.some((l) => isListStale(l, now)) ? 'Lista desactualizada' : 'Al día', lists.some((l) => isListStale(l, now)) ? 'media' : 'ok'],
    ubicacion: [policeSource ? 'Conectada' : 'Sin acceso', policeSource ? 'ok' : ''],
    usuarios: [`${users.filter((u) => u.active).length} usuarios activos`, ''],
  };
  return (
    <ul className="list pb flush">
      {TABS.map(([k, label, icon]) => (
        <li key={k}>
          <button className={`item ${current === k ? 'sel' : ''}`} onClick={() => c.open({ k: 'config', tab: k })}>
            <span className="ic"><Icon name={icon} /></span>
            <div><div className="t">{label}</div><div className="s">{info[k][0]}</div></div>
            <div className="r">{info[k][1] === 'media' && <span className="sev media" aria-label="Requiere atención" />}{info[k][1] === 'ok' && <span className="dot" aria-label="Bien" />}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AuditNav() {
  const c = useConsole();
  const entries = useApi((s) => s.audit);
  const current = c.sheet?.k === 'bitacora' ? c.sheet.tab ?? '' : null;
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
  const actions = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="sect">Filtrar por acción</div>
      <ul className="list pb flush">
        <li><button className={`item ${current === '' ? 'sel' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'bitacora' })}><span className="t">Todo el registro</span><span className="r mono">{entries.length}</span></button></li>
        {actions.map(([a, n]) => (
          <li key={a}><button className={`item ${current === a ? 'sel' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'bitacora', tab: a })}><span className="t">{a}</span><span className="r mono">{n}</span></button></li>
        ))}
      </ul>
      <div className="lfoot">Solo lectura: nadie puede editar ni borrar el registro.</div>
    </>
  );
}
