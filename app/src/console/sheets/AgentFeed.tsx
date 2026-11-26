/* Jules trabajando, en vivo (mando). En vez de un resumen quieto, un ciclo:
   1. Revisa: la Nebulosa en el centro, pensando, y lo que va mirando ("Contando gente en 6 zonas…").
   2. Encuentra: lo dice de a una cosa, escribiéndolo ("Plaza Salvador del Mundo está al 148 %…"), y
      pregunta qué hacer con botones ("Mandar 2 patrullas" · "Ver zona" · "Ahora no").
   3. Responde: "Listo. Van 2 patrullas…". Lo que hizo solo (reversible) lo cuenta y ofrece deshacer.
   4. "Sigo revisando…" y vuelve a 1 con lo siguiente. Si no queda nada, dice qué está vigilando,
      y cuando los datos cambian y aparece algo nuevo, arranca otra vez.
   Lo resuelto queda arriba como una lista corta, para ver lo que pasó en el turno. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { snapshot, useApi } from '../../api';
import { hhmm } from '../../api/format';
import type { User } from '../../api/types';
import { Nebulosa } from '../../ui/Nebulosa';
import { TextoJules } from '../../ui/TextoJules';
import { dismiss, runAgent, undo, useAgentLog, type Done, type Look, type Proposal, type Tone } from '../julesAgent';

/** Un hallazgo para mostrar: una propuesta (necesita aprobación) o algo que Jules ya hizo solo. */
type Finding =
  | { k: 'propuesta'; key: string; p: Proposal }
  | { k: 'hecho'; key: string; d: Done };
type Phase = 'scan' | 'show' | 'ack' | 'calm';
interface Past { key: string; at: number; text: string; tone: 'ok' | 'skip' | 'undo' }

const sinMovimiento = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const T = (ms: number) => (sinMovimiento() ? 200 : ms);
/** Jules escribe más despacio que en la charla: se lee mientras aparece. */
const RITMO = 90;

