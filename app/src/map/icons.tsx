/* Sistema iconográfico de Panóptico 33 — fuente única de los íconos del mapa.

   Tres reglas, siempre las mismas:
   1. La FORMA de afuera dice la CATEGORÍA.
      · Alerta  → mira de fijación roja con asta (algo pasó en este punto y espera una decisión).
      · Unidad  → hexágono (un recurso propio que se mueve).
      · Cámara  → nodo circular (un sensor fijo).
      · Zona    → el polígono en el mapa y su rótulo.
      · Grupo   → chip con la forma de su categoría en chico y la cantidad.
   2. El DIBUJO de adentro dice el TIPO dentro de la categoría.
   3. El ROJO es solo para alertas, y en el mapa solo están las que esperan una decisión: todas iguales,
      sin niveles. Las enviadas a Maic y las descartadas salen del mapa (ya están resueltas).
      Unidades y cámaras no usan color: su estado cambia el dibujo.

   Todos los dibujos son de 24 × 24, en currentColor y con trazo de 1,8. */
import type { AlertKind, CameraStatus, UnitStatus, UnitType } from '../api/types';

/* ---------- Dibujos de tipo ---------- */

/** Alertas: qué pasó. Dibujos rellenos (se leen a 20 px), en currentColor. */
export function AlertGlyph({ kind }: { kind: AlertKind }) {
  const hole = { fill: 'var(--surface)' };
  if (kind === 'placa_en_lista') return (
    // Auto de frente con la placa resaltada (de frente, para no confundirse con la patrulla, que va de perfil).
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5.2 10.2l1.6-4.1c.3-.8 1-1.3 1.9-1.3h6.6c.9 0 1.6.5 1.9 1.3l1.6 4.1c1.1.3 1.9 1.3 1.9 2.5v4.1c0 .6-.5 1-1 1h-.9v1.4c0 .5-.4.9-.9.9h-1.4c-.5 0-.9-.4-.9-.9v-1.4H8.4v1.4c0 .5-.4.9-.9.9H6.1c-.5 0-.9-.4-.9-.9v-1.4h-.9c-.6 0-1-.4-1-1v-4.1c0-1.2.8-2.2 1.9-2.5z" fill="currentColor" />
      <path d="M7.4 9.8l1-2.8c.1-.3.4-.5.7-.5h5.8c.3 0 .6.2.7.5l1 2.8z" style={hole} />
      <circle cx="6.6" cy="13" r="1.1" style={hole} /><circle cx="17.4" cy="13" r="1.1" style={hole} />
      <rect x="8.6" y="12.2" width="6.8" height="3.4" rx=".6" style={hole} />
      <path d="M9.9 13.9h4.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
  if (kind === 'persona_en_lista') return (
    // Reconocimiento facial: una persona (cabeza y hombros) dentro del marco de detección.
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 8V4.6C3 3.7 3.7 3 4.6 3H8M16 3h3.4c.9 0 1.6.7 1.6 1.6V8M21 16v3.4c0 .9-.7 1.6-1.6 1.6H16M8 21H4.6C3.7 21 3 20.3 3 19.4V16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="9.8" r="3.3" fill="currentColor" />
      <path d="M6.6 18.6c.6-2.9 2.8-4.6 5.4-4.6s4.8 1.7 5.4 4.6z" fill="currentColor" />
    </svg>
  );
  if (kind === 'aglomeracion') return (
    // Multitud: cinco personas apretadas.
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="6.2" r="2.3" fill="currentColor" /><path d="M8.2 13.6c0-2.3 1.7-4 3.8-4s3.8 1.7 3.8 4z" fill="currentColor" />
      <circle cx="5.8" cy="9.2" r="1.9" fill="currentColor" /><path d="M2.6 15.6c0-1.9 1.4-3.4 3.2-3.4s3.2 1.5 3.2 3.4z" fill="currentColor" />
      <circle cx="18.2" cy="9.2" r="1.9" fill="currentColor" /><path d="M15 15.6c0-1.9 1.4-3.4 3.2-3.4s3.2 1.5 3.2 3.4z" fill="currentColor" />
      <circle cx="8.6" cy="14.4" r="2" fill="currentColor" style={{ stroke: 'var(--surface)', strokeWidth: 1 }} /><path d="M5 21c0-2 1.6-3.6 3.6-3.6s3.6 1.6 3.6 3.6z" fill="currentColor" style={{ stroke: 'var(--surface)', strokeWidth: 1 }} />
      <circle cx="15.4" cy="14.4" r="2" fill="currentColor" style={{ stroke: 'var(--surface)', strokeWidth: 1 }} /><path d="M11.8 21c0-2 1.6-3.6 3.6-3.6s3.6 1.6 3.6 3.6z" fill="currentColor" style={{ stroke: 'var(--surface)', strokeWidth: 1 }} />
    </svg>
  );
  if (kind === 'brecha_presencia') return (
    // Gente sin policía: personas y un escudo policial tachado en la esquina.
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="7" cy="7.4" r="2.3" fill="currentColor" /><path d="M2.8 15.4c0-2.5 1.9-4.4 4.2-4.4s4.2 1.9 4.2 4.4z" fill="currentColor" />
      <circle cx="12.4" cy="9.6" r="2.1" fill="currentColor" /><path d="M8.6 17.6c0-2.3 1.7-4 3.8-4 1 0 1.9.4 2.6 1z" fill="currentColor" />
      <path d="M17.6 11.4l4 1.5v3c0 2.6-1.7 4.6-4 5.5-2.3-.9-4-2.9-4-5.5v-3z" fill="currentColor" style={{ stroke: 'var(--surface)', strokeWidth: 1.2 }} />
      <path d="M14.6 20.6l6.2-8" stroke="var(--surface)" strokeWidth="2.2" strokeLinecap="round" /><path d="M14.6 20.6l6.2-8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
  return (
    // Cámara de vigilancia (cuerpo, visera y lente, sobre su soporte de pared) tachada: dejó de transmitir.
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="2.5" y="5.5" width="13.5" height="7" rx="1.6" fill="currentColor" />
      <path d="M16 6.4l4.6-1.6v8.4L16 11.6z" fill="currentColor" />
      <circle cx="18.4" cy="9" r="1" style={hole} />
      <path d="M7 12.5v3.5H3.2M3.2 13.8v4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 3.5l16.5 17" stroke="var(--surface)" strokeWidth="3.2" strokeLinecap="round" /><path d="M4 3.5l16.5 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Unidades: cómo se mueve. */
export function UnitGlyph({ type }: { type: UnitType }) {
  const hole = { fill: 'var(--surface)' };
  if (type === 'Motorizada') return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="5.4" cy="16.4" r="3.3" fill="none" stroke="currentColor" strokeWidth="2.3" />
      <circle cx="18.6" cy="16.4" r="3.3" fill="none" stroke="currentColor" strokeWidth="2.3" />
      <path d="M6.6 11.6h4.6l1.6-2.4h3.4l.9 1.6-2.6 3.4H8.9z" fill="currentColor" />
      <rect x="9.6" y="13.4" width="4" height="3" rx=".6" fill="currentColor" />
      <path d="M5.4 16.4l3.4-3.6M18.6 16.4l-2.3-7.4M15.2 8.7l2.8-.7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <rect x="17.4" y="10" width="2.4" height="1.6" rx=".5" fill="currentColor" />
    </svg>
  );
  if (type === 'A pie') return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8.1 5.6c0-1.4 1.8-2.6 3.9-2.6s3.9 1.2 3.9 2.6v.7H8.1z" fill="currentColor" />
      <path d="M7.2 6.5h9.6l-1.1 1.3H8.3z" fill="currentColor" />
      <circle cx="12" cy="9.9" r="2.2" fill="currentColor" />
      <path d="M6.8 21v-5.4c0-2.3 2.2-3.9 5.2-3.9s5.2 1.6 5.2 3.9V21z" fill="currentColor" />
      <path d="M13.5 14.6h2.1v1.5c0 .8-.5 1.3-1.05 1.5-.55-.2-1.05-.7-1.05-1.5z" style={hole} />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="9.3" y="3.6" width="5.4" height="2" rx=".7" fill="currentColor" />
      <path fillRule="evenodd" fill="currentColor" d="M2.6 15.8v-3c0-.6.4-1.1 1-1.2l2.7-.5 1.9-3.2c.3-.5.8-.8 1.4-.8h4.8c.6 0 1.1.3 1.4.7l2.4 3.3 2.6.5c.6.1 1 .6 1 1.2v3zM9.5 8.4h2.3v2.8H7.8zM13.1 8.4h1.9l2 2.8h-3.9z" />
      <circle cx="7" cy="16.3" r="2.5" fill="currentColor" /><circle cx="7" cy="16.3" r="1" style={hole} />
      <circle cx="17" cy="16.3" r="2.5" fill="currentColor" /><circle cx="17" cy="16.3" r="1" style={hole} />
    </svg>
  );
}

/* ---------- Contenedores (la categoría) ---------- */

/** Alerta en listas y fichas: ficha roja con el dibujo del tipo grande, sin corchetes (a tamaño chico
    la mira no deja ver el dibujo). Gris si la alerta ya se resolvió. */
export function AlertTile({ kind, size = 32, muted = false }: { kind: AlertKind; size?: number; muted?: boolean }) {
  return <span className={`ic-tile ${muted ? 'muted' : ''}`} style={{ width: size, height: size }}><AlertGlyph kind={kind} /></span>;
}

/** Alerta: mira de fijación (corchetes) con el dibujo del tipo, un asta y un anillo en el piso que
    marca el punto exacto. Roja, todas iguales; mientras espera decisión, la mira se cierra en bucle. */
export function AlertMark({ kind, size = 36, still = false, muted = false }: { kind: AlertKind; size?: number; still?: boolean; muted?: boolean }) {
  return (
    <span className={`ic-alert ${still ? 'still' : ''} ${muted ? 'muted' : ''}`} style={{ width: size, height: still ? size : size * 1.6 }}>
      <span className="ic-lock" style={{ width: size, height: size }}>
        <span className="ic-core"><AlertGlyph kind={kind} /></span>
      </span>
      {!still && <u className="ic-stem" aria-hidden />}
    </span>
  );
}

/** Unidad: hexágono negro con borde gris; adentro, el tipo. */
export function UnitHex({ type, status = 'disponible', size = 28 }: { type: UnitType; status?: UnitStatus; size?: number }) {
  return (
    <span className={`ic-unit ${status === 'sin_reporte' || status === 'desconocida' ? 'off' : ''} ${status === 'desconocida' ? 'unknown' : ''}`} style={{ width: size, height: size }}>
      <UnitGlyph type={type} />
    </span>
  );
}

/** Cámara: nodo circular. Operativa = anillo y núcleo; degradada = anillo punteado; caída = tachada; fuera de preset = núcleo corrido. */
export function CameraNode({ status, size = 18 }: { status: CameraStatus; size?: number }) {
  return (
    <svg className={`ic-cam ${status}`} width={size} height={size} viewBox="-2 -2 24 24" aria-hidden>
      <circle cx="10" cy="10" r="8.2" className="ring" strokeDasharray={status === 'degradada' ? '2.6 2.2' : undefined} />
      <circle cx={status === 'fuera_de_preset' ? 13 : 10} cy={status === 'fuera_de_preset' ? 7 : 10} r="3.2" className="core" />
      <path d="M10 -1.5v3M21.5 10h-3M10 21.5v-3M-1.5 10h3" className="ticks" />
      {status === 'caida' && <path d="M4 16L16 4" className="slash" />}
    </svg>
  );
}

/** Grupo al alejar el zoom: la forma de la categoría en chico y cuántos hay. */
export function GroupChip({ cat, n }: { cat: 'alerts' | 'units' | 'cameras'; n: number }) {
  return (
    <span className={`ic-group ${cat}`}>
      <span className="ic-group-mark" aria-hidden>
        {cat === 'alerts' ? <span className="lockmini" />
          : cat === 'units' ? <span className="hexmini" /> : <CameraNode status="operativa" size={14} />}
      </span>
      <b>{n}</b>
    </span>
  );
}
