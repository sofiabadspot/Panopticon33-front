/* Columna derecha del modo historia: los capítulos en orden. Los antecedentes van sin número (no tienen
   punto en el mapa); lo agregado por el analista lleva barra gris y "Agregado por". Entre dos capítulos se
   marca el hueco sin cámaras: ese tramo es inferido, no observado. */
import { useEffect, useRef, useState } from 'react';
import { canOpenStory, storySubjectLabel, toggleKeyMoment } from '../../api';
import { hhmm, pct } from '../../api/format';
import { gapBefore } from '../../api/story';
import type { Story, StoryChapter, StorySubject } from '../../api/types';
import { Icon } from '../../ui/kit';
import { StoryEmpty } from './StoryPanel';
import { useStoryChapters, useStoryPlayback } from './useStory';

const TZ = 'America/El_Salvador';
const day = (t: number) => new Date(t).toLocaleDateString('es-SV', { timeZone: TZ, day: '2-digit', month: '2-digit' });

const mentionLabel = (m: StorySubject) => (m.k === 'sin_identificar' ? 'persona sin identificar' : storySubjectLabel(m).title);

function title(c: StoryChapter) {
  if (c.source === 'antecedente') return c.note ?? c.place;
  if (c.source === 'analista') return c.evidence[0]?.caption || c.place;
  return c.cameraId ? `${c.cameraId} · ${c.place}` : c.place;
}
function detail(c: StoryChapter, story: Story) {
  if (c.source === 'antecedente') return c.lat === null ? `${c.srcLabel ?? 'Registro'} · sin ubicación de cámara` : `${c.srcLabel ?? 'Registro'} · ${c.cameraId ? `${c.cameraId} · ` : ''}${c.place}`;
  if (c.source === 'analista') return c.place;
  const what = story.subject.k === 'placa' ? 'Placa leída' : 'Persona detectada';
  return [what + (c.confidence !== undefined ? ` · ${pct(c.confidence)}` : ''), c.reads > 1 ? `×${c.reads} lecturas` : '', c.note ?? ''].filter(Boolean).join(' · ');
}

export function StoryChapters({ story }: { story: Story }) {
  const chs = useStoryChapters(story);
  const { at, setAt, setPlaying, playing } = useStoryPlayback(chs.length);
  const [q, setQ] = useState('');
  const today = day(Date.now());
  const nowRef = useRef<HTMLLIElement>(null);
  useEffect(() => { nowRef.current?.scrollIntoView({ block: 'nearest' }); }, [at]);

  const needle = q.trim().toLowerCase();
  const match = (c: StoryChapter) => !needle || [c.place, c.cameraId, c.note, c.keyLabel, c.srcLabel, c.addedBy, ...c.evidence.map((e) => e.caption)]
    .some((s) => s && s.toLowerCase().includes(needle));
  // Número de cada capítulo: cuentan las detecciones; lo agregado lleva "+" y los antecedentes "—".
  let seq = 0;
  const nums = chs.map((c) => (c.source === 'sistema' ? String(++seq).padStart(2, '0') : c.source === 'analista' ? '+' : '—'));
  const rows = chs.map((c, i) => ({ c, i })).filter((x) => match(x.c));

  return (
    <div className="story-chapters">
      <div className="story-chd"><span className="story-lbl">Capítulos · {chs.length}</span></div>
      {!chs.length ? <StoryEmpty story={story} /> : <>
        <div className="story-search">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en esta historia" aria-label="Buscar por lugar, cámara o texto" />
          {q && <button className="iconbtn" onClick={() => setQ('')} aria-label="Borrar búsqueda"><Icon name="close" /></button>}
        </div>
        <ol className="story-list">
          {!rows.length && <li className="empty">Ningún capítulo coincide con “{q.trim()}”.</li>}
          {rows.map(({ c, i }) => {
            const gap = gapBefore(chs, i);
            const now = i === at;
            const ment = c.mentions && canOpenStory(c.mentions) ? c.mentions : null;
            const d = day(c.at);
            return [
              !needle && gap && gap.min > 5 && <li key={c.id + ':gap'} className="story-gap" aria-hidden>+{gap.min} min sin cámaras · tramo inferido</li>,
              <li key={c.id} ref={now ? nowRef : undefined} className={`story-ch ${c.source} ${now ? 'now' : ''}`}>
                <button className="story-ch-main" onClick={() => { setAt(i); setPlaying(false); }} aria-current={now ? 'step' : undefined}>
                  <span className="n">{nums[i]}</span>
                  <span className="story-ch-body">
                    <b>{title(c)}</b>
                    <small>{detail(c, story)}{now && playing ? ' · reproduciendo' : ''}</small>
                    {(c.key || c.source !== 'sistema' || gap?.impossible) && (
                      <span className="story-pills">
                        {c.key && <span className="story-pill key">★ {c.keyLabel ?? 'Momento clave'}</span>}
                        {c.source === 'antecedente' && <span className="story-pill">Antecedente · {c.srcLabel ?? 'Registro'}</span>}
                        {c.source === 'analista' && <span className="story-pill">Agregado por {c.addedBy ?? 'el analista'}</span>}
                        {gap?.impossible && <span className="story-pill warn">⚠ El tramo no cierra</span>}
                      </span>
                    )}
                  </span>
                  <span className="t mono">{d !== today && <>{d}<br /></>}{hhmm(c.at)}</span>
                </button>
                <button className={`story-star ${c.key ? 'on' : ''}`} onClick={() => toggleKeyMoment(story.id, c.id)} aria-pressed={!!c.key}
                  aria-label={c.key ? 'Quitar de momentos clave' : 'Marcar como momento clave'} title={c.key ? 'Quitar de momentos clave' : 'Marcar como momento clave'}>
                  <span aria-hidden>★</span>
                </button>
                {ment && <p className="story-ment">Aparece con: {mentionLabel(ment)} · <span className="story-ment-link">Ver su historia</span></p>}
              </li>,
            ];
          })}
        </ol>
      </>}
    </div>
  );
}
