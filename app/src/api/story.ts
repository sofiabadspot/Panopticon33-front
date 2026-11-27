/* Lógica pura de la «Historia del analista»: de lecturas, antecedentes y notas a capítulos.
   Solo `import type`: corre tal cual bajo `node --test`. */
import type { Evidence, StoryChapter } from './types';

export const GROUP_MS = 120_000;
export const ENCOUNTER_MS = 90_000;
export const CHAPTER_MS = 4_000;

export interface Sight { at: number; cameraId: string; place: string; lat: number; lon: number; confidence: number; evidence: Evidence }
export interface Prior { at: number; label: string; src: string; camera?: { id: string; lat: number; lon: number; place: string } }
export interface Other { label: string; sights: { at: number; cameraId: string }[] }

interface Opts {
  alertAt?: { at: number; alertId: string };
  others?: Other[];
  keyOverrides?: Record<string, boolean>;
  window?: { from: number; to: number };
}

// Misma aproximación que `metersBetween` en api/index.ts (copiada: este módulo no importa código).
const metersBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 111320);
};

const rank = (s: StoryChapter['source']) => (s === 'analista' ? 1 : 0);

export function buildChapters(sights: Sight[], priors: Prior[], added: StoryChapter[], opts: Opts): StoryChapter[] {
  const w = opts.window;
  const reads = sights.filter((s) => !w || (s.at >= w.from && s.at <= w.to)).sort((a, b) => a.at - b.at);

  const out: StoryChapter[] = [];
  let lastRead = 0;
  reads.forEach((s, i) => {
    const prev = out[out.length - 1];
    if (prev && prev.source === 'sistema' && prev.cameraId === s.cameraId && s.at - lastRead < GROUP_MS) {
      prev.reads += 1;
      prev.evidence.push(s.evidence);
      prev.confidence = Math.max(prev.confidence ?? 0, s.confidence);
    } else {
      out.push({
        id: `sistema-${s.at}-${s.cameraId ?? i}`, at: s.at, lat: s.lat, lon: s.lon, place: s.place, cameraId: s.cameraId,
        confidence: s.confidence, reads: 1, evidence: [s.evidence], source: 'sistema',
      });
    }
    lastRead = s.at;
  });

  const system = out.slice();
  priors.forEach((p, i) => {
    const host = p.camera && system.find((c) => c.cameraId === p.camera!.id && Math.abs(c.at - p.at) < GROUP_MS);
    if (host) { host.note = p.label; return; }
    out.push({
      id: `antecedente-${p.at}-${p.camera?.id ?? i}`, at: p.at,
      lat: p.camera ? p.camera.lat : null, lon: p.camera ? p.camera.lon : null,
      place: p.camera ? p.camera.place : p.label, cameraId: p.camera?.id,
      reads: 0, evidence: [], source: 'antecedente', srcLabel: p.src, note: p.label,
    });
  });
  for (const c of added) out.push({ ...c });

  // Orden estable por hora; en empate, sistema/antecedente antes que analista.
  const ordered = out.map((c, i) => ({ c, i })).sort((a, b) => a.c.at - b.c.at || rank(a.c.source) - rank(b.c.source) || a.i - b.i).map((x) => x.c);

  // Momentos clave. Prioridad: alerta > primera/última > encuentro. De cada otro sujeto, solo el primer encuentro.
  const seen = ordered.filter((c) => c.source === 'sistema');
  const mark = (c: StoryChapter, label: string) => { c.key = true; c.keyLabel = label; };
  if (seen.length) {
    mark(seen[0], 'Primera detección');
    if (seen.length > 1) mark(seen[seen.length - 1], 'Última vez visto');
  }
  if (opts.alertAt && ordered.length) {
    const near = ordered.reduce((best, c) => (Math.abs(c.at - opts.alertAt!.at) < Math.abs(best.at - opts.alertAt!.at) ? c : best));
    mark(near, 'Se generó ' + opts.alertAt.alertId);
    near.alertId = opts.alertAt.alertId;
  }
  // Encuentros: si el capítulo ya tiene otra etiqueta (alerta, primera/última), se le suma « · con X».
  for (const o of opts.others ?? []) {
    const c = ordered.find((c) => c.cameraId && o.sights.some((s) => s.cameraId === c.cameraId && Math.abs(s.at - c.at) < ENCOUNTER_MS));
    if (!c) continue;
    if (c.key && c.keyLabel) c.keyLabel += ' · con ' + o.label;
    else mark(c, 'Encuentro con ' + o.label);
  }
  for (const c of ordered) {
    const o = opts.keyOverrides?.[c.id];
    if (o === false) { c.key = false; delete c.keyLabel; }
    else if (o === true) c.key = true;
  }
  return ordered;
}

/** Las paradas del recorrido: solo lo que tiene posición. */
export function routeStops(chs: StoryChapter[]): StoryChapter[] {
  return chs.filter((c) => c.lat !== null && c.lon !== null);
}

/** Tiempo desde la detección anterior con posición; `impossible` si exigiría más de 90 km/h.
   Solo entre detecciones del sistema: lo que agrega el analista y los antecedentes no cuentan (ni dan ni reciben hueco). */
export function gapBefore(chs: StoryChapter[], i: number): { min: number; impossible: boolean } | null {
  const c = chs[i];
  if (!c || c.source !== 'sistema' || c.lat === null || c.lon === null) return null;
  let p: StoryChapter | undefined;
  for (let j = i - 1; j >= 0; j--) if (chs[j].source === 'sistema' && chs[j].lat !== null) { p = chs[j]; break; }
  if (!p) return null;
  const dt = c.at - p.at;
  const km = metersBetween({ lat: c.lat, lon: c.lon }, { lat: p.lat!, lon: p.lon! }) / 1000;
  const impossible = dt <= 0 ? km > 0 : km / (dt / 3_600_000) > 90;
  return { min: Math.round(dt / 60_000), impossible };
}

/** Qué parada del recorrido corresponde al capítulo `at` (índice en `chs`, antecedentes incluidos): la suya
    si tiene posición; si no, la última con posición antes de él; si no hay ninguna antes, la primera.
    null si no hay paradas. */
export function routeStopAt(chs: StoryChapter[], at: number): number | null {
  let k = -1, cur = -1;
  chs.forEach((c, i) => { if (c.lat !== null && c.lon !== null) { k++; if (i <= at) cur = k; } });
  if (k < 0) return null;
  return Math.max(cur, 0);
}
