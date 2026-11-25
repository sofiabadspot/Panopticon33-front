/* Expediente de una persona a pantalla completa (verificación facial).
   Se abre desde la ficha facial para revisar todo junto y con detalle antes de decidir:
   · Comparar: la captura (o la de cualquier detección) junto a la foto de la lista que se elija.
     Clic en una imagen la amplía ahí mismo; mover el mouse recorre la imagen y la rueda acerca más.
   · Reconstrucción 3D: se gira arrastrando, la rueda acerca, puede girar sola, marcar los puntos de
     referencia del rostro y escanear.
   · Señas: por grupo (cuerpo, rostro, tatuajes y cicatrices, ropa), lo que dice la lista frente a lo
     que se ve en la captura, y qué no se puede ver.
   · Conexiones en el tiempo: cada vehículo, persona, lugar o caso vinculado es una fila con sus fechas.
     Al elegir una se ve su ficha: datos, su historia con la persona y con qué otras conexiones coincide.
   · Detecciones, datos y fuentes. El 911 decide desde acá también.
   Esc cierra el expediente (no la ficha). Todo es de ejemplo hasta que lleguen los datos reales. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
// Mismo día en hora de El Salvador (no en UTC).
const dayOf = (t: number) => dateShort(t);
/** Dos conexiones van juntas si comparten algún hecho de la historia. */
const together = (m: FacialMatch, a: string, b: string) => m.story.some((e) => e.links.includes(a) && e.links.includes(b));
const dm = (t: number) => dateShort(t).replace(/\s*de\s*/g, ' ').replace(/\s\d{4}$/, '');
const strength = (w: number) => (w >= 0.75 ? 'Vínculo fuerte' : w >= 0.5 ? 'Vínculo medio' : 'Vínculo débil');

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

/** Conexiones: la persona al centro, de ella salen los cuatro grupos (vehículos, personas, lugares,
    casos) y de cada grupo lo que tiene vinculado. El grosor de la línea es la fuerza del vínculo; las
    líneas punteadas unen conexiones que aparecen el mismo día (por ejemplo, el vehículo y el coimputado
    vistos juntos en el mercado). Elegir un nodo (clic, Enter o Espacio) abre su ficha al costado: datos,
    su historia con la persona y con qué otras conexiones coincide en fecha. */
