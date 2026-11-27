/* Revisar evidencia sin salir de la ficha, con lenguaje de visor (HUD), no de botones de ventana:
   · Inspectable: la miniatura. Al pasar el mouse se enciende un marco de mira en las esquinas, una lente
     que agranda lo que está bajo el puntero y, pegada a la lente, la pista "Clic · ampliar".
     Abajo a la derecha, una píldora para girar 90°.
   · ImageViewer: la imagen ampliada SOBRE EL MAPA (la ficha sigue abierta al lado). Marco de mira,
     lectura de zoom y giro arriba, y un dock flotante abajo (alejar, barra de zoom, acercar, girar,
     restablecer). Rueda para acercar hacia el puntero, arrastrar para mover, doble clic alterna 1×/2,5×,
     R gira, Esc cierra el visor (no la ficha).
   Funciona con foto, video o el marcador de "material pendiente" (regla de evidencia: nunca se inventa). */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Evidence as Ev } from '../api/types';
import { Evidence, Icon } from './kit';

const LENS = 132, LENS_ZOOM = 2.6;

export function Inspectable({ ev, tag, title, rotation, onRotate, onExpand, className = '' }: {
  ev: Ev; tag?: ReactNode; title: string; rotation: number; onRotate: () => void; onExpand: () => void; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Girada de costado, la miniatura se achica para que la imagen entre entera en el mismo recuadro.
  const [side, setSide] = useState(1);
  useEffect(() => {
    const b = box.current; if (!b) return undefined;
    const calc = () => { const w = b.offsetWidth, h = b.offsetHeight; setSide(rotation % 180 === 0 || !w || !h ? 1 : Math.min(w / h, h / w)); };
    calc(); const ro = new ResizeObserver(calc); ro.observe(b); return () => ro.disconnect();
  }, [rotation]);
  const rot = `rotate(${rotation}deg) scale(${side})`;

  const move = (e: RPointerEvent) => {
    if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('.insp-rotate')) { setLens(null); return; }
    const r = box.current!.getBoundingClientRect();
    setLens({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height });
  };
  // La pista va debajo de la lente; si no entra, arriba.
  const hintBelow = lens ? lens.y + LENS / 2 + 30 < lens.h : true;

  return (
    <div ref={box} className={`insp ${lens ? 'is-live' : ''} ${className}`} onPointerMove={move} onPointerLeave={() => setLens(null)}>
      <button type="button" className="insp-hit" onClick={onExpand} aria-label={`Ampliar ${title} sobre el mapa`}>
        <div className="insp-rot" style={{ transform: rot }}><Evidence ev={ev} /></div>
      </button>
      {tag && <span className="insp-tag">{tag}</span>}
      <span className="insp-hud" aria-hidden><i /><i /><i /><i /></span>

      <button type="button" className="insp-rotate" onClick={onRotate} aria-label={`Girar ${title} 90°`} title="Girar 90°">
        <RotateIcon /><span className="mono">{rotation}°</span>
      </button>

      {lens && (
        <>
          <div className="insp-lens" aria-hidden style={{ left: lens.x - LENS / 2, top: lens.y - LENS / 2, width: LENS, height: LENS }}>
            <div style={{ position: 'absolute', width: lens.w, height: lens.h, left: LENS / 2 - lens.x * LENS_ZOOM, top: LENS / 2 - lens.y * LENS_ZOOM, transform: `scale(${LENS_ZOOM})`, transformOrigin: '0 0' }}>
              <div className="insp-rot" style={{ transform: rot }}><Evidence ev={ev} /></div>
            </div>
            <span className="insp-cross" />
          </div>
          <span className="insp-hint" aria-hidden style={{ left: lens.x, top: hintBelow ? lens.y + LENS / 2 + 8 : lens.y - LENS / 2 - 30 }}>
            <ClickIcon />Clic · ampliar
          </span>
        </>
      )}
    </div>
  );
}

