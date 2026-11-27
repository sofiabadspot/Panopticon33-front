/* Mapa de la persona (expediente facial): la cara al centro y, alrededor, las categorías de lo que se
   juntó (detecciones de hoy, identidad, vehículos, personas, lugares, casos). Tocar una categoría la
   abre o cierra (de entrada está todo abierto): sus elementos salen unidos con líneas, en orden de fecha
   (del más viejo al más nuevo, en el sentido del reloj). Cada evidencia muestra su material (captura,
   video, documento, registro). Los nodos se acomodan para no pisarse y se mueven al abrir o cerrar. Se navega como un panel: arrastrar mueve,
   la rueda acerca. El buscador encuentra cualquier dato, abre las ramas donde está y lo resalta.
   A la izquierda, siempre la persona (foto de la lista y reconstrucción 3D) y debajo el detalle de lo
   elegido. Sin imágenes ficticias. */
import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { dateShort, hhmm, pct } from '../../api/format';
import { type FacialMatch, type LinkKind } from '../../api/facial';
import { FaceCloud } from '../../ui/FaceCloud';
import { Icon } from '../../ui/kit';
import { Shot } from './FacialDossier';
import { Artifact, cardsOf, type Card } from './EvidenceWall';

type Cat = 'hoy' | 'identidad' | LinkKind;
const CATS: { id: Cat; label: string; icon: string }[] = [
  { id: 'hoy', label: 'Detecciones de hoy', icon: 'videocam' },
  { id: 'vehiculo', label: 'Vehículos', icon: 'directions_car' },
  { id: 'persona', label: 'Personas asociadas', icon: 'groups' },
  { id: 'caso', label: 'Casos', icon: 'gavel' },
  { id: 'lugar', label: 'Lugares', icon: 'location_on' },
  { id: 'identidad', label: 'Identidad y documentos', icon: 'badge' },
];
const KIND_ICON: Record<LinkKind, string> = { vehiculo: 'directions_car', persona: 'person', lugar: 'location_on', caso: 'gavel' };
const ART_ICON: Record<Card['art'], string> = { captura: 'photo_camera', video: 'smart_display', documento: 'description', registro: 'database', retrato: 'face' };
const ART_LABEL: Record<Card['art'], string> = { captura: 'Captura', video: 'Video', documento: 'Documento', registro: 'Registro', retrato: 'Imagen' };

/** Un nodo del mapa. `parent` dibuja la línea; `at` ordena por fecha. */
interface Node { id: string; parent: string | null; level: 0 | 1 | 2 | 3; x: number; y: number; label: string; sub: string; icon: string; at?: number; card?: Card; link?: string; cat?: Cat; count?: number; text: string }

const R = [0, 250, 520, 860];
/** Tamaño de cada nodo para que no se pisen: la cara, las categorías, los vínculos y las evidencias (con su material). */
const box = (n: Node): [number, number] => (n.level === 0 ? [180, 200] : n.card ? [196, 168] : n.level === 1 ? [70 + n.label.length * 8, 48] : [Math.min(276, 64 + Math.max(n.label.length * 7.5, (n.sub.length + 14) * 5.6)), 54]);
const rad = (d: number) => (d * Math.PI) / 180;

