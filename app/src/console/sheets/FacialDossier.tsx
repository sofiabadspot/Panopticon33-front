/* Expediente de una persona a pantalla completa (verificación facial), armado como tablero de
   investigación: a la izquierda el perfil (fotos de la lista, reconstrucción 3D que se gira, señas y
   datos); a la derecha ventanas que se van abriendo según lo que se toca, cada una unida con una línea a
   la fila de donde salió. Todo tiene fecha: se entra por lo de hoy (las detecciones, cámara por cámara),
   por la historia (los hechos en orden) o por los vínculos (ordenados por cuándo aparecieron). Un hecho
   abre lo que involucra y el hecho anterior y el siguiente; un vínculo abre su historia; una detección
   abre la comparación de su captura con la foto de la lista.
   Esc cierra el expediente (no la ficha). Todo es de ejemplo hasta que lleguen los datos reales. */
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dateShort, dateTime, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, FACIAL_SOURCES, TRAIT_GROUPS, lastDetection, type FacialMatch, type LinkKind, type PersonLink, type TraitGroup } from '../../api/facial';
import { FaceCloud } from '../../ui/FaceCloud';
import { Icon, useNow } from '../../ui/kit';

const KIND: Record<LinkKind, { label: string; one: string; icon: string }> = {
  vehiculo: { label: 'Vehículos', one: 'Vehículo', icon: 'directions_car' },
  persona: { label: 'Personas', one: 'Persona', icon: 'person' },
  lugar: { label: 'Lugares', one: 'Lugar', icon: 'location_on' },
  caso: { label: 'Casos', one: 'Caso', icon: 'gavel' },
};
const dayOf = (t: number) => dateShort(t);
const dm = (t: number) => dateShort(t).replace(/\s*de\s*/g, ' ').replace(/\s\d{4}$/, '');
/** Fecha corta para una fila: "hoy 11:47" o "16 oct". */
const when = (t: number, now: number) => (dayOf(t) === dayOf(now) ? `hoy ${hhmm(t)}` : dm(t));
/** Tiempo entre dos momentos: "12 min", "1 h 25", "3 días". */
const gap = (ms: number) => { const mn = Math.round(ms / 60000); if (mn >= 2 * 1440) return `${Math.round(mn / 1440)} días`; return mn < 60 ? `${mn} min` : `${Math.floor(mn / 60)} h${mn % 60 ? ` ${mn % 60}` : ''}`; };

/** Lo que puede abrirse en el tablero: un vínculo, un hecho de la historia o una detección de hoy. */
type Open = { t: 'link'; id: string } | { t: 'ev'; i: number } | { t: 'cap'; i: number };
const keyOf = (n: Open) => (n.t === 'link' ? `l:${n.id}` : `${n.t}:${n.i}`);
const Board = createContext<{ path: Open[]; open: (depth: number, n: Open) => void; shut: (col: number) => void }>({ path: [], open: () => {}, shut: () => {} });

/** Una fila que abre algo en la columna siguiente (o lo cierra si ya está abierto). */
function Row({ depth, n, children, label }: { depth: number; n: Open; children: ReactNode; label: string }) {
  const { path, open } = useContext(Board);
  const on = !!path[depth] && keyOf(path[depth]) === keyOf(n);
  return (
    <button type="button" className={`bw-row ${on ? 'on' : ''}`} data-row={`${depth}|${keyOf(n)}`} aria-expanded={on} aria-label={label} onClick={() => open(depth, n)}>
      {children}<Icon name="chevron_right" />
    </button>
  );
}

