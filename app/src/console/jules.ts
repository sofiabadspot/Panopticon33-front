/* Jules (fase 2): consulta y recomienda, nunca ejecuta. Humano en el circuito.
   Responde con los datos vivos de la consola y propone a dónde mirar (abrir una zona,
   una alerta, un panel). En producción la respuesta la da el agente en el backend
   (POST /v1/jules/ask); aquí es una respuesta por reglas sobre los mismos datos.
   Cada consulta queda en la bitácora. */
import { audit, forOperator, sessionFor, snapshot } from '../api';
import { zoneCoverage } from '../api/coverage';
import { fmt, fmtCrowd, normalizePlate, pct } from '../api/format';
import { KIND_LABEL } from '../api/labels';
import type { Role } from '../api/types';
import { byUrgency } from '../views/shared';
import type { JulesMsg } from './ctx';

const has = (q: string, ...w: string[]) => w.some((x) => q.includes(x));

export function answerJules(raw: string, role: Role): JulesMsg {
  const s = snapshot();
  const q = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  audit(sessionFor(role).user, 'Consulta a Jules', 'Jules', raw.slice(0, 120));
  const measured = s.zones.filter((z) => s.zoneStatus[z.id]?.count != null);
  const pending = s.alerts.filter((a) => forOperator(a) && a.review === 'por_revisar').sort(byUrgency);

  // Placa
  const plate = raw.match(/[A-Za-z]{1,2}\s?\d{3}-?\d{3}/)?.[0];
  if (plate) {
    const np = normalizePlate(plate);
    const al = s.alerts.find((a) => a.plate && normalizePlate(a.plate.listed) === np);
    if (al) return { from: 'jules', text: `${al.plate!.listed} está en la lista de robados (${al.plate!.vehicle.type} ${al.plate!.vehicle.make} ${al.plate!.vehicle.color.toLowerCase()}). Tiene la alerta ${al.id}, ${al.review === 'por_revisar' ? 'aún por revisar' : al.review}.`,
      actions: [{ label: `Abrir ${al.id}`, sheet: { k: 'alerta', id: al.id } }, ...(role === 'analyst' ? [{ label: 'Reconstruir recorrido', panel: 'investigar' as const }] : [])] };
    return { from: 'jules', text: `No hay alertas para ${plate.toUpperCase()}. ${role === 'analyst' ? 'Puedes buscar sus lecturas en Investigar; te pedirá un motivo.' : 'La búsqueda de lecturas la hace el analista.'}`,
      actions: role === 'analyst' ? [{ label: 'Ir a Investigar', panel: 'investigar' }] : [] };
  }

  // Zona por nombre
  const zone = s.zones.find((z) => q.includes(z.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(' ').slice(-2).join(' ')));
  if (zone) {
    const st = s.zoneStatus[zone.id];
    if (!st || st.count == null) return { from: 'jules', text: `${zone.name} está sin cobertura: no puedo decir cuánta gente hay. No significa que esté vacía.`, actions: [{ label: 'Abrir la zona', sheet: { k: 'zona', id: zone.id } }] };
    return { from: 'jules', text: `${zone.name}: unas ${fmtCrowd(st.count)} personas (entre ${fmtCrowd(st.low!)} y ${fmtCrowd(st.high!)}), ${pct(st.occupancy!)} de su capacidad${st.perOfficer != null ? `, ${fmt(st.perOfficer)} personas por policía` : ''}.`,
      datos: [{ valor: fmtCrowd(st.count), etiqueta: 'Personas' }, { valor: pct(st.occupancy!), etiqueta: 'De su capacidad' }, ...(st.perOfficer != null ? [{ valor: fmt(st.perOfficer), etiqueta: 'Personas por policía' }] : [])],
      actions: [{ label: 'Abrir la zona', sheet: { k: 'zona', id: zone.id } }] };
  }

  // Presencia policial / refuerzo
  if (has(q, 'polic', 'brecha', 'refuer', 'unidad')) {
    if (!s.policeSource) return { from: 'jules', text: 'No hay acceso a la ubicación policial, así que no puedo medir la presencia. Puedo comparar con los policías planificados de cada evento.' };
    const worst = measured.filter((z) => s.zoneStatus[z.id].perOfficer != null).sort((a, b) => s.zoneStatus[b.id].perOfficer! - s.zoneStatus[a.id].perOfficer!)[0];
    if (!worst) return { from: 'jules', text: 'No hay zonas con presencia policial medida ahora.' };
    const st = s.zoneStatus[worst.id];
    return { from: 'jules', text: `La brecha más grande está en ${worst.name}: ${fmt(st.perOfficer!)} personas por policía (${st.officers} policías para unas ${fmtCrowd(st.count!)} personas). Recomiendo evaluar un refuerzo ahí. El despliegue se ordena por Maic o por radio; yo no lo ejecuto.`,
      datos: [{ valor: fmt(st.perOfficer!), etiqueta: 'Personas por policía' }, { valor: fmt(st.officers ?? 0), etiqueta: 'Policías' }],
      actions: [{ label: `Ver ${worst.name}`, sheet: { k: 'zona', id: worst.id } }] };
  }

  // Qué atender primero
  if (has(q, 'alerta', 'primero', 'urgente', 'atiendo', 'pendiente')) {
    if (!pending.length) return { from: 'jules', text: 'No hay alertas por revisar.' };
    const a = pending[0];
    return { from: 'jules', text: `Hay ${pending.length} alertas por revisar. La más urgente es ${KIND_LABEL[a.kind].toLowerCase()} (${a.id}): ${a.rule.measured}. Confirmarla o descartarla es decisión del operador 911.`,
      actions: [{ label: `Abrir ${a.id}`, sheet: { k: 'alerta', id: a.id } }, { label: 'Ver la bandeja', panel: 'alertas' }] };
  }

  // Cámaras
  if (has(q, 'camara', 'caida', 'cobertura', 'preset')) {
    const bad = s.cameras.filter((c) => c.status !== 'operativa');
    return { from: 'jules', text: bad.length ? `${bad.length} cámaras no están operativas: ${bad.map((c) => `${c.id} (${c.status.replace(/_/g, ' ')})`).join(', ')}.` : 'Todas las cámaras están operativas.',
      actions: bad.slice(0, 2).map((c) => ({ label: `Ver ${c.id}`, sheet: { k: 'camara', id: c.id } })) };
  }

  // Dónde hay más gente
  if (has(q, 'gente', 'persona', 'aglomer', 'riesgo', 'estado', 'resumen', 'como esta')) {
    const top = [...measured].sort((a, b) => s.zoneStatus[b.id].occupancy! - s.zoneStatus[a.id].occupancy!)[0];
    const total = measured.reduce((n, z) => n + s.zoneStatus[z.id].count!, 0);
    const st = s.zoneStatus[top.id];
    return { from: 'jules', text: `Hay unas ${fmtCrowd(total)} personas en las zonas vigiladas. El punto de mayor riesgo es ${top.name}, al ${pct(st.occupancy!)} de su capacidad. ${pending.length} alertas esperan revisión del 911.`,
      datos: [{ valor: fmtCrowd(total), etiqueta: 'Personas en las zonas' }, { valor: pct(st.occupancy!), etiqueta: `Capacidad de ${top.name}` }, { valor: fmt(pending.length), etiqueta: 'Alertas por revisar' }],
      actions: [{ label: `Ver ${top.name}`, sheet: { k: 'zona', id: top.id } }] };
  }

  return { from: 'jules', text: 'Puedo responder sobre el estado de las zonas, la presencia policial, las alertas por revisar, las cámaras o una placa. Por ejemplo: "¿dónde hay más gente?", "¿dónde falta policía?" o "P 512-884".' };
}

