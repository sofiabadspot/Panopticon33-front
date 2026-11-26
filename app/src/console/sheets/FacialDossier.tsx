/* Expediente de una persona a pantalla completa (reconocimiento facial).
   Arriba: quién es, el riesgo, la mejor coincidencia y la decisión. A la izquierda, siempre a la vista, la
   persona: la reconstrucción 3D, el modo Comparar (lista · 3D · captura) y todas sus imágenes. A la
   derecha, el expediente como una carpeta con solapas: Resumen, Detecciones, Señas, Vínculos (lista o
   mapa), Historia, Documentos y Fuentes. El Analista, además, puede pedir buscar en otras fuentes.
   Esc cierra el expediente (no la ficha). Todo es de ejemplo. */
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ago, dateShort, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, FACIAL_SOURCES, POSE_LABEL, SHARP_LABEL, TRAIT_GROUPS, lastDetection, type FacialDetection, type FacialMatch, type LinkKind, type PersonLink, type Proof, type ProofKind, type Trait, type TraitGroup } from '../../api/facial';
import { useSession } from '../../shell/session';
import { FaceCloud, type FaceAnchors } from '../../ui/FaceCloud';
import { Artifact, type Card } from './EvidenceWall';
import { PersonMap } from './PersonMap';
import { EmptyState, Icon, useNow, useToast } from '../../ui/kit';

// Mismo día en hora de El Salvador (no en UTC).

/** Lugar reservado para una imagen que todavía no hay (el prototipo no usa fotos ficticias). */
export function Shot({ label }: { label?: string }) {
  return <span className="shot"><span className="ph-ev"><img src="/assets/logo-spotvision-bn.png" alt="" />{label && <b>{label}</b>}</span></span>;
}

/** Algo para ver en grande: una imagen, un video, un documento o un registro. */
export interface ViewItem { src: string; tag: string; title: string; sub: string; icon: string }
const PROOF_ICON: Record<ProofKind, string> = { imagen: 'image', video: 'smart_display', documento: 'description', registro: 'database' };
const PROOF_TAG: Record<ProofKind, string> = { imagen: 'Imagen', video: 'Video', documento: 'Documento', registro: 'Registro' };
export const proofItem = (p: Proof): ViewItem => ({ src: '', tag: PROOF_TAG[p.kind], title: p.title, sub: `${p.src} · ${dateShort(p.at)}`, icon: PROOF_ICON[p.kind] });

/** Visor grande que se navega: anterior / siguiente (también con las flechas), una tira con todas y,
    si se pasa `compare`, la imagen de referencia al lado para comparar. `standalone`: se abre sobre toda
    la pantalla y maneja Esc y las flechas (desde la ficha); si no, lo maneja el expediente. */
export function Viewer({ items, index, onIndex, onClose, compare, standalone, render }: {
  items: ViewItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; compare?: ViewItem | null; standalone?: boolean;
  /** Dibuja el material en grande en vez de una imagen (evidencias del expediente). */
  render?: (i: number) => ReactNode;
}) {
  const n = items.length;
  const x = items[Math.min(index, n - 1)];
  const cb = useRef({ onIndex, onClose, index, n }); cb.current = { onIndex, onClose, index, n };
  useEffect(() => {
    if (!standalone) return;
    const k = (e: KeyboardEvent) => {
      const c = cb.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); c.onClose(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); c.onIndex((c.index + (e.key === 'ArrowRight' ? 1 : c.n - 1)) % c.n); }
    };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [standalone]);
  if (!x) return null;
  const ref = compare && x.tag === 'Hoy' ? compare : null;
  const body = (
    <div className={`lb ${standalone ? 'solo' : ''}`} role="dialog" aria-modal={standalone || undefined} aria-label={`${x.tag}: ${x.title}`}>
      <div className="lb-hd">
        <span className="mono">{index + 1} / {n}</span>
        <b><Icon name={x.icon} />{x.tag} · {x.title}</b>
        <span className="lb-sub">{x.sub}</span>
        <button className="iconbtn" aria-label="Cerrar (Esc)" onClick={onClose}><Icon name="close" /></button>
      </div>
      {render ? <div className="lb-body lb-art">{render(index)}</div> : <div className={`lb-body ${ref ? 'two' : ''}`}>
        <figure><ZoomImg key={x.title + index} src={x.src} alt={`${x.tag} · ${x.title}`} /><figcaption>{x.tag} · {x.sub}</figcaption></figure>
        {ref && <figure><ZoomImg src={ref.src} alt={`${ref.tag} · ${ref.title}`} /><figcaption>Para comparar: {ref.title}</figcaption></figure>}
      </div>}
      {n > 1 && (
        <div className="lb-nav">
          <button className="btn secondary sm" onClick={() => onIndex((index + n - 1) % n)}><Icon name="chevron_left" />Anterior</button>
          <div className="lb-strip">{items.map((y, i) => <button key={i} className={i === index ? 'on' : ''} aria-label={`${y.tag} · ${y.title}`} aria-pressed={i === index} onClick={() => onIndex(i)}>{y.src ? <img src={y.src} alt="" /> : <span className="lb-ic"><Icon name={y.icon} /></span>}</button>)}</div>
          <button className="btn secondary sm" onClick={() => onIndex((index + 1) % n)}>Siguiente<Icon name="chevron_right" /></button>
        </div>
      )}
    </div>
  );
  return standalone ? createPortal(<div className="lb-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>{body}</div>, document.body) : body;
}

