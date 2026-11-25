/* Expediente de una persona a pantalla completa (verificación facial).
   Se abre desde la ficha facial para revisar todo junto y con detalle antes de decidir:
   · Comparar: la captura (o la de cualquier detección) junto a la foto de la lista que se elija.
     Clic en una imagen la amplía ahí mismo; mover el mouse recorre la imagen y la rueda acerca más.
   · Reconstrucción 3D: se gira arrastrando, la rueda acerca, puede girar sola, marcar los puntos de
     referencia del rostro y escanear.
   · Señas para confirmar: cada seña de la lista se marca como "Coincide" o "No coincide" frente a lo que
     se ve en la captura, con un resumen. Es ayuda para decidir; no queda guardado.
   · Conexiones: la persona en el centro y lo que tiene vinculado (vehículos, personas, lugares, casos).
   · Detecciones, datos y fuentes. El 911 decide desde acá también.
   Esc cierra el expediente (no la ficha). Todo es de ejemplo hasta que lleguen los datos reales. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ago, dateTime, hhmm, pct } from '../../api/format';
import { FACIAL_LISTS, FACIAL_SOURCES, lastDetection, type FacialMatch, type LinkKind } from '../../api/facial';
import { FaceCloud } from '../../ui/FaceCloud';
import { Icon, useNow } from '../../ui/kit';

const KIND: Record<LinkKind, { label: string; icon: string; angle: number }> = {
  vehiculo: { label: 'Vehículos', icon: 'directions_car', angle: -150 },
  persona: { label: 'Personas', icon: 'person', angle: -30 },
  lugar: { label: 'Lugares', icon: 'location_on', angle: 150 },
  caso: { label: 'Casos', icon: 'gavel', angle: 30 },
};

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

/** Conexiones: la persona al centro y cada vínculo en su cuadrante (vehículos, personas, lugares, casos).
    El grosor de la línea es la fuerza del vínculo; al pasar el mouse se resalta y se lee el detalle. */
