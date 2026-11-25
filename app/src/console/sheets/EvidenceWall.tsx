/* Muro de evidencias del expediente facial (como un tablero de investigación).
   A la izquierda, el perfil de la persona en grande. A la derecha, columnas por fuente —lo de hoy en las
   cámaras, el archivo de cámaras, la justicia (Fiscalía y juzgado) y los registros (PNC, RNPN,
   Transporte)— con una ventana por cada evidencia que muestra el material mismo: la captura, el video,
   el documento, el registro, el mapa del recorrido o la reconstrucción 3D.
   Arriba, los vínculos de la persona: al elegir uno se encienden las evidencias que lo respaldan y una
   línea las une con él; el resto se atenúa. Tocar una ventana la abre en grande para recorrerla.
   Sin imágenes ficticias: cada material se dibuja como su tipo (cuadro de cámara, hoja, ficha). */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dateShort, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, FACIAL_SOURCES, type FacialMatch, type LinkKind, type Proof } from '../../api/facial';
import { FaceCloud } from '../../ui/FaceCloud';
import { Icon } from '../../ui/kit';
import { FaceTrail } from './FaceTrail';

const KIND_ICON: Record<LinkKind, string> = { vehiculo: 'directions_car', persona: 'person', lugar: 'location_on', caso: 'gavel' };
type Col = 'hoy' | 'archivo' | 'justicia' | 'registros';
const COLS: { id: Col; title: string; sub: string }[] = [
  { id: 'hoy', title: 'Cámaras · hoy', sub: 'recorrido y capturas' },
  { id: 'archivo', title: 'Archivo de cámaras', sub: 'videos e imágenes anteriores' },
  { id: 'justicia', title: 'Fiscalía · Juzgado', sub: 'denuncias, actas, órdenes' },
  { id: 'registros', title: 'PNC · RNPN · Transporte', sub: 'fichas y registros' },
];
type Art = 'captura' | 'video' | 'documento' | 'registro' | 'retrato';
export interface Card { key: string; col: Col; art: Art; src: string; title: string; at: number; links: string[]; facts?: [string, string][]; score?: number }

const isCam = (src: string) => /^(CAM-|SM-|SPOTBOX|SpotBox)/.test(src);
const colOf = (src: string): Col => (isCam(src) ? 'archivo' : /^(Fiscalía|Juzgado)/.test(src) ? 'justicia' : 'registros');
const artOf = (p: Proof): Art => (p.kind === 'video' ? 'video' : p.kind === 'documento' ? 'documento' : p.kind === 'registro' ? 'registro' : isCam(p.src) ? 'captura' : 'retrato');

