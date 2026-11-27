/* Columna izquierda del modo historia: a quién se sigue, con qué motivo, un resumen y los momentos clave.
   Abajo, "Agregar evidencia". Los capítulos y el capítulo actual son los mismos que ven la columna derecha,
   el mapa y el reproductor (useStory.ts). */
import { storySubjectLabel, useApi } from '../../api';
import { hhmm } from '../../api/format';
import { gapBefore } from '../../api/story';
import type { Story, StoryChapter } from '../../api/types';
import { EmptyState, Icon } from '../../ui/kit';
import { useStoryChapters, useStoryPlayback, useStoryRange } from './useStory';

const BN = '/assets/logo-spotvision-bn.png';

/** "2 h 10", "45 min", "40 d 3 h". */
function span(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  if (m >= 48 * 60) { const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return h ? `${d} d ${h} h` : `${d} d`; }
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Sin capítulos en la ventana elegida: lo dicen las dos columnas, con "Ver todo" si hay ventana. */
export function StoryEmpty({ story }: { story: Story }) {
  const { range, setRange } = useStoryRange();
  const canWiden = !!story.window && range === 'ventana';
  return (
    <EmptyState icon="history" title="Sin detecciones en esta ventana"
      action={canWiden ? <button className="btn secondary sm" onClick={() => setRange('todo')}>Ver todo</button> : undefined}>
      {canWiden ? 'Ninguna cámara registró al sujeto entre el inicio y el fin del hecho.' : 'Ninguna cámara registró al sujeto.'}
    </EmptyState>
  );
}

/** Una frase con lo que no cierra y lo agregado. */
function summary(story: Story, chs: StoryChapter[]) {
  const seen = chs.filter((c) => c.source === 'sistema');
  const reads = seen.reduce((n, c) => n + c.reads, 0);
  const cams = new Set(seen.map((c) => c.cameraId).filter(Boolean)).size;
  const verb = story.subject.k === 'placa' ? 'Leída' : 'Detectada';
  const out = [`${verb} ${times(reads, 'vez', 'veces')} en ${times(cams, 'cámara', 'cámaras')}.`];
  const bad = chs.map((c, i) => ({ c, i, g: gapBefore(chs, i) })).filter((x) => x.g?.impossible);
  if (bad.length === 1) {
    const prev = chs.slice(0, bad[0].i).reverse().find((c) => c.lat !== null);
    out.push(`Un tramo no cierra${prev ? ` (${hhmm(prev.at)} → ${hhmm(bad[0].c.at)})` : ''}.`);
  } else if (bad.length > 1) out.push(`${bad.length} tramos no cierran.`);
  const added = chs.filter((c) => c.source === 'analista').length;
  if (added) out.push(added === 1 ? 'Una evidencia agregada por el analista.' : `${added} evidencias agregadas por el analista.`);
  return out.join(' ');
}

export function StoryPanel({ story, onAddEvidence }: { story: Story; onAddEvidence?: () => void }) {
  const investigations = useApi((s) => s.investigations);
  const chs = useStoryChapters(story);
  const { setAt, setPlaying } = useStoryPlayback(chs.length);
  const { range, setRange } = useStoryRange();
  const who = storySubjectLabel(story.subject);
  const inv = story.invId ? investigations.find((k) => k.id === story.invId) : undefined;
  // "Acerca de" mide lo detectado: los antecedentes (pueden ser de semanas antes) no estiran el lapso, y lo
  // agregado por el analista no suma cámaras.
  const timed = chs.filter((c) => c.source !== 'antecedente');
  const spanChs = timed.length ? timed : chs;
  const cams = new Set(chs.filter((c) => c.source === 'sistema').map((c) => c.cameraId).filter(Boolean)).size;
  const keys = chs.map((c, i) => ({ c, i })).filter((x) => x.c.key);
  const go = (i: number) => { setAt(i); setPlaying(false); };

  return (
    <div className="story-panel">
      <div className="story-body">
        <section className="story-sec">
          <span className="story-lbl">Historia</span>
          {story.subject.k === 'placa' ? (
            <div className="story-subject">
              <span className="plate story-plate">{who.title}</span>
              <div className="story-who"><b>{who.sub}</b>{who.facts.map(([k, v]) => <small key={k}>{k}: {v}</small>)}</div>
            </div>
          ) : (
            <div className="story-subject">
              {story.subject.k === 'persona'
                ? (() => { const src = who.photos?.find(Boolean); return <img className={`story-photo ${src ? '' : 'bn'}`} src={src || BN} alt="" />; })()
                : <span className="story-photo none" aria-hidden><Icon name="person" /></span>}
              <div className="story-who"><b>{who.title}</b><small>{who.sub}</small></div>
            </div>
          )}
          <dl className="story-facts">
            {story.subject.k !== 'placa' && who.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            <div><dt>Motivo</dt><dd>{story.reason}</dd></div>
            {inv && <div><dt>Desde</dt><dd><span className="mono">{inv.id}</span> · {inv.place.label}</dd></div>}
            {story.window && (
              <div><dt>Ventana</dt><dd className="story-range" role="group" aria-label="Ventana">
                <button className={`lchip ${range === 'ventana' ? 'on' : ''}`} aria-pressed={range === 'ventana'} onClick={() => setRange('ventana')}>Ventana del hecho</button>
                <button className={`lchip ${range === 'todo' ? 'on' : ''}`} aria-pressed={range === 'todo'} onClick={() => setRange('todo')}>7 días</button>
              </dd></div>
            )}
          </dl>
        </section>

        {!chs.length ? <StoryEmpty story={story} /> : <>
          <section className="story-sec">
            <span className="story-lbl">Acerca de</span>
            <div className="story-stats">
              <div><b>{chs.length}</b><span>{chs.length === 1 ? 'capítulo' : 'capítulos'}</span></div>
              <div><b>{cams}</b><span>{cams === 1 ? 'cámara' : 'cámaras'}</span></div>
              <div><b>{span(spanChs[spanChs.length - 1].at - spanChs[0].at)}</b><span>de {hhmm(spanChs[0].at)} a {hhmm(spanChs[spanChs.length - 1].at)}</span></div>
            </div>
            <p className="story-sum">{summary(story, chs)}</p>
          </section>

          <section className="story-sec">
            <span className="story-lbl">Momentos clave</span>
            {!keys.length ? <p className="story-sum">Sin momentos clave. Marcalos con la estrella de cada capítulo.</p> : (
              <ul className="story-keys">
                {keys.map(({ c, i }) => (
                  <li key={c.id}><button onClick={() => go(i)}>
                    <span className="star" aria-hidden>★</span><span>{c.keyLabel ?? c.place}{c.cameraId ? ` · ${c.cameraId}` : ''}</span><em>{hhmm(c.at)}</em>
                  </button></li>
                ))}
              </ul>
            )}
          </section>
        </>}
      </div>
      <div className="story-foot">
        {onAddEvidence && <button className="btn primary sm block" onClick={onAddEvidence}><Icon name="add" />Agregar un evento al trayecto <span className="kbd">clic en el mapa</span></button>}
      </div>
    </div>
  );
}
