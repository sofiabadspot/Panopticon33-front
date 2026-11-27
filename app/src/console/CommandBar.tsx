/* Barra de comandos del mapa (como la de herramientas de Figma): abajo al centro, cada herramienta con
   su atajo de teclado. Decidido en la reunión del 26/11:
   · Mover (V): el mapa como siempre.
   · Registrar incidentes (I): clic en el mapa → se registra lo que pasó ahí (p. ej. un robo que entra
     por el 911) y, en la misma tarjeta, quién llega a ese punto para mandar unidades. Reemplaza al
     botón "¿Quién llega?" (renombrado en la reunión). Atajo directo: Alt + clic en el mapa.
   · ¿Quién llega? (Q): solo para los roles que no registran incidentes (miden, no despachan).
   · Nuevo evento (E): solo quien puede crear eventos.
   Los atajos no corren mientras se escribe en un campo. */
import { useEffect, useRef, useState } from 'react';
import { INCIDENT_LABEL, placeLabel, registerIncident } from '../api';
import type { IncidentKind, LngLat } from '../api/types';
import { useSession } from '../shell/session';
import { Icon } from '../ui/kit';

export type Tool = 'mover' | 'incidente' | 'medir';

/* Íconos de la barra: dibujados para esta barra (los genéricos no se entendían) y siempre con su nombre
   debajo. Trazo de 1,7 sobre 24 px, como el resto de la iconografía del mapa. */
const G = ({ children }: { children: React.ReactNode }) => <svg className="cmd-ic" viewBox="0 0 24 24" aria-hidden>{children}</svg>;
const IC = {
  /** Mover: puntero, como en cualquier editor. */
  mover: <G><path className="f" d="M6 3.5l12.5 7-5.3 1.5-2.6 5.4z" /></G>,
  /** Registrar incidente: un pin con un "+": marcar algo nuevo en un punto. */
  incidente: <G><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><path d="M12 7v6M9 10h6" /></G>,
  /** ¿Quién llega?: un punto con el radio alrededor y una unidad acercándose. */
  medir: <G><circle className="f" cx="12" cy="12" r="2" /><circle cx="12" cy="12" r="6" strokeDasharray="2.4 2.2" /><path d="M20.5 3.5l-4.2 4.2M20.5 3.5h-3.6M20.5 3.5v3.6" /></G>,
  /** Nuevo evento: bandera, la misma del rótulo de los eventos en el mapa. */
  evento: <G><path d="M6 21V4M6 4.5h11l-2.5 4 2.5 4H6" /></G>,
  /** Atajos: teclado. */
  atajos: <G><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" /></G>,
};

const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

interface Props {
  tool: Tool; setTool: (t: Tool) => void;
  /** Qué herramientas tiene este rol (y si hay fuente de ubicación policial para medir). */
  canIncident: boolean; canMeasure: boolean;
  onNewEvent?: () => void;
}

