/* Permisos: qué ve y qué hace quien tiene la sesión, leído de la configuración de su rol
   (Configuración → Roles). Ningún componente pregunta por el nombre del rol: pregunta acá.
   En producción sale de GET /v1/me/permissions y se vuelve a pedir con el evento roles.updated;
   el backend hace cumplir lo mismo (filtra alertas y rechaza acciones con 403). */
import { useApi } from '../api';
import type { AlertAction, LayerAccess, LayerKey, Role, RoleConfig, TabId } from '../api/types';
import { useSession } from '../shell/session';

/** Las pestañas que se pueden dar a un rol, con su nombre. Bitácora queda fuera mientras no haya rol Auditor. */
export const TAB_LABEL: Record<TabId, string> = { estado: 'Estado', alertas: 'Alertas', investigar: 'Investigaciones', verificacion: 'Personas' };
export const TAB_ICON: Record<TabId, string> = { estado: 'analytics', alertas: 'notifications', investigar: 'timeline', verificacion: 'person_search' };
export const ALL_TABS = Object.keys(TAB_LABEL) as TabId[];

export interface Perms {
  role: Role;
  /** null: el rol no existe en la plataforma (no tiene acceso configurado). */
  cfg: RoleConfig | null;
  tabs: TabId[];
  /** Con qué abre la consola: la primera pestaña, o Configuración si no tiene pestañas. */
  home: TabId | 'config' | null;
  config: boolean;
  jules: boolean;
  has: (t: TabId) => boolean;
  can: (a: AlertAction) => boolean;
  layer: (k: LayerKey) => LayerAccess;
  /** Ve alertas: por la pestaña o por la capa del mapa. */
  seesAlerts: boolean;
}

export function permsOf(role: Role, cfg: RoleConfig | null | undefined): Perms {
  const c = cfg ?? null;
  const tabs = c?.tabs ?? [];
  return {
    role, cfg: c, tabs,
    home: tabs[0] ?? (c?.config ? 'config' : null),
    config: !!c?.config,
    jules: !!c?.jules,
    has: (t) => tabs.includes(t),
    can: (a) => !!c?.actions.includes(a),
    layer: (k) => c?.layers[k] ?? 'oculta',
    seesAlerts: !!c && (tabs.includes('alertas') || c.layers.alerts !== 'oculta'),
  };
}

/** Permisos de la sesión. Se actualiza solo cuando alguien cambia el rol. */
export function usePermissions(): Perms {
  const { role } = useSession();
  const cfg = useApi((s) => s.roleConfigs.find((r) => r.role === role));
  return permsOf(role, cfg);
}
