/* Texto de Jules que aparece palabra por palabra, como si lo fuera escribiendo.
   Copia de sentinel-front/src/components/jules/TextoJules.jsx (modo sin reservar: el texto crece
   renglón a renglón y cada palabra entra con un fundido corto). Los lectores de pantalla leen el
   texto entero (aria-label). Con "reducir movimiento" aparece todo de una. */
import { useEffect, useState } from 'react';

const RITMO = 45;
const sinMovimiento = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TextoJules({ texto, as: Tag = 'p', className = '', ritmo = RITMO, onPalabra, onTermina }: {
  texto: string; as?: 'p' | 'span' | 'div' | 'h3'; className?: string; ritmo?: number; onPalabra?: () => void; onTermina?: () => void;
}) {
  const palabras = texto.split(' ');
  const [visibles, setVisibles] = useState(() => (sinMovimiento() ? palabras.length : 0));
  useEffect(() => {
    if (visibles >= palabras.length) { onTermina?.(); return undefined; }
    const t = setTimeout(() => setVisibles((n) => n + 1), ritmo);
    return () => clearTimeout(t);
  }, [visibles, palabras.length, ritmo, onTermina]);
  useEffect(() => { if (visibles) onPalabra?.(); }, [visibles, onPalabra]);
  return (
    <Tag className={className} aria-label={texto}>
      {palabras.slice(0, visibles).map((p, i) => <span key={i} aria-hidden className="svx-palabra-nueva">{p}{i < palabras.length - 1 ? ' ' : ''}</span>)}
    </Tag>
  );
}
