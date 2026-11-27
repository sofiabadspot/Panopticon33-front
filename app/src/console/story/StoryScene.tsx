/* Escena del recorrido: cuando el capítulo actual no tiene lugar en el mapa (un documento, fotos de la
   persona, un informe de una fuente externa, un antecedente), aparece como una tarjeta al costado del mapa,
   sin taparlo: el recorrido sigue a la vista y la línea sigue avanzando hacia el próximo punto. La tarjeta
   dice cuándo pasó, de qué fuente viene y entre qué puntos del recorrido cae, para que se lea en orden. */
import { dateShort, hhmm, spanWhen } from '../../api/format';
import type { Story } from '../../api/types';
import { Evidence, Icon } from '../../ui/kit';
import { useStoryChapters, useStoryPlayback } from './useStory';

export function StoryScene({ story }: { story: Story }) {
  const chs = useStoryChapters(story);
  const { at } = useStoryPlayback(chs.length);
  const c = chs[at];
  if (!c || (c.lat !== null && c.lon !== null)) return null;
  const ante = c.source === 'antecedente';
  const title = ante ? c.note ?? c.place : c.evidence[0]?.caption ?? c.place;
  const shown = c.evidence.filter((e) => e.type !== 'pendiente' || !ante);
  const placed = (i: number) => chs[i] && chs[i].lat !== null;
  let p = at - 1; while (p >= 0 && !placed(p)) p--;
  let n = at + 1; while (n < chs.length && !placed(n)) n++;
  const when = spanWhen(chs.map((x) => x.at));
  const where = (i: number) => `${chs[i].cameraId ?? chs[i].place} (${when.at(chs[i].at)})`;
  const between = p >= 0 && n < chs.length ? `Entre ${where(p)} y ${where(n)}` : p >= 0 ? `Después de ${where(p)}` : n < chs.length ? `Antes de ${where(n)}` : '';
  return (
    <aside className="story-scene" aria-live="polite" aria-label="Evidencia sin lugar en el mapa">
      <article key={c.id} className="scene-card">
        <header className="scene-hd">
          <span className="scene-kicker"><Icon name={ante ? 'history' : 'description'} />{ante ? 'Antecedente' : 'Sin lugar en el mapa'}</span>
          <time className="scene-when mono" dateTime={new Date(c.at).toISOString()}>{dateShort(c.at)} · {hhmm(c.at)}</time>
        </header>
        <h2 className="scene-title">{title}</h2>
        {between && <p className="scene-between"><Icon name="timeline" />{between}</p>}
        {shown.length > 0 && (
          <div className={`scene-ev ${shown.length > 1 ? 'many' : ''}`}>
            {shown.map((e, i) => <Evidence key={i} ev={e.type === 'pendiente' ? { ...e, caption: '' } : e} />)}
          </div>
        )}
        <footer className="scene-ft">
          {c.srcLabel && <span>Fuente: <b>{c.srcLabel}</b></span>}
          {c.addedBy && <span>Agregado por {c.addedBy}{c.addedAt ? ` el ${dateShort(c.addedAt)} ${hhmm(c.addedAt)}` : ''}</span>}
        </footer>
      </article>
    </aside>
  );
}