/** Una ventana del tablero. Las de entrada (columna 0) no se cierran. */
function Win({ col, kicker, title, children, wide }: { col: number; kicker: string; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const { shut } = useContext(Board);
  return (
    <section className={`bw ${wide ? 'wide' : ''}`} data-win={col} aria-label={kicker}>
      <header className="bw-hd">
        <span className="bw-k mono">{kicker}</span>
        <b>{title}</b>
        {col > 0 && <button className="bw-x" aria-label={`Cerrar ${kicker}`} onClick={() => shut(col)}><Icon name="close" /></button>}
      </header>
      <div className="bw-bd">{children}</div>
    </section>
  );
}

/** Imagen que se amplía ahí mismo: clic acerca (2,5×) hacia donde está el puntero, mover la recorre,
    la rueda cambia el aumento, otro clic vuelve. */
function ZoomImg({ src, alt }: { src: string; alt: string }) {
  const [z, setZ] = useState(1);
  const [o, setO] = useState({ x: 50, y: 50 });
  const btn = useRef<HTMLButtonElement>(null);
  const zRef = useRef(z); zRef.current = z;
  const at = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setO({ x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) }); };
  // La rueda acerca más sin desplazar el panel (oyente no pasivo: React los registra pasivos).
  useEffect(() => {
    const b = btn.current; if (!b) return;
    const w = (e: WheelEvent) => { if (zRef.current === 1) return; e.preventDefault(); setZ((v) => Math.max(1.2, Math.min(6, v * Math.exp(-e.deltaY * 0.002)))); };
    b.addEventListener('wheel', w, { passive: false }); return () => b.removeEventListener('wheel', w);
  }, []);
  return (
    <button ref={btn} type="button" className={`ds-zoom ${z > 1 ? 'on' : ''}`} aria-label={z > 1 ? `Alejar ${alt}` : `Ampliar ${alt}`} aria-pressed={z > 1}
      // Con teclado (Enter o Espacio) no hay puntero: se acerca al centro.
      onClick={(e) => { if (e.detail === 0) setO({ x: 50, y: 50 }); else at(e); setZ(z > 1 ? 1 : 2.5); }} onMouseMove={(e) => z > 1 && at(e)}>
      <img src={src} alt={alt} style={{ transform: `scale(${z})`, transformOrigin: `${o.x}% ${o.y}%` } as CSSProperties} />
      {z > 1 && <span className="ds-zoom-lvl mono">{z.toFixed(1)}×</span>}
    </button>
  );
}

