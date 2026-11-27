/* Abrir una historia desde cualquier lado (buscador, ficha de vehículo, alerta, línea de tiempo, capítulos).
   Toda historia pide motivo, salvo que venga de una investigación: ahí hereda el suyo. Si el sujeto ya
   tiene historia con el mismo origen (la misma investigación, o ninguna), se reabre sin volver a pedirlo. Solo el analista; si la historia no se puede abrir
   (coincidencia descartada, sujeto que no existe), no pasa nada: el botón ni aparece. */
import { useCallback, useState, useSyncExternalStore, type FormEvent } from 'react';
import { canOpenStory, openStory, snapshot, storySubjectLabel } from '../../api';
import { normalizePlate } from '../../api/format';
import { SEARCH_REASONS } from '../../api/labels';
import type { StorySubject } from '../../api/types';
import { useSession } from '../../shell/session';
import { Dialog, Icon } from '../../ui/kit';
import { useConsole } from '../ctx';
import { playWhenOpened } from './useStory';
import { STORY_REASON } from './StorySimple';
import { usePermissions } from '../permissions';

/* El sujeto que espera motivo. Lo pinta <OpenStoryHost />, montado una vez en la consola. */
let pending: StorySubject | null = null;
const subs = new Set<() => void>();
const setPending = (s: StorySubject | null) => { pending = s; subs.forEach((f) => f()); };
const usePending = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => pending);

const same = (a: StorySubject, b: StorySubject) =>
  a.k === 'placa' ? b.k === 'placa' && normalizePlate(a.plate) === normalizePlate(b.plate)
    : a.k === 'persona' ? b.k === 'persona' && a.matchId === b.matchId
      : b.k === 'sin_identificar' && a.faceId === b.faceId;

export function useOpenStory(): (s: StorySubject, from?: { invId: string }) => void {
  const { role, user } = useSession();
  const perm = usePermissions();
  const c = useConsole();
  return useCallback((s: StorySubject, from?: { invId: string }) => {
    if (!perm.has('investigar') || !canOpenStory(s)) return;
    // Desde una investigación es otra historia que la suelta: se reabre solo la del mismo origen.
    const had = snapshot().stories.find((x) => same(x.subject, s) && x.invId === from?.invId);
    if (had) { playWhenOpened(); c.setStoryId(had.id); return; }
    if (from) { const st = openStory(s, '', user, from); if (st) { playWhenOpened(); c.setStoryId(st.id); } return; }
    // Versión simple: sin diálogo de motivo. Queda en la bitácora con el motivo fijo.
    const st = openStory(s, STORY_REASON, user); if (st) { playWhenOpened(); c.setStoryId(st.id); }
  }, [role, user, c]);
}

export function OpenStoryHost() {
  const s = usePending();
  return s ? <ReasonDialog key={JSON.stringify(s)} s={s} /> : null;
}

function ReasonDialog({ s }: { s: StorySubject }) {
  const { user } = useSession();
  const c = useConsole();
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const close = useCallback(() => setPending(null), []);
  const label = storySubjectLabel(s);
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (!pick) return;
    const st = openStory(s, [pick, text.trim()].filter(Boolean).join(' · '), user);
    setPending(null);
    if (st) { playWhenOpened(); c.setStoryId(st.id); }
  };
  return (
    <Dialog title={s.k === 'sin_identificar' ? `Investigar a la persona sin identificar ${s.faceId}` : `Investigar ${label.title}`} onClose={close}>
      <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 14 }}>
        <div className="callout"><Icon name="lock" /><span className="grow">La investigación reconstruye por dónde anduvo, capítulo por capítulo. Abrirla queda en la bitácora con su motivo.</span></div>
        <div className="field">
          <select className="fld sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Motivo de la consulta" autoFocus>
            <option value="">Motivo de la consulta…</option>{SEARCH_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input className="fld sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Número de caso (opcional)" aria-label="Número de caso" />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost sm" type="button" onClick={close}>Cancelar</button>
          <button className="btn primary sm" type="submit" disabled={!pick} title={pick ? undefined : 'Elegí un motivo'}><Icon name="play_arrow" />Abrir y reproducir</button>
        </div>
      </form>
    </Dialog>
  );
}
