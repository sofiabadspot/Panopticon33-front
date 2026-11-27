/* Barra de comandos del mapa (como la de herramientas de Figma): abajo al centro, cada herramienta con
   su atajo de teclado. Decidido en la reunión del 26/11:
   · Mover (V): el mapa como siempre.
   · Registrar incidentes (I): clic en el mapa → junto al punto se abre un abanico de botones (boceto del
     27/11): Mandar unidades (rojo, el primero) y qué pasó (robo, riña…). Reemplaza al botón "¿Quién
     llega?" (renombrado en la reunión). Atajo directo: Alt + clic en el mapa.
   · Agregar evidencia (A): solo en la investigación del analista; mismo abanico (archivo, título, plataforma).
   · ¿Quién llega? (Q): solo para los roles que no registran incidentes (miden, no despachan).
   · Nuevo evento (E): solo quien puede crear eventos.
   Los atajos no corren mientras se escribe en un campo. */
import { useEffect, useRef, useState } from 'react';
import { INCIDENT_LABEL, placeLabel, registerIncident } from '../api';
import type { IncidentKind, LngLat } from '../api/types';
import { useSession } from '../shell/session';
import { Icon } from '../ui/kit';
import { QuickFan } from './QuickFan';

export type Tool = 'mover' | 'incidente' | 'medir' | 'evidencia';

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
  /** Agregar evidencia: una hoja con un clip, lo que se adjunta a la investigación. */
  evidencia: <G><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3.5V8h4.5" /><path d="M12 11v6M9 14h6" /></G>,
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
  /** Analista en una investigación: la barra es Mover + Agregar evidencia. */
  canEvidence?: boolean;
  /** Evidencia sin lugar en el mapa (documentos, fotos, informes): abre su formulario. */
  onLooseEvidence?: () => void;
}

