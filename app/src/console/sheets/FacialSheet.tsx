/* Verificación facial (fase 3) — operador 911.
   Panel: coincidencias pendientes de los puntos de control.
   Ficha: captura, foto de la lista y reconstrucción 3D lado a lado; el operador decide
   si es probable (avisa al agente) o la descarta. Nunca es una identificación. */
import { useState } from 'react';
import { ago, hhmm, pct } from '../../api/format';
import { FACIAL_DISCARD, discardFacial, notifyAgent, useFacial } from '../../api/facial';
import { useSession } from '../../shell/session';
import { EmptyState, Icon, useNow, useToast } from '../../ui/kit';
import { useConsole } from '../ctx';
import { SheetHead } from './SheetHead';

const STATUS: Record<string, string> = { por_revisar: 'Por revisar', agente_avisado: 'Agente avisado', descartada: 'Descartada', confirmada_agente: 'Confirmada por el agente', descartada_agente: 'Descartada por el agente' };

function Phase3Notice() {
  return <div className="notice"><Icon name="lock" /><span>Requiere base legal confirmada.</span></div>;
}

export function FacialPanel() {
  const c = useConsole();
  const now = useNow(10000);
  const matches = useFacial();
  return (
    <>
      <Phase3Notice />
      <div className="sect">Coincidencias en puntos de control</div>
      {/* Vacía: no hubo coincidencias. Con coincidencias pero ninguna pendiente: se dice antes de la lista. */}
      {!matches.length && <EmptyState icon="visibility" title="Sin coincidencias">Los puntos de control no encontraron rostros de la lista de personas buscadas. Si aparece una, llega acá con un aviso.</EmptyState>}
      {matches.length > 0 && !matches.some((m) => m.status === 'por_revisar') && <div className="es-inline"><span className="es-ic" aria-hidden><Icon name="done_all" /></span><span><b>Todo revisado.</b> Ninguna coincidencia espera decisión.</span></div>}
      <ul className="list pb flush">
        {matches.map((m) => (
          <li key={m.id}>
            <button className={`item ${c.sheet?.k === 'facial' && c.sheet.id === m.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '44px 1fr auto' }} onClick={() => c.open({ k: 'facial', id: m.id })}>
              <img src={m.capture} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
              <div><div className="t">Coincidencia {pct(m.score)}</div><div className="s">{m.reason} · {m.listRef}</div><div className="s">{m.checkpoint.replace('Punto de control · ', '')}</div></div>
              <div className="r"><span>{ago(m.at, now)}</span><span className={`chip ${m.status === 'por_revisar' ? 'outline' : m.status === 'descartada' ? '' : 'ok'}`}>{STATUS[m.status]}</span></div>
            </button>
          </li>
        ))}
      </ul>
      <div className="lfoot">Solo corre en puntos de control habilitados. Los rostros que no coinciden no se guardan.</div>
    </>
  );
}

export function FacialSheet({ id }: { id: string }) {
  const { user } = useSession();
  const toast = useToast();
  const now = useNow(5000);
  const m = useFacial().find((x) => x.id === id);
  const [discarding, setDiscarding] = useState(false);
  if (!m) return <SheetHead kicker="Verificación facial" title="No encontrada" />;
  const fig = (src: string | null, cap: string) => (
    <figure style={{ margin: 0 }}>
      <div className="evidence" style={{ aspectRatio: '3 / 4' }}>{src ? <img src={src} alt={cap} /> : <div className="ph-ev"><img src="/assets/logo-spotvision-bn.png" alt="" /><b>{cap}</b><span>Se genera en el SpotBox</span></div>}</div>
      <figcaption className="caption" style={{ marginTop: 6, textAlign: 'center' }}>{cap}</figcaption>
    </figure>
  );
  return (
    <>
      <SheetHead kicker={<><span className="mono">{m.id}</span>·<span>{ago(m.at, now)}</span></>} title={<>Coincidencia {pct(m.score)}</>} sub={m.checkpoint}
        aside={<><span className="chip outline">{STATUS[m.status]}</span></>} />
      <div className="pb">
        <div className="callout"><Icon name="info" /><span className="grow">Una coincidencia no es una identificación. La revisan dos personas: tú y el agente en el punto de control.</span></div>
        <div className="grid cols-3" style={{ gap: 8 }}>
          {fig(m.capture, 'Captura')}{fig(m.listPhoto, 'Foto de la lista')}{fig(null, 'Reconstrucción 3D')}
        </div>
        <div className="box"><div className="bb" style={{ paddingTop: 12 }}><dl className="details">
          <dt>Lista</dt><dd>{m.listName} · <span className="mono">{m.listRef}</span></dd>
          <dt>Motivo</dt><dd>{m.reason}</dd>
          <dt>Vigencia de la orden</dt><dd>hasta el {m.orderUntil}</dd>
          <dt>Certeza</dt><dd className="mono">{pct(m.score)}</dd>
          <dt>Procesado en</dt><dd className="mono">{m.spotbox}</dd>
          <dt>Agente</dt><dd>{m.agent}</dd>
        </dl></div></div>
        <div className="box"><div className="bh"><h3>Contexto de la cámara</h3></div><div className="bb"><img src={m.scene} alt="Escena del punto de control" style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }} /></div></div>
        <div className="box"><div className="bh"><h3>Estados</h3></div><div className="bb"><ol className="timeline">
          {m.timeline.map((t, i) => <li key={i} className={i === m.timeline.length - 1 ? 'now' : 'done'}><span className="b" aria-hidden /><div>{t.label}</div><div className="when">{hhmm(t.at)}{t.by && ` · ${t.by}`}</div></li>)}
        </ol></div></div>
      </div>
      <div className="pf">
        {m.status === 'por_revisar' && !discarding && <>
          <button className="btn positive" style={{ flex: 1 }} onClick={() => { notifyAgent(m.id, user); toast('Agente avisado con foto, motivo y certeza'); }}><Icon name="send" />Probable: avisar al agente</button>
          <button className="btn secondary" onClick={() => setDiscarding(true)}><Icon name="close" />No coincide</button>
        </>}
        {m.status === 'por_revisar' && discarding && <>
          <span style={{ fontSize: 'var(--fs-sm)', width: '100%', color: 'var(--ink-muted)' }}>Motivo del descarte</span>
          {FACIAL_DISCARD.map((r) => <button key={r} className="btn secondary xs" onClick={() => { discardFacial(m.id, r, user); setDiscarding(false); }}>{r}</button>)}
          <button className="btn ghost xs" onClick={() => setDiscarding(false)}>Cancelar</button>
        </>}
        {m.status === 'agente_avisado' && <span style={{ fontSize: 'var(--fs-sm)' }}><Icon name="check_circle" /> El agente verifica en sitio y registra el resultado. Si se confirma, llega a Maic.</span>}
        {m.status === 'descartada' && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Descartada. El rostro no se guarda.</span>}
      </div>
    </>
  );
}