export function AgentFeed({ user, saludo, onLook }: { user: User; saludo: string; onLook: (l: Look) => void }) {
  // Se rearma con los datos vivos y con lo que Jules hace.
  useApi((s) => s.alerts); useApi((s) => s.zoneStatus); useApi((s) => s.units);
  const log = useAgentLog();
  const brief = runAgent('command');

  // Lo resuelto en esta sesión (propuestas aprobadas o descartadas, avisos ya contados).
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [past, setPast] = useState<Past[]>([]);
  const queue: Finding[] = useMemo(() => [
    ...brief.proposals.map((p) => ({ k: 'propuesta' as const, key: p.key, p })),
    ...log.filter((d) => !d.key.startsWith('hecho-') && !d.undone).map((d) => ({ k: 'hecho' as const, key: d.key, d })),
  ].filter((f) => !handled.has(f.key)), [brief.proposals, log, handled]);

  const [phase, setPhase] = useState<Phase>('scan');
  const [current, setCurrent] = useState<Finding | null>(null);
  const [ack, setAck] = useState('');
  const [typed, setTyped] = useState(false);
  const first = useRef(true);
  // La cola cambia con cada dato nuevo; el temporizador de "revisando" no se reinicia por eso.
  const queueRef = useRef(queue); queueRef.current = queue;

  // Revisar → mostrar lo siguiente (o quedarse vigilando).
  useEffect(() => {
    if (phase !== 'scan') return undefined;
    const t = setTimeout(() => {
      const next = queueRef.current[0] ?? null;
      setCurrent(next); setTyped(false);
      setPhase(next ? 'show' : 'calm');
      first.current = false;
    }, T(first.current ? 5200 : 3400));
    return () => clearTimeout(t);
  }, [phase]);
  // Vigilando y aparece algo nuevo: vuelve a revisar.
  useEffect(() => { if (phase === 'calm' && queue.length) setPhase('scan'); }, [phase, queue.length]);
  // Después de responder, sigue revisando.
  useEffect(() => {
    if (phase !== 'ack') return undefined;
    const t = setTimeout(() => setPhase('scan'), T(4200));
    return () => clearTimeout(t);
  }, [phase]);

  // Terminó de escribir: una pausa corta y recién ahí aparecen el detalle y las opciones.
  const reveal = useCallback(() => { setTimeout(() => setTyped(true), T(700)); }, []);
  const resolve = useCallback((f: Finding, text: string, tone: Past['tone'], reply: string) => {
    setHandled((h) => new Set(h).add(f.key));
    setPast((p) => [{ key: f.key, at: Date.now(), text, tone }, ...p].slice(0, 6));
    setAck(reply); setPhase('ack');
  }, []);

  const s = snapshot();
  const measured = s.zones.filter((z) => s.zoneStatus[z.id]?.count != null).length;
  const waiting = s.alerts.filter((a) => a.review === 'por_revisar').length;
  const steps = [`Mirando ${s.cameras.length} cámaras`, `Contando gente en ${measured} zonas`, `Revisando ${waiting} alertas`, 'Buscando patrullas cerca'];

  const tone: Tone = current?.k === 'propuesta' ? current.p.tone : 'ok';

  const approve = (f: Extract<Finding, { k: 'propuesta' }>) => { f.p.approve(user); resolve(f, f.p.doneText.replace(/^Listo\. /, ''), 'ok', f.p.doneText); };
  const skip = (f: Extract<Finding, { k: 'propuesta' }>) => { dismiss(f.p.key, user); resolve(f, `No mandé refuerzos a ${f.p.subject}.`, 'skip', 'Entendido, no lo mando. Si empeora, te lo vuelvo a proponer.'); };
  const keep = (f: Extract<Finding, { k: 'hecho' }>) => resolve(f, f.d.text, 'ok', 'Perfecto. Sigo revisando.');
  const revert = (f: Extract<Finding, { k: 'hecho' }>) => { undo(f.d.key, user); resolve(f, `Deshice: ${f.d.text.charAt(0).toLowerCase()}${f.d.text.slice(1)}`, 'undo', 'Listo, lo deshice.'); };

  return (
    <div className={`ag ag--${phase}`}>
      {/* Revisando: Jules grande al centro, y el saludo solo la primera vez. */}
      {phase === 'scan' && (
        <div className="ag-scan">
          <Nebulosa state="think" size={80} />
          {!past.length && <span className="ag-hello">{saludo}</span>}
          <Steps steps={past.length ? ['Sigo revisando', ...steps.slice(1)] : steps} />
        </div>
      )}

      <div aria-live="polite">
        {phase === 'show' && current?.k === 'propuesta' && (
          <div className={`ag-msg ${tone}`} key={current.key}>
            <span className="ag-meta"><i aria-hidden />{tone === 'crit' ? 'Urgente' : 'Para mirar'} · {hhmm(Date.now())}</span>
            <TextoJules as="h3" className="ag-lead" texto={current.p.lead} ritmo={RITMO} onTermina={reveal} />
            {typed && <div className="ag-more svx-entrar">
              {current.p.leadDetail && <p className="ag-detail">{current.p.leadDetail}</p>}
              <p className="ag-ask">{current.p.ask}</p>
              {current.p.cost && <p className="ag-cost">{current.p.cost}</p>}
              <div className="ag-row">
                <button className="ag-btn primary" onClick={() => approve(current)}>{current.p.title}</button>
                {current.p.look && <button className="ag-btn link" onClick={() => onLook(current.p.look!)}>{current.p.look.label}</button>}
                <button className="ag-btn link" onClick={() => skip(current)}>Ahora no</button>
              </div>
            </div>}
          </div>
        )}

        {phase === 'show' && current?.k === 'hecho' && (
          <div className="ag-msg done" key={current.key}>
            <span className="ag-meta"><i aria-hidden />Lo hice solo · se puede deshacer</span>
            <TextoJules as="h3" className="ag-lead" texto={current.d.text} ritmo={RITMO} onTermina={reveal} />
            {typed && <div className="ag-more svx-entrar">
              <div className="ag-row">
                <button className="ag-btn primary" onClick={() => keep(current)}>Bien, seguí</button>
                {current.d.look && <button className="ag-btn link" onClick={() => onLook(current.d.look!)}>{current.d.look.label}</button>}
                <button className="ag-btn link" onClick={() => revert(current)}>Deshacer</button>
              </div>
            </div>}
          </div>
        )}

        {phase === 'ack' && (
          <div className="ag-msg ok svx-entrar"><TextoJules key={ack} as="h3" className="ag-lead ag-done" texto={ack} ritmo={RITMO} /></div>
        )}

        {phase === 'calm' && (
          <div className="ag-msg ok">
            <h3 className="ag-lead">{past.length ? 'Por ahora no hay nada más.' : brief.headline}</h3>
            <h4 className="ag-sec-h">Sigo vigilando</h4>
            <ul className="ag-watch">{brief.watching.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </div>

      {past.length > 0 && (
        <section className="ag-past">
          <h4 className="ag-sec-h">En este turno</h4>
          <ul>
            {past.map((x) => (
              <li key={x.key + x.at} className={x.tone}><span className="mono">{hhmm(x.at)}</span><span>{x.text}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}


/** Lo que va mirando mientras revisa: un paso por vez, con el brillo recorriendo el texto. */
function Steps({ steps }: { steps: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % steps.length), 1300); return () => clearInterval(t); }, [steps.length]);
  return <p key={i} className="ag-step svx-brillo svx-entrar">{steps[i]}…</p>;
}
