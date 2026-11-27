/* Visor único de material (foto, video, documento, registro). Lo usan:
   · la evidencia de una ficha, ampliada SOBRE EL MAPA (la ficha sigue abierta al lado);
   · el expediente facial, para sus capturas, respaldos y documentos.
   Siempre igual: cabecera con título, detalle, anterior/siguiente y cerrar (Esc); en el medio el material
   con marco de mira; abajo, la tira de miniaturas (si hay varias) y el dock de zoom y giro.
   Rueda para acercar hacia el puntero, arrastrar para mover, doble clic alterna 1×/2,5×,
   + − 0 con el teclado, R gira (si se puede girar), ← → pasan de una a otra, Esc cierra el visor
   (no la ficha). Con `compare`, la referencia va al lado y se acerca junto con la principal. */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './kit';

const MIN = 1, MAX = 6;

export interface MediaNav {
  index: number; count: number; onGo: (i: number) => void;
  /** Miniaturas de todas (opcional): una por elemento, en el mismo orden. */
  thumbs?: { label: string; node: ReactNode }[];
}

export function MediaViewer({ title, sub, icon, onClose, nav, rotation, onRotate, compare, kind = 'media', mount = 'map', className = '', children }: {
  title: string; sub?: string; icon?: string; onClose: () => void;
  nav?: MediaNav;
  /** Giro controlado desde afuera (cada miniatura recuerda el suyo). Sin onRotate, no se gira. */
  rotation?: number; onRotate?: (deg: number) => void;
  /** Material de referencia al lado, con su leyenda (p. ej., la foto de la lista). */
  compare?: { node: ReactNode; caption: ReactNode; mainCaption?: ReactNode } | null;
  /** 'media': foto o video 16:9. 'document': hoja o registro, a lo alto. */
  kind?: 'media' | 'document';
  /** 'map': se monta sobre el mapa (portal). 'inline': donde se lo ponga (el expediente). */
  mount?: 'map' | 'inline';
  className?: string;
  children: ReactNode;
}) {
  const rot = onRotate ? rotation ?? 0 : 0;
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [hint, setHint] = useState(true);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setHint(false), 3200); return () => clearTimeout(t); }, []);
  // Al pasar a otro material, vuelve al tamaño original.
  useEffect(() => { setZ(1); setPan({ x: 0, y: 0 }); }, [nav?.index]);

  // Girada de costado, la imagen se achica lo justo para seguir entrando entera.
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const calc = () => {
      const st = stage.current?.getBoundingClientRect(), im = img.current; if (!st || !im) return;
      const w = im.offsetWidth, h = im.offsetHeight;
      setFit(rot % 180 === 0 || !w || !h ? 1 : Math.min(1, (st.width - 48) / h, (st.height - 48) / w));
    };
    calc();
    const ro = new ResizeObserver(calc); if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, [rot]);

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
  const reset = () => { setZ(1); setPan({ x: 0, y: 0 }); onRotate?.(0); };
  const turn = (d: number) => { if (!onRotate) return; onRotate((rot + d + 360) % 360); setHint(false); };
  const go = (d: 1 | -1) => nav && nav.onGo((nav.index + d + nav.count) % nav.count);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input:not([type="range"]), select, textarea')) return;
      // preventDefault: la consola no cierra la ficha con este Esc.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(z * 1.4); }
      else if (e.key === '-') { e.preventDefault(); zoomTo(z / 1.4); }
      else if ((e.key === 'r' || e.key === 'R') && onRotate) { e.preventDefault(); e.stopPropagation(); turn(e.shiftKey ? -90 : 90); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
      else if (nav && nav.count > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); go(e.key === 'ArrowRight' ? 1 : -1); }
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

  const many = !!nav && nav.count > 1;
  const body = (
    <section className={`iv ${className}`.trim()} role="dialog" aria-label={`Ampliado: ${title}`}>
      <header className="iv-hd">
        <div className="iv-title">{icon ? <Icon name={icon} /> : <span className="iv-live" aria-hidden />}<b>{title}</b>{sub && <span>{sub}</span>}</div>
        {many && (
          <div className="iv-nav" role="group" aria-label="Otros elementos">
            <button type="button" className="iv-dbtn" onClick={() => go(-1)} aria-label="Anterior" title="Anterior (←)"><Icon name="chevron_left" /></button>
            <span className="mono" aria-live="polite">{nav!.index + 1} / {nav!.count}</span>
            <button type="button" className="iv-dbtn" onClick={() => go(1)} aria-label="Siguiente" title="Siguiente (→)"><Icon name="chevron_right" /></button>
          </div>
        )}
        <button type="button" className="iv-close" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)"><Icon name="close" /><span className="kbd">Esc</span></button>
      </header>

      <div ref={stage} className={`iv-stage ${z > 1 ? 'can-pan' : ''} ${panning ? 'panning' : ''}`} onWheel={wheel} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={(e) => zoomTo(z > 1 ? 1 : 2.5, e.clientX, e.clientY)}>
        <div ref={img} className={`iv-img ${kind === 'document' ? 'doc' : ''} ${compare ? 'two' : ''}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${z * fit}) rotate(${rot}deg)` }}>
          {compare ? <>
            <figure>{children}{compare.mainCaption && <figcaption>{compare.mainCaption}</figcaption>}</figure>
            <figure>{compare.node}<figcaption>{compare.caption}</figcaption></figure>
          </> : children}
        </div>
        {/* Marco de mira y lecturas, como el HUD del mapa */}
        <span className="iv-hud" aria-hidden><i /><i /><i /><i /></span>
        <span className="iv-cross" aria-hidden />
        <span className="iv-read mono" aria-live="polite">ZOOM {Math.round(z * 100)}%{onRotate ? ` · GIRO ${rot}°` : ''}</span>
        <span className={`iv-hint ${hint ? '' : 'gone'}`} aria-hidden><ScrollIcon />Rueda para acercar · arrastra para mover · doble clic</span>
      </div>

      {many && nav!.thumbs && (
        <div className="iv-strip" role="group" aria-label="Todos los elementos">
          {nav!.thumbs.map((t, i) => <button key={i} type="button" className={i === nav!.index ? 'on' : ''} aria-label={t.label} aria-pressed={i === nav!.index} onClick={() => nav!.onGo(i)}>{t.node}</button>)}
        </div>
      )}

      <div className="iv-dock" role="toolbar" aria-label="Controles">
        <button type="button" className="iv-dbtn" onClick={() => zoomTo(z / 1.4)} disabled={z <= MIN} aria-label="Alejar" title="Alejar (−)"><span className="iv-sym">−</span></button>
        <input className="iv-range" type="range" min={100} max={600} step={10} value={Math.round(z * 100)} onChange={(e) => zoomTo(Number(e.target.value) / 100)} aria-label="Nivel de zoom" style={{ ['--p' as string]: `${((z - MIN) / (MAX - MIN)) * 100}%` }} />
        <button type="button" className="iv-dbtn" onClick={() => zoomTo(z * 1.4)} disabled={z >= MAX} aria-label="Acercar" title="Acercar (+)"><span className="iv-sym">+</span></button>
        {onRotate && <>
          <span className="iv-dsep" />
          <button type="button" className="iv-dbtn" onClick={() => turn(-90)} aria-label="Girar a la izquierda" title="Girar a la izquierda (Mayús+R)"><span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><RotateIcon /></span></button>
          <button type="button" className="iv-dbtn" onClick={() => turn(90)} aria-label="Girar a la derecha" title="Girar a la derecha (R)"><RotateIcon /></button>
        </>}
        <span className="iv-dsep" />
        <button type="button" className="iv-dbtn wide" onClick={reset} disabled={z === 1 && rot === 0} title="Volver al tamaño original (0)">Restablecer</button>
      </div>
    </section>
  );
  if (mount === 'inline') return body;
  const host = typeof document !== 'undefined' ? document.querySelector('.mapwrap') : null;
  return host ? createPortal(body, host) : null;
}

export function RotateIcon() {
  return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M15.5 9.5A5.5 5.5 0 1 1 13.9 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M14.5 2.5v3.6h-3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
/** Mouse con la rueda marcada: "acerca con la rueda". */
function ScrollIcon() {
  return <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 4v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
