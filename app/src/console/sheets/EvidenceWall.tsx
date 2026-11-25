/* Muro de evidencias del expediente facial (como un tablero de investigación).
   A la izquierda, el perfil de la persona en grande. A la derecha, una columna por categoría —Hoy,
   Identidad, Vehículos, Personas, Lugares, Casos— y en cada una un bloque por vínculo con sus
   evidencias en orden de fecha (la captura, el video, el documento, el registro, el mapa, la 3D).
   Arriba, los vínculos: al elegir uno (o su bloque) se encienden sus evidencias, aunque estén en otro
   bloque, y una línea lo une con su bloque por el espacio entre columnas, sin pasar sobre las tarjetas.
   Tocar una evidencia la abre en grande para recorrerla.
   Sin imágenes ficticias: cada material se dibuja como su tipo (cuadro de cámara, hoja, ficha). */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dateShort, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, FACIAL_SOURCES, type FacialMatch, type LinkKind, type Proof } from '../../api/facial';
import { FaceCloud } from '../../ui/FaceCloud';
import { Icon } from '../../ui/kit';
import { FaceTrail } from './FaceTrail';

const KIND_ICON: Record<LinkKind, string> = { vehiculo: 'directions_car', persona: 'person', lugar: 'location_on', caso: 'gavel' };
type Col = 'hoy' | 'identidad' | LinkKind;
const COLS: { id: Col; title: string; icon: string }[] = [
  { id: 'hoy', title: 'Hoy', icon: 'today' },
  { id: 'identidad', title: 'Identidad', icon: 'badge' },
  { id: 'vehiculo', title: 'Vehículos', icon: 'directions_car' },
  { id: 'persona', title: 'Personas', icon: 'person' },
  { id: 'lugar', title: 'Lugares', icon: 'location_on' },
  { id: 'caso', title: 'Casos', icon: 'gavel' },
];
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

const ART_LABEL: Record<Art, string> = { captura: 'Captura', video: 'Video', documento: 'Documento', registro: 'Registro', retrato: 'Imagen' };