export function CommandBar({ tool, setTool, canIncident, canMeasure, onNewEvent }: Props) {
  const [menu, setMenu] = useState<'atajos' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Atajos de teclado
  const st = useRef({ tool, canIncident, canMeasure, onNewEvent }); st.current = { tool, canIncident, canMeasure, onNewEvent };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || (e.target as HTMLElement).closest?.('[role="dialog"]')) return;
      const S = st.current, key = e.key.toLowerCase();
      if (key === 'v') setTool('mover');
      else if (key === 'i' && S.canIncident) setTool(S.tool === 'incidente' ? 'mover' : 'incidente');
      else if (key === 'q' && S.canMeasure && !S.canIncident) setTool(S.tool === 'medir' ? 'mover' : 'medir');
      else if (key === 'e' && S.onNewEvent) S.onNewEvent();
      else if (e.key === '?') setMenu((m) => (m === 'atajos' ? null : 'atajos'));
      else if (e.key === 'Escape' && (S.tool !== 'mover' || menu)) { setMenu(null); if (S.tool !== 'mover') { setTool('mover'); e.preventDefault(); } }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [setTool, menu]);
  // Clic afuera cierra el menú abierto
  useEffect(() => {
    if (!menu) return undefined;
    const k = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('pointerdown', k); return () => window.removeEventListener('pointerdown', k);
  }, [menu]);

  const Btn = ({ t, icon, label, short, keyHint, disabled, why }: { t: Tool; icon: React.ReactNode; label: string; short: string; keyHint: string; disabled?: boolean; why?: string }) => (
    <button className={`cmd-btn ${tool === t ? 'on' : ''}`} aria-pressed={tool === t} disabled={disabled} onClick={() => setTool(tool === t && t !== 'mover' ? 'mover' : t)}
      title={disabled ? why : `${label} (${keyHint})`} aria-keyshortcuts={keyHint} aria-label={label}>
      {icon}<span className="cmd-name" aria-hidden>{short}</span><span className="cmd-tip" aria-hidden>{label}<kbd className="kbd">{keyHint}</kbd></span>
    </button>
  );

  return (
    <div className="cmdbar" ref={ref} role="toolbar" aria-label="Herramientas del mapa">
      <Btn t="mover" label="Mover" short="Mover" keyHint="V" icon={IC.mover} />
      {canIncident
        ? <Btn t="incidente" label="Registrar incidentes" short="Incidente" keyHint="I" icon={IC.incidente} />
        : <Btn t="medir" label="¿Quién llega?" short="Quién llega" keyHint="Q" icon={IC.medir} disabled={!canMeasure} why="Sin acceso a la ubicación policial" />}
      {onNewEvent && <button className="cmd-btn" onClick={onNewEvent} title="Nuevo evento (E)" aria-keyshortcuts="E" aria-label="Nuevo evento">{IC.evento}<span className="cmd-name" aria-hidden>Evento</span><span className="cmd-tip" aria-hidden>Nuevo evento<kbd className="kbd">E</kbd></span></button>}
      <span className="cmd-sep" aria-hidden />
      <div className="cmd-wrap">
        <button className={`cmd-btn ${menu === 'atajos' ? 'on' : ''}`} aria-expanded={menu === 'atajos'} onClick={() => setMenu(menu === 'atajos' ? null : 'atajos')} title="Atajos de teclado (?)" aria-keyshortcuts="?" aria-label="Atajos de teclado">{IC.atajos}<span className="cmd-name" aria-hidden>Atajos</span><span className="cmd-tip" aria-hidden>Atajos<kbd className="kbd">?</kbd></span></button>
        {menu === 'atajos' && (
          <div className="cmd-pop keys" role="dialog" aria-label="Atajos de teclado">
            <div className="cmd-pop-hd"><span>Atajos de teclado</span></div>
            <dl>
              <dt><kbd className="kbd">V</kbd></dt><dd>Mover el mapa</dd>
              {canIncident && <><dt><kbd className="kbd">I</kbd></dt><dd>Registrar incidentes: clic en el mapa, y ver quién llega</dd></>}
              {canIncident && <><dt><kbd className="kbd">Alt</kbd> + clic</dt><dd>Registrar lo que pasó en ese punto, con cualquier herramienta</dd></>}
              {!canIncident && <><dt><kbd className="kbd">Q</kbd></dt><dd>¿Quién llega a un punto?</dd></>}
              {onNewEvent && <><dt><kbd className="kbd">E</kbd></dt><dd>Nuevo evento</dd></>}
              <dt><kbd className="kbd">Esc</kbd></dt><dd>Volver a Mover · cerrar la ficha</dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

const KINDS: IncidentKind[] = ['robo', 'rina', 'accidente', 'sospechoso', 'otro'];
/** Ícono de cada tipo de incidente: el mismo en el formulario y en el marcador del mapa. */
export const INCIDENT_ICON: Record<IncidentKind, string> = { robo: 'front_hand', rina: 'groups', accidente: 'car_crash', sospechoso: 'person_search', otro: 'report' };

/** Registro de un incidente en un punto del mapa. La dirección sale de la cámara más cercana y se puede
    corregir; toda alerta o evento tiene una dirección (zona opcional). */
export function IncidentCard({ p, onClose, onDone, children }: { p: LngLat | null; onClose: () => void; onDone: (label: string) => void;
  /** ¿Quién llega? a ese punto: va debajo del registro, para mandar unidades desde la misma tarjeta. */ children?: React.ReactNode }) {
  const { user } = useSession();
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [withNote, setWithNote] = useState(false);
  /** Registrado: la tarjeta queda abierta con quién llega, para despachar. */
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { if (p) { setAddress(placeLabel(p[1], p[0])); setDone(null); } }, [p?.[0], p?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = !!p && !!kind && address.trim().length > 2;
  const save = () => {
    if (!ok) return;
    const k = registerIncident({ kind: kind!, lat: p![1], lon: p![0], address: address.trim(), note: note.trim() }, user);
    const label = `${k.id} · ${INCIDENT_LABEL[k.kind]}`;
    setDone(label); setKind(null); setNote(''); setWithNote(false); onDone(label);
  };
  /* Un paso por vez. 1) Qué pasó: el tipo, la dirección (ya viene puesta) y Registrar; lo que informaron es
     opcional y queda plegado. 2) Mandar unidades: se ve desde el principio, pero se abre al registrar. Así
     en cada momento hay una sola cosa para hacer y un solo botón principal. */
  return (
    <section className="measure-card inc-card" aria-live="polite" aria-label="Registrar incidente">
      <div className="mc2-hd"><span className="mc2-lbl">Nuevo incidente</span><button className="iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)"><Icon name="close" /></button></div>
      {!p ? <p className="mc2-hint">Hacé clic en el mapa donde pasó.</p> : <>
        {done ? (
          <div className="inc-step done">
            <h3 className="inc-step-hd"><span className="inc-num ok"><Icon name="check" /></span><span className="inc-step-t">{done}<small>{address}</small></span></h3>
          </div>
        ) : (
          <form className="inc-step" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <h3 className="inc-step-hd" id="inc-what"><span className="inc-num">1</span>¿Qué pasó?</h3>
            <div className="inc-kinds" role="radiogroup" aria-labelledby="inc-what">
              {KINDS.map((k) => <button type="button" key={k} role="radio" aria-checked={kind === k} className={`inc-kind ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}><Icon name={INCIDENT_ICON[k]} /><span>{INCIDENT_LABEL[k]}</span></button>)}
            </div>
            <div className="field"><label htmlFor="inc-addr">Dirección</label><input id="inc-addr" className="fld" value={address} onChange={(e) => setAddress(e.target.value)} />
              <span className="hint">Clic en el mapa para mover el punto</span></div>
            {withNote
              ? <div className="field"><label htmlFor="inc-note">Qué informaron</label><textarea id="inc-note" className="fld" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: robo de celular, dos personas en moto hacia el sur" /></div>
              : <button type="button" className="linklike inc-addnote" onClick={() => setWithNote(true)}><Icon name="add" />Agregar lo que informaron</button>}
            <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={!ok}>{kind ? 'Registrar' : 'Elegí qué pasó'}</button>
          </form>
        )}
        {done && children
          ? <div className="inc-step inc-who"><h3 className="inc-step-hd"><span className="inc-num">2</span>Mandar unidades</h3>{children}</div>
          : children && <div className="inc-step inc-who locked" aria-disabled><h3 className="inc-step-hd"><span className="inc-num">2</span>Mandar unidades<small>después de registrar</small></h3></div>}
      </>}
    </section>
  );
}
