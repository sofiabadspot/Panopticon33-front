/* Marca de Jules: la Nebulosa original (WebGL, colores de Spotvision: --jules-c1…c5 en theme.css).
   Copia de sentinel-front/src/components/ds/Nebulosa.jsx, sin el modo interactivo.
   Cambia según lo que hace: quieto, escucha (más luz), piensa (orbita rápido) y habla (late suave). */
import { useEffect, useRef } from 'react';
import { registerOrb, type JulesState } from './nebulosa/renderer';

export function Nebulosa({ size = 24, state = 'idle' }: { size?: number; state?: JulesState }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const orbe = useRef<ReturnType<typeof registerOrb> | null>(null);

  useEffect(() => {
    if (!lienzo.current) return;
    const o = registerOrb(lienzo.current);
    orbe.current = o;
    return () => { o.dispose(); orbe.current = null; };
  }, []);

  useEffect(() => { orbe.current?.set(state); }, [state]);

  return (
    <span className="jg" data-state={state} aria-hidden style={{ width: size, height: size }}>
      <canvas ref={lienzo} />
    </span>
  );
}
