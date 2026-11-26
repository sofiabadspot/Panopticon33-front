/* Sistema iconográfico de Panóptico 33 — fuente única de los íconos del mapa.
   Propuesta aprobada: docs/propuesta-alertas-v2.html (tareas 6, 7 y 34).

   Reglas:
   1. La FORMA de afuera dice la CATEGORÍA.
      · Alerta  → chapa cuadrada con asta y anillo en el piso (el punto exacto).
      · Unidad  → hexágono (un recurso propio que se mueve).
      · Cámara  → nodo circular (un sensor fijo).
      · Grupo   → chip con la cantidad.
   2. El DIBUJO de adentro dice el TIPO: una sola idea por tipo, en silueta llena y blanca, para que
      se lea a 14–16 px (el auto, la cara, tres personas, un policía con un menos, la cámara tachada).
   3. Cada dato de la alerta tiene su canal y ninguno depende solo del color (los hexágonos del mapa ya
      usan verde, amarillo y rojo):
      · Criticidad → 3, 2 o 1 barras arriba de la chapa; el marco repite el nivel en rojo, amarillo o gris.
      · Espera     → borde blanco que se completa alrededor de la chapa hasta el tiempo objetivo de su
                     criticidad (SEVERITY_TARGET_MIN). Que haya borde ya dice "espera tu decisión".
      · Atraso     → pasado el objetivo, el borde se va y queda arriba a la derecha el atraso (+3′), que sigue contando.
      · Confirmada → sin borde; un hexágono con cuántas unidades van.
      · Descartada → gris.
   Todos los dibujos son de 24 × 24, en currentColor. */
import { useNow } from '../ui/kit';
import { SEVERITY_TARGET_MIN } from '../api/labels';
import type { AlertKind, CameraStatus, Severity, UnitStatus, UnitType } from '../api/types';
import type { AirType } from '../api/aircraft';

/* ---------- Dibujos de tipo ---------- */

