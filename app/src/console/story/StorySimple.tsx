/* Analista, versión simple: buscás una placa o una persona, la elegís y ves su recorrido en el mapa con
   todos los eventos. ▶ reproduce: la línea se va dibujando, la cámara va de evento en evento y en cada uno
   aparece la captura con la cámara y la hora (como "Ver recorrido en el mapa", al estilo God's Eye View).
   Abrir una historia queda en la bitácora; el motivo es fijo ("Consulta del analista"). */
import { useEffect, useMemo, useState } from 'react';
import { canOpenStory, openStory, sampleInvestigations, samplePerson, storyPlates, useApi } from '../../api';
import { UNKNOWN_FACES, useFacial } from '../../api/facial';
import { ago } from '../../api/format';
import type { Story } from '../../api/types';
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
  const c = useConsole();
  useEffect(() => { sampleInvestigations(); samplePerson(); }, [faces.length]);
  // Guardadas: las investigaciones, de la más reciente a la más vieja. Sin guardar: lo que se miró hace poco.
  const saved = stories.filter((x) => x.saved).sort((a, b) => b.saved!.at - a.saved!.at);
  const recent = stories.filter((x) => !x.saved).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const t = q.trim().toLowerCase();
  const hits = useMemo<Hit[]>(() => {
    if (t.length < 2) return [];
    const has = (x: string) => x.toLowerCase().includes(t);
    const out: Hit[] = storyPlates(q).map((p) => ({ key: 'p' + p.plate, icon: 'directions_car', label: p.plate, sub: `Placa · ${p.reads} ${p.reads === 1 ? 'lectura' : 'lecturas'} en 7 días${p.listed ? ' · en lista' : ''}`, s: { k: 'placa', plate: p.plate } }));
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
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca una placa o una persona" aria-label="Buscar placa o persona" />
      </label>
      {t.length < 2 ? (
        <>
          <p className="ss-hint">Escribe una placa (por ejemplo <b>P 512</b>) o el nombre de una persona para empezar una investigación.</p>
          {saved.length > 0 && <div className="ss-grp">Investigaciones <span>{saved.length}</span></div>}
          <ul className="ss-cards">
            {saved.map((st) => <li key={st.id}><InvCard st={st} onOpen={() => c.setStoryId(st.id)} /></li>)}
          </ul>
          {recent.length > 0 && <div className="ss-grp">Vistas hace poco</div>}
          <ul className="ss-list">
            {recent.map((st) => (
              <li key={st.id}><button onClick={() => open(st.subject)}><Icon name="history" /><span><b>{st.title}</b><small>Sin guardar · {ago(st.createdAt)}</small></span></button></li>
            ))}
          </ul>
        </>
      ) : !hits.length ? <p className="ss-hint">No hay lecturas ni detecciones de «{q.trim()}».</p> : (
        <ul className="ss-list">
          {hits.map((h) => (
            <li key={h.key}><button onClick={() => open(h.s)}><Icon name={h.icon} /><span><b>{h.label}</b><small>{h.sub}</small></span><Icon name="play_arrow" /></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tarjeta de una investigación guardada: nombre, a quién sigue, el caso y cuánto se le agregó. */
function InvCard({ st, onOpen }: { st: Story; onOpen: () => void }) {
  const n = st.added.length;
  return (
    <button className="ss-card" onClick={onOpen}>
      <span className="ss-card-hd"><b>{st.saved!.name}</b><Icon name="chevron_right" /></span>
      <span className="ss-card-who">{st.subject.k === 'placa' ? <span className="plate">{st.title}</span> : <><Icon name="person" />{st.title}</>}{st.caseId && <span className="mono">{st.caseId}</span>}</span>
      <span className="ss-card-ft"><span>{n ? `${n} ${n === 1 ? 'evidencia' : 'evidencias'}` : 'Sin evidencias'}</span><span>{st.saved!.by} · {ago(st.saved!.at)}</span></span>
    </button>
  );
}

/** Barra de abajo en modo historia: ▶, cuántos eventos y salir. */
export function StoryBar({ title, chapters, onPlay, played, onExit }: { title: string; chapters: StoryChapter[]; onPlay: () => void; played: boolean; onExit: () => void }) {
  const n = chapters.filter((c) => c.lat !== null && c.lon !== null).length;
  return (
    <div className="sbar" role="group" aria-label="Recorrido">
      <button className="sbar-play" onClick={onPlay} disabled={!n} aria-label={played ? 'Reproducir de nuevo' : 'Reproducir el recorrido'}><Icon name={played ? 'refresh' : 'play_arrow'} /></button>
      <div className="sbar-txt"><b>{title}</b><span>{n ? `${n} ${n === 1 ? 'momento' : 'momentos'} en el mapa · ${played ? 'reproduciendo' : 'presiona ▶ para ver el recorrido'}` : 'Sin momentos con ubicación'}</span></div>
      <button className="btn secondary sm" onClick={onExit}><Icon name="search" />Nueva búsqueda</button>
    </div>
  );
}
