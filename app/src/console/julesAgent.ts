/* Jules como agente (decisión del 26/11: "solo lo reversible").
   · Lo que se puede deshacer y no mueve a nadie en la calle, Jules lo hace solo y avisa:
     avisar a un supervisor, pedir que revisen una cámara. Cada acción queda en la bitácora a nombre
     de Jules y tiene "Deshacer".
   · Lo que mueve policías o identifica personas lo propone con su efecto y su costo, y lo hace solo
     si una persona lo aprueba (la plataforma asigna las unidades; el 911 decide sobre una cara).
   · Dice además qué está vigilando y qué va a hacer si cambia.
   En producción esto lo decide el agente en el backend; acá son reglas sobre los datos vivos. */
import { useSyncExternalStore } from 'react';
import { audit, forOperator, nearestFree, sendUnitsTo, sessionFor, snapshot, unitOptions } from '../api';
import { zoneCoverage } from '../api/coverage';
import { fmtCrowd, pct } from '../api/format';
import type { Role, User, Zone } from '../api/types';
import { overdueMin } from '../map/icons';
import { waitingSince } from '../views/shared';
import type { Sheet } from './ctx';

export type Tone = 'crit' | 'warn' | 'ok';
export interface Look { label: string; sheet?: Sheet; panel?: 'alertas' | 'estado' }
/** Algo que Jules propone y no hace sin aprobación. */
export interface Proposal {
  key: string; tone: Tone;
  /** De qué se trata (la zona). */ subject: string;
  /** Qué pasa (lo que Jules encontró). */ lead: string; leadDetail?: string;
  /** Qué propone, como pregunta ("¿Mando 2 patrullas? Llegan en 1 min."). */ ask: string;
  /** Rótulo del botón de aprobar. */ title: string; effect: string; cost?: string;
  /** Lo que dice Jules cuando ya lo hizo. */ doneText: string;
  look?: Look; approve: (by: User) => void;
}
/** Algo que Jules ya hizo solo. */
export interface Done { key: string; text: string; at: number; undone?: boolean; look?: Look }
export interface AgentBrief { tone: Tone; headline: string; detail?: string; proposals: Proposal[]; done: Done[]; watching: string[] }

/* ---------- Bitácora propia de Jules (lo que hizo, aprobado o deshecho) ---------- */
let log: Done[] = [];
/** Propuestas ya aprobadas o descartadas: no se vuelven a ofrecer. */
const settled = new Set<string>();
const subs = new Set<() => void>();
const emit = () => { log = [...log]; subs.forEach((f) => f()); };
export const useAgentLog = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => log);

const julesAs = (role: Role): User => ({ ...sessionFor(role).user, id: 'jules', name: 'Jules' });

/** Hace una acción reversible una sola vez (por clave) y la anota. */
function doOnce(key: string, text: string, role: Role, auditAction: string, object: string, look?: Look) {
  if (log.some((d) => d.key === key)) return;
  audit(julesAs(role), auditAction, object, text);
  log = [{ key, text, at: Date.now(), look }, ...log];
  emit();
}
export function undo(key: string, by: User) {
  const d = log.find((x) => x.key === key); if (!d || d.undone) return;
  audit(by, 'Deshacer acción de Jules', key, d.text);
  log = log.map((x) => (x.key === key ? { ...x, undone: true } : x));
  emit();
}
export function dismiss(key: string, by: User) {
  settled.add(key);
  audit(by, 'Descartar propuesta de Jules', key, '');
  emit();
}

/* ---------- Lectura del momento ---------- */
/** Personas que sumó una zona en los últimos 10 minutos (la tendencia guarda una muestra cada 2 min). */
function gained10(z: Zone) {
  const t = snapshot().zoneStatus[z.id]?.trend.filter((v): v is number => v != null) ?? [];
  return t.length > 5 ? t[t.length - 1] - t[t.length - 6] : 0;
}
const unitsTxt = (n: number) => `${n} ${n === 1 ? 'patrulla' : 'patrullas'}`;

/** Lo que Jules hace solo: reversible y sin mover a nadie. Se llama fuera del render (en un efecto). */
export function agentTick(role: Role) {
  const s = snapshot(), now = Date.now();
  const late = s.alerts.filter((a) => forOperator(a) && a.review === 'por_revisar' && overdueMin(a.severity, waitingSince(a), now) > 0);
  // Un solo aviso al supervisor por sesión, si hay 3 o más atrasadas (repetirlo cada rato sería ruido).
  if (late.length >= 3) doOnce('aviso-atrasadas', `Avisé al supervisor del 911 que hay ${late.length} alertas atrasadas.`, role, 'Avisar al supervisor', 'Supervisor 911', { label: 'Ver alertas', panel: 'alertas' });
  for (const c of s.cameras.filter((x) => x.status === 'caida')) doOnce(`soporte-${c.id}`, `Pedí a soporte técnico que revise la cámara ${c.id}${c.street ? ` (${c.street})` : ''}.`, role, 'Pedir revisión de cámara', c.id, { label: 'Ver cámara', sheet: { k: 'camara', id: c.id } });
}