function Connections({ m }: { m: FacialMatch }) {
  const [hover, setHover] = useState<number | null>(null);
  // Ancho de sobra para los rótulos; los nodos se mantienen lejos de los bordes.
  const W = 860, H = 300, cx = W / 2, cy = H / 2, PAD = 190;
  const nodes = useMemo(() => {
    const out: { i: number; x: number; y: number; kind: LinkKind }[] = [];
    (Object.keys(KIND) as LinkKind[]).forEach((k) => {
      const list = m.links.map((l, i) => ({ l, i })).filter((x) => x.l.kind === k);
      list.forEach((x, j) => {
        const a = ((KIND[k].angle + (j - (list.length - 1) / 2) * 22) * Math.PI) / 180;
        const r = 120 + (j % 2) * 22;
        out.push({ i: x.i, x: Math.max(PAD, Math.min(W - PAD, cx + Math.cos(a) * r * 1.9)), y: Math.max(24, Math.min(H - 24, cy + Math.sin(a) * r * 0.95)), kind: k });
      });
    });
    return out;
  }, [m, cx, cy]);
  const h = hover != null ? m.links[hover] : null;
  return (
    <div className="ds-graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Conexiones de ${m.listRef}`}>
        <defs><clipPath id={`ds-face-${m.id}`}><circle cx={cx} cy={cy} r="30" /></clipPath></defs>
        {nodes.map((n) => {
          const l = m.links[n.i];
          return <line key={'e' + n.i} x1={cx} y1={cy} x2={n.x} y2={n.y} className={`ds-edge ${hover === n.i ? 'on' : hover != null ? 'dim' : ''}`} style={{ strokeWidth: 0.8 + l.weight * 2.4 }} />;
        })}
        <circle cx={cx} cy={cy} r="38" className="ds-ring" />
        <image href={m.listPhotos[0]?.src} x={cx - 30} y={cy - 30} width="60" height="60" preserveAspectRatio="xMidYMid slice" clipPath={`url(#ds-face-${m.id})`} aria-hidden />
        <g role="list">{nodes.map((n) => {
          const l = m.links[n.i];
          return (
            <g key={'n' + n.i} className={`ds-node k-${n.kind} ${hover === n.i ? 'on' : hover != null ? 'dim' : ''}`} transform={`translate(${n.x} ${n.y})`}
              onMouseEnter={() => setHover(n.i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.i)} onBlur={() => setHover(null)} tabIndex={0} role="listitem" aria-label={`${KIND[n.kind].label}: ${l.label}, ${l.sub}`}>
              <circle r="15" />
              <foreignObject x="-8" y="-8" width="16" height="16"><Icon name={KIND[n.kind].icon} /></foreignObject>
              <text className="ds-node-lbl" textAnchor={n.x < cx ? 'end' : 'start'} x={n.x < cx ? -22 : 22} dy="4">{l.label}</text>
            </g>
          );
        })}</g>
      </svg>
      <div className="ds-legend">
        {(Object.keys(KIND) as LinkKind[]).filter((k) => m.links.some((l) => l.kind === k)).map((k) => <span key={k}><Icon name={KIND[k].icon} />{KIND[k].label} <b className="mono">{m.links.filter((l) => l.kind === k).length}</b></span>)}
      </div>
      <p className="ds-graph-note" aria-live="polite">{h ? <><b>{h.label}</b> · {h.sub}</> : 'Pasá el mouse por una conexión para ver el detalle.'}</p>
    </div>
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
  const d = m.detections[Math.min(det, m.detections.length - 1)] ?? lastDetection(m);
  const [auto, setAuto] = useState(true);
  const [marks3d, setMarks3d] = useState(true);
  const [scan, setScan] = useState(true);
  const [reset, setReset] = useState(0);
  const [checks, setChecks] = useState<Record<string, 'si' | 'no' | undefined>>({});
  const yes = m.marks.filter((x) => checks[x] === 'si').length, no = m.marks.filter((x) => checks[x] === 'no').length;
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
          <h2>Comparar</h2>
          <div className="ds-pair">
            <figure><ZoomImg src={d.capture} alt="Captura" /><figcaption><b>Captura</b> · {d.cameraId} · {hhmm(d.at)}</figcaption></figure>
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
          <h2>Señas para confirmar <span className="ds-sub" aria-live="polite">{yes} de {m.marks.length} coinciden{no ? ` · ${no} no` : ''}</span></h2>
          <div className="ds-meter" aria-hidden><i className="si" style={{ width: `${(yes / Math.max(1, m.marks.length)) * 100}%` }} /><i className="no" style={{ width: `${(no / Math.max(1, m.marks.length)) * 100}%` }} /></div>
          <ul className="ds-marks">
            {m.marks.map((x) => (
              <li key={x}>
                <span>{x}</span>
                <span className="ds-yn" role="group" aria-label={x}>
                  <button className={checks[x] === 'si' ? 'si' : ''} aria-pressed={checks[x] === 'si'} onClick={() => setChecks((c) => ({ ...c, [x]: c[x] === 'si' ? undefined : 'si' }))}><Icon name="check" />Coincide</button>
                  <button className={checks[x] === 'no' ? 'no' : ''} aria-pressed={checks[x] === 'no'} onClick={() => setChecks((c) => ({ ...c, [x]: c[x] === 'no' ? undefined : 'no' }))}><Icon name="close" />No</button>
                </span>
              </li>
            ))}
          </ul>
          <div className="ds-seen"><span className="ds-k">En la captura</span>{m.observed.map((x) => <span key={x} className="chip">{x}</span>)}</div>
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
          <h2>Conexiones <span className="ds-sub">{m.links.length}</span></h2>
          <Connections m={m} />
        </section>

        <section className="ds-panel ds-dets" aria-label="Detecciones">
          <h2>Detecciones <span className="ds-sub">{m.detections.length} · la última {ago(lastDetection(m).at, now)}</span></h2>
          <ol className="ds-tl">
            {[...m.detections].map((x, i) => ({ x, i })).reverse().map(({ x, i }) => (
              <li key={x.at}>
                <button className={i === det ? 'on' : ''} aria-pressed={i === det} onClick={() => setDet(i)} title="Comparar con esta captura">
                  <img src={x.capture} alt="" />
                  <span><b className="mono">{hhmm(x.at)}</b><small>{x.cameraId} · {x.place}</small></span>
                  <b className="mono ds-tl-s">{pct(x.score)}</b>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>,
    document.body,
  );
}
