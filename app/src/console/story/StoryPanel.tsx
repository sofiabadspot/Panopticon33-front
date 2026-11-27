/* Columna izquierda del modo historia: a quién se sigue, con qué motivo, un resumen y los momentos clave.
   Abajo, «Guardar como investigación» si todavía no lo está. La evidencia se agrega desde la barra del mapa. Los capítulos y el capítulo actual son los mismos que ven la columna derecha,
   el mapa y el reproductor (useStory.ts). */
import { useState } from 'react';
import { saveStory, storySubjectLabel, useApi } from '../../api';
import { spanWhen } from '../../api/format';
import { gapBefore } from '../../api/story';
import type { Story, StoryChapter } from '../../api/types';
import { useSession } from '../../shell/session';
import { EmptyState, Icon } from '../../ui/kit';
import { SubjectCard } from './SubjectCard';
import { useStoryChapters, useStoryPlayback, useStoryRange } from './useStory';


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
  const when = spanWhen(chs.map((c) => c.at));
  const seen = chs.filter((c) => c.source === 'sistema');
  const reads = seen.reduce((n, c) => n + c.reads, 0);
  const cams = new Set(seen.map((c) => c.cameraId).filter(Boolean)).size;
  const verb = story.subject.k === 'placa' ? 'Leída' : 'Detectada';
  const out = [`${verb} ${times(reads, 'vez', 'veces')} en ${times(cams, 'cámara', 'cámaras')}.`];
  const bad = chs.map((c, i) => ({ c, i, g: gapBefore(chs, i) })).filter((x) => x.g?.impossible);
  if (bad.length === 1) {
    const prev = chs.slice(0, bad[0].i).reverse().find((c) => c.lat !== null);
    out.push(`Un tramo no cierra${prev ? ` (${when.at(prev.at)} → ${when.at(bad[0].c.at)})` : ''}.`);
  } else if (bad.length > 1) out.push(`${bad.length} tramos no cierran.`);
  const added = chs.filter((c) => c.source === 'analista').length;
  if (added) out.push(added === 1 ? 'Una evidencia agregada por el analista.' : `${added} evidencias agregadas por el analista.`);
  return out.join(' ');
}

const BN = '/assets/logo-spotvision-bn.png';

export function StoryPanel({ story, onExit }: { story: Story; onExit?: () => void }) {
  const investigations = useApi((s) => s.investigations);
  const chs = useStoryChapters(story);
  const when = spanWhen(chs.map((c) => c.at));
  const who = storySubjectLabel(story.subject);
  const { setAt, setPlaying } = useStoryPlayback(chs.length);
  const { range, setRange } = useStoryRange();
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
        {/* Volver a la lista: el mismo enlace «← Investigaciones» del panel de investigaciones. Esc también sale. */}
        {onExit && <button className="linklike story-back" onClick={onExit} title="Volver a Investigaciones (Esc)"><Icon name="arrow_back" />Investigaciones</button>}
        <section className="story-sec">
          <span className="story-lbl">{story.saved ? 'Investigación' : 'Sin guardar'}</span>
          {story.saved && <h2 className="story-name">{story.saved.name}</h2>}
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

        {/* Ficha del sujeto: las mismas piezas que la ficha de vehículo y la de reconocimiento facial. */}
        <section className="story-sec story-subj">
          <span className="story-lbl">{story.subject.k === 'placa' ? 'Ficha del vehículo' : 'Ficha de la persona'}</span>
          <SubjectCard story={story} />
        </section>

        {!chs.length ? <StoryEmpty story={story} /> : <>
          <section className="story-sec">
            <span className="story-lbl">Acerca de</span>
            <div className="story-stats">
              <div><b>{chs.length}</b><span>{chs.length === 1 ? 'capítulo' : 'capítulos'}</span></div>
              <div><b>{cams}</b><span>{cams === 1 ? 'cámara' : 'cámaras'}</span></div>
              <div><b>{span(spanChs[spanChs.length - 1].at - spanChs[0].at)}</b><span>de {when.at(spanChs[0].at)} a {when.at(spanChs[spanChs.length - 1].at)}</span></div>
            </div>
            <p className="story-sum">{summary(story, chs)}</p>
          </section>

          <section className="story-sec">
            <span className="story-lbl">Momentos clave</span>
            {!keys.length ? <p className="story-sum">Sin momentos clave. Marcalos con la estrella de cada capítulo.</p> : (
              <ul className="story-keys">
                {keys.map(({ c, i }) => (
                  <li key={c.id}><button onClick={() => go(i)}>
                    <span className="star" aria-hidden>★</span><span>{c.keyLabel ?? c.place}{c.cameraId ? ` · ${c.cameraId}` : ''}</span><em>{when.at(c.at)}</em>
                  </button></li>
                ))}
              </ul>
            )}
          </section>
        </>}
      </div>
      <div className="story-foot">
        {story.saved
          ? <p className="story-saved"><Icon name="check" />Guardada por {story.saved.by}</p>
          : <SaveAs story={story} />}
      </div>
    </div>
  );
}

/** Lo que se está mirando todavía no es una investigación: se guarda con un nombre y pasa a la lista. */
function SaveAs({ story }: { story: Story }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`Investigación de ${story.title}`);
  if (!open) return <button className="btn primary sm block" onClick={() => setOpen(true)}><Icon name="check" />Guardar como investigación</button>;
  return (
    <form className="story-save" onSubmit={(e) => { e.preventDefault(); saveStory(story.id, name, user); }}>
      <label htmlFor="inv-name" className="lbl">Nombre de la investigación</label>
      <input id="inv-name" className="fld sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <div className="ev-actions">
        <button type="button" className="btn secondary sm" onClick={() => setOpen(false)}>Cancelar</button>
        <button type="submit" className="btn primary sm" disabled={!name.trim()}>Guardar</button>
      </div>
    </form>
  );
}
