/* Pestañas en píldora del DS de Sync (.sv-tabs--pill). Copia de sync-front/src/components/ds/Tabs.jsx
   (sin cantidades ni extras, que Jules no usa). Con teclado: ← → (o Inicio/Fin). */
import { useRef, type KeyboardEvent } from 'react';

export function Tabs<V extends string>({ items, value, onChange, label }: {
  items: { value: V; label: string }[]; value: V; onChange?: (v: V) => void; label?: string;
}) {
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  function moverConTeclado(evento: KeyboardEvent) {
    if ((evento.target as HTMLElement).getAttribute('role') !== 'tab') return;
    const actual = items.findIndex((item) => item.value === value);
    const destinos: Record<string, number> = {
      ArrowRight: (actual + 1) % items.length,
      ArrowLeft: (actual - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    const siguiente = destinos[evento.key];
    if (siguiente === undefined) return;
    evento.preventDefault();
    onChange?.(items[siguiente].value);
    botones.current[siguiente]?.focus();
  }

  return (
    <div className="sv-tabs sv-tabs--pill">
      <div className="sv-tabs__list" role="tablist" aria-label={label} onKeyDown={moverConTeclado}>
        {items.map((item, indice) => {
          const elegido = item.value === value;
          return (
            <button
              key={item.value}
              ref={(boton) => { botones.current[indice] = boton; }}
              type="button"
              role="tab"
              className="sv-tabs__tab"
              aria-selected={elegido}
              tabIndex={elegido ? 0 : -1}
              onClick={() => onChange?.(item.value)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