export const JULES_SUGGESTIONS = ['¿Dónde hay más gente?', '¿Dónde falta policía?', '¿Qué alerta atiendo primero?', '¿Qué cámaras fallan?'];

/* Resumen del momento para el mando (lo que Jules dice al saludar). Se arma con los datos vivos.
   Cada punto lleva un tono (crítico, atención, ok) y, si corresponde, a dónde mirar. */
export interface BriefPoint { text: string; tone: 'crit' | 'warn' | 'ok'; action?: { label: string; sheet?: JulesMsg['actions'] extends (infer A)[] | undefined ? A extends { sheet?: infer S } ? S : never : never; panel?: 'alertas' | 'estado' } }
export function julesBriefing(role: Role): { lead: string; points: BriefPoint[] } {
  void role;
  const s = snapshot();
  const measured = s.zones.filter((z) => s.zoneStatus[z.id]?.count != null);
  const total = measured.reduce((n, z) => n + s.zoneStatus[z.id].count!, 0);
  const pending = s.alerts.filter((a) => forOperator(a) && a.review === 'por_revisar').sort(byUrgency);
  const top = [...measured].sort((a, b) => s.zoneStatus[b.id].occupancy! - s.zoneStatus[a.id].occupancy!)[0];
  const uncovered = s.policeSource ? s.zones.filter((z) => zoneCoverage(z, s.units).state === 'sin_cobertura') : [];
  const down = s.cameras.filter((c) => c.status === 'caida');
  const points: BriefPoint[] = [];
  if (top) { const occ = s.zoneStatus[top.id].occupancy!; points.push({ text: `${top.name} está al ${pct(occ)} de su capacidad.`, tone: occ >= 1 ? 'crit' : occ >= 0.75 ? 'warn' : 'ok', action: { label: 'Ver zona', sheet: { k: 'zona', id: top.id } } }); }
  points.push(pending.length ? { text: `${pending.length} ${pending.length === 1 ? 'alerta espera' : 'alertas esperan'} la decisión del operador 911. La más urgente: ${KIND_LABEL[pending[0].kind].toLowerCase()}.`, tone: 'warn', action: { label: 'Ver alertas', panel: 'alertas' } } : { text: 'No hay alertas esperando decisión.', tone: 'ok' });
  if (s.policeSource) points.push(uncovered.length ? { text: `${uncovered.length === 1 ? `${uncovered[0].name} no tiene` : `${uncovered.length} zonas no tienen`} una patrulla a menos de 4 minutos.`, tone: 'crit', action: { label: 'Ver zona', sheet: { k: 'zona', id: uncovered[0].id } } } : { text: 'Todas las zonas tienen presencia policial o una patrulla cerca.', tone: 'ok' });
  if (down.length) points.push({ text: `${down.length === 1 ? `La cámara ${down[0].id} está` : `${down.length} cámaras están`} sin video.`, tone: 'warn', action: { label: 'Ver cámara', sheet: { k: 'camara', id: down[0].id } } });
  return { lead: `Hay unas ${fmtCrowd(total)} personas en las zonas vigiladas. Esto es lo que hay que mirar ahora:`, points };
}