export function EvidenceWall({ m, onOpen, profile }: { m: FacialMatch; onOpen: (cards: Card[], i: number) => void; profile: ReactNode }) {
  const cards = useMemo(() => cardsOf(m), [m]);
  const [sel, setSel] = useState<string | null>(null);
  const seed = [...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const on = (c: Card) => !sel || c.links.includes(sel);
  const vinc = [{ id: 'hoy', label: 'Hoy', icon: 'today', n: m.detections.length }, { id: 'identidad', label: 'Identidad', icon: 'badge', n: cards.filter((c) => c.links.includes('identidad')).length },
    ...m.links.map((l) => ({ id: l.id, label: l.label, icon: KIND_ICON[l.kind], n: cards.filter((c) => c.links.includes(l.id)).length }))];

  // Línea del vínculo elegido a su bloque: baja del vínculo, corre por encima de las columnas, baja por
  // el espacio entre columnas y entra por el costado del bloque. Nunca pasa por encima de una tarjeta.
  const wall = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<string | null>(null);
  const draw = useCallback(() => {
    const w = wall.current; if (!w || !sel) { setLine(null); return; }
    const chip = w.querySelector<HTMLElement>(`[data-vinc="${sel}"]`), grp = w.querySelector<HTMLElement>(`[data-grp="${sel}"]`), cols = w.querySelector<HTMLElement>('.ev-cols');
    const col = grp?.closest<HTMLElement>('.ev-col');
    if (!chip || !grp || !cols || !col) { setLine(null); return; }
    const o = w.getBoundingClientRect(), sx = w.scrollLeft - o.left, sy = w.scrollTop - o.top;
    const r = chip.getBoundingClientRect(), g = grp.getBoundingClientRect(), c = cols.getBoundingClientRect(), k = col.getBoundingClientRect();
    const x1 = r.left + r.width / 2 + sx, y1 = r.bottom + sy, bus = c.top - 12 + sy, gx = k.left - 14 + sx, gy = g.top + g.height / 2 + sy, x2 = g.left + sx;
    setLine(`M${x1} ${y1} V${bus} H${gx} V${gy} H${x2}`);
  }, [sel]);
  useLayoutEffect(() => {
    draw();
    const w = wall.current; if (!w) return;
    const ro = new ResizeObserver(draw); ro.observe(w);
    w.addEventListener('scroll', draw, true);
    return () => { ro.disconnect(); w.removeEventListener('scroll', draw, true); };
  }, [draw]);
  // Al elegir un vínculo, su columna se trae a la vista.
  useLayoutEffect(() => {
    const w = wall.current, g = sel ? w?.querySelector<HTMLElement>(`[data-grp="${sel}"]`)?.closest<HTMLElement>('.ev-col') : null;
    if (!w || !g) return;
    // Solo de costado: la barra de vínculos y los títulos quedan a la vista.
    const o = w.getBoundingClientRect(), r = g.getBoundingClientRect();
    if (r.left < o.left || r.right > o.right) w.scrollTo({ left: w.scrollLeft + r.left - o.left - 40, behavior: 'smooth' });
  }, [sel]);

  const pending = FACIAL_SOURCES.filter((s) => s.state === 'por_conectar');
  const card = (c: Card, list: Card[], i: number) => (
    <div key={c.key} role="button" tabIndex={0} className={`ev-card ${on(c) ? (sel ? 'hit' : '') : 'dim'}`} onClick={() => onOpen(list, i)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(list, i); } }}
      aria-label={`${ART_LABEL[c.art]}: ${c.title}, ${c.src}, ${dateShort(c.at)}`}>
      <span className="ev-ch"><span className="mono">{dateShort(c.at)} · {c.src} · {ART_LABEL[c.art]}</span><b>{c.title}</b></span>
      <Artifact c={c} />
      {c.links.length > 1 && (
        <span className="ev-tags">También: {c.links.filter((id) => id !== c.group).map((id) => {
          const l = m.links.find((x) => x.id === id);
          return <button key={id} onClick={(e) => { e.stopPropagation(); setSel(id); }}>{l ? <><Icon name={KIND_ICON[l.kind]} />{l.label}</> : id === 'identidad' ? 'Identidad' : id}</button>;
        })}</span>
      )}
    </div>
  );
  const groupHead = (id: string, icon: string, label: string, sub: string, n: number) => (
    <button data-grp={id} className={`ev-grp ${sel === id ? 'on' : sel ? 'dim' : ''}`} aria-pressed={sel === id} onClick={() => setSel(sel === id ? null : id)}>
      <Icon name={icon} /><span><b>{label}</b><small>{sub}</small></span><b className="mono">{n}</b>
    </button>
  );
  return (
    <div className="ev">
      <aside className="ev-prof" aria-label="Perfil">{profile}</aside>
      <div className="ev-main" ref={wall}>
        <svg className="ev-lines" aria-hidden>{line && <><path d={line} /><circle r="3.5" cx={Number(line.split(' ').at(-1)?.slice(1))} cy={Number(line.split(' ').at(-2)?.slice(1))} /></>}</svg>
        <div className="ev-vinc" role="group" aria-label="Vínculos de la persona">
          <span className="ev-k">Vínculos</span>
          {vinc.map((v) => (
            <button key={v.id} data-vinc={v.id} className={sel === v.id ? 'on' : ''} aria-pressed={sel === v.id} onClick={() => setSel(sel === v.id ? null : v.id)}>
              <Icon name={v.icon} />{v.label}<b className="mono">{v.n}</b>
            </button>
          ))}
        </div>
        <div className="ev-cols">
          {COLS.map((col) => {
            const groups = col.id === 'hoy' || col.id === 'identidad' ? [col.id] : m.links.filter((l) => l.kind === col.id).sort((a, b) => b.weight - a.weight).map((l) => l.id);
            if (!groups.length) return null;
            return (
              <section key={col.id} className="ev-col" aria-label={col.title}>
                <header className="ev-colh"><Icon name={col.icon} /><b>{col.title}</b></header>
                {groups.map((g) => {
                  const list = cards.filter((c) => c.group === g);
                  const l = m.links.find((x) => x.id === g);
                  return (
                    <div key={g} className="ev-group">
                      {g === 'hoy' ? groupHead('hoy', 'today', `${m.detections.length} detecciones`, `${new Set(m.detections.map((d) => d.cameraId)).size} cámaras · recorrido en el mapa`, list.length)
                        : g === 'identidad' ? groupHead('identidad', 'badge', m.name, `${m.listRef} · reconstrucción 3D y documentos`, list.length)
                        : l && groupHead(l.id, KIND_ICON[l.kind], l.label, l.sub, cards.filter((c) => c.links.includes(l.id)).length)}
                      {g === 'hoy' && (
                        <div className={`ev-card big ${sel && sel !== 'hoy' ? 'dim' : sel ? 'hit' : ''}`}>
                          <div className="ev-map"><FaceTrail dets={m.detections} onOpen={(i) => onOpen(list, i)} /></div>
                        </div>
                      )}
                      {g === 'identidad' && (
                        <div className={`ev-card big ${sel && sel !== 'identidad' ? 'dim' : sel ? 'hit' : ''}`}>
                          <div className="ev-ch"><span className="mono">Reconstrucción 3D</span><b>Afinada con {m.profile3d.detections} detecciones</b></div>
                          <div className="ev-3d"><FaceCloud seed={seed} label={`Reconstrucción 3D del perfil ${m.listRef}`} interactive auto landmarks scan /></div>
                        </div>
                      )}
                      <div className={`ev-grid ${g === 'hoy' ? 'two' : ''}`}>{list.map((c, i) => card(c, list, i))}</div>
                      {g === 'identidad' && pending.map((s) => (
                        <div key={s.name} className="ev-card ghost"><span className="ev-ch"><span className="mono">{s.name}</span><b>Por conectar</b></span></div>
                      ))}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