const MIN = 1, MAX = 6;
/** `nav` (opcional): varias imágenes en el mismo visor; se pasa de una a otra con ‹ › o las flechas. */
export function ImageViewer({ ev, title, sub, rotation, onRotate, onClose, nav }: {
  ev: Ev; title: string; sub?: string; rotation: number; onRotate: (deg: number) => void; onClose: () => void;
  nav?: { index: number; count: number; onGo: (i: number) => void };
}) {
  const host = typeof document !== 'undefined' ? document.querySelector('.mapwrap') : null;
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [hint, setHint] = useState(true);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setHint(false), 3200); return () => clearTimeout(t); }, []);

  // Girada de costado, la imagen se achica lo justo para seguir entrando entera.
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const calc = () => {
      const st = stage.current?.getBoundingClientRect(), im = img.current; if (!st || !im) return;
      const w = im.offsetWidth, h = im.offsetHeight;
      setFit(rotation % 180 === 0 || !w || !h ? 1 : Math.min(1, (st.width - 48) / h, (st.height - 48) / w));
    };
    calc();
    const ro = new ResizeObserver(calc); if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, [rotation]);

  const zoomTo = (nz: number, cx?: number, cy?: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, nz));
    // Zoom hacia el punto del puntero (o el centro): ese punto queda quieto en pantalla.
    if (cx !== undefined && cy !== undefined && stage.current) {
      const r = stage.current.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
      const k = clamped / z;
      setPan((p) => (clamped === 1 ? { x: 0, y: 0 } : { x: ox - (ox - p.x) * k, y: oy - (oy - p.y) * k }));
    } else if (clamped === 1) setPan({ x: 0, y: 0 });
    else setPan((p) => ({ x: p.x * (clamped / z), y: p.y * (clamped / z) }));
    setZ(clamped); setHint(false);
  };
  const reset = () => { setZ(1); setPan({ x: 0, y: 0 }); onRotate(0); };
  const turn = (d: number) => { onRotate((rotation + d + 360) % 360); setHint(false); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input:not([type="range"]), select, textarea')) return;
      // preventDefault: la consola no cierra la ficha con este Esc.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(z * 1.4); }
      else if (e.key === '-') { e.preventDefault(); zoomTo(z / 1.4); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopPropagation(); turn(e.shiftKey ? -90 : 90); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
      else if (nav && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); nav.onGo((nav.index + (e.key === 'ArrowRight' ? 1 : nav.count - 1)) % nav.count); }
    };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  });

  const wheel = (e: RWheelEvent) => zoomTo(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  // La rueda necesita un oyente no pasivo para poder frenar el scroll de la página.
  useEffect(() => {
    const el = stage.current; if (!el) return undefined;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false }); return () => el.removeEventListener('wheel', stop);
  }, []);
  const down = (e: RPointerEvent) => { if (z === 1) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; setPanning(true); };
  const moveP = (e: RPointerEvent) => { const d = drag.current; if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); };
  const up = () => { drag.current = null; setPanning(false); };

  if (!host) return null;
  return createPortal(
    <section className="iv" role="dialog" aria-label={`Imagen ampliada: ${title}`}>
      <header className="iv-hd">
        <div className="iv-title"><span className="iv-live" aria-hidden /><b>{title}</b>{sub && <span>{sub}</span>}</div>
        {nav && nav.count > 1 && (
          <div className="iv-nav" role="group" aria-label="Otras imágenes">
            <button type="button" className="iv-dbtn" onClick={() => nav.onGo((nav.index + nav.count - 1) % nav.count)} aria-label="Imagen anterior" title="Anterior (←)"><Icon name="chevron_left" /></button>
            <span className="mono" aria-live="polite">{nav.index + 1} / {nav.count}</span>
            <button type="button" className="iv-dbtn" onClick={() => nav.onGo((nav.index + 1) % nav.count)} aria-label="Imagen siguiente" title="Siguiente (→)"><Icon name="chevron_right" /></button>
          </div>
        )}
        <button type="button" className="iv-close" onClick={onClose} aria-label="Cerrar imagen ampliada" title="Cerrar (Esc)"><Icon name="close" /><span className="kbd">Esc</span></button>
      </header>

      <div ref={stage} className={`iv-stage ${z > 1 ? 'can-pan' : ''} ${panning ? 'panning' : ''}`} onWheel={wheel} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={(e) => zoomTo(z > 1 ? 1 : 2.5, e.clientX, e.clientY)}>
        <div ref={img} className="iv-img" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${z * fit}) rotate(${rotation}deg)` }}>
          <Evidence ev={ev} />
        </div>
        {/* Marco de mira y lecturas, como el HUD del mapa */}
        <span className="iv-hud" aria-hidden><i /><i /><i /><i /></span>
        <span className="iv-cross" aria-hidden />
        <span className="iv-read mono" aria-live="polite">ZOOM {Math.round(z * 100)}% · GIRO {rotation}°</span>
        <span className={`iv-hint ${hint ? '' : 'gone'}`} aria-hidden><ScrollIcon />Rueda para acercar · arrastra para mover · doble clic</span>
      </div>

      <div className="iv-dock" role="toolbar" aria-label="Controles de la imagen">
        <button type="button" className="iv-dbtn" onClick={() => zoomTo(z / 1.4)} disabled={z <= MIN} aria-label="Alejar" title="Alejar (−)"><span className="iv-sym">−</span></button>
        <input className="iv-range" type="range" min={100} max={600} step={10} value={Math.round(z * 100)} onChange={(e) => zoomTo(Number(e.target.value) / 100)} aria-label="Nivel de zoom" style={{ ['--p' as string]: `${((z - MIN) / (MAX - MIN)) * 100}%` }} />
        <button type="button" className="iv-dbtn" onClick={() => zoomTo(z * 1.4)} disabled={z >= MAX} aria-label="Acercar" title="Acercar (+)"><span className="iv-sym">+</span></button>
        <span className="iv-dsep" />
        <button type="button" className="iv-dbtn" onClick={() => turn(-90)} aria-label="Girar a la izquierda" title="Girar a la izquierda (Mayús+R)"><span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><RotateIcon /></span></button>
        <button type="button" className="iv-dbtn" onClick={() => turn(90)} aria-label="Girar a la derecha" title="Girar a la derecha (R)"><RotateIcon /></button>
        <span className="iv-dsep" />
        <button type="button" className="iv-dbtn wide" onClick={reset} disabled={z === 1 && rotation === 0} title="Volver al tamaño y giro original (0)">Restablecer</button>
      </div>
    </section>,
    host,
  );
}

function RotateIcon() {
  return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M15.5 9.5A5.5 5.5 0 1 1 13.9 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M14.5 2.5v3.6h-3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
/** Mouse con el botón izquierdo marcado: "esto se hace con un clic". */
function ClickIcon() {
  return <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1.5v4.5H4.2A4 4 0 0 1 8 1.5Z" fill="currentColor" /></svg>;
}
/** Mouse con la rueda marcada: "acercá con la rueda". */
function ScrollIcon() {
  return <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 4v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

/** Miniaturas ampliables de una ficha y su visor: cada miniatura recuerda su giro; una sola abierta a la vez. */
export function useInspect(sub: string) {
  const [rot, setRot] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<{ key: string; ev: Ev; title: string } | null>(null);
  const setR = (key: string, deg: number) => setRot((r) => ({ ...r, [key]: deg }));
  const thumb = (key: string, ev: Ev, title: string, tag?: ReactNode) => (
    <Inspectable key={key} ev={ev} title={title} tag={tag} rotation={rot[key] ?? 0}
      onRotate={() => setR(key, ((rot[key] ?? 0) + 90) % 360)} onExpand={() => setOpen({ key, ev, title })} />
  );
  const viewer = open && (
    <ImageViewer ev={open.ev} title={open.title} sub={sub} rotation={rot[open.key] ?? 0} onRotate={(d) => setR(open.key, d)} onClose={() => setOpen(null)} />
  );
  return { thumb, viewer };
}
