/* Evidencias del expediente facial: de dónde salen (cardsOf: una por cada respaldo, con los vínculos
   que respalda, en orden de fecha) y cómo se dibuja cada material sin imágenes ficticias (Artifact). */
import { dateShort, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, type FacialMatch, type Proof } from '../../api/facial';
import { Icon } from '../../ui/kit';

type Art = 'captura' | 'video' | 'documento' | 'registro' | 'retrato';
export interface Card { key: string; group: string; art: Art; src: string; title: string; at: number; links: string[]; facts?: [string, string][]; score?: number }

const isCam = (src: string) => /^(CAM-|SM-|SPOTBOX|SpotBox)/.test(src);
const artOf = (p: Proof): Art => (p.kind === 'video' ? 'video' : p.kind === 'documento' ? 'documento' : p.kind === 'registro' ? 'registro' : isCam(p.src) ? 'captura' : 'retrato');

/** Todas las evidencias de la persona, una vez cada una. `group` es el vínculo al que pertenece (donde
    se muestra); `links`, todos los vínculos que respalda. Primero los vínculos y después la identidad,
    así la orden de captura queda en su caso y en Identidad solo lo propio (ficha, DUI). */
export function cardsOf(m: FacialMatch): Card[] {
  const out = new Map<string, Card>();
  const add = (p: Proof, link: string, facts?: [string, string][]) => {
    const key = `${p.kind}|${p.title}|${p.src}|${p.at}`;
    const c = out.get(key);
    if (c) { if (!c.links.includes(link)) c.links.push(link); return; }
    out.set(key, { key, group: link, art: artOf(p), src: p.src, title: p.title, at: p.at, links: [link], facts: p.kind === 'registro' ? facts : undefined });
  };
  m.links.forEach((l) => l.proofs.forEach((p) => add(p, l.id, l.facts)));
  m.docs.forEach((p) => add(p, 'identidad', [['Persona', m.name], ['Documento', m.docId], ['Lista', `${FACIAL_LISTS[m.list].name} · ${m.listRef}`]]));
  const today = m.detections.map((d, i): Card => ({ key: `det${i}`, group: 'hoy', art: 'captura', src: d.cameraId, title: d.place, at: d.at, links: ['hoy'], score: d.score }));
  // En orden de fecha, de lo más viejo a lo más nuevo: así se lee la historia de cada vínculo.
  return [...today, ...[...out.values()].sort((a, b) => a.at - b.at)];
}

/** El material dibujado según su tipo (sin imágenes ficticias). */
export function Artifact({ c }: { c: Card }) {
  if (c.art === 'captura' || c.art === 'video') return (
    <span className={`art cam ${c.art}`}>
      <span className="art-rec mono"><i />{c.src}</span>
      <span className="art-ts mono">{dateShort(c.at)} · {hhmm(c.at)}</span>
      {c.score != null && <span className="art-score mono">{pct(c.score)}</span>}
      <span className="art-fig" aria-hidden><Icon name="person" /></span>
      {c.art === 'video' && <><span className="art-play" aria-hidden><Icon name="play_arrow" /></span><span className="art-bar" aria-hidden><i /></span></>}
      <i className="art-c tl" /><i className="art-c tr" /><i className="art-c bl" /><i className="art-c br" />
    </span>
  );
  if (c.art === 'documento') return (
    <span className="art doc">
      <span className="doc-hd"><b>{c.src}</b><span className="mono">{dateShort(c.at)}</span></span>
      <span className="doc-t">{c.title}</span>
      {[92, 100, 76, 88, 64, 95, 40].map((w, i) => <i key={i} className="doc-l" style={{ width: `${w}%` }} />)}
      <span className="doc-stamp">{c.src.split(' ')[0]}</span>
    </span>
  );
  if (c.art === 'registro') return (
    <span className="art reg">
      {(c.facts ?? [['Fuente', c.src], ['Fecha', dateShort(c.at)]]).slice(0, 4).map(([k, v]) => <span key={k} className="reg-r"><span>{k}</span><b>{v}</b></span>)}
    </span>
  );
  return (
    <span className="art por">
      <span className="art-fig" aria-hidden><Icon name="person" /></span>
      <span className="por-cap mono">{c.src} · {dateShort(c.at)}</span>
    </span>
  );
}