function Connections({ m, sel, setSel }: { m: FacialMatch; sel: string | null; setSel: (id: string | null) => void }) {
  const order = Object.keys(KIND) as LinkKind[];
  const kinds = order.filter((k) => m.links.some((l) => l.kind === k));
  const byWeight = useMemo(() => [...m.links].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.weight - a.weight), [m.links]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState<string | null>(null);
  // Ubicación: cada grupo en su cuadrante (vehículos arriba a la izquierda, personas arriba a la derecha,
  // lugares abajo a la izquierda, casos abajo a la derecha); sus conexiones se abren en abanico hacia afuera.
  const W = 800, H = 330, cx = W / 2, cy = H / 2, PAD = 175;
  const ANG: Record<LinkKind, number> = { vehiculo: -150, persona: -30, lugar: 150, caso: 30 };
  const lay = useMemo(() => {
    const hubs = kinds.map((k) => { const a = (ANG[k] * Math.PI) / 180; return { k, x: cx + Math.cos(a) * 120, y: cy + Math.sin(a) * 78 }; });
    const leaves: { l: PersonLink; x: number; y: number; hx: number; hy: number; left: boolean }[] = [];
    hubs.forEach((h) => {
      const list = byWeight.filter((l) => l.kind === h.k);
      list.forEach((l, j) => {
        const a = ((ANG[h.k] + (j - (list.length - 1) / 2) * 26) * Math.PI) / 180;
        const x = Math.max(PAD, Math.min(W - PAD, cx + Math.cos(a) * 250));
        const y = Math.max(22, Math.min(H - 22, cy + Math.sin(a) * 135));
        leaves.push({ l, x, y, hx: h.x, hy: h.y, left: x < cx });
      });
    });
    // Pares que comparten algún hecho de la historia (una vez por par).
    const pairs: { a: number; b: number }[] = [];
    leaves.forEach((p, i) => leaves.forEach((q, k) => { if (k > i && together(m, p.l.id, q.l.id)) pairs.push({ a: i, b: k }); }));
    return { hubs, leaves, pairs };
  }, [m.links, byWeight]); // eslint-disable-line react-hooks/exhaustive-deps
  const l = sel ? m.links.find((v) => v.id === sel) : undefined;
  const focus = hover ?? l?.id;
  const shown = (_k: LinkKind) => true;
  const short = (s: string) => (s.length > 25 ? s.slice(0, 24) + '…' : s);
  return (
    <div className="cx-main">
        <svg className="cx-graph" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Conexiones de ${m.listRef}`}>
          <defs><clipPath id={`ds-face-${m.id}`}><circle cx={cx} cy={cy} r="28" /></clipPath></defs>
          {lay.pairs.map(({ a, b }) => {
            const p = lay.leaves[a], q = lay.leaves[b];
            const on = focus === p.l.id || focus === q.l.id;
            if (!on) return null;
            const mx = (p.x + q.x) / 2 + (cy - (p.y + q.y) / 2) * 0.25, my = (p.y + q.y) / 2 + ((p.x + q.x) / 2 - cx) * -0.08;
            return <path key={`x${a}-${b}`} d={`M${p.x} ${p.y} Q${mx} ${my} ${q.x} ${q.y}`} className={`cx-co ${shown(p.l.kind) && shown(q.l.kind) ? '' : 'dim'}`} />;
          })}
          {lay.hubs.map((h) => <line key={'h' + h.k} x1={cx} y1={cy} x2={h.x} y2={h.y} className={`cx-trunk ${l?.kind === h.k ? 'on' : ''} ${shown(h.k) ? '' : 'dim'}`} />)}
          {lay.leaves.map((n) => (
            <line key={'e' + n.l.id} x1={n.hx} y1={n.hy} x2={n.x} y2={n.y} style={{ strokeWidth: 0.8 + n.l.weight * 2.6 }}
              className={`cx-edge ${focus === n.l.id ? 'on' : ''} ${shown(n.l.kind) ? '' : 'dim'}`} />
          ))}
          <circle cx={cx} cy={cy} r="40" className="cx-pulse" />
          <circle cx={cx} cy={cy} r="34" className="cx-ring" />
          {m.listPhotos[0] && <image href={m.listPhotos[0].src} x={cx - 28} y={cy - 28} width="56" height="56" preserveAspectRatio="xMidYMid slice" clipPath={`url(#ds-face-${m.id})`} aria-hidden />}
          {lay.hubs.map((h) => (
            <g key={'g' + h.k} className={`cx-hub ${shown(h.k) ? '' : 'dim'}`} transform={`translate(${h.x} ${h.y})`} aria-hidden>
              <circle r="13" />
              <foreignObject x="-8" y="-8" width="16" height="16"><Icon name={KIND[h.k].icon} /></foreignObject>
              <text y={h.y < cy ? -19 : 27} textAnchor="middle">{KIND[h.k].label.toUpperCase()}</text>
            </g>
          ))}
          <g role="list">{lay.leaves.map((n) => {
            const on = l?.id === n.l.id;
            const act = () => setSel(on ? null : n.l.id);
            return (
              <g key={'n' + n.l.id} role="listitem" transform={`translate(${n.x} ${n.y})`}
                className={`cx-node ${on ? 'sel' : ''} ${hover === n.l.id ? 'on' : ''} ${shown(n.l.kind) ? '' : 'dim'}`}>
                <g role="button" tabIndex={shown(n.l.kind) ? 0 : -1} aria-pressed={on} aria-label={`${KIND[n.l.kind].one}: ${n.l.label}, ${n.l.sub}. ${strength(n.l.weight)}.`}
                  onClick={act} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }}
                  onMouseEnter={() => setHover(n.l.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.l.id)} onBlur={() => setHover(null)}>
                  <circle r="20" className="cx-hit" />
                  <circle r={10 + n.l.weight * 6} className="cx-dotc" />
                  <foreignObject x="-8" y="-8" width="16" height="16"><Icon name={KIND[n.l.kind].icon} /></foreignObject>
                  <text className="cx-lbl" textAnchor={n.left ? 'end' : 'start'} x={n.left ? -24 : 24} dy="-1">{short(n.l.label)}</text>
                  <text className="cx-lbl2" textAnchor={n.left ? 'end' : 'start'} x={n.left ? -24 : 24} dy="12">{n.l.sub.length > 34 ? n.l.sub.slice(0, 33) + '…' : n.l.sub}</text>
                </g>
              </g>
            );
          })}</g>
        </svg>
        <p className="ds-hint">Toca una conexión: en la historia se marcan sus hechos. La línea punteada la une con las que estuvieron en el mismo hecho.</p>
      </div>
  );
}

