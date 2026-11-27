/* Cambios de rol en vivo: cuando alguien guarda el rol de quien tiene la sesión, la consola lo aplica sin volver
   a entrar (ctx.tsx ya hace caer la pestaña o la ficha que no corresponde, y Console.tsx apaga las capas
   ocultas). Acá se avisa qué cambió, en una línea. */
import { useEffect, useRef } from 'react';
import type { AlertAction, LayerKey, RoleConfig } from '../api/types';
import { useToast } from '../ui/kit';
import { TAB_LABEL, type Perms } from './permissions';

const LAYER_NAME: Record<LayerKey, string> = {
  zones: 'Zonas', events: 'Eventos', alerts: 'Alertas', units: 'Unidades policiales', cameras: 'Cámaras', hex: 'Mapa de calor', drones: 'Drones', helis: 'Helicópteros',
};
const ACTION_NAME: Record<AlertAction, string> = {
  decidir: 'decidir alertas', despachar: 'enviar unidades', registrar: 'registrar incidentes', decidir_facial: 'decidir coincidencias faciales',
};
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
/** Cada cambio se avisa una vez, aunque el efecto corra de nuevo (modo estricto de React en desarrollo). */
let lastNotice = '';

/** Qué ganó y qué perdió el rol, en palabras. Vacío si no cambió nada visible. */
export function describeRoleChange(a: RoleConfig, b: RoleConfig): { lost: string[]; gained: string[] } {
  const lost: string[] = [], gained: string[] = [];
  const tabsOut = a.tabs.filter((t) => !b.tabs.includes(t)), tabsIn = b.tabs.filter((t) => !a.tabs.includes(t));
  if (tabsOut.length) lost.push(`la pestaña ${list(tabsOut.map((t) => TAB_LABEL[t]))}`);
  if (tabsIn.length) gained.push(`la pestaña ${list(tabsIn.map((t) => TAB_LABEL[t]))}`);
  if (!tabsOut.length && !tabsIn.length && a.tabs.join() !== b.tabs.join()) gained.push('un nuevo orden de pestañas');
  const keys = Object.keys(LAYER_NAME) as LayerKey[];
  const hid = keys.filter((k) => a.layers[k] !== 'oculta' && b.layers[k] === 'oculta');
  const shown = keys.filter((k) => a.layers[k] === 'oculta' && b.layers[k] !== 'oculta');
  if (hid.length) lost.push(list(hid.map((k) => LAYER_NAME[k])));
  if (shown.length) gained.push(list(shown.map((k) => LAYER_NAME[k])));
  const actOut = a.actions.filter((x) => !b.actions.includes(x)), actIn = b.actions.filter((x) => !a.actions.includes(x));
  if (actOut.length) lost.push(...actOut.map((x) => ACTION_NAME[x]));
  if (actIn.length) gained.push(...actIn.map((x) => ACTION_NAME[x]));
  if (a.jules && !b.jules) lost.push('Jules'); if (!a.jules && b.jules) gained.push('Jules');
  if (a.config && !b.config) lost.push('Configuración'); if (!a.config && b.config) gained.push('Configuración');
  if (a.alertScope !== b.alertScope || a.minSeverity !== b.minSeverity) gained.push('otro alcance de alertas');
  return { lost, gained };
}

export function useRoleChangeNotice(p: Perms) {
  const toast = useToast();
  const prev = useRef<RoleConfig | null>(p.cfg);
  useEffect(() => {
    const was = prev.current; prev.current = p.cfg;
    if (!was || !p.cfg || was.role !== p.cfg.role || was.version === p.cfg.version) return;
    const key = `${p.cfg.role}:${p.cfg.version}`;
    if (lastNotice === key) return;
    lastNotice = key;
    const { lost, gained } = describeRoleChange(was, p.cfg);
    if (lost.length) toast(`Tu rol cambió. Ya no tienes: ${lost.join(' · ')}.${gained.length ? ` Ahora tienes: ${gained.join(' · ')}.` : ''}`);
    else if (gained.length) toast(`Tu rol cambió. Ahora tienes: ${gained.join(' · ')}.`);
  }, [p.cfg?.version]); // eslint-disable-line react-hooks/exhaustive-deps
}
