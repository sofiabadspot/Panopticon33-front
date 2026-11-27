/* Analista, versión simple: buscás una placa o una persona, la elegís y ves su recorrido en el mapa con
   todos los eventos. ▶ reproduce: la línea se va dibujando, la cámara va de evento en evento y en cada uno
   aparece la captura con la cámara y la hora (como "Ver recorrido en el mapa", al estilo God's Eye View).
   Abrir una historia queda en la bitácora; el motivo es fijo ("Consulta del analista"). */
import { useMemo, useState } from 'react';
import { canOpenStory, openStory, storyPlates, useApi } from '../../api';
import { UNKNOWN_FACES, useFacial } from '../../api/facial';
import { ago } from '../../api/format';
import type { StoryChapter, StorySubject } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon } from '../../ui/kit';
import { useConsole } from '../ctx';
import { playWhenOpened } from './useStory';

export const STORY_REASON = 'Consulta del analista';

/** Abre la historia de un sujeto (o la que ya estaba abierta de ese sujeto). */
export function useOpenSubject(): (s: StorySubject) => void {
  const { user } = useSession();
  const c = useConsole();
  return (s) => { if (!canOpenStory(s)) return; const st = openStory(s, STORY_REASON, user); if (st) { playWhenOpened(); c.setStoryId(st.id); } };
}

interface Hit { key: string; icon: string; label: string; sub: string; s: StorySubject }

/** Panel izquierdo del analista: un buscador y lo que encuentra. */
export function StorySearch() {
  const [q, setQ] = useState('');
  const faces = useFacial();
  const stories = useApi((s) => s.stories);
  const open = useOpenSubject();
  const t = q.trim().toLowerCase();
  const hits = useMemo<Hit[]>(() => {
    if (t.length < 2) return [];
    const has = (x: string) => x.toLowerCase().includes(t);
    const out: Hit[] = storyPlates(q).map((p) => ({ key: 'p' + p.plate, icon: 'directions_car', label: p.plate, sub: `Placa · ${p.reads} ${p.reads === 1 ? 'evento' : 'eventos'} en 7 días${p.listed ? ' · en lista' : ''}`, s: { k: 'placa', plate: p.plate } }));
    for (const m of faces.filter((m) => (has(m.name) || has(m.listRef) || has(m.docId)) && canOpenStory({ k: 'persona', matchId: m.id })).slice(0, 5))
      out.push({ key: 'm' + m.id, icon: 'person', label: m.name, sub: `Persona · ${m.listRef}`, s: { k: 'persona', matchId: m.id } });
    for (const u of UNKNOWN_FACES.filter((u) => has(u.label) || has(u.id) || (t.length >= 4 && has('persona sin identificar'))))
      out.push({ key: 'u' + u.id, icon: 'person_search', label: `Persona sin identificar ${u.id}`, sub: u.label, s: { k: 'sin_identificar', faceId: u.id } });
    return out;
  }, [q, t, faces]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ss">
      <label className="ss-search">
        <Icon name="search" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscá una placa o una persona" aria-label="Buscar placa o persona" />
      </label>
      {t.length < 2 ? (
        <>
          <p className="ss-hint">Escribí una placa (por ejemplo <b>P 512</b>) o el nombre de una persona. Elegila y apretá ▶ para ver su recorrido.</p>
          {stories.length > 0 && <div className="ss-grp">Vistas hace poco</div>}
          <ul className="ss-list">
            {stories.slice().reverse().slice(0, 6).map((st) => (
              <li key={st.id}><button onClick={() => open(st.subject)}><Icon name="history" /><span><b>{st.title}</b><small>{ago(st.createdAt)}</small></span></button></li>
            ))}
          </ul>
        </>
      ) : !hits.length ? <p className="ss-hint">No hay eventos de «{q.trim()}».</p> : (
        <ul className="ss-list">
          {hits.map((h) => (
            <li key={h.key}><button onClick={() => open(h.s)}><Icon name={h.icon} /><span><b>{h.label}</b><small>{h.sub}</small></span><Icon name="play_arrow" /></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Barra de abajo en modo historia: ▶, cuántos eventos y salir. */
export function StoryBar({ title, chapters, onPlay, played, onExit }: { title: string; chapters: StoryChapter[]; onPlay: () => void; played: boolean; onExit: () => void }) {
  const n = chapters.filter((c) => c.lat !== null && c.lon !== null).length;
  return (
    <div className="sbar" role="group" aria-label="Recorrido">
      <button className="sbar-play" onClick={onPlay} disabled={!n} aria-label={played ? 'Reproducir de nuevo' : 'Reproducir el recorrido'}><Icon name={played ? 'refresh' : 'play_arrow'} /></button>
      <div className="sbar-txt"><b>{title}</b><span>{n ? `${n} ${n === 1 ? 'evento' : 'eventos'} en el mapa · ${played ? 'reproduciendo' : 'apretá ▶ para ver el recorrido'}` : 'Sin eventos con ubicación'}</span></div>
      <button className="btn secondary sm" onClick={onExit}><Icon name="search" />Nueva búsqueda</button>
    </div>
  );
}