/** La historia de la persona en orden de fecha. Cada hecho dice qué involucra; si hay una conexión
    elegida, se marcan sus hechos y el resto queda atenuado. Tocar una etiqueta elige esa conexión. */
function History({ m, now, sel, setSel }: { m: FacialMatch; now: number; sel: string | null; setSel: (id: string | null) => void }) {
  const l = sel ? m.links.find((v) => v.id === sel) : undefined;
  return (
    <>
      {l && (
        <div className="hs-sel">
          <Icon name={KIND[l.kind].icon} /><span><b>{l.label}</b> · {l.sub}</span>
          <button className="iconbtn" aria-label="Ver toda la historia" onClick={() => setSel(null)}><Icon name="close" /></button>
        </div>
      )}
      <ol className="hs">
        {m.story.map((e, i) => {
          const on = !!l && e.links.includes(l.id);
          return (
            <li key={i} className={l ? (on ? 'on' : 'off') : ''}>
              <span className="hs-d mono">{dayOf(e.at) === dayOf(now) ? `hoy ${hhmm(e.at)}` : dm(e.at)}</span>
              <div>
                <b>{e.label}</b>
                {(e.place || e.src) && <small>{[e.place, e.src].filter(Boolean).join(' · ')}</small>}
                <span className="hs-tags">
                  {e.links.map((id) => m.links.find((v) => v.id === id)).filter((v): v is PersonLink => !!v).map((v) => (
                    <button key={v.id} className={v.id === sel ? 'on' : ''} aria-pressed={v.id === sel} onClick={() => setSel(v.id === sel ? null : v.id)}><Icon name={KIND[v.kind].icon} />{v.label}</button>
                  ))}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
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
  const [det, setDet] = useState(m.detections.length - 1);
  const [sel, setSel] = useState<string | null>(null);
  const d = m.detections[Math.min(det, m.detections.length - 1)] ?? lastDetection(m);
  const [auto, setAuto] = useState(true);
  const [marks3d, setMarks3d] = useState(true);
  const [scan, setScan] = useState(true);
  const [reset, setReset] = useState(0);
  const seed = [...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);
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
      const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], canvas[tabindex]')].filter((x) => x.offsetParent !== null || x instanceof SVGElement);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], act = document.activeElement;
      if (e.shiftKey && (act === first || act === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('keydown', k, true); back?.focus?.(); };
  }, []);

  return createPortal(
    <div className="ds" role="dialog" aria-modal aria-label={`Expediente de ${m.name}`} ref={box} tabIndex={-1}>
      <header className="ds-hd">
        <div className="ds-id">
          <span className="ds-eyebrow mono">Expediente · {m.listRef} · {L.name}</span>
          <h1>{m.name}</h1>
          <span className="ds-reason">{m.reason}{m.orderUntil ? ` · vigente hasta el ${m.orderUntil}` : ''} · <span className="mono">{m.docId}</span></span>
        </div>
        <div className="ds-score" style={{ '--p': `${Math.round(d.score * 100)}` } as CSSProperties} aria-label={`Coincidencia ${pct(d.score)}`}>
          <b className="mono">{Math.round(d.score * 100)}<small>%</small></b><span>coincidencia</span>
        </div>
        <div className="ds-act">
          {canDecide && <>
            <button className="btn positive" onClick={onConfirm}><Icon name="check" />Es la persona: confirmar</button>
            <button className="btn secondary" onClick={onDiscard}><Icon name="close" />No coincide</button>
          </>}
          <button className="iconbtn ds-close" onClick={onClose} aria-label="Cerrar el expediente (Esc)"><Icon name="close" /></button>
        </div>
      </header>

      <div className="ds-grid">
        <section className="ds-panel ds-compare" aria-label="Comparar">
          <h2>Comparar <span className="ds-sub">hoy {m.detections.length} {m.detections.length === 1 ? 'detección' : 'detecciones'} · elige cuál</span></h2>
          <div className="ds-today" role="group" aria-label="Detecciones de hoy">
            {m.detections.map((x, i) => <button key={x.at} className={i === det ? 'on' : ''} aria-pressed={i === det} onClick={() => setDet(i)}><b className="mono">{hhmm(x.at)}</b> {x.cameraId} · <span className="mono">{pct(x.score)}</span></button>)}
          </div>
          <div className="ds-pair">
            <figure><ZoomImg src={d.capture} alt="Captura" /><figcaption><b>Captura {hhmm(d.at)}</b> · {d.cameraId} · {d.place}</figcaption></figure>
            {photo ? <figure><ZoomImg src={photo.src} alt={photo.caption} /><figcaption><b>{photo.caption}</b> · {photo.year} · <span className="mono">{pct(photo.score)}</span></figcaption></figure>
              : <figure><div className="ds-zoom ds-nophoto">Sin fotos en la lista</div><figcaption>&nbsp;</figcaption></figure>}
          </div>
          <div className="ds-strip" role="group" aria-label="Fotos en la lista">
            {photos.map((x, i) => <button key={x.src + i} className={i === ph ? 'on' : ''} aria-pressed={i === ph} onClick={() => setPh(i)}><img src={x.src} alt="" /><span>{x.caption}<b className="mono">{pct(x.score)}</b></span></button>)}
          </div>
          <p className="ds-hint">Clic en una imagen para ampliarla; la rueda acerca más.</p>
        </section>

        <section className="ds-panel ds-3d" aria-label="Reconstrucción 3D">
          <h2>Reconstrucción 3D <span className="ds-sub">afinada con {m.profile3d.detections} detecciones · {dateTime(m.profile3d.updatedAt)}</span></h2>
          <div className="ds-stage">
            <FaceCloud seed={seed} label={`Reconstrucción 3D del perfil ${m.listRef}`} interactive auto={auto} landmarks={marks3d} scan={scan} resetKey={reset} />
            <i className="ds-br tl" /><i className="ds-br tr" /><i className="ds-br bl" /><i className="ds-br brr" />
          </div>
          <div className="ds-tools" role="group" aria-label="Vista 3D">
            <button aria-pressed={auto} className={auto ? 'on' : ''} onClick={() => setAuto(!auto)}><Icon name={auto ? 'pause' : 'play_arrow'} />{auto ? 'Pausar giro' : 'Girar sola'}</button>
            <button aria-pressed={marks3d} className={marks3d ? 'on' : ''} onClick={() => setMarks3d(!marks3d)}><Icon name="hub" />Puntos de referencia</button>
            <button aria-pressed={scan} className={scan ? 'on' : ''} onClick={() => setScan(!scan)}><Icon name="radar" />Escaneo</button>
            <button onClick={() => setReset(reset + 1)}><Icon name="center_focus_strong" />Vista inicial</button>
          </div>
          <p className="ds-hint">Arrastrá para girar · rueda para acercar · flechas para girar · 0 vuelve.</p>
        </section>

        <section className="ds-panel ds-side" aria-label="Para confirmar">
          <h2>Señas para confirmar</h2>
          <Traits m={m} />
          <h2 className="ds-h2b">Datos</h2>
          <dl className="ds-dl">
            <dt>Nombre</dt><dd>{m.name}</dd>
            <dt>Documento</dt><dd className="mono">{m.docId}</dd>
            <dt>Lista</dt><dd>{L.name} · <span className="mono">{m.listRef}</span></dd>
            <dt>Procesado en</dt><dd className="mono">{m.spotbox}</dd>
            <dt>Agente</dt><dd>{m.agent}</dd>
          </dl>
          <div className="ds-src">
            <span className="ds-k">Fuentes</span>
            {FACIAL_SOURCES.map((s) => <span key={s.name} className={`ds-srcitem ${s.state}`}><i />{s.name}</span>)}
          </div>
        </section>

        <section className="ds-panel ds-links" aria-label="Conexiones">
          <h2>Conexiones <span className="ds-sub">{m.links.length} vínculos</span></h2>
          <Connections m={m} sel={sel} setSel={setSel} />
        </section>

        <section className="ds-panel ds-hist" aria-label="Historia">
          <h2>Historia <span className="ds-sub">{m.story.length} hechos, del más viejo al de hoy</span></h2>
          <History m={m} now={now} sel={sel} setSel={setSel} />
        </section>
      </div>
    </div>,
    document.body,
  );
}