/** Todas las evidencias de la persona, una vez cada una, con los vínculos que respaldan. */
export function cardsOf(m: FacialMatch): Card[] {
  const out = new Map<string, Card>();
  const add = (p: Proof, link: string, facts?: [string, string][]) => {
    const key = `${p.kind}|${p.title}|${p.src}|${p.at}`;
    const c = out.get(key);
    if (c) { if (!c.links.includes(link)) c.links.push(link); return; }
    out.set(key, { key, col: colOf(p.src), art: artOf(p), src: p.src, title: p.title, at: p.at, links: [link], facts: p.kind === 'registro' ? facts : undefined });
  };
  m.docs.forEach((p) => add(p, 'identidad', [['Persona', m.name], ['Documento', m.docId], ['Lista', `${FACIAL_LISTS[m.list].name} · ${m.listRef}`]]));
  m.links.forEach((l) => l.proofs.forEach((p) => add(p, l.id, l.facts)));
  const today = m.detections.map((d, i): Card => ({ key: `det${i}`, col: 'hoy', art: 'captura', src: d.cameraId, title: d.place, at: d.at, links: ['hoy'], score: d.score }));
  return [...today, ...[...out.values()].sort((a, b) => b.at - a.at)];
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
  const vinc = [{ id: 'hoy', label: 'Hoy', icon: 'today', n: m.detections.length }, { id: 'identidad', label: 'Identidad', icon: 'badge', n: m.docs.length },
    ...m.links.map((l) => ({ id: l.id, label: l.label, icon: KIND_ICON[l.kind], n: cards.filter((c) => c.links.includes(l.id)).length }))];

  // Líneas del vínculo elegido a cada evidencia que lo respalda.
  const wall = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const draw = useCallback(() => {
    const w = wall.current; if (!w || !sel) { setLines([]); return; }
    const o = w.getBoundingClientRect();
    const chip = w.querySelector<HTMLElement>(`[data-vinc="${sel}"]`); if (!chip) { setLines([]); return; }
    const r = chip.getBoundingClientRect();
    const x1 = r.left + r.width / 2 - o.left, y1 = r.bottom - o.top;
    setLines([...w.querySelectorAll<HTMLElement>('.ev-card.hit')].map((el) => {
      const b = el.getBoundingClientRect();
      const x2 = b.left + 18 - o.left, y2 = b.top - o.top, my = y1 + 14;
      return `M${x1} ${y1} V${my} H${x2} V${y2}`;
    }));
  }, [sel]);
  useLayoutEffect(() => {
    draw();
    const w = wall.current; if (!w) return;
    const ro = new ResizeObserver(draw); ro.observe(w);
    w.addEventListener('scroll', draw, true);
    return () => { ro.disconnect(); w.removeEventListener('scroll', draw, true); };
  }, [draw]);

  const pending = FACIAL_SOURCES.filter((s) => s.state === 'por_conectar');
  return (
    <div className="ev">
      <aside className="ev-prof" aria-label="Perfil">{profile}</aside>
      <div className="ev-main" ref={wall}>
        <svg className="ev-lines" aria-hidden>{lines.map((d, i) => <path key={i} d={d} />)}</svg>
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
            const list = cards.filter((c) => c.col === col.id);
            return (
              <section key={col.id} className="ev-col" aria-label={col.title}>
                <header className="ev-colh"><b>{col.title}</b><span>{col.sub}</span></header>
                {col.id === 'hoy' && (
                  <div className={`ev-card big ${on({ links: ['hoy'] } as Card) ? (sel ? 'hit' : '') : 'dim'}`}>
                    <div className="ev-ch"><span className="mono">Mapa · recorrido</span><b>{m.detections.length} detecciones hoy</b></div>
                    <div className="ev-map"><FaceTrail dets={m.detections} onOpen={(i) => onOpen(list, i)} /></div>
                  </div>
                )}
                {col.id === 'archivo' && (
                  <div className={`ev-card big ${sel ? (sel === 'identidad' || sel === 'hoy' ? 'hit' : 'dim') : ''}`}>
                    <div className="ev-ch"><span className="mono">Reconstrucción 3D</span><b>Afinada con {m.profile3d.detections} detecciones</b></div>
                    <div className="ev-3d"><FaceCloud seed={seed} label={`Reconstrucción 3D del perfil ${m.listRef}`} interactive auto landmarks scan /></div>
                  </div>
                )}
                <div className={`ev-grid ${col.id === 'hoy' ? 'two' : ''}`}>
                  {list.map((c, i) => (
                    <button key={c.key} className={`ev-card ${on(c) ? (sel ? 'hit' : '') : 'dim'}`} onClick={() => onOpen(list, i)}
                      aria-label={`${ART_LABEL[c.art]}: ${c.title}, ${c.src}, ${dateShort(c.at)}`}>
                      <span className="ev-ch"><span className="mono">{c.src} · {ART_LABEL[c.art]}</span><b>{c.title}</b></span>
                      <Artifact c={c} />
                      {c.links.some((l) => l !== 'hoy' && l !== 'identidad') && (
                        <span className="ev-tags">{c.links.map((id) => m.links.find((l) => l.id === id)).filter(Boolean).map((l) => <span key={l!.id}><Icon name={KIND_ICON[l!.kind]} />{l!.label}</span>)}</span>
                      )}
                    </button>
                  ))}
                  {col.id === 'registros' && pending.map((s) => (
                    <div key={s.name} className="ev-card ghost"><span className="ev-ch"><span className="mono">{s.name}</span><b>Por conectar</b></span><span className="art ghost-a"><Icon name="link_off" /></span></div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
