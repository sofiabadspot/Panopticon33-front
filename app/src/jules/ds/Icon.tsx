/* Íconos de trazo del DS de Sync (.sv-ico). Copia de sync-front/src/components/ds/Icon.jsx,
   solo con los dibujos que usa Jules. */
const TRAZOS = {
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  contraer: 'M20 4l-6 6M14 4v6h6M4 20l6-6M10 20v-6H4',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  detener: 'M7 7h10v10H7z',
  'me-gusta': 'M7 10v11M7 10l4-8a2.5 2.5 0 0 1 3 3l-1 5h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 21H7M7 10H4v11h3',
  'no-me-gusta': 'M17 14V3M17 14l-4 8a2.5 2.5 0 0 1-3-3l1-5H5.5a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 7 3h10M17 14h3V3h-3',
  editar: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  opinion: 'M12 3a9 9 0 0 0-7.8 13.5L3 21l4.5-1.2A9 9 0 1 0 12 3zM9 10h.01M15 10h.01M9 14a4 4 0 0 0 6 0',
  mas: 'M13 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM13 19a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  copiar: 'M9 9h11v11H9zM5 15H4V4h11v1',
} as const;

export type IconName = keyof typeof TRAZOS;

export function Icon({ name, size, className = '' }: { name: IconName; size?: 'lg'; className?: string }) {
  const clases = ['sv-ico', size === 'lg' && 'sv-ico--lg', className].filter(Boolean).join(' ');
  return (
    <svg className={clases} viewBox="0 0 24 24" aria-hidden="true">
      <path d={TRAZOS[name]} />
    </svg>
  );
}