export function CommandBar({ tool, setTool, canIncident, canMeasure, onNewEvent, canEvidence, onLooseEvidence }: Props) {
  const [menu, setMenu] = useState<'atajos' | 'evidencia' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Atajos de teclado
  const st = useRef({ tool, canIncident, canMeasure, onNewEvent, canEvidence }); st.current = { tool, canIncident, canMeasure, onNewEvent, canEvidence };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || (e.target as HTMLElement).closest?.('[role="dialog"]')) return;
      const S = st.current, key = e.key.toLowerCase();
      if (key === 'v') setTool('mover');
      else if (key === 'i' && S.canIncident) setTool(S.tool === 'incidente' ? 'mover' : 'incidente');
      else if (key === 'a' && S.canEvidence) { setMenu((m) => (m === 'evidencia' ? null : 'evidencia')); if (S.tool === 'evidencia') setTool('mover'); }
      else if (key === 'q' && S.canMeasure && !S.canIncident && !S.canEvidence) setTool(S.tool === 'medir' ? 'mover' : 'medir');
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
      {canEvidence ? (
        /* Evidencia: las opciones salen del botón. En un lugar → se toca el mapa (abanico junto al punto);
           sin lugar → formulario de documentos, fotos o informes. */
        <div className="cmd-wrap">
          <button className={`cmd-btn ${tool === 'evidencia' || menu === 'evidencia' ? 'on' : ''}`} aria-expanded={menu === 'evidencia'} aria-haspopup="menu"
            onClick={() => { if (tool === 'evidencia') { setTool('mover'); setMenu(null); } else setMenu(menu === 'evidencia' ? null : 'evidencia'); }}
            title="Agregar evidencia (A)" aria-keyshortcuts="A" aria-label="Agregar evidencia">
            {IC.evidencia}<span className="cmd-name" aria-hidden>Evidencia</span><span className="cmd-tip" aria-hidden>Agregar evidencia<kbd className="kbd">A</kbd></span>
          </button>
          {menu === 'evidencia' && (
            <div className="cmd-pop cmd-menu" role="menu" aria-label="Agregar evidencia">
              <div className="cmd-pop-hd"><span>Agregar evidencia</span></div>
              <button role="menuitem" className="cmd-opt" onClick={() => { setMenu(null); setTool('evidencia'); }}>
                <Icon name="location_on" /><span><b>En un lugar del mapa</b><small>Tocás el punto donde pasó: un video, una foto o una cámara de la plataforma</small></span>
              </button>
              <button role="menuitem" className="cmd-opt" onClick={() => { setMenu(null); setTool('mover'); onLooseEvidence?.(); }}>
                <Icon name="description" /><span><b>Sin lugar en el mapa</b><small>Un documento, fotos o un informe: se ve como una escena del recorrido</small></span>
              </button>
            </div>
          )}
        </div>
      ) : canIncident
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
              {canIncident && <><dt><kbd className="kbd">I</kbd></dt><dd>Registrar incidentes: clic en el mapa y elegí qué hacer</dd></>}
              {canIncident && <><dt><kbd className="kbd">Alt</kbd> + clic</dt><dd>Registrar lo que pasó en ese punto, con cualquier herramienta</dd></>}
              {canEvidence && <><dt><kbd className="kbd">A</kbd></dt><dd>Agregar evidencia: en un lugar del mapa o sin lugar</dd></>}
              {!canIncident && !canEvidence && <><dt><kbd className="kbd">Q</kbd></dt><dd>¿Quién llega a un punto?</dd></>}
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

/** Registrar un incidente en un punto: al tocar el mapa se abre un abanico de botones junto al punto
    (QuickFan). Tres caminos:
    1) Mandar unidades primero (botón rojo, el primero): está pasando ahora; qué pasó se elige después.
    2) Elegir qué pasó → Registrar → mandar unidades desde el mismo panel.
    3) Solo registrar, sin mandar a nadie.
    Por ahora se mandan unidades policiales. Mapeado para después: otros tipos de unidad según el hecho
    (ambulancias en un accidente, bomberos…), con su propia fuente de ubicación. */
export function IncidentFan({ p, xy, onClose, onDone, children }: { p: LngLat; xy: [number, number]; onClose: () => void; onDone: (label: string) => void;
  /** ¿Quién llega? a ese punto, para mandar unidades. */ children?: React.ReactNode }) {
  const { user } = useSession();
  const [active, setActive] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [withNote, setWithNote] = useState(false);
  /** Registrado en este punto: el panel ofrece mandar unidades. */
  const [done, setDone] = useState<{ label: string; kind: IncidentKind } | null>(null);
  useEffect(() => { setAddress(placeLabel(p[1], p[0])); setDone(null); setActive(null); setNote(''); setWithNote(false); }, [p[0], p[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = KINDS.find((k) => k === active) ?? null;
  const save = () => {
    if (!kind || address.trim().length <= 2) return;
    const k = registerIncident({ kind, lat: p[1], lon: p[0], address: address.trim(), note: note.trim() }, user);
    const label = `${k.id} · ${INCIDENT_LABEL[k.kind]}`;
    setDone({ label, kind: k.kind }); setNote(''); setWithNote(false); onDone(label);
  };
  const items = [
    { id: 'unidades', label: 'Mandar unidades', icon: 'send', tone: 'danger' as const, hint: 'Mandar ya; qué pasó se elige después' },
    ...KINDS.map((k) => ({ id: k, label: INCIDENT_LABEL[k], icon: INCIDENT_ICON[k] })),
  ];
  const units = (
    <div className="qf-sec">
      <div className="seg qf-seg" role="group" aria-label="Tipo de unidad">
        <button className="on" aria-pressed>Policía</button>
        <button disabled title="Próximamente: según el hecho, también ambulancias o bomberos">Ambulancia</button>
      </div>
      {children}
    </div>
  );
  return (
    <QuickFan xy={xy} items={items} active={active} onPick={setActive} onClose={onClose} label="Registrar incidente en este punto">
      <div className="mc2-hd"><span className="mc2-lbl">{active === 'unidades' ? 'Mandar unidades' : kind ? INCIDENT_LABEL[kind] : ''}</span></div>
      {active === 'unidades' ? <>
        {units}
        <p className="qf-hint">{done ? <>Registrado como <b className="mono">{done.label}</b></> : 'Qué pasó lo elegís después, en los otros botones.'}</p>
      </> : done && done.kind === kind ? <>
        <p className="qf-done"><span className="inc-num ok"><Icon name="check" /></span><span className="inc-step-t">{done.label}<small>{address}</small></span></p>
        {children && <><span className="qf-sub">Mandar unidades</span>{units}</>}
      </> : (
        <form className="qf-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="field"><label htmlFor="inc-addr">Dirección</label><input id="inc-addr" className="fld sm" value={address} onChange={(e) => setAddress(e.target.value)} />
            <span className="hint">Clic en otro punto del mapa para moverlo</span></div>
          {withNote
            ? <div className="field"><label htmlFor="inc-note">Qué informaron</label><textarea id="inc-note" className="fld" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: robo de celular, dos personas en moto hacia el sur" /></div>
            : <button type="button" className="linklike inc-addnote" onClick={() => setWithNote(true)}><Icon name="add" />Agregar lo que informaron</button>}
          <button type="submit" className="btn primary sm" style={{ width: '100%' }} disabled={address.trim().length <= 2}>Registrar</button>
        </form>
      )}
    </QuickFan>
  );
}
