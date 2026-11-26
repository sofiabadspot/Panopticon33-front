/* Configuración · Acceso: quién ve qué. Primero se definen los roles (arquetipos: qué capas del mapa
   ve cada uno y desde qué criticidad le llegan las alertas); después cada usuario hereda la de su rol.
   Altas, contraseñas y el rol de cada persona se gestionan en Keycloak. */
import {
  setUserActive, updateRoleConfig, useApi,
} from '../../api';
import { ROLE_LABEL, SEVERITY_LABEL } from '../../api/labels';
import type { LayerAccess, LayerKey, Role, Severity } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon, useToast } from '../../ui/kit';
import { useConsole } from '../ctx';
import { SectionHead } from './configPlace';

const ROLES: Role[] = ['command', 'operator_911', 'analyst', 'admin'];
const ROLE_HELP: Record<Role, string> = {
  command: 'Mando y ministro', operator_911: 'Decide las alertas', analyst: 'Investiga', admin: 'Configura',
};
const LAYERS: [LayerKey, string, string?][] = [
  ['alerts', 'Alertas'], ['events', 'Eventos'], ['zones', 'Zonas'], ['units', 'Unidades policiales', 'La ubicación de cada agente: no todos los roles deberían verla'],
  ['cameras', 'Cámaras'], ['hex', 'Mapa de calor'], ['drones', 'Drones'], ['helis', 'Helicópteros'],
];
const ACCESS: [LayerAccess, string][] = [['inicio', 'Al entrar'], ['disponible', 'Disponible'], ['oculta', 'Oculta']];

export function RolesSection() {
  const { user } = useSession();
  const toast = useToast();
  const configs = useApi((s) => s.roleConfigs);
  const cfg = (r: Role) => configs.find((x) => x.role === r)!;
  const save = (r: Role, patch: Parameters<typeof updateRoleConfig>[1], what: string) => { updateRoleConfig(r, patch, user); toast(`${ROLE_LABEL[r]}: ${what}`); };
  return (
    <>
      <SectionHead group="Acceso" icon="shield" title="Roles" sub="Qué ve cada rol en el mapa y desde qué criticidad le llegan las alertas. Cada usuario hereda lo de su rol." />
      <div className="pb">
        <div className="callout warn"><Icon name="warning" /><span className="grow"><b>Propuesta a validar con el cliente.</b> Los cambios se aplican la próxima vez que cada persona abre la consola.</span></div>
        <div className="panel flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Capa del mapa</th>{ROLES.map((r) => <th key={r}>{ROLE_LABEL[r]}<div className="dim" style={{ fontSize: 'var(--fs-2xs)', textTransform: 'none', letterSpacing: 0 }}>{ROLE_HELP[r]}</div></th>)}</tr></thead>
            <tbody>
              {LAYERS.map(([k, label, help]) => (
                <tr key={k}>
                  <td>{label}{help && <div className="dim" style={{ fontSize: 'var(--fs-xs)' }}>{help}</div>}</td>
                  {ROLES.map((r) => (
                    <td key={r}>
                      <select className="fld sm" aria-label={`${label} · ${ROLE_LABEL[r]}`} value={cfg(r).layers[k]}
                        onChange={(e) => save(r, { layers: { ...cfg(r).layers, [k]: e.target.value as LayerAccess } }, `${label.toLowerCase()} ${ACCESS.find(([a]) => a === e.target.value)![1].toLowerCase()}`)}>
                        {ACCESS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td>Desde qué criticidad<div className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Por definir con el cliente: ¿el ministro ve todas o solo las críticas?</div></td>
                {ROLES.map((r) => (
                  <td key={r}>
                    <select className="fld sm" aria-label={`Criticidad mínima · ${ROLE_LABEL[r]}`} value={cfg(r).minSeverity ?? ''}
                      onChange={(e) => save(r, { minSeverity: (e.target.value || null) as Severity | null }, e.target.value ? `solo alertas ${SEVERITY_LABEL[e.target.value as Severity].toLowerCase()} o más graves` : 'todas las criticidades')}>
                      <option value="">Todas</option><option value="media">Media o más</option><option value="critica">Solo críticas</option>
                    </select>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <dl className="details" style={{ maxWidth: 640, fontSize: 'var(--fs-sm)' }}>
          <dt>Al entrar</dt><dd>La capa está prendida cuando la persona abre la consola.</dd>
          <dt>Disponible</dt><dd>Aparece en la franja de capas, apagada. La persona la prende si la necesita.</dd>
          <dt>Oculta</dt><dd>El rol no la ve ni la puede prender.</dd>
        </dl>
      </div>
    </>
  );
}

export function UsersSection() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const users = useApi((s) => s.users);
  return (
    <>
      <SectionHead group="Acceso" icon="person" title="Usuarios" sub="Quién tiene acceso a la consola. Lo que ve cada persona lo define su rol." />
      <div className="pb">
        <div className="panel flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Acceso</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.id === user.id && <span className="dim"> (tú)</span>}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td><label className="toggle"><input type="checkbox" checked={u.active} disabled={u.id === user.id} onChange={(e) => { setUserActive(u.id, e.target.checked, user); toast(`${u.name}: ${e.target.checked ? 'puede entrar' : 'ya no puede entrar'}`); }} /><span className="sr">Acceso</span></label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="callout"><Icon name="info" /><span className="grow">Para dar de alta a una persona, cambiar su contraseña o su rol, usa Keycloak. Lo que ve cada rol se define en <button className="linklike" onClick={() => c.open({ k: 'config', tab: 'roles' })}>Roles</button>.</span></div>
      </div>
    </>
  );
}
