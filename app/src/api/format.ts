const TZ = 'America/El_Salvador';
const nf = new Intl.NumberFormat('es-SV');

export const fmt = (n: number) => nf.format(Math.round(n));

/** Multitudes grandes: redondeo legible (regla del caso 1). 78 412 → "78 000". */
export function roundCrowd(n: number) {
  const step = n >= 100000 ? 10000 : n >= 10000 ? 1000 : n >= 1000 ? 100 : n >= 100 ? 10 : 1;
  return Math.round(n / step) * step;
}
export const fmtCrowd = (n: number) => fmt(roundCrowd(n));

export const hhmm = (t: number) => new Date(t).toLocaleTimeString('es-SV', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' });
export const hhmmss = (t: number) => new Date(t).toLocaleTimeString('es-SV', { timeZone: TZ, hour12: false });
export const dateTime = (t: number) =>
  new Date(t).toLocaleString('es-SV', { timeZone: TZ, hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const dateShort = (t: number) => new Date(t).toLocaleDateString('es-SV', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });

/** Cuánto falta para `t`: "en 45 min", "en 4 h 20 min", "en 7 d". */
export function inTime(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((t - now) / 60000));
  if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 48) return `en ${Math.round(h / 24)} días`;
  return r ? `en ${h} h ${r} min` : `en ${h} h`;
}
export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

export const pct = (x: number) => (x > 0 && x < 0.005 ? '< 1 %' : `${Math.round(x * 100)} %`);
const nf1 = new Intl.NumberFormat('es-SV', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Un decimal con la convención de El Salvador (punto decimal), igual que los miles. */
export const dec1 = (n: number) => nf1.format(n);

/** Placas: mayúsculas, sin espacios ni guiones (regla del caso 2). */
export const normalizePlate = (p: string) => p.toUpperCase().replace(/[\s-]/g, '');

/** Valor de input datetime-local en hora de El Salvador (UTC−6, sin horario de verano). */
export const toLocalInput = (t: number) => new Date(t - 6 * 3600e3).toISOString().slice(0, 16);
export const fromLocalInput = (v: string) => new Date(v + ':00-06:00').getTime();

/** Fechas de una investigación (puede abarcar horas, días o años): un solo criterio para la lista, el
    reproductor, el mapa y las tarjetas.
    · Todo hoy: solo la hora («08:07»).
    · Varios días, o un día que no es hoy: fecha y hora («27 nov · 08:07»).
    · Varios años: con el año («27 nov 2024 · 08:07»). */
export function spanWhen(times: number[]) {
  const key = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
  const days = new Set(times.map(key)), years = new Set([...days].map((d) => d.slice(0, 4)));
  const withYear = years.size > 1 || (years.size === 1 && ![...years][0].startsWith(key(Date.now()).slice(0, 4)));
  const withDate = days.size > 1 || (days.size === 1 && !days.has(key(Date.now())));
  const day = (t: number) => new Date(t).toLocaleDateString('es-SV', { timeZone: TZ, day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).replace('.', '');
  return { withDate, dayKey: key, day, at: (t: number) => (withDate ? `${day(t)} · ${hhmm(t)}` : hhmm(t)) };
}
/** Un lapso legible: «45 min», «3 h», «12 d», «2 años». */
export function lapse(min: number) {
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  if (min < 365 * 24 * 60) return `${Math.round(min / 1440)} d`;
  const y = Math.round(min / 525600); return `${y} ${y === 1 ? 'año' : 'años'}`;
}
