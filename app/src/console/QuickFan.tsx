/* Abanico de acciones junto al punto tocado en el mapa (boceto del 27/11): del punto salen líneas punteadas a
   unos botones-píldora, uno debajo del otro. Tocar uno abre su panel al lado de ese mismo botón; el abanico
   sigue abierto, así se puede hacer otra acción en el mismo punto. Lo usan Registrar incidente (operador) y
   Agregar evidencia (analista). Cerca del borde derecho se abre hacia la izquierda. Esc cierra. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/kit';

export interface FanItem { id: string; label: string; icon: string; tone?: 'danger'; hint?: string }

const GAP = 44, X0 = 64, STEP = 14, POP_W = 320, PILL_W = 220, PILL_H = 36, POP_H = 320, PAD = 16;
/** Abajo queda la barra de herramientas: el abanico y su panel no bajan de acá. */
const PAD_B = 84;

export function QuickFan({ xy, items, active, onPick, onClose, label, children }: {
  xy: [number, number];
  items: FanItem[];
  active: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  /** Nombre del grupo, para lectores de pantalla («Acciones en este punto»). */
  label: string;
  /** Panel del botón activo: se abre junto a él. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<[number, number]>([0, 0]);
  /** Hasta dónde llegan las píldoras (la más saliente): el panel se abre pasando esa línea, sin taparlas. */
  const [reach, setReach] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el?.parentElement) return;
    setBox([el.parentElement.clientWidth, el.parentElement.clientHeight]);
    setReach(Math.max(0, ...[...el.querySelectorAll<HTMLElement>('.qfan-row')].map((r) => Math.abs(r.offsetLeft) + r.offsetWidth)));
  }, [xy[0], xy[1], items.length]);
  const n = items.length;
  // Cerca del borde derecho (o de la columna de la derecha) el abanico se abre hacia la izquierda.
  const left = box[0] > 0 && xy[0] + X0 + STEP * n + PILL_W + POP_W + 24 > box[0];
  const dx = (i: number) => (X0 + STEP * i) * (left ? -1 : 1);
  // Cerca de arriba o de abajo, el abanico se corre para entrar entero.
  const half = ((n - 1) / 2) * GAP;
  const lo = xy[1] - half - PILL_H / 2, hi = xy[1] + half + PILL_H / 2;
  const shift = !box[1] ? 0 : lo < PAD ? PAD - lo : hi > box[1] - PAD_B ? box[1] - PAD_B - hi : 0;
  const dy = (i: number) => (i - (n - 1) / 2) * GAP + shift;
  // El panel: a la altura del botón activo, pasando las píldoras; dentro del mapa.
  const ai = items.findIndex((it) => it.id === active);
  const popTop = ai < 0 ? 0 : Math.max(PAD - xy[1], Math.min(dy(ai) - PILL_H / 2, box[1] - PAD_B - POP_H - xy[1]));
  const popLeft = (reach || X0 + STEP * (n - 1) + PILL_W) + 12;

  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, []);

  return (
    <div ref={ref} className={`qfan ${left ? 'left' : ''}`} style={{ left: xy[0], top: xy[1] }} role="group" aria-label={label}>
      <svg className="qfan-lines" aria-hidden>{items.map((it, i) => <line key={it.id} x1={0} y1={0} x2={dx(i) - (left ? -4 : 4)} y2={dy(i)} className={active === it.id ? 'on' : ''} />)}</svg>
      <span className="qfan-dot" aria-hidden />
      {items.map((it, i) => (
        <div key={it.id} className="qfan-row" style={{ left: dx(i), top: dy(i), animationDelay: `${i * 28}ms` }}>
          <button type="button" className={`qfan-pill ${it.tone ?? ''} ${active === it.id ? 'on' : ''}`} aria-expanded={active === it.id} onClick={() => onPick(active === it.id ? null : it.id)} title={it.hint}>
            <Icon name={it.icon} /><span>{it.label}</span>
          </button>
        </div>
      ))}
      {ai >= 0 && children && (
        <div className="qfan-pop" role="dialog" aria-label={items[ai].label}
          style={{ top: popTop, left: left ? -popLeft - POP_W : popLeft, maxHeight: box[1] ? box[1] - PAD_B - xy[1] - popTop : undefined }}>{children}</div>
      )}
      <button type="button" className="qfan-x iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)"><Icon name="close" /></button>
    </div>
  );
}
