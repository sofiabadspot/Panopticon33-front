import { useId } from 'react';

/* Marca de Panopticon 33 (artefacto "Panoptikon 33 · Logo").
   Isotipo: dos gotas unidas (filtro goo) con una luz que orbita cada 5 s.
   Los grises son los de la pieza de marca, no tokens del tema: no se cambian. */

export function P33Mark({ size = 24, still = false }: { size?: number; still?: boolean }) {
  const u = useId().replace(/:/g, '');
  const id = (k: string) => `p33${u}-${k}`;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="p33-mark" style={{ overflow: 'visible', display: 'block', flex: 'none' }} aria-hidden="true">
      <defs>
        <filter id={id('sp')} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7.5" /></filter>
        <filter id={id('soft')} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="22" /></filter>
        <filter id={id('goo')} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6" result="g" />
          <feGaussianBlur in="g" stdDeviation="11" />
        </filter>
        <filter id={id('lm')} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="20" /></filter>
        <mask id={id('m')} maskUnits="userSpaceOnUse" x="-60" y="-60" width="320" height="320">
          <g filter={`url(#${id('goo')})`}>
            <circle cx="107.8" cy="98.3" r="56" fill="#fff" />
            <circle cx="64.8" cy="107.5" r="34" fill="#fff" />
          </g>
        </mask>
        <mask id={id('l')} maskUnits="userSpaceOnUse" x="-60" y="-60" width="320" height="320">
          <g className={still ? undefined : 'p33-orbit'}><circle cx="100" cy="38" r="46" fill="#fff" filter={`url(#${id('lm')})`} /></g>
        </mask>
      </defs>
      <g mask={`url(#${id('m')})`}>
        <rect x="-60" y="-60" width="320" height="320" fill="#1a1f26" />
        <g mask={`url(#${id('l')})`}>
          <rect x="-60" y="-60" width="320" height="320" fill="#5d6876" />
          <g filter={`url(#${id('soft')})`}>
            <circle cx="66" cy="62" r="40" fill="#1a1f26" />
            <circle cx="146" cy="96" r="34" fill="#fff" opacity="0.55" />
            <circle cx="92" cy="150" r="38" fill="#1a1f26" />
            <circle cx="84" cy="84" r="20" fill="#fff" opacity="0.8" />
          </g>
        </g>
      </g>
      <g mask={`url(#${id('l')})`}>
        <g filter={`url(#${id('sp')})`}>
          {[[84.4, 145.4, 10.1], [110, 55.4, 9.4], [137.8, 161.8, 12.3], [98, 25.8, 12.6], [32.9, 100.6, 9.5]].map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#dfe6ee" opacity="0.7" />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Logo horizontal: isotipo + "Panopticon" en Erbaum Light y el 33 en gris medio, a la mitad del tamaño. */
export function P33Logo({ size = 20, mark = true, className = '' }: { size?: number; mark?: boolean; className?: string }) {
  return (
    <span className={`p33-logo ${className}`} style={{ fontSize: size }} role="img" aria-label="Panopticon 33">
      {mark && <P33Mark size={Math.round(size * 2.55)} />}
      <span className="p33-word" aria-hidden="true">Panopticon<span className="p33-num">33</span></span>
    </span>
  );
}

/** Firma de producto: "Panopticon 33 × SPOTVISION", con el logo de Spotvision. */
export function BrandLockup({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`brand-lockup ${className}`} style={{ fontSize: size }}>
      <P33Logo size={size} />
      <span className="bl-by" aria-hidden="true">×</span>
      <img className="bl-sv" src="/assets/logo-spotvision.png" alt="SPOTVISION" />
    </span>
  );
}