/** Alertas: qué pasó. Siluetas llenas en currentColor; los huecos toman el color de la chapa (--hole). */
export function AlertGlyph({ kind }: { kind: AlertKind }) {
  const H = 'var(--hole, var(--surface-panel))';
  if (kind === 'placa_en_lista') return (
    // El auto de frente, simplificado, con la placa como el hueco más grande.
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4.4 10.2l1.9-4.6c.3-.8 1-1.3 1.9-1.3h7.6c.9 0 1.6.5 1.9 1.3l1.9 4.6c1 .4 1.7 1.4 1.7 2.5v5.4c0 .6-.4 1-1 1H3.7c-.6 0-1-.4-1-1v-5.4c0-1.1.7-2.1 1.7-2.5z" fill="currentColor" />
      <path d="M6.9 9.9l1.3-3.3h7.6l1.3 3.3z" fill={H} />
      <rect x="7" y="12.4" width="10" height="4.4" rx=".7" fill={H} />
      <rect x="3.6" y="18.6" width="3.6" height="2.8" rx=".9" fill="currentColor" /><rect x="16.8" y="18.6" width="3.6" height="2.8" rx=".9" fill="currentColor" />
    </svg>
  );
  if (kind === 'persona_en_lista') return (
    // Una cara (no el cuerpo) dentro de las esquinas de detección.
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M2.5 7.5V4.3c0-1 .8-1.8 1.8-1.8h3.2M16.5 2.5h3.2c1 0 1.8.8 1.8 1.8v3.2M21.5 16.5v3.2c0 1-.8 1.8-1.8 1.8h-3.2M7.5 21.5H4.3c-1 0-1.8-.8-1.8-1.8v-3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="12" cy="12" rx="5.4" ry="6.4" fill="currentColor" />
      <circle cx="9.9" cy="11.2" r="1.15" fill={H} /><circle cx="14.1" cy="11.2" r="1.15" fill={H} />
      <path d="M10.2 14.9c1.1.7 2.5.7 3.6 0" fill="none" stroke={H} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
  if (kind === 'aglomeracion') return (
    // Tres personas, la de adelante más grande.
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="5" cy="8.6" r="2.4" fill="currentColor" /><path d="M.8 18.5c0-2.9 1.9-5.1 4.2-5.1 1.1 0 2.1.5 2.8 1.3-.9 1.1-1.5 2.4-1.6 3.8z" fill="currentColor" />
      <circle cx="19" cy="8.6" r="2.4" fill="currentColor" /><path d="M23.2 18.5c0-2.9-1.9-5.1-4.2-5.1-1.1 0-2.1.5-2.8 1.3.9 1.1 1.5 2.4 1.6 3.8z" fill="currentColor" />
      <circle cx="12" cy="7.4" r="3.1" fill="currentColor" /><path d="M6.6 21c0-3.9 2.4-6.8 5.4-6.8s5.4 2.9 5.4 6.8z" fill="currentColor" />
    </svg>
  );
  if (kind === 'brecha_presencia') return (
    // Falta policía: un policía (la gorra lo distingue) con un signo menos.
    <svg viewBox="0 0 24 24" aria-hidden>
      <g transform="translate(-2.6 0)">
        <path d="M7.2 7.6l.9-3.6c.1-.5.6-.9 1.1-.9h5.6c.5 0 1 .4 1.1.9l.9 3.6z" fill="currentColor" />
        <path d="M5.8 7.6h12.4v1.6H5.8z" fill="currentColor" />
        <path d="M8.6 9.2c0 2.1 1.5 3.8 3.4 3.8s3.4-1.7 3.4-3.8z" fill="currentColor" />
        <path d="M4.6 21.5c0-4 3.3-6.8 7.4-6.8s7.4 2.8 7.4 6.8z" fill="currentColor" />
      </g>
      <circle cx="18.6" cy="17.6" r="4.6" fill="currentColor" stroke={H} strokeWidth="1.4" />
      <path d="M16.3 17.6h4.6" stroke={H} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
  return (
    // Cámara de video tachada: dejó de transmitir.
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="1.8" y="7" width="13.6" height="10" rx="2" fill="currentColor" />
      <path d="M16.6 10.6l5.6-3.2v9.2l-5.6-3.2z" fill="currentColor" />
      <path d="M3.5 20.5L20.5 3.5" stroke={H} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M3.5 20.5L20.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Medios aéreos: íconos planos vistos desde arriba, con la nariz hacia arriba (rumbo 0 = norte) para girar con
    su rumbo. Silueta llena en currentColor, como los dibujos de las unidades; los huecos toman --hole. */
export function AirGlyph({ type }: { type: AirType }) {
  const H = 'var(--hole, var(--surface))';
  if (type === 'Dron') return (
    // Cuadricóptero: cuatro hélices (aro con su motor), brazos en X y el cuerpo con la cámara adelante.
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      {[[5.2, 5.2], [18.8, 5.2], [5.2, 18.8], [18.8, 18.8]].map(([x, y]) => (
        <g key={`${x}${y}`}><circle cx={x} cy={y} r="3.9" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx={x} cy={y} r="1.3" fill="currentColor" /></g>
      ))}
      <rect x="8.9" y="7.6" width="6.2" height="8.8" rx="2.6" fill="currentColor" />
      <circle cx="12" cy="9.6" r="1.25" fill={H} />
    </svg>
  );
  return (
    // Helicóptero: dos palas cruzadas sobre la cabina, botalón de cola y estabilizador.
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3.6 1.8l16.8 14.4M20.4 1.8L3.6 16.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 3.4c2.6 0 3.9 2.3 3.9 5.4 0 2.7-1.4 4.4-2.8 5v5.4h-2.2v-5.4c-1.4-.6-2.8-2.3-2.8-5 0-3.1 1.3-5.4 3.9-5.4z" fill="currentColor" />
      <path d="M10.2 5.4c.5-.8 1.1-1.1 1.8-1.1s1.3.3 1.8 1.1z" fill={H} />
      <path d="M8.6 20.4h6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="9" r="1.1" fill={H} />
    </svg>
  );
}

/** Medio aéreo en el mapa: el ícono plano, sin el hexágono de las unidades de tierra (se lee como algo que
    vuela), girando con el rumbo. El rumbo va en la variable CSS --hdg para que el mapa lo mueva sin redibujar. */
export function AirSprite({ type, heading = 0, size }: { type: AirType; heading?: number; size?: number; still?: boolean }) {
  const s = size ?? (type === 'Dron' ? 24 : 30);
  return (
    <span className={`air3d ${type === 'Dron' ? 'is-drone' : 'is-heli'}`} style={{ width: s, height: s, ['--hdg' as string]: `${heading}deg` }}>
      <span className="air3d-body"><AirGlyph type={type} /></span>
    </span>
  );
}

/** Ícono chico del medio aéreo (chips de capa, leyendas). */
export function AirHex({ type, size = 18 }: { type: AirType; size?: number }) {
  return <AirSprite type={type} size={size} />;
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

/** Alerta en listas y fichas: chapa oscura con el dibujo en blanco y el marco del color de su criticidad.
    Gris si la alerta ya se resolvió. */
export function AlertTile({ kind, size = 32, muted = false, severity }: { kind: AlertKind; size?: number; muted?: boolean; severity?: Severity }) {
  return <span className={`ic-tile ${muted ? 'muted' : ''} ${severity ? 'sev-' + severity : ''}`} style={{ width: size, height: size }}><AlertGlyph kind={kind} /></span>;
}

/** Barras de criticidad (como la señal del celular): 3 crítica, 2 media, 1 baja. Para listas y fichas. */
export function SeverityBars({ severity, muted = false }: { severity: Severity; muted?: boolean }) {
  const n = SEV_N[severity];
  return (
    <span className={`ic-bars sev-${severity} ${muted ? 'muted' : ''}`} role="img" aria-label={`Criticidad ${SEV_WORD[severity]}`}>
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? 'on' : ''} />)}
    </span>
  );
}

const SEV_N: Record<Severity, number> = { critica: 3, media: 2, baja: 1 };
const SEV_WORD: Record<Severity, string> = { critica: 'crítica', media: 'media', baja: 'baja' };
/** Borde de tiempo: recorre la chapa desde arriba al centro, en sentido horario. */
const RING = 'M20 11H30a4 4 0 0 1 4 4V37a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z';

/** Minutos de atraso de una alerta que espera decisión (0 si todavía está en tiempo). */
export function overdueMin(severity: Severity, since: number, now: number) {
  const over = now - since - SEVERITY_TARGET_MIN[severity] * 60000;
  return over > 0 ? Math.max(1, Math.floor(over / 60000)) : 0;
}

/** Atraso escrito corto: minutos hasta la hora, después horas ("+7′", "+3 h"). */
export function fmtLate(min: number, long = false) {
  return min < 60 ? `+${min}${long ? ' min' : '′'}` : `+${Math.floor(min / 60)} h`;
}

/** Borde de tiempo y atraso: cuenta solo (cada 2 s) mientras la alerta espera. */
function WaitLayer({ severity, since }: { severity: Severity; since: number }) {
  const now = useNow(2000);
  const p = Math.min(1, (now - since) / (SEVERITY_TARGET_MIN[severity] * 60000)) * 100;
  const over = overdueMin(severity, since, now);
  const t = fmtLate(over), w = 6 + t.length * 5.2, x0 = 42.5 - w;
  // Al completarse, el borde se va y queda solo el atraso, que sigue contando.
  if (over > 0) return (
    <g className="iw-late" aria-label={`Atrasada ${over} min`}>
      <rect x={x0} y={1} width={w} height={11} rx={2} />
      <text x={x0 + w / 2} y={9.6} textAnchor="middle">{t}</text>
    </g>
  );
  return (
    <>
      <path d={RING} className="iw-track-bg" />
      <path d={RING} className="iw-track" />
      <path d={RING} className="iw-fill" pathLength={100} strokeDasharray={`${p} 100`} />
    </>
  );
}

/** Alerta en el mapa: chapa con el dibujo del tipo, barras de criticidad arriba, borde de tiempo
    alrededor mientras espera decisión (con el atraso si se pasó), y asta con anillo en el piso.
    Confirmada: sin borde, con un hexágono que dice cuántas unidades van. */
export function AlertMark({ kind, severity = 'media', since, state, units = 0, size = 36, still = false, muted = false }: {
  kind: AlertKind; severity?: Severity; since?: number; state?: 'espera' | 'confirmada' | 'descartada';
  units?: number; size?: number; still?: boolean; muted?: boolean;
}) {
  const st = state ?? (muted ? 'descartada' : 'espera');
  const n = SEV_N[severity], h = still ? 44 : 66;
  return (
    <span className={`ic-alert sev-${severity} st-${st} ${still ? 'still' : ''}`} style={{ width: size * 46 / 40, height: size * h / 40 }}>
      <svg viewBox={`-3 -1 46 ${h}`} width="100%" height="100%" overflow="visible" aria-hidden>
        {st === 'espera' && severity === 'critica' && <rect className="ia-echo" x="8" y="14" width="24" height="24" rx="4" />}
        {[0, 1, 2].map((i) => <rect key={i} className={`ia-bar ${i < n ? 'on' : ''}`} x={13 + i * 5.5} y={8 - (3 + i * 1.5)} width="3.5" height={3 + i * 1.5} rx=".6" />)}
        {st === 'espera' && since != null && <WaitLayer severity={severity} since={since} />}
        <rect className="ia-plate-bg" x="9" y="15" width="22" height="22" rx="3" />
        <rect className="ia-plate" x="9" y="15" width="22" height="22" rx="3" />
        <svg className="ia-glyph" x="11.5" y="17.5" width="17" height="17" overflow="visible"><AlertGlyph kind={kind} /></svg>
        {st === 'confirmada' && (
          <g className="ia-units" transform="translate(26 30)">
            <path d="M6 0l5.2 3v6L6 12 .8 9V3z" />
            {units > 0 ? <text x="6" y="8.6" textAnchor="middle">{units}</text> : <path className="ia-check" d="M3.6 6.2l1.8 1.8L8.6 4.6" />}
          </g>
        )}
        {!still && <><path className="ia-stem-bg" d="M20 41V60" /><path className="ia-stem" d="M20 41V60" /><ellipse className="ia-foot-bg" cx="20" cy="61.5" rx="5" ry="2" /><ellipse className="ia-foot" cx="20" cy="61.5" rx="5" ry="2" /></>}
      </svg>
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

/** Grupo al alejar el zoom: la forma de la categoría en chico y cuántos hay.
    Alertas: sin dibujo (un grupo puede juntar tipos distintos); el marco y las barras dicen la criticidad
    más alta y, si alguna se pasó de tiempo, arriba va el atraso más grande. */
export function GroupChip({ cat, n, severity, alerts }: { cat: 'alerts' | 'units' | 'cameras'; n: number; severity?: Severity; alerts?: { severity: Severity; createdAt: number; waiting: boolean }[] }) {
  if (cat === 'alerts' && severity) return <AlertGroupChip n={n} severity={severity} alerts={alerts ?? []} />;
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

function AlertGroupChip({ n, severity, alerts }: { n: number; severity: Severity; alerts: { severity: Severity; createdAt: number; waiting: boolean }[] }) {
  const now = useNow(5000);
  const over = Math.max(0, ...alerts.filter((a) => a.waiting).map((a) => overdueMin(a.severity, a.createdAt, now)));
  return (
    <span className={`ic-group alerts sev-${severity}`}>
      <b>{n}</b><SeverityBars severity={severity} />
      {over > 0 && <em className="ic-group-late">{fmtLate(over)}</em>}
    </span>
  );
}
