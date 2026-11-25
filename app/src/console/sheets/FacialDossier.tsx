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
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { dateTime, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, FACIAL_SOURCES, TRAIT_GROUPS, lastDetection, type FacialMatch, type LinkKind, type TraitGroup } from '../../api/facial';
import { FaceCloud } from '../../ui/FaceCloud';
import { FaceTrail } from './FaceTrail';
import { Icon } from '../../ui/kit';

const KIND: Record<LinkKind, { label: string; one: string; icon: string }> = {
  vehiculo: { label: 'Vehículos', one: 'Vehículo', icon: 'directions_car' },
  persona: { label: 'Personas', one: 'Persona', icon: 'person' },
  lugar: { label: 'Lugares', one: 'Lugar', icon: 'location_on' },
  caso: { label: 'Casos', one: 'Caso', icon: 'gavel' },
};
// Mismo día en hora de El Salvador (no en UTC).
const strength = (w: number) => (w >= 0.75 ? 'Vínculo fuerte' : w >= 0.5 ? 'Vínculo medio' : 'Vínculo débil');

/** Lugar reservado para una imagen que todavía no hay (el prototipo no usa fotos ficticias). */
export function Shot({ label }: { label?: string }) {
  return <span className="shot"><span className="ph-ev"><img src="/assets/logo-spotvision-bn.png" alt="" />{label && <b>{label}</b>}</span></span>;
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

/** Conexiones: la persona al centro y, alrededor, un bloque por grupo (vehículos, personas, lugares,
    casos) con lo que tiene vinculado adentro, del vínculo más fuerte al más débil. Elegir una conexión
    muestra sus datos ahí mismo; otra vez la cierra. */
function Connections({ m, sel, setSel }: { m: FacialMatch; sel: string | null; setSel: (id: string | null) => void }) {
  const order = Object.keys(KIND) as LinkKind[];
  const l = sel ? m.links.find((v) => v.id === sel) : undefined;
  // Ubicación fija: vehículos arriba a la izquierda, personas arriba a la derecha, lugares abajo a la
  // izquierda, casos abajo a la derecha. La línea de cada bloque sale de la persona.
  const POS: Record<LinkKind, [number, number]> = { vehiculo: [22, 26], persona: [78, 26], lugar: [22, 74], caso: [78, 74] };
  return (
    <div className="cn">
      <svg className="cn-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {order.map((k) => <line key={k} x1="50" y1="50" x2={POS[k][0]} y2={POS[k][1]} className={l?.kind === k ? 'on' : ''} />)}
      </svg>
      <div className="cn-me">
        <span className="cn-face"><Icon name="person" /></span>
        <b>{m.name}</b>
        <small className="mono">{m.listRef} · {m.links.length} vínculos</small>
      </div>
      {order.map((k) => {
        const list = m.links.filter((v) => v.kind === k).sort((a, b) => b.weight - a.weight);
        return (
          <section key={k} className={`cn-g g-${k} ${l?.kind === k ? 'on' : ''}`} aria-label={`${KIND[k].label}: ${list.length}`}>
            <h3><Icon name={KIND[k].icon} />{KIND[k].label}<span className="mono">{list.length}</span></h3>
            {list.length ? list.map((v) => (
              <button key={v.id} className={`cn-item ${v.id === sel ? 'on' : ''}`} aria-pressed={v.id === sel} onClick={() => setSel(v.id === sel ? null : v.id)}
                title={`${strength(v.weight)} · ${v.events.length} ${v.events.length === 1 ? 'hecho' : 'hechos'}`}>
                <span className="cn-w" aria-hidden><i style={{ height: `${v.weight * 100}%` }} /></span>
                <span><b>{v.label}</b><small>{v.sub}</small>
                  {v.id === sel && <dl className="cn-facts">{v.facts.map(([k, val]) => <Fragment key={k}><dt>{k}</dt><dd>{val}</dd></Fragment>)}</dl>}
                </span>
              </button>
            )) : <p className="cn-none">Sin vínculos</p>}
          </section>
        );
      })}
    </div>
  );
}

/** Metadatos de la persona en un solo lugar y con un solo formato: identidad, señas (lo que dice la
    lista y lo que se ve en la captura) y fuentes. */
function Meta({ m }: { m: FacialMatch }) {
  const L = FACIAL_LISTS[m.list];
  const groups = (Object.keys(TRAIT_GROUPS) as TraitGroup[]).filter((g) => m.traits.some((x) => x.group === g));
  return (
    <div className="md">
      <h3>Identidad</h3>
      <dl>
        <dt>Nombre</dt><dd>{m.name}</dd>
        <dt>Documento</dt><dd className="mono">{m.docId}</dd>
        <dt>Lista</dt><dd>{L.name} · <span className="mono">{m.listRef}</span></dd>
        <dt>Motivo</dt><dd>{m.reason}{m.orderUntil ? ` · hasta el ${m.orderUntil}` : ''}</dd>
        <dt>Procesado en</dt><dd className="mono">{m.spotbox}</dd>
        <dt>Agente</dt><dd>{m.agent}</dd>
      </dl>
      {groups.map((g) => (
        <Fragment key={g}>
          <h3>{TRAIT_GROUPS[g]}</h3>
          <dl>
            {m.traits.filter((x) => x.group === g).map((x, i) => (
              <Fragment key={i}>
                <dt>{x.label}</dt>
                <dd>
                  {x.list && <span><i>Lista</i>{x.list}</span>}
                  <span><i>Captura</i>{x.seen ?? <em>no se ve{x.note ? ` · ${x.note}` : ''}</em>}</span>
                </dd>
              </Fragment>
            ))}
          </dl>
        </Fragment>
      ))}
      <h3>Fuentes</h3>
      <dl>{FACIAL_SOURCES.map((s) => <Fragment key={s.name}><dt>{s.name}</dt><dd className={s.state === 'conectada' ? 'ok' : 'muted'}>{s.state === 'conectada' ? 'Conectada' : 'Por conectar'}</dd></Fragment>)}</dl>
    </div>
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

export function FacialDossier({ m, canDecide, onConfirm, onDiscard, onClose }: {
  m: FacialMatch; canDecide: boolean; onConfirm: () => void; onDiscard: () => void; onClose: () => void;
}) {
  const L = FACIAL_LISTS[m.list];
  const photos = useMemo(() => [...m.listPhotos].sort((a, b) => b.score - a.score), [m.listPhotos]);
  const [sel, setSel] = useState<string | null>(null);
  // Todas las imágenes juntas: primero las fotos de la lista, después las capturas de hoy en orden.
  const imgs = useMemo(() => [
    ...photos.map((x) => ({ src: x.src, kind: 'lista' as const, title: x.caption, sub: `${x.year} · ${pct(x.score)}` })),
    ...m.detections.map((x) => ({ src: x.capture, kind: 'captura' as const, title: `${hhmm(x.at)} · ${x.cameraId}`, sub: `${x.place} · ${pct(x.score)}` })),
  ], [photos, m.detections]);
  const [big, setBig] = useState<number | null>(null);
  const bigRef = useRef(big); bigRef.current = big;
  const best = m.detections.length ? Math.max(...m.detections.map((x) => x.score)) : lastDetection(m).score;
  const [auto, setAuto] = useState(true);
  const [marks3d, setMarks3d] = useState(true);
  const [scan, setScan] = useState(true);
  const [reset, setReset] = useState(0);
  const seed = [...m.listRef].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const imgsRef = useRef(imgs.length); imgsRef.current = imgs.length;
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  // Al abrir toma el foco (una sola vez); Esc lo cierra sin cerrar nada más; Tab queda adentro; al
  // cerrar, el foco vuelve a donde estaba (el botón que lo abrió).
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (bigRef.current != null) setBig(null); else close.current(); return; }
      if (bigRef.current != null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); const n = imgsRef.current; setBig((b) => (b == null ? b : (b + (e.key === 'ArrowRight' ? 1 : n - 1)) % n)); return; }
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

      <div className="ds-grid">
        <section className="ds-panel ds-compare" aria-label="Imágenes">
          <h2>Imágenes <span className="ds-sub">{photos.length} de la lista · {m.detections.length} de hoy · toca una para verla grande</span></h2>
          <div className="gl">
            {imgs.map((x, i) => (
              <button key={x.src + i} className={`gl-t ${x.kind}`} onClick={() => setBig(i)} aria-label={`Ver grande: ${x.kind === 'lista' ? 'foto de la lista' : 'captura'} ${x.title}`}>
                {x.src ? <img src={x.src} alt="" /> : <Shot />}
                <span className="gl-tag mono">{x.kind === 'lista' ? 'Lista' : 'Hoy'}</span>
                <span className="gl-cap"><b>{x.title}</b><small>{x.sub}</small></span>
              </button>
            ))}
          </div>
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

        <section className="ds-panel ds-side" aria-label="Metadatos">
          <h2>Metadatos</h2>
          <Meta m={m} />
        </section>

        <section className="ds-panel ds-links" aria-label="Conexiones">
          <h2>Conexiones <span className="ds-sub">{m.links.length} vínculos</span></h2>
          <Connections m={m} sel={sel} setSel={setSel} />
        </section>

        <section className="ds-panel ds-hist" aria-label="Recorrido de hoy">
          <h2>Recorrido de hoy <span className="ds-sub">{m.detections.length} capturas en el mapa, en orden de hora · toca una para verla grande</span></h2>
          <FaceTrail dets={m.detections} onOpen={(i) => setBig(photos.length + i)} />
        </section>
      </div>

      {big != null && imgs[big] && (() => {
        const x = imgs[big];
        const ref = x.kind === 'captura' ? imgs[0] : null;
        return (
          <div className="lb" role="group" aria-label="Imagen ampliada">
            <div className="lb-hd">
              <span className="mono">{big + 1} / {imgs.length}</span>
              <b>{x.kind === 'lista' ? 'Foto de la lista' : 'Captura de hoy'} · {x.title}</b>
              <span className="lb-sub">{x.sub}</span>
              <button className="iconbtn" aria-label="Cerrar la imagen (Esc)" onClick={() => setBig(null)}><Icon name="close" /></button>
            </div>
            <div className={`lb-body ${ref ? 'two' : ''}`}>
              <figure><ZoomImg key={x.src + big} src={x.src} alt={x.title} /><figcaption>{x.kind === 'lista' ? 'Lista' : 'Captura'}</figcaption></figure>
              {ref && <figure><ZoomImg src={ref.src} alt={ref.title} /><figcaption>Para comparar: {ref.title} (lista)</figcaption></figure>}
            </div>
            <div className="lb-nav">
              <button className="btn secondary sm" onClick={() => setBig((big + imgs.length - 1) % imgs.length)}><Icon name="chevron_left" />Anterior</button>
              <div className="lb-strip">{imgs.map((y, i) => <button key={y.src + i} className={i === big ? 'on' : ''} aria-label={y.title} aria-pressed={i === big} onClick={() => setBig(i)}>{y.src ? <img src={y.src} alt="" /> : <Shot />}</button>)}</div>
              <button className="btn secondary sm" onClick={() => setBig((big + 1) % imgs.length)}>Siguiente<Icon name="chevron_right" /></button>
            </div>
          </div>
        );
      })()}
    </div>,
    document.body,
  );
}