/** Arma lo que Jules dice al entrar (sin efectos: se puede llamar en el render). */
export function runAgent(role: Role): AgentBrief {
  void role;
  const s = snapshot();
  const measured = s.zones.filter((z) => s.zoneStatus[z.id]?.count != null);
  const byOcc = [...measured].sort((a, b) => s.zoneStatus[b.id].occupancy! - s.zoneStatus[a.id].occupancy!);
  const top = byOcc[0];
  const occ = top ? s.zoneStatus[top.id].occupancy! : 0;
  const now = Date.now();
  const waiting = s.alerts.filter((a) => forOperator(a) && a.review === 'por_revisar');
  const late = waiting.filter((a) => overdueMin(a.severity, waitingSince(a), now) > 0);
  const uncovered = s.policeSource ? s.zones.filter((z) => zoneCoverage(z, s.units).state === 'sin_cobertura') : [];

  /* 2 · Lo que propone (mueve policías: necesita aprobación) */
  const proposals: Proposal[] = [];
  const reinforce = (z: Zone, n: number, why: string, tone: Tone, lead: string, leadDetail?: string) => {
    const key = `refuerzo-${z.id}`;
    if (settled.has(key) || !s.policeSource) return;
    const ids = nearestFree(z, n); if (!ids.length) return;
    const opts = unitOptions(z).filter((o) => ids.includes(o.unit.id));
    const eta = Math.max(...opts.map((o) => o.eta));
    const leave = [...new Set(opts.map((o) => o.unit.zoneId).filter((id): id is string => !!id && id !== z.id))].map((id) => s.zones.find((x) => x.id === id)?.name).filter(Boolean);
    const etaTxt = `${ids.length === 1 ? 'llega' : 'llegan'} en ${Math.max(1, Math.round(eta))} min`;
    proposals.push({
      key, tone, lead, leadDetail, subject: z.name,
      ask: `¿Mando ${unitsTxt(ids.length)}? ${ids.length === 1 ? 'La más cercana' : 'Las más cercanas'} ${etaTxt}.`,
      doneText: `Listo. ${ids.length === 1 ? 'Va' : 'Van'} ${unitsTxt(ids.length)} a ${z.name} (${ids.join(', ')}); ${etaTxt}.`,
      title: `Enviar ${unitsTxt(ids.length)}`,
      effect: `${why ? why + ' ' : ''}${ids.length === 1 ? 'Llega' : 'Llegan'} en ${Math.max(1, Math.round(eta))} min (${ids.join(', ')}).`,
      cost: leave.length ? `Dejan ${leave.join(' y ')} con menos presencia.` : undefined,
      look: { label: 'Ver zona', sheet: { k: 'zona', id: z.id } },
      approve: (by) => {
        sendUnitsTo(z, ids, by, `Envío a ${z.name} (propuesto por Jules)`);
        settled.add(key);
        log = [{ key: `hecho-${key}`, text: `Envié ${unitsTxt(ids.length)} a ${z.name}, con la aprobación de ${by.name}.`, at: Date.now(), look: { label: 'Ver zona', sheet: { k: 'zona', id: z.id } } }, ...log];
        emit();
      },
    });
  };
  if (top && occ >= 1) {
    const g = gained10(top);
    reinforce(top, 2, '', 'crit', `${top.name} está al ${pct(occ)} de su capacidad${g > 0 ? ' y se sigue llenando' : ''}.`,
      `Hay unas ${fmtCrowd(s.zoneStatus[top.id].count!)} personas${g > 0 ? `; sumó ${fmtCrowd(g)} en los últimos 10 minutos` : ''}.`);
  }
  for (const z of uncovered.slice(0, 1)) if (z.id !== top?.id) reinforce(z, 1, 'No tiene una patrulla a menos de 4 minutos.', 'warn', `${z.name} no tiene una patrulla a menos de 4 minutos.`);

  /* 3 · La lectura: una frase con lo más importante y hacia dónde va */
  let tone: Tone = 'ok', headline = 'La ciudad está tranquila.', detail: string | undefined;
  if (top && occ >= 1) {
    const g = gained10(top);
    tone = 'crit';
    headline = `${top.name} está al ${pct(occ)} de su capacidad${g > 0 ? ' y se sigue llenando' : ''}.`;
    detail = `Hay unas ${fmtCrowd(s.zoneStatus[top.id].count!)} personas${g > 0 ? `; sumó ${fmtCrowd(g)} en los últimos 10 minutos` : ''}.`;
  } else if (late.length) {
    tone = 'warn';
    headline = `${late.length} ${late.length === 1 ? 'alerta lleva' : 'alertas llevan'} más tiempo del previsto sin decisión.`;
  } else if (uncovered.length) {
    tone = 'warn';
    headline = `${uncovered[0].name} no tiene una patrulla cerca.`;
  } else if (top) {
    detail = `${top.name} es la zona con más gente: ${pct(occ)} de su capacidad.`;
  }

  /* 4 · Lo que vigila */
  const watching: string[] = [];
  if (top && occ >= 0.75) watching.push(`${top.name}: si pasa el ${pct(Math.max(1, Math.ceil((occ + 0.1) * 10) / 10))}, te propongo más refuerzos.`);
  if (waiting.length) watching.push(`Las ${waiting.length} alertas sin decisión: si alguna crítica se atrasa, aviso al supervisor.`);
  if (!watching.length) watching.push('Las zonas, las alertas y las cámaras: si algo cambia, te aviso aquí.');

  return { tone, headline, detail, proposals, done: log, watching };
}
