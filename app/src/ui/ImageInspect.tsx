/* Revisar evidencia sin salir de la ficha, con lenguaje de visor (HUD), no de botones de ventana:
   · Inspectable: la miniatura. Al pasar el mouse se enciende un marco de mira en las esquinas, una lente
     que agranda lo que está bajo el puntero y, pegada a la lente, la pista "Clic · ampliar".
     Abajo a la derecha, una píldora para girar 90°.
   · ImageViewer: la imagen ampliada SOBRE EL MAPA, con el visor único (ui/MediaViewer).
   Funciona con foto, video o el marcador de "material pendiente" (regla de evidencia: nunca se inventa). */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Evidence as Ev } from '../api/types';
import { Evidence } from './kit';
import { MediaViewer, RotateIcon } from './MediaViewer';

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

/** Evidencia ampliada sobre el mapa: el visor único (ui/MediaViewer) con giro.
    `nav` (opcional): varias imágenes en el mismo visor; se pasa de una a otra con ‹ › o las flechas. */
export function ImageViewer({ ev, title, sub, rotation, onRotate, onClose, nav }: {
  ev: Ev; title: string; sub?: string; rotation: number; onRotate: (deg: number) => void; onClose: () => void;
  nav?: { index: number; count: number; onGo: (i: number) => void };
}) {
  return <MediaViewer title={title} sub={sub} rotation={rotation} onRotate={onRotate} onClose={onClose} nav={nav}><Evidence ev={ev} /></MediaViewer>;
}

/** Mouse con el botón izquierdo marcado: "esto se hace con un clic". */
function ClickIcon() {
  return <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1.5v4.5H4.2A4 4 0 0 1 8 1.5Z" fill="currentColor" /></svg>;
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