export function PersonMap({ m, onOpen, about, who = true }: {
  m: FacialMatch; onOpen: (cards: Card[], i: number) => void; about?: ReactNode;
  /** Muestra la persona (foto y 3D) arriba del detalle. Sin ella cuando la persona ya está a la vista al lado. */
  who?: boolean;
}) {
  const cards = useMemo(() => cardsOf(m), [m]);
  // Todo abierto de entrada: categorías y vínculos.
  const [open, setOpen] = useState<Set<string>>(() => new Set([...CATS.map((c) => `cat:${c.id}`), ...m.links.map((l) => `link:${l.id}`)]));
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // Hijos de cada categoría y de cada vínculo, en orden de fecha.
  const tree = useMemo(() => {
    const kids = new Map<string, Omit<Node, 'x' | 'y' | 'level' | 'parent'>[]>();
    const first = (id: string) => Math.min(...cards.filter((c) => c.links.includes(id)).map((c) => c.at), Infinity);
    CATS.forEach((c) => {
      if (c.id === 'hoy') kids.set('cat:hoy', cards.filter((x) => x.group === 'hoy').map((x) => ({ id: `card:${x.key}`, label: `${hhmm(x.at)} · ${x.src}`, sub: `${x.title} · ${pct(x.score ?? 0)}`, icon: 'photo_camera', at: x.at, card: x, text: `${x.src} ${x.title} detección captura` })));
      else if (c.id === 'identidad') kids.set('cat:identidad', cards.filter((x) => x.group === 'identidad').map((x) => ({ id: `card:${x.key}`, label: x.title, sub: `${x.src} · ${dateShort(x.at)}`, icon: ART_ICON[x.art], at: x.at, card: x, text: `${x.title} ${x.src} ${ART_LABEL[x.art]}` })));
      else kids.set(`cat:${c.id}`, m.links.filter((l) => l.kind === c.id).map((l) => ({ id: `link:${l.id}`, label: l.label, sub: l.sub, icon: KIND_ICON[l.kind], at: first(l.id), link: l.id, count: l.proofs.length, text: `${l.label} ${l.sub} ${l.facts.map((f) => f.join(' ')).join(' ')}` })).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)));
    });
    m.links.forEach((l) => kids.set(`link:${l.id}`, cards.filter((x) => x.links.includes(l.id)).map((x) => ({ id: `card:${l.id}:${x.key}`, label: x.title, sub: `${x.src} · ${dateShort(x.at)}`, icon: ART_ICON[x.art], at: x.at, card: x, text: `${x.title} ${x.src} ${ART_LABEL[x.art]}` }))));
    return kids;
  }, [cards, m.links]);

  // Con búsqueda: se abren las ramas donde hay coincidencias.
  const hits = useMemo(() => {
    const s = new Set<string>(); if (!query) return s;
    tree.forEach((list, parent) => list.forEach((n) => { if (n.text.toLowerCase().includes(query) || n.label.toLowerCase().includes(query)) { s.add(n.id); s.add(parent); if (parent.startsWith('link:')) s.add(`cat:${m.links.find((l) => `link:${l.id}` === parent)?.kind}`); } }));
    return s;
  }, [query, tree, m.links]);
  const isOpen = (id: string) => open.has(id) || (query !== '' && hits.has(id));

  // Ubicación radial: categorías alrededor de la cara; sus hijos en abanico hacia afuera; los hijos de un
  // vínculo, en abanico detrás de él.
  const nodes = useMemo(() => {
    const out: Node[] = [{ id: 'me', parent: null, level: 0, x: 0, y: 0, label: m.name, sub: m.listRef, icon: 'person', text: `${m.name} ${m.listRef} ${m.docId}` }];
    const cats = CATS.filter((c) => (tree.get(`cat:${c.id}`)?.length ?? 0) > 0);
    cats.forEach((c, i) => {
      const a = -90 + (360 / cats.length) * i;
      const list = tree.get(`cat:${c.id}`) ?? [];
      out.push({ id: `cat:${c.id}`, parent: 'me', level: 1, x: Math.cos(rad(a)) * R[1], y: Math.sin(rad(a)) * R[1], label: c.label, sub: '', icon: c.icon, cat: c.id, count: list.length, text: c.label });
      if (!isOpen(`cat:${c.id}`)) return;
      const step = Math.min(18, 120 / Math.max(1, list.length - 1));
      list.forEach((n, j) => {
        const b = a + (j - (list.length - 1) / 2) * step;
        out.push({ ...n, parent: `cat:${c.id}`, level: 2, x: Math.cos(rad(b)) * R[2], y: Math.sin(rad(b)) * R[2] });
        if (!n.link || !isOpen(n.id)) return;
        const sub = tree.get(n.id) ?? [];
        const st = Math.min(9, 70 / Math.max(1, sub.length - 1));
        sub.forEach((g, k) => {
          const c2 = b + (k - (sub.length - 1) / 2) * st;
          out.push({ ...g, parent: n.id, level: 3, x: Math.cos(rad(c2)) * R[3], y: Math.sin(rad(c2)) * R[3] });
        });
      });
    });
    // Acomodo: se separan los nodos que se pisan (por su tamaño real) y cada uno vuelve un poco a su lugar
    // ideal, así se mantiene el orden por categoría y por fecha. La cara no se mueve.
    const ideal = out.map((n) => [n.x, n.y]);
    const size = out.map(box);
    for (let it = 0; it < 360; it++) {
      for (let i = 1; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b2 = out[j];
        const ox = (size[i][0] + size[j][0]) / 2 + 18 - Math.abs(a.x - b2.x), oy = (size[i][1] + size[j][1]) / 2 + 18 - Math.abs(a.y - b2.y);
        if (ox <= 0 || oy <= 0) continue;
        const wa = a.level === 1 ? 0.25 : 0.5, wb = b2.level === 1 ? 0.25 : 0.5;
        if (ox < oy) { const s = a.x < b2.x ? -1 : 1; a.x += s * ox * wa; b2.x -= s * ox * wb; }
        else { const s = a.y < b2.y ? -1 : 1; a.y += s * oy * wa; b2.y -= s * oy * wb; }
      }
      // Que nada pise la cara.
      for (let i = 1; i < out.length; i++) {
        const n = out[i], ox = (size[0][0] + size[i][0]) / 2 + 24 - Math.abs(n.x), oy = (size[0][1] + size[i][1]) / 2 + 24 - Math.abs(n.y);
        if (ox > 0 && oy > 0) { if (ox < oy) n.x += (n.x < 0 ? -1 : 1) * ox; else n.y += (n.y < 0 ? -1 : 1) * oy; }
        n.x += (ideal[i][0] - n.x) * 0.02; n.y += (ideal[i][1] - n.y) * 0.02;
      }
    }
    return out;
  }, [tree, open, hits, query, m]); // eslint-disable-line react-hooks/exhaustive-deps
  // Movimiento: al abrir o cerrar algo, cada nodo va de donde estaba a su nuevo lugar (y los nuevos salen
  // de su padre).
  const [pos, setPos] = useState<Map<string, [number, number]>>(() => new Map(nodes.map((n) => [n.id, [n.x, n.y]])));
  const posRef = useRef(pos); posRef.current = pos;
  useEffect(() => {
    const from = posRef.current, t0 = performance.now(), D = 420;
    const start = new Map(nodes.map((n) => [n.id, from.get(n.id) ?? from.get(n.parent ?? '') ?? [0, 0]] as [string, [number, number]]));
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - (1 - k) ** 3;
      setPos(new Map(nodes.map((n) => { const s = start.get(n.id)!; return [n.id, [s[0] + (n.x - s[0]) * e, s[1] + (n.y - s[1]) * e]]; })));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodes]);
  const at = (id: string): [number, number] => pos.get(id) ?? [0, 0];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Panel: mover arrastrando, acercar con la rueda (hacia el puntero).
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 0.5 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const w = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
      setView((v) => { const k = Math.max(0.25, Math.min(2.2, v.k * Math.exp(-e.deltaY * 0.0015))); return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }; });
    };
    el.addEventListener('wheel', w, { passive: false }); return () => el.removeEventListener('wheel', w);
  }, []);
  const down = (e: RPointerEvent) => { if ((e.target as HTMLElement).closest('button, input')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; };
  const move = (e: RPointerEvent) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); };
  const up = () => { drag.current = null; };
  const focusOn = (n: Node) => setView((v) => ({ ...v, x: -n.x * v.k * 0.6, y: -n.y * v.k * 0.6 }));

  const toggle = (n: Node) => {
    setSel(n.id);
    if (n.level === 1 || n.link) setOpen((s) => { const t = new Set(s); if (t.has(n.id)) t.delete(n.id); else t.add(n.id); return t; });
    if (n.level >= 1) focusOn(n);
  };
  const selected = sel ? byId.get(sel) : undefined;
  const lit = (n: Node) => !query || hits.has(n.id) || n.level <= 1;
  const seed = [...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);

  return (
    <div className="pm">
      <aside className="pm-side">
        {/* La persona siempre a la vista: foto de la lista y reconstrucción 3D que se gira. */}
        {who && <div className="pm-who">
          <span className="pm-photo"><Shot label={m.listPhotos[0] ? `${m.listPhotos[0].caption} · ${m.listPhotos[0].year}` : 'Sin foto'} /></span>
          <span className="pm-3d"><FaceCloud seed={seed} label={`Reconstrucción 3D del perfil ${m.listRef}`} interactive auto landmarks /></span>
        </div>}
        <div className="pm-detail" aria-live="polite">
        {!selected ? (
          <>
            <span className="pm-k mono">Datos de la persona</span>
            <dl className="pm-dl">
              <dt>Documento</dt><dd className="mono">{m.docId}</dd>
              {m.traits.filter((x) => x.list).map((x, i) => <Fragment key={i}><dt>{x.label}</dt><dd>{x.list}</dd></Fragment>)}
              <dt>Riesgo</dt><dd>{m.risk.level} · {m.risk.notes[0]}</dd>
              <dt>Agente cerca</dt><dd>{m.agent}</dd>
            </dl>
            {about}
          </>
        ) : selected.card ? (() => {
          const c = selected.card!;
          const siblings = (tree.get(selected.parent ?? '') ?? []).map((x) => x.card!).filter(Boolean);
          return (
            <>
              <span className="pm-k mono">{ART_LABEL[c.art]} · {c.src}</span>
              <h3>{c.title}</h3>
              <p className="mono">{dateShort(c.at)} · {hhmm(c.at)}</p>
              <button className="pm-art" onClick={() => onOpen(siblings, Math.max(0, siblings.findIndex((x) => x.key === c.key)))} aria-label="Abrir en grande"><Artifact c={c} /></button>
              <button className="btn secondary sm" onClick={() => onOpen(siblings, Math.max(0, siblings.findIndex((x) => x.key === c.key)))}><Icon name="open_in_full" />Ver en grande y recorrer las {siblings.length}</button>
              {c.links.filter((id) => id !== 'hoy' && id !== 'identidad').length > 0 && (
                <div className="pm-also"><span className="pm-k mono">Respalda</span>
                  {c.links.map((id) => m.links.find((l) => l.id === id)).filter(Boolean).map((l) => (
                    <button key={l!.id} onClick={() => { const node = byId.get(`link:${l!.id}`); setOpen((s) => new Set([...s, `cat:${l!.kind}`, `link:${l!.id}`])); setSel(`link:${l!.id}`); if (node) focusOn(node); }}><Icon name={KIND_ICON[l!.kind]} />{l!.label}</button>
                  ))}
                </div>
              )}
            </>
          );
        })() : selected.link ? (() => {
          const l = m.links.find((x) => x.id === selected.link)!;
          const ev = cards.filter((c) => c.links.includes(l.id));
          return (
            <>
              <span className="pm-k mono">{CATS.find((c) => c.id === l.kind)?.label} · desde {dateShort(Math.min(...ev.map((c) => c.at)))}</span>
              <h3>{l.label}</h3>
              <p>{l.sub}</p>
              <dl className="pm-dl">{l.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
              <span className="pm-k mono">{ev.length} evidencias, en orden de fecha</span>
              <ol className="pm-list">{ev.map((c, i) => <li key={c.key}><button onClick={() => onOpen(ev, i)}><Icon name={ART_ICON[c.art]} /><span><b>{c.title}</b><small>{dateShort(c.at)} · {c.src}</small></span></button></li>)}</ol>
            </>
          );
        })() : (
          <>
            <span className="pm-k mono">Categoría</span>
            <h3>{selected.label}</h3>
            <p>{selected.count} {selected.count === 1 ? 'elemento' : 'elementos'}, en orden de fecha.</p>
            <ol className="pm-list">{(tree.get(selected.id) ?? []).map((x) => (
              <li key={x.id}><button onClick={() => { const node = byId.get(x.id); setSel(x.id); if (x.link) setOpen((s) => new Set([...s, x.id])); if (node) focusOn(node); }}>
                <Icon name={x.icon} /><span><b>{x.label}</b><small>{x.at && x.at < Infinity ? `${dateShort(x.at)} · ` : ''}{x.sub}</small></span></button></li>
            ))}</ol>
          </>
        )}
        </div>
      </aside>
      <div className="pm-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="pm-search">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en todo lo de la persona (placa, lugar, caso, cámara…)" aria-label="Buscar en el mapa de la persona" />
          {query && <span className="mono">{[...hits].filter((h) => h.startsWith('card:') || h.startsWith('link:')).length} resultados</span>}
          {q && <button className="iconbtn" aria-label="Borrar búsqueda" title="Borrar búsqueda" onClick={() => setQ('')}><Icon name="close" /></button>}
        </div>
        <div className="pm-zoom" role="group" aria-label="Acercar o alejar">
          <button className="iconbtn" aria-label="Acercar" title="Acercar" onClick={() => setView((v) => ({ ...v, k: Math.min(2.2, v.k * 1.25) }))}><Icon name="add" /></button>
          <button className="iconbtn" aria-label="Alejar" title="Alejar" onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.25) }))}><Icon name="remove" /></button>
          <button className="iconbtn" aria-label="Centrar en la persona" title="Centrar en la persona" onClick={() => setView({ x: 0, y: 0, k: 0.5 })}><Icon name="center_focus_strong" /></button>
        </div>
        <div className="pm-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pm-lines" aria-hidden>
            {nodes.filter((n) => n.parent).map((n) => {
              if (!byId.get(n.parent!)) return null;
              const [px, py] = at(n.parent!), [nx, ny] = at(n.id);
              const mx = (px + nx) / 2, my = (py + ny) / 2;
              const on = sel === n.id || sel === n.parent || (selected && selected.parent === n.id);
              return <path key={n.id} d={`M${px} ${py} Q${mx * 0.92} ${my * 0.92} ${nx} ${ny}`} className={`l${n.level} ${on ? 'on' : ''} ${lit(n) ? '' : 'dim'}`} />;
            })}
          </svg>
          {nodes.map((n) => (
            n.level === 0 ? (
              <button key={n.id} className={`pm-me ${sel === null ? 'on' : ''}`} style={{ left: 0, top: 0 }} onClick={() => { setSel(null); setView({ x: 0, y: 0, k: view.k }); }} aria-label={`${m.name}, ${m.listRef}`}>
                <span className="pm-face"><Icon name="person" /></span>
              </button>
            ) : (
              n.card ? (
                <button key={n.id} className={`pm-n pm-card ${sel === n.id ? 'sel' : ''} ${lit(n) ? '' : 'dim'} ${query && hits.has(n.id) ? 'hit' : ''}`}
                  style={{ left: at(n.id)[0], top: at(n.id)[1] }} onClick={() => toggle(n)} aria-label={`${ART_LABEL[n.card.art]}: ${n.label}, ${dateShort(n.at ?? 0)}`}>
                  <span className="pm-ct"><Icon name={n.icon} /><span><b>{n.label}</b><small>{n.sub}</small></span></span>
                  <span className="pm-thumb"><Artifact c={n.card} /></span>
                </button>
              ) :
              <button key={n.id} className={`pm-n l${n.level} ${sel === n.id ? 'sel' : ''} ${isOpen(n.id) ? 'open' : ''} ${lit(n) ? '' : 'dim'} ${query && hits.has(n.id) && n.level >= 2 ? 'hit' : ''}`}
                style={{ left: at(n.id)[0], top: at(n.id)[1] }} onClick={() => toggle(n)} aria-expanded={n.level === 1 || n.link ? isOpen(n.id) : undefined}
                aria-label={`${n.label}${n.at && n.level >= 2 ? `, ${dateShort(n.at)}` : ''}${n.count != null ? `, ${n.count}` : ''}`}>
                <Icon name={n.icon} />
                <span><b>{n.label}</b>{n.level >= 2 && <small>{n.level === 2 && n.at && n.at < Infinity ? `${dateShort(n.at)} · ` : ''}{n.sub}</small>}</span>
                {n.count != null && <i className="mono">{n.count}</i>}
              </button>
            )
          ))}
        </div>
        <p className="pm-hint">Toca una categoría para abrirla · arrastra para moverte · rueda para acercar</p>
      </div>

    </div>
  );
}
