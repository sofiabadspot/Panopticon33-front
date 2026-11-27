/* Jules: respuestas a las preguntas del chat. Lo que Jules hace solo (reversible) y lo que propone
   para aprobar está en julesAgent.ts. Lo que mueve policías siempre lo aprueba una persona.
   Responde con los datos vivos de la consola y propone a dónde mirar (abrir una zona,
   una alerta, un panel). En producción la respuesta la da el agente en el backend
   (POST /v1/jules/ask); aquí es una respuesta por reglas sobre los mismos datos.
   Cada consulta queda en la bitácora. */
import { audit, forOperator, inScope, snapshot } from '../api';
import { fmt, fmtCrowd, normalizePlate, pct } from '../api/format';
import { KIND_LABEL } from '../api/labels';
import type { User } from '../api/types';
import type { Perms } from './permissions';
import { byUrgency } from '../views/shared';
import type { JulesMsg } from './ctx';

const has = (q: string, ...w: string[]) => w.some((x) => q.includes(x));

/** Responde dentro de los permisos del rol: solo cuenta las alertas de su alcance, no habla de la ubicación de
    unidades si esa capa le está oculta y solo ofrece ir a lo que puede abrir (ctx.tsx filtra las acciones). */
export function answerJules(raw: string, perms: Perms, user: User): JulesMsg {
  const s = snapshot();
  const q = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  audit(user, 'Consulta a Jules', 'Jules', raw.slice(0, 120));
  const measured = s.zones.filter((z) => s.zoneStatus[z.id]?.count != null);
  const pending = perms.seesAlerts ? s.alerts.filter((a) => forOperator(a) && a.review === 'por_revisar' && inScope(a, user)).sort(byUrgency) : [];

  // Placa
  const plate = raw.match(/[A-Za-z]{1,2}\s?\d{3}-?\d{3}/)?.[0];
  if (plate) {
    const np = normalizePlate(plate);
    const al = perms.seesAlerts ? s.alerts.find((a) => a.plate && normalizePlate(a.plate.listed) === np && inScope(a, user)) : undefined;
    if (al) return { from: 'jules', text: `${al.plate!.listed} está en la lista de robados (${al.plate!.vehicle.type} ${al.plate!.vehicle.make} ${al.plate!.vehicle.color.toLowerCase()}). Tiene la alerta ${al.id}, ${al.review === 'por_revisar' ? 'aún por revisar' : al.review}.`,
      actions: [{ label: `Abrir ${al.id}`, sheet: { k: 'alerta', id: al.id } }, ...(perms.has('investigar') ? [{ label: 'Reconstruir recorrido', panel: 'investigar' as const }] : [])] };
    return { from: 'jules', text: `No hay alertas para ${plate.toUpperCase()}. ${perms.has('investigar') ? 'Puedes buscar sus lecturas en Investigar; te pedirá un motivo.' : 'La búsqueda de lecturas la hace el analista.'}`,
      actions: perms.has('investigar') ? [{ label: 'Ir a Investigar', panel: 'investigar' }] : [] };
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
    if (perms.layer('units') === 'oculta') return { from: 'jules', text: 'La presencia policial no está entre lo que ve tu rol. Pídesela al administrador si la necesitas.' };
    if (!s.policeSource) return { from: 'jules', text: 'No hay acceso a la ubicación policial, así que no puedo medir la presencia. Puedo comparar con los policías planificados de cada evento.' };
    const worst = measured.filter((z) => s.zoneStatus[z.id].perOfficer != null).sort((a, b) => s.zoneStatus[b.id].perOfficer! - s.zoneStatus[a.id].perOfficer!)[0];
    if (!worst) return { from: 'jules', text: 'No hay zonas con presencia policial medida ahora.' };
    const st = s.zoneStatus[worst.id];
    return { from: 'jules', text: `La brecha más grande está en ${worst.name}: ${fmt(st.perOfficer!)} personas por policía (${st.officers} policías para unas ${fmtCrowd(st.count!)} personas). Recomiendo un refuerzo ahí: si quieres, te lo dejo propuesto arriba para que lo apruebes, o lo envías con «¿Quién llega?».`,
      datos: [{ valor: fmt(st.perOfficer!), etiqueta: 'Personas por policía' }, { valor: fmt(st.officers ?? 0), etiqueta: 'Policías' }],
      actions: [{ label: `Ver ${worst.name}`, sheet: { k: 'zona', id: worst.id } }] };
  }

  // Qué atender primero
  if (has(q, 'alerta', 'primero', 'urgente', 'atiendo', 'pendiente')) {
    if (!pending.length) return { from: 'jules', text: 'No hay alertas por revisar.' };
    const a = pending[0];
    return { from: 'jules', text: `Hay ${pending.length} alertas por revisar. La más urgente es ${KIND_LABEL[a.kind].toLowerCase()} (${a.id}): ${a.rule.measured}. ${perms.can('decidir') ? 'Confirmarla o descartarla es decisión tuya.' : 'Confirmarla o descartarla le toca a quien decide las alertas.'}`,
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