/** Respaldos: un recuadro por cada imagen, video, documento o registro que comprueba un dato. */
export function Proofs({ items, onOpen }: { items: Proof[]; onOpen: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="pv" role="list" aria-label="Respaldos">
      {items.map((p, i) => (
        <button key={i} role="listitem" className={`pv-t k-${p.kind}`} onClick={() => onOpen(i)} aria-label={`Ver ${PROOF_TAG[p.kind].toLowerCase()}: ${p.title}, ${p.src}, ${dateShort(p.at)}`}>
          <span className="pv-ic"><Icon name={PROOF_ICON[p.kind]} /></span>
          <span className="pv-k mono">{PROOF_TAG[p.kind]}</span>
          <b>{p.title}</b>
          <small>{p.src} · {dateShort(p.at)}</small>
        </button>
      ))}
    </div>
  );
}

/** Imagen que se amplía ahí mismo: clic acerca (2,5×) hacia donde está el puntero, mover la recorre,
    la rueda cambia el aumento, otro clic vuelve. */
function ZoomImg({ src, alt }: { src: string; alt: string }) {
  return src ? <ZoomReal src={src} alt={alt} /> : <span className="ds-zoom ds-empty"><Shot label={alt} /></span>;
}
function ZoomReal({ src, alt }: { src: string; alt: string }) {
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
export function Traits({ m, only }: { m: FacialMatch; only?: TraitGroup[] }) {
  const traits = only ? m.traits.filter((x) => only.includes(x.group)) : m.traits;
  const both = traits.filter((x) => x.list && x.seen).length;
  const hidden = traits.filter((x) => x.list && !x.seen).length;
  const groups = (Object.keys(TRAIT_GROUPS) as TraitGroup[]).filter((g) => traits.some((x) => x.group === g));
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
            {traits.filter((x) => x.group === g).map((x, i) => (
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

type Sec = 'resumen' | 'det' | 'senas' | 'vin' | 'hist' | 'docs' | 'fuentes';
const KIND_LABEL: Record<LinkKind, [string, string]> = { vehiculo: ['Vehículo', 'Vehículos'], persona: ['Persona', 'Personas'], lugar: ['Lugar', 'Lugares'], caso: ['Caso', 'Casos'] };
const isUnknown = (l: PersonLink) => l.kind === 'persona' && l.facts.some(([k, v]) => k === 'Identidad' && v === 'Sin identificar');

/** Una seña que se ve en la cara, unida al punto del 3D de donde sale. */
interface Call { key: string; side: 'l' | 'r'; top: number; title: string; text: string; ok: boolean; at: string[] }
/** En qué puntos del 3D está una seña del rostro (por sus palabras); null si no es de la cara. */
function faceAt(t: Trait): string[] | null {
  if (t.group !== 'rostro') return null;
  const s = `${t.label} ${t.list ?? ''}`.toLowerCase(), der = /derech/.test(s), izq = /izquierd/.test(s);
  if (/ceja|ojo|párpado/.test(s)) return der ? ['od'] : izq ? ['oi'] : ['oi', 'od'];
  if (/barba|vello|bigote|ment[oó]n/.test(s)) return ['me'];
  if (/nariz/.test(s)) return ['na'];
  if (/boca|labio/.test(s)) return ['bi', 'bd'];
  if (/frente/.test(s)) return ['fr'];
  if (/mand[ií]bula|mejilla|p[oó]mulo/.test(s)) return der ? ['md'] : izq ? ['mi'] : ['mi', 'md'];
  return null;
}

/** Las señas de la cara sobre el 3D: cada una con una línea al punto de donde sale, que sigue a la cara
    al girar. Línea entera: coincide; punteada: no se ve. Si el punto queda del otro lado, se apaga. */
function FaceCalls({ calls, onAnchorsRef }: { calls: Call[]; onAnchorsRef: React.MutableRefObject<((a: FaceAnchors) => void) | undefined> }) {
  const svg = useRef<SVGSVGElement>(null);
  const lab = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    // Las líneas y los puntos se buscan una vez; en cada cuadro solo se mueven.
    const el0 = svg.current;
    const lines = new Map([...(el0?.querySelectorAll<SVGPolylineElement>('[data-l]') ?? [])].map((n) => [n.dataset.l!, n]));
    const dots = new Map([...(el0?.querySelectorAll<SVGCircleElement>('[data-d]') ?? [])].map((n) => [n.dataset.d!, n]));
    onAnchorsRef.current = (a) => {
      const el = svg.current; if (!el) return;
      const W = el.clientWidth;
      for (const c of calls) {
        const box = lab.current[c.key]; if (!box) continue;
        const lx = c.side === 'l' ? box.offsetLeft + box.offsetWidth : box.offsetLeft, ly = box.offsetTop + box.offsetHeight + 4;
        const bend = c.side === 'l' ? lx + W * 0.05 : lx - W * 0.05;
        const pts = c.at.map((k) => a[k]).filter(Boolean);
        const back = pts.every((p) => !p.front);
        box.classList.toggle('back', back);
        c.at.forEach((k, i) => {
          const p = a[k], line = lines.get(`${c.key}-${i}`), dot = dots.get(`${c.key}-${i}`);
          if (!p || !line || !dot) return;
          const from = c.side === 'l' ? box.offsetLeft : box.offsetLeft + box.offsetWidth;
          line.setAttribute('points', `${from},${ly} ${lx},${ly} ${bend},${ly} ${p.x},${p.y}`);
          dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y));
          line.style.opacity = dot.style.opacity = p.front ? '1' : '0.3';
        });
      }
    };
    return () => { onAnchorsRef.current = undefined; };
  }, [calls, onAnchorsRef]);
  return (
    <div className="dz-calls">
      <svg ref={svg} className="dz-calls-svg" aria-hidden>
        {calls.flatMap((c) => c.at.map((_, i) => (
          <g key={`${c.key}-${i}`} className={c.ok ? '' : 'no'}>
            <polyline data-l={`${c.key}-${i}`} points="" />
            <circle data-d={`${c.key}-${i}`} r="5" />
          </g>
        )))}
      </svg>
      {calls.map((c) => (
        <div key={c.key} ref={(el) => { lab.current[c.key] = el; }} className={`dz-call ${c.side} ${c.ok ? '' : 'no'}`} style={{ top: `${c.top}%` }}>
          <b>{c.title}</b>
          <span className="dz-call-t">{c.text}</span>
          <span className="dz-call-back">Del otro lado: gírala</span>
        </div>
      ))}
    </div>
  );
}

/** Foto de la lista dibujada sin imagen ficticia. */
function ListPic({ caption, year }: { caption: string; year: string }) {
  return <span className="art por"><span className="art-fig" aria-hidden><Icon name="person" /></span><span className="por-cap mono">{caption} · {year}</span></span>;
}
const capCard = (x: FacialDetection, i: number): Card => ({ key: `det${i}`, group: 'hoy', art: 'captura', src: x.cameraId, title: x.place, at: x.at, links: ['hoy'], score: x.score });

export function FacialDossier({ m, canDecide, onConfirm, onDiscard, onClose }: {
  m: FacialMatch; canDecide: boolean; onConfirm: () => void; onDiscard: () => void; onClose: () => void;
}) {
  const now = useNow(1000);
  const { role } = useSession();
  const toast = useToast();
  const analyst = role === 'analyst';
  const L = FACIAL_LISTS[m.list];
  const [sec, setSec] = useState<Sec>('resumen');
  const [cmp, setCmp] = useState(false);
  const [spin, setSpin] = useState(true);
  const [asMap, setAsMap] = useState(false);
  const [view, setView] = useState<{ items: ViewItem[]; index: number; cards?: Card[] } | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const openCards = (cards: Card[], i: number) => setView({ cards, items: cards.map((c) => ({ src: '', tag: c.src, icon: 'description', title: c.title, sub: `${dateShort(c.at)} · ${hhmm(c.at)}` })), index: i });
  const anchors = useRef<((a: FaceAnchors) => void) | undefined>(undefined);
  const onAnchors = useCallback((a: FaceAnchors) => anchors.current?.(a), []);

  const dets = useMemo(() => [...m.detections].sort((a, b) => b.at - a.at), [m.detections]);
  const d = dets[0] ?? lastDetection(m);
  const best = m.detections.length ? Math.max(...m.detections.map((x) => x.score)) : d.score;
  const seed = [...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const [ref, setRef] = useState(0);
  const [cap, setCap] = useState(0);
  const refPhoto = m.listPhotos[ref];
  const capDet = dets[cap];

  // Las señas de la cara van sobre el 3D; las demás, en su panel.
  const calls: Call[] = useMemo(() => {
    // Cada etiqueta a la altura de su punto (arriba: frente y ojos; abajo: boca y mentón), así la línea no cruza la cara.
    const RANK: Record<string, number> = { fr: 0, oi: 1, od: 1, na: 2, mi: 3, md: 3, bi: 3, bd: 3, me: 4 };
    const TOP = [6, 16, 38, 62, 70];
    const face = m.traits.filter((t) => t.list && faceAt(t));
    const out: Call[] = face.map((t, i) => ({
      key: `t${i}`, side: faceAt(t)!.every((k) => k.endsWith('d')) ? 'r' : faceAt(t)!.every((k) => k.endsWith('i')) ? 'l' : i % 2 ? 'r' : 'l', top: TOP[Math.min(...faceAt(t)!.map((k) => RANK[k] ?? 2))], title: t.label,
      text: `${t.list} · ${t.seen ? 'coincide' : 'no se ve'}`, ok: !!t.seen, at: faceAt(t)!,
    }));
    if (m.listPhotos[0]) out.push({ key: 'med', side: 'r', top: out.some((c) => c.side === 'r' && c.top >= 30 && c.top < 50) ? 50 : 38, title: 'Rasgos medidos', text: `${pct(m.listPhotos[0].score)} con la ${m.listPhotos[0].caption.toLowerCase()}`, ok: true, at: ['oi', 'od', 'na', 'bi', 'bd'] });
    return out;
  }, [m.traits, m.listPhotos]);
  const body = m.traits.filter((t) => !faceAt(t));

  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const secRef = useRef(sec); secRef.current = sec;
  // Volver al Resumen: el foco va a su botón del dock (si no, quedaría fuera del expediente).
  const closeSec = () => { setSec('resumen'); requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[data-sec="resumen"]')?.focus()); };
  const closeSecRef = useRef(closeSec); closeSecRef.current = closeSec;
  // Al abrir toma el foco (una sola vez); Esc cierra lo de más arriba (el visor, la sección, el expediente);
  // Tab queda adentro; al cerrar, el foco vuelve a donde estaba (el botón que lo abrió).
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (viewRef.current) setView(null); else if (secRef.current !== 'resumen') closeSecRef.current(); else close.current(); return; }
      const v = viewRef.current;
      if (v && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); const n = v.items.length; setView({ ...v, index: (v.index + (e.key === 'ArrowRight' ? 1 : n - 1)) % n }); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], canvas[tabindex]')].filter((x) => x.offsetParent !== null || x instanceof SVGElement);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], act = document.activeElement;
      if (e.shiftKey && (act === first || act === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('keydown', k, true); back?.focus?.(); };
  }, []);

  const connected = FACIAL_SOURCES.filter((s) => s.state === 'conectada').length;
  const tabs: { id: Sec; label: string; count?: string }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'det', label: 'Detecciones', count: String(m.detections.length) },
    { id: 'senas', label: 'Señas', count: String(m.traits.length) },
    { id: 'vin', label: 'Vínculos', count: String(m.links.length) },
    { id: 'hist', label: 'Historia', count: String(m.story.length) },
    { id: 'docs', label: 'Documentos', count: String(m.docs.length) },
    { id: 'fuentes', label: 'Fuentes', count: `${connected}/${FACIAL_SOURCES.length}` },
  ];
  // Flechas, Inicio y Fin entre secciones, como las pestañas de Jules.
  const tabKey = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, tabs.findIndex((t) => t.id === sec)), n = tabs.length;
    const next = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
    setSec(next.id); setCmp(false);
    (e.currentTarget.querySelector(`[data-sec="${next.id}"]`) as HTMLElement | null)?.focus();
  };

  const order = m.links.find((l) => l.kind === 'caso' && l.facts.some(([, v]) => v === 'Orden de captura'));
  const confirmed = m.timeline.find((x) => x.label.startsWith('Identidad confirmada'));
  const steps: { label: string; done: boolean; wait?: boolean }[] = [
    { label: 'Detectada', done: true }, { label: 'Aviso al 911', done: true },
    { label: 'Confirma el 911', done: !!confirmed, wait: !confirmed && m.status === 'por_revisar' }, { label: 'Agente avisado', done: !!confirmed },
  ];
  const wait = Math.max(0, Math.round((now - d.at - 3000) / 1000));
  const riskCls = m.risk.level === 'alto' ? 'critica' : m.risk.level === 'medio' ? 'media' : 'baja';
  const mode = sec !== 'resumen' ? 'section' : cmp ? 'cmp' : 'home';

  return createPortal(
    <div className="ds dz-ds" role="dialog" aria-modal aria-label={`Expediente de ${m.name}`} ref={box} tabIndex={-1}>
      <header className="ds-hd">
        <div className="ds-id">
          <span className="ds-eyebrow mono">Expediente · {m.listRef} · {L.name}</span>
          <h1>{m.name}</h1>
          <span className="ds-reason">{m.reason}{m.orderUntil ? ` · vence el ${m.orderUntil}` : ''}</span>
        </div>
        <span className={`chip ${riskCls}`}><Icon name="warning" />Riesgo {m.risk.level}</span>
        <div className="ds-score">
          <b className="mono">{pct(best)}</b>
          <small>mejor coincidencia hoy</small>
        </div>
        <div className="ds-act">
          {canDecide && <>
            <button className="btn positive" onClick={onConfirm}><Icon name="check" />Confirmar identidad</button>
            <button className="btn secondary" onClick={onDiscard}><Icon name="close" />No es la persona</button>
          </>}
          <button className="iconbtn ds-close" onClick={onClose} aria-label="Cerrar el expediente (Esc)"><Icon name="close" /></button>
        </div>
      </header>

      <div className={`dz ${mode}`} role="tabpanel" id="dz-panel" aria-labelledby={`dz-tab-${sec}`}>
        <div className="dz-floor" aria-hidden />
        <div className="dz-orbit" aria-hidden><i /><i /><i /></div>

        {/* La persona en 3D, protagonista. */}
        <div className="dz-person">
          <div className="dz-modes">
            <div className="seg" role="group" aria-label="Cómo ver a la persona">
              <button className={!cmp ? 'on' : ''} aria-pressed={!cmp} onClick={() => setCmp(false)}>3D</button>
              <button className={cmp ? 'on' : ''} aria-pressed={cmp} onClick={() => { setCmp(true); setSec('resumen'); }}>Comparar</button>
            </div>
            {!cmp && <button className="btn ghost xs" aria-pressed={!spin} onClick={() => setSpin(!spin)}><Icon name={spin ? 'pause' : 'play_arrow'} />{spin ? 'Pausar' : 'Mover'}</button>}
          </div>
          <div className="dz-face">
            <FaceCloud seed={seed} label={`Reconstrucción 3D de ${m.listRef}`} interactive auto={spin && !cmp} sway front={cmp} landmarks scan tags={false} onAnchors={onAnchors} />
            {mode === 'home' && <FaceCalls calls={calls} onAnchorsRef={anchors} />}
          </div>
          <span className="ds-eyebrow dz-cap">Reconstrucción 3D · {m.profile3d.detections} detecciones · no prueba la identidad</span>
        </div>

        {/* Comparar: la lista y la captura, grandes, a los lados del 3D de frente. */}
        {mode === 'cmp' && <>
          <figure className="dz-cmp l">
            <span className="ds-eyebrow">Lista</span>
            {refPhoto ? <ListPic caption={refPhoto.caption} year={refPhoto.year} /> : <Shot label="Sin foto" />}
            <figcaption>{refPhoto ? <>{refPhoto.caption} · {refPhoto.year} · <b className="mono">{pct(refPhoto.score)}</b></> : 'Sin foto en la lista'}</figcaption>
          </figure>
          <figure className="dz-cmp r">
            <span className="ds-eyebrow">Hoy</span>
            {capDet ? <Artifact c={capCard(capDet, cap)} /> : <Shot label="Sin captura" />}
            {capDet && <figcaption>{POSE_LABEL[capDet.quality.pose]} · {SHARP_LABEL[capDet.quality.sharp].toLowerCase()} · <b className="mono">{pct(capDet.score)}</b></figcaption>}
          </figure>
        </>}

        {/* Lo que no es de la cara: por tema, sin líneas a la cara. */}
        {mode === 'home' && <>
          <div className="dz-col l">
            <span className="ds-eyebrow dz-group">Ahora</span>
            <section className="ds-panel dz-glass">
              <h2>Estado del aviso</h2>
              {m.status === 'por_revisar' && <p className="dx-wait">{analyst ? 'Esperando al 911' : 'Esperando tu confirmación'} · <b className="mono">{Math.floor(wait / 60)}:{String(wait % 60).padStart(2, '0')}</b></p>}
              <ol className="dx-steps">{steps.map((s) => <li key={s.label} className={s.done ? 'done' : s.wait ? 'wait' : ''}><i aria-hidden /><span>{s.label}</span></li>)}</ol>
            </section>
            <section className="ds-panel dz-glass dz-now">
              <h2>Dónde está ahora <span className="dz-live" aria-hidden /></h2>
              <p className="dx-big">{d.place}</p>
              <p className="dx-sub">Visto {ago(d.at, now)}</p>
              <span className="dz-src ds-eyebrow" aria-hidden>Sale de esta captura</span>
            </section>
          </div>
          <div className="dz-col r">
            <span className="ds-eyebrow dz-group">Por qué está en la lista</span>
            <section className="ds-panel dz-glass">
              <h2>{order ? 'Orden de captura' : 'Motivo'}</h2>
              {order ? <><p className="dx-big mono">{order.label}</p><p className="dx-sub">{order.facts.find(([k]) => k === 'Emitida por')?.[1]}</p></> : <p className="dx-big">{m.reason}</p>}
              <h2 className={`dz-risk ${m.risk.level}`}>Al intervenir</h2>
              <ul className="dx-ul">{m.risk.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </section>
            {body.length > 0 && (
              <section className="ds-panel dz-glass">
                <h2>Señas fuera de la cara</h2>
                <dl className="dx-dl">{body.filter((t) => t.list).map((t, i) => <Fragment key={i}><dt>{t.label}</dt><dd className={t.seen ? '' : 'dx-muted'}>{t.list} · {t.seen ? 'coincide' : 'no se ve'}</dd></Fragment>)}</dl>
                {body.some((t) => !t.list && t.seen) && <p className="dx-sub">Hoy lleva: {body.filter((t) => !t.list && t.seen).map((t) => t.seen!.toLowerCase()).join(', ')}</p>}
                <p className="dz-legend"><span><i />coincide</span><span><i className="no" />no se ve</span></p>
              </section>
            )}
          </div>
        </>}

        {/* La sección elegida, en un cajón a la derecha; la persona se corre. */}
        {/* Cada sección es una vista del expediente: la persona queda chica a la izquierda y la sección ocupa el resto. */}
        {mode === 'section' && (
          <section className="dz-view" aria-label={tabs.find((t) => t.id === sec)?.label}>
            <header className="dz-view-hd">
              <h2>{tabs.find((t) => t.id === sec)?.label}</h2>
              <button className="btn ghost xs" onClick={() => closeSec()}><Icon name="arrow_back" />Volver al resumen</button>
            </header>
            {sec === 'det' && <Detecciones m={m} dets={dets} />}
            {sec === 'senas' && <Traits m={m} />}
            {sec === 'vin' && <>
              <div className="seg dx-end" role="group" aria-label="Cómo ver los vínculos">
                <button className={!asMap ? 'on' : ''} aria-pressed={!asMap} onClick={() => setAsMap(false)}>Lista</button>
                <button className={asMap ? 'on' : ''} aria-pressed={asMap} onClick={() => setAsMap(true)}>Mapa</button>
              </div>
              {asMap ? <div className="dx-map"><PersonMap m={m} onOpen={openCards} who={false} /></div> : (
                <div className="dx-links">
                  {[...m.links].sort((a, b) => b.weight - a.weight).map((l) => (
                    <article key={l.id} className="ds-panel">
                      <span className="ds-eyebrow dx-muted">{KIND_LABEL[l.kind][0]}</span>
                      <h3>{l.label}</h3>
                      <p className="dx-sub">{l.sub}</p>
                      <dl className="dx-dl">{l.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
                      {analyst && isUnknown(l) && <button className="btn secondary sm dx-investigate" onClick={() => toast('La búsqueda en otras fuentes todavía no está en la consola')}><Icon name="person_search" />Investigar quién es</button>}
                    </article>
                  ))}
                </div>
              )}
            </>}
            {sec === 'hist' && (
              <ol className="dx-story">
                {[...m.story].sort((a, b) => b.at - a.at).map((e, i) => (
                  <li key={i} className={i === 0 ? 'now' : ''}>
                    <small className="mono">{ago(e.at, now)}</small><i aria-hidden />
                    <span>{e.label}{(e.place || e.src) && <small>{[e.place, e.src && !/^SPOTBOX/.test(e.src) ? e.src : null].filter(Boolean).join(' · ')}</small>}</span>
                  </li>
                ))}
              </ol>
            )}
            {sec === 'docs' && (m.docs.length
              ? <Proofs items={m.docs} onOpen={(i) => setView({ items: m.docs.map(proofItem), index: i })} />
              : <EmptyState icon="description" title="Sin documentos" action={<button className="btn secondary sm" onClick={() => setSec('fuentes')}>Ver las fuentes</button>} />)}
            {sec === 'fuentes' && <Fuentes m={m} analyst={analyst} onInvestigate={() => toast('La búsqueda en otras fuentes todavía no está en la consola')} />}
          </section>
        )}

        {/* Las imágenes, como cuadros de cámara: la última captura primero (de ahí sale «Dónde está ahora»). */}
        {mode !== 'section' && <div className="dz-strip" role="group" aria-label="Imágenes de la persona">
          {dets.map((x, i) => (
            <button key={`d${i}`} className={`dz-thumb ${cmp && cap === i ? 'on' : ''} ${i === 0 ? 'last' : ''}`} aria-pressed={cmp && cap === i} aria-label={`Captura de hoy, ${hhmm(x.at)}, ${pct(x.score)}`} onClick={() => { setCap(i); setCmp(true); setSec('resumen'); }}>
              <Artifact c={capCard(x, i)} short />
            </button>
          ))}
          {m.listPhotos.length > 0 && <span className="dx-sep" aria-hidden />}
          {m.listPhotos.map((p, i) => (
            <button key={`l${i}`} className={`dz-thumb ${cmp && ref === i ? 'on' : ''}`} aria-pressed={cmp && ref === i} aria-label={`Foto de la lista: ${p.caption} ${p.year}, ${pct(p.score)}`} onClick={() => { setRef(i); setCmp(true); setSec('resumen'); }}>
              <ListPic caption={p.caption} year={p.year} />
            </button>
          ))}
        </div>}

        {/* Las secciones del expediente, en un dock abajo al centro. */}
        <div className="dz-dock" role="tablist" aria-label="Secciones del expediente" onKeyDown={tabKey}>
          {tabs.map((t) => (
            <button key={t.id} id={`dz-tab-${t.id}`} data-sec={t.id} role="tab" aria-selected={sec === t.id} aria-controls="dz-panel"
              tabIndex={sec === t.id ? 0 : -1} className={sec === t.id ? 'on' : ''} onClick={() => { setSec(t.id); setCmp(false); }}>
              {t.label}{t.count != null && <i className="mono">{t.count}</i>}
            </button>
          ))}
        </div>
      </div>

      {view && <Viewer items={view.items} index={view.index} render={view.cards ? (i) => <Artifact c={view.cards![i]} /> : undefined} onIndex={(i) => setView({ ...view, index: i })} onClose={() => setView(null)} />}
    </div>,
    document.body,
  );
}

/** Una tarjeta por detección: la captura, el puntaje y qué tan útil es para comparar. */
function Detecciones({ m, dets }: { m: FacialMatch; dets: FacialDetection[] }) {
  const byTime = [...m.detections].sort((a, b) => a.at - b.at);
  const rose = byTime.length > 1 && byTime[byTime.length - 1].score > byTime[0].score;
  return (
    <>
      {rose && <p className="dx-text dx-muted">La coincidencia subió de {pct(byTime[0].score)} a {pct(byTime[byTime.length - 1].score)}</p>}
      <div className="dx-cards">
        {dets.map((x, i) => (
          <article key={x.at} className={`ds-panel dx-card ${i === 0 ? 'last' : ''}`}>
            <div className="dx-card-img">
              <Artifact c={capCard(x, i)} />
              {(i === 0 || i === dets.length - 1) && dets.length > 1 && <span className="ds-eyebrow dx-tag dx-tag-b">{i === 0 ? 'Última' : 'Primera'}</span>}
            </div>
            <p className="dx-card-place">{x.place}</p>
            <dl className="dx-dl">
              <dt>Ángulo</dt><dd>{POSE_LABEL[x.quality.pose]}</dd>
              <dt>Nitidez</dt><dd>{SHARP_LABEL[x.quality.sharp]}</dd>
              <dt>Qué la tapa</dt><dd>{x.quality.covered.length ? x.quality.covered.join(', ') : 'Nada'}</dd>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

/** De dónde sale cada dato. El Analista, además, puede buscar en otras bases. */
function Fuentes({ m, analyst, onInvestigate }: { m: FacialMatch; analyst: boolean; onInvestigate: () => void }) {
  const at = lastDetection(m).at;
  const gave = (name: string) => {
    if (/PNC/.test(name)) return `Ficha, motivo${m.orderUntil ? ', orden' : ''}${m.listPhotos.length ? ', fotos' : ''} y señas`;
    if (/DUI/.test(name)) return `Documento${m.listPhotos.some((p) => /DUI/.test(p.caption)) ? ' y foto del DUI' : ''}`;
    return '';
  };
  const unknown = m.links.find(isUnknown);
  return (
    <>
      <div className="ds-panel dx-table">
        <table className="tr">
          <thead><tr><th scope="col">Fuente</th><th scope="col">Estado</th><th scope="col">Qué aportó</th><th scope="col">Última consulta</th></tr></thead>
          <tbody>
            {FACIAL_SOURCES.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td><span className={`chip ${s.state === 'conectada' ? 'ok' : 'outline'}`}>{s.state === 'conectada' ? 'Conectada' : 'Por conectar'}</span></td>
                <td>{s.state === 'conectada' ? gave(s.name) || '—' : '—'}</td>
                <td className="mono">{s.state === 'conectada' ? hhmm(at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {analyst && (
        <section className="ds-panel dx-analyst">
          <h2>Investigar en otras fuentes</h2>
          <p className="dx-text dx-muted">Devuelve candidatos, no identidades. Queda registrado con el motivo.</p>
          <dl className="dx-dl">
            <dt>Motivo</dt><dd>{m.reason}</dd>
            <dt>Caso</dt><dd className="mono">{m.listRef}</dd>
          </dl>
          <div className="dx-row">
            <button className="btn primary sm" onClick={onInvestigate}><Icon name="person_search" />Investigar a {m.listRef}</button>
            {unknown && <button className="btn secondary sm" onClick={onInvestigate}>Investigar al acompañante sin identificar</button>}
          </div>
        </section>
      )}
    </>
  );
}
