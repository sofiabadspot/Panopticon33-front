import { useEffect, type RefObject } from 'react';

/** Barra que se desplaza de costado: marca data-edges="start|end|both" cuando hay contenido escondido
    a un lado (el CSS pone un degradado en ese borde) y convierte la rueda vertical en desplazamiento lateral. */
export function useOverflowEdges(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const update = () => {
      const start = el.scrollLeft > 2, end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      el.dataset.edges = start && end ? 'both' : start ? 'start' : end ? 'end' : '';
    };
    const wheel = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY; e.preventDefault(); } };
    const ro = new ResizeObserver(update); ro.observe(el); [...el.children].forEach((c) => ro.observe(c));
    el.addEventListener('scroll', update, { passive: true }); el.addEventListener('wheel', wheel, { passive: false });
    update();
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); el.removeEventListener('wheel', wheel); };
  }, [ref]);
}
