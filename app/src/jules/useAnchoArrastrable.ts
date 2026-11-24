/* Ancho de un panel que se cambia arrastrando su borde (o con ← → desde el teclado). Copia de
   sync-front/src/components/jules/useAnchoArrastrable.js. Lo usan el panel de conversaciones y
   el lateral de Jules.
   lado: de qué lado del panel está el borde ('izquierda' o 'derecha'). Jules está pegado a la
     derecha de la pantalla, así que su borde está a la izquierda: ir a la izquierda lo agranda.
   inicial: ancho de arranque (null = el del CSS).
   onMover(ancho): avisa cada cambio mientras se arrastra (Jules: la columna de la consola sigue
     al mouse). onCambio(ancho): avisa el ancho final al soltar.
   limites: [mínimo, máximo] en px cuando el ancho no lo limita el CSS (la columna de la consola).
   medir(panel): qué ancho se toma como el actual (Jules: el de la columna que lo contiene). */
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export function useAnchoArrastrable<T extends HTMLElement = HTMLElement>({ lado = 'izquierda', inicial = null, onMover, onCambio, limites, medir }: {
  lado?: 'izquierda' | 'derecha'; inicial?: number | null; onMover?: (ancho: number) => void; onCambio?: (ancho: number) => void; limites?: [number, number];
  medir?: (panel: T) => number;
} = {}) {
  const [ancho, setAnchoCrudo] = useState<number | null>(inicial);
  const panelRef = useRef<T>(null);
  const borde = lado === 'izquierda';

  const limitar = (valor: number) => (limites ? Math.min(limites[1], Math.max(limites[0], valor)) : valor);
  const anchoActual = () => (panelRef.current ? (medir ? medir(panelRef.current) : panelRef.current.offsetWidth) : 0);
  const setAncho = (valor: number) => { const v = limitar(valor); setAnchoCrudo(v); onMover?.(v); return v; };

  function empezarArrastre(evento: ReactPointerEvent<HTMLElement>) {
    evento.preventDefault();
    const elemento = evento.currentTarget;
    elemento.setPointerCapture(evento.pointerId);
    const densidad = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const desdeX = evento.clientX;
    const desdeAncho = anchoActual();
    let ultimo = desdeAncho;
    document.body.classList.add('svx-arrastrando');

    function mover(e: PointerEvent) {
      const corrido = (desdeX - e.clientX) / densidad;
      ultimo = setAncho(desdeAncho + (borde ? corrido : -corrido));
    }
    function soltar() {
      const final = limites ? ultimo : anchoActual();
      setAncho(final);
      onCambio?.(final);
      document.body.classList.remove('svx-arrastrando');
      elemento.removeEventListener('pointermove', mover);
      elemento.removeEventListener('pointerup', soltar);
      elemento.removeEventListener('pointercancel', soltar);
    }
    elemento.addEventListener('pointermove', mover);
    elemento.addEventListener('pointerup', soltar);
    elemento.addEventListener('pointercancel', soltar);
  }

  // Con teclado, de a --space-4 (16px).
  function moverConTeclado(evento: KeyboardEvent) {
    const paso = ({ ArrowLeft: 16, ArrowRight: -16 } as Record<string, number>)[evento.key];
    if (!paso) return;
    evento.preventDefault();
    const nuevo = setAncho(anchoActual() + (borde ? paso : -paso));
    onCambio?.(nuevo);
  }

  const propsBorde = {
    role: 'separator',
    'aria-orientation': 'vertical' as const,
    tabIndex: 0,
    onPointerDown: empezarArrastre,
    onKeyDown: moverConTeclado,
  };

  return { ancho, panelRef, propsBorde };
}