/** Señas por grupo: lo registrado en la lista frente a lo que se ve en la captura. */
export function Traits({ m }: { m: FacialMatch }) {
  const both = m.traits.filter((x) => x.list && x.seen).length;
  const hidden = m.traits.filter((x) => x.list && !x.seen).length;
  const groups = (Object.keys(TRAIT_GROUPS) as TraitGroup[]).filter((g) => m.traits.some((x) => x.group === g));
  return (
    <>
      <div className="tr-sum">
        <span><b className="mono">{both}</b> se pueden comparar</span>
        {hidden > 0 && <span><b className="mono">{hidden}</b> no se {hidden === 1 ? 've' : 'ven'} en la captura</span>}
      </div>
      <table className="tr">
        <thead><tr><th scope="col"><span className="sr">Seña</span></th><th scope="col">En la lista</th><th scope="col">En la captura</th></tr></thead>
        {groups.map((g) => (
          <tbody key={g}>
            <tr className="tr-g"><th colSpan={3} scope="rowgroup">{TRAIT_GROUPS[g]}</th></tr>
            {m.traits.filter((x) => x.group === g).map((x, i) => (
              <tr key={g + i}>
                <th scope="row">{x.label}</th>
                <td>{x.list ?? <span className="tr-na">Sin registro</span>}</td>
                <td>{x.seen ?? <span className="tr-na"><Icon name="visibility_off" />No se ve{x.note ? ` · ${x.note}` : ''}</span>}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </>
  );
}


export function FacialDossier({ m, canDecide, onConfirm, onDiscard, onClose }: {
  m: FacialMatch; canDecide: boolean; onConfirm: () => void; onDiscard: () => void; onClose: () => void;
}) {
  const now = useNow(10000);
  const L = FACIAL_LISTS[m.list];
  const photos = useMemo(() => [...m.listPhotos].sort((a, b) => b.score - a.score), [m.listPhotos]);
  const [ph, setPh] = useState(0);
  const photo = photos[Math.min(ph, photos.length - 1)];
  const [auto, setAuto] = useState(true);
  const [marks3d, setMarks3d] = useState(true);
  const [reset, setReset] = useState(0);
  const seed = [...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const dets = m.detections;
  const best = Math.max(...dets.map((x) => x.score));
  const cams = new Set(dets.map((x) => x.cameraId)).size;
  // Vínculos en el orden en que aparecieron en la historia.
  const links = useMemo(() => [...m.links].sort((a, b) => (a.events[0]?.at ?? Infinity) - (b.events[0]?.at ?? Infinity)), [m.links]);
  const linkOf = (id: string) => m.links.find((l) => l.id === id);

  // Camino abierto: path[0] es lo abierto desde las ventanas de entrada, path[1] lo abierto desde ahí, etc.
  const [path, setPath] = useState<Open[]>(() => (dets.length ? [{ t: 'cap', i: dets.length - 1 }] : []));
  const open = (depth: number, n: Open) => setPath((p) => (p[depth] && keyOf(p[depth]) === keyOf(n) ? p.slice(0, depth) : [...p.slice(0, depth), n]));
  const ctx = useMemo(() => ({ path, open, shut: (col: number) => setPath((p) => p.slice(0, col - 1)) }), [path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Líneas: de la fila elegida a la ventana que abrió. Se recalculan al abrir, al redimensionar y al
  // desplazar cualquier lista.
  const board = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ d: string; x1: number; y1: number; x2: number; y2: number }[]>([]);
  const draw = useCallback(() => {
    const b = board.current; if (!b) return;
    const o = b.getBoundingClientRect();
    const out: typeof lines = [];
    path.forEach((n, c) => {
      const row = b.querySelector<HTMLElement>(`[data-row="${c}|${keyOf(n)}"]`);
      const win = b.querySelector<HTMLElement>(`[data-win="${c + 1}"]`);
      if (!row || !win) return;
      const r = row.getBoundingClientRect(), w = win.getBoundingClientRect();
      const box = (row.closest('.bw-bd') as HTMLElement | null)?.getBoundingClientRect() ?? r;
      const x1 = r.right - o.left + b.scrollLeft, y1 = Math.max(box.top + 6, Math.min(box.bottom - 6, r.top + r.height / 2)) - o.top + b.scrollTop;
      const x2 = w.left - o.left + b.scrollLeft, y2 = w.top + 17 - o.top + b.scrollTop;
      const mx = x1 + (x2 - x1) / 2;
      out.push({ d: `M${x1} ${y1} H${mx} V${y2} H${x2}`, x1, y1, x2, y2 });
    });
    setLines(out);
  }, [path]);
  useLayoutEffect(() => {
    draw();
    const b = board.current; if (!b) return;
    const ro = new ResizeObserver(draw); ro.observe(b);
    b.addEventListener('scroll', draw, true);
    return () => { ro.disconnect(); b.removeEventListener('scroll', draw, true); };
  }, [draw]);
  // Al abrir algo nuevo, el tablero se corre para mostrarlo.
  useEffect(() => { const b = board.current; if (b) b.scrollTo({ left: b.scrollWidth, behavior: 'smooth' }); }, [path.length]);

  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  // Al abrir toma el foco (una sola vez); Esc lo cierra sin cerrar nada más; Tab queda adentro; al
  // cerrar, el foco vuelve a donde estaba (el botón que lo abrió).
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], canvas[tabindex]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], act = document.activeElement;
      if (e.shiftKey && (act === first || act === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('keydown', k, true); back?.focus?.(); };
  }, []);

  const linkRow = (depth: number, l: PersonLink, extra?: string) => (
    <Row key={l.id} depth={depth} n={{ t: 'link', id: l.id }} label={`${KIND[l.kind].one} ${l.label}`}>
      <i className="bw-ic"><Icon name={KIND[l.kind].icon} /></i>
      <span className="bw-t"><b>{l.label}</b><small>{extra ?? l.sub}</small></span>
    </Row>
  );
  const evRow = (depth: number, i: number, pre?: string) => {
    const e = m.story[i];
    return (
      <Row key={'e' + i} depth={depth} n={{ t: 'ev', i }} label={`${when(e.at, now)}: ${e.label}`}>
        <span className="bw-d mono">{pre ?? when(e.at, now)}</span>
        <span className="bw-t"><b>{e.label}</b><small>{e.links.map((id) => linkOf(id)?.label).filter(Boolean).join(' · ')}</small></span>
      </Row>
    );
  };

  /** Ventana de lo abierto en la columna `col` (path[col - 1]). */
  const view = (n: Open, col: number) => {
    if (n.t === 'cap') {
      const x = dets[n.i];
      if (!x) return null;
      const prev = dets[n.i - 1];
      return (
        <Win key={col} col={col} wide kicker={`Detección · ${x.cameraId}`} title={<>{hhmm(x.at)} · {x.place}</>}>
          <div className="ds-pair">
            <figure><ZoomImg src={x.capture} alt={`Captura de las ${hhmm(x.at)}`} /><figcaption><b>Captura</b> · <span className="mono">{pct(x.score)}</span></figcaption></figure>
            {photo ? <figure><ZoomImg src={photo.src} alt={photo.caption} /><figcaption><b>{photo.caption}</b> · {photo.year}</figcaption></figure>
              : <figure><div className="ds-zoom ds-nophoto">Sin fotos en la lista</div><figcaption>&nbsp;</figcaption></figure>}
          </div>
          <dl className="ds-dl">
            <dt>Cuándo</dt><dd>{dateTime(x.at)}</dd>
            <dt>Cámara</dt><dd className="mono">{x.cameraId}</dd>
            <dt>Antes</dt><dd>{prev ? <>{gap(x.at - prev.at)} antes en <span className="mono">{prev.cameraId}</span></> : 'Primera detección de hoy'}</dd>
          </dl>
          <p className="ds-hint">Clic en una imagen para ampliarla; la rueda acerca más. La foto de la lista se cambia en el perfil.</p>
        </Win>
      );
    }
    if (n.t === 'link') {
      const l = linkOf(n.id);
      if (!l) return null;
      return (
        <Win key={col} col={col} kicker={`${KIND[l.kind].one} · desde ${l.events[0] ? dm(l.events[0].at) : '—'}`} title={l.label}>
          <p className="bw-sub">{l.sub}</p>
          <dl className="ds-dl">{l.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          <h4 className="bw-h">Su historia con la persona</h4>
          {l.events.map((e) => evRow(col, m.story.indexOf(e)))}
        </Win>
      );
    }
    const e = m.story[n.i];
    if (!e) return null;
    const prev = n.i > 0 ? n.i - 1 : null, next = n.i < m.story.length - 1 ? n.i + 1 : null;
    return (
      <Win key={col} col={col} kicker={`Hecho · ${dateShort(e.at)}${dayOf(e.at) === dayOf(now) ? ` ${hhmm(e.at)}` : ''}`} title={e.label}>
        {(e.place || e.src) && <p className="bw-sub">{[e.place, e.src].filter(Boolean).join(' · ')}</p>}
        <h4 className="bw-h">Involucra</h4>
        {e.links.map((id) => linkOf(id)).filter((v): v is PersonLink => !!v).map((l) => linkRow(col, l))}
        <h4 className="bw-h">En el tiempo</h4>
        {prev != null && evRow(col, prev, `${gap(e.at - m.story[prev].at)} antes`)}
        {next != null && evRow(col, next, `${gap(m.story[next].at - e.at)} después`)}
      </Win>
    );
  };

  return createPortal(
    <div className="ds" role="dialog" aria-modal aria-label={`Expediente de ${m.name}`} ref={box} tabIndex={-1}>
      <header className="ds-hd">
        <div className="ds-id">
          <span className="ds-eyebrow mono">Expediente · {m.listRef} · {L.name}</span>
          <h1>{m.name}</h1>
          <span className="ds-reason">{m.reason}{m.orderUntil ? ` · vigente hasta el ${m.orderUntil}` : ''} · <span className="mono">{m.docId}</span></span>
        </div>
        <div className="ds-score" style={{ '--p': `${Math.round(best * 100)}` } as CSSProperties} aria-label={`Mejor coincidencia de hoy ${pct(best)}`}>
          <b className="mono">{Math.round(best * 100)}<small>%</small></b><span>mejor de hoy</span>
        </div>
        <div className="ds-act">
          {canDecide && <>
            <button className="btn positive" onClick={onConfirm}><Icon name="check" />Es la persona: confirmar</button>
            <button className="btn secondary" onClick={onDiscard}><Icon name="close" />No coincide</button>
          </>}
          <button className="iconbtn ds-close" onClick={onClose} aria-label="Cerrar el expediente (Esc)"><Icon name="close" /></button>
        </div>
      </header>

      <div className="ds-body">
        <aside className="ds-panel ds-prof" aria-label="Perfil">
          {photo ? <img className="ds-photo" src={photo.src} alt={`${photo.caption} (${photo.year})`} /> : <div className="ds-photo ds-nophoto">Sin fotos en la lista</div>}
          {photos.length > 1 && (
            <div className="ds-photos" role="group" aria-label={`Fotos en la lista (${photos.length})`}>
              {photos.map((x, i) => <button key={x.src + i} className={i === ph ? 'on' : ''} aria-pressed={i === ph} onClick={() => setPh(i)}>{x.caption} · {x.year} <b className="mono">{pct(x.score)}</b></button>)}
            </div>
          )}
          <dl className="ds-dl">
            <dt>Documento</dt><dd className="mono">{m.docId}</dd>
            <dt>Lista</dt><dd>{L.name} · <span className="mono">{m.listRef}</span></dd>
            <dt>Procesado en</dt><dd className="mono">{m.spotbox}</dd>
            <dt>Agente</dt><dd>{m.agent}</dd>
          </dl>
          <h2>Reconstrucción 3D <span className="ds-sub">{m.profile3d.detections} detecciones · {dm(m.profile3d.updatedAt)}</span></h2>
          <div className="ds-stage">
            <FaceCloud seed={seed} label={`Reconstrucción 3D del perfil ${m.listRef}`} interactive auto={auto} landmarks={marks3d} scan resetKey={reset} />
          </div>
          <div className="ds-tools" role="group" aria-label="Vista 3D">
            <button aria-pressed={auto} className={auto ? 'on' : ''} onClick={() => setAuto(!auto)}><Icon name={auto ? 'pause' : 'play_arrow'} />{auto ? 'Pausar' : 'Girar'}</button>
            <button aria-pressed={marks3d} className={marks3d ? 'on' : ''} onClick={() => setMarks3d(!marks3d)}><Icon name="hub" />Puntos</button>
            <button onClick={() => setReset(reset + 1)}><Icon name="center_focus_strong" />Inicial</button>
          </div>
          <h2>Señas para confirmar</h2>
          <Traits m={m} />
          <div className="ds-src">
            <span className="ds-k">Fuentes</span>
            {FACIAL_SOURCES.map((s) => <span key={s.name} className={`ds-srcitem ${s.state}`}><i />{s.name}</span>)}
          </div>
        </aside>

        <Board.Provider value={ctx}>
        <div className="bd" ref={board}>
          <svg className="bd-lines" aria-hidden>
            {lines.map((x, i) => <g key={i}><path d={x.d} /><circle cx={x.x1} cy={x.y1} r="3" /><circle cx={x.x2} cy={x.y2} r="3" /></g>)}
          </svg>
          <div className="bd-col bd-root">
            <Win col={0} kicker={`Hoy · ${dets.length} detecciones · ${cams} cámaras`} title={dets.length ? <>{hhmm(dets[0].at)} a {hhmm(lastDetection(m).at)}</> : 'Sin detecciones'}>
              {dets.map((x, i) => (
                <Row key={x.at} depth={0} n={{ t: 'cap', i }} label={`${hhmm(x.at)}, ${x.cameraId}, ${x.place}, ${pct(x.score)}`}>
                  <span className="bw-d mono">{hhmm(x.at)}</span>
                  <span className="bw-t"><b>{x.cameraId} · {pct(x.score)}</b><small>{i > 0 ? `${gap(x.at - dets[i - 1].at)} después · ` : ''}{x.place}</small></span>
                </Row>
              ))}
            </Win>
            <Win col={0} kicker={`Historia · ${m.story.length} hechos`} title={m.story.length ? <>desde el {dateShort(m.story[0].at)}</> : 'Sin hechos'}>
              {m.story.map((_, i) => evRow(0, i))}
            </Win>
            <Win col={0} kicker={`Vínculos · ${links.length}`} title="Por orden de aparición">
              {links.map((l) => linkRow(0, l, `desde ${l.events[0] ? dm(l.events[0].at) : '—'} · ${l.events.length} ${l.events.length === 1 ? 'hecho' : 'hechos'}`))}
            </Win>
          </div>
          {path.map((n, i) => <div key={i + keyOf(n)} className="bd-col">{view(n, i + 1)}</div>)}
        </div>
        </Board.Provider>
      </div>
    </div>,
    document.body,
  );
}
