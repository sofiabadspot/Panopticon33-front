/* El recorrido de la historia en el mapa: las paradas (solo lo que tiene posición), cuál es la actual
   según el capítulo que se está mirando y el número que lleva en el HUD. Sale de la misma lista de
   capítulos que muestran el panel y la columna de capítulos. */
import { useMemo } from 'react';
import { dateTime, hhmm } from '../../api/format';
import { routeStopAt, routeStops } from '../../api/story';
import type { Story, StoryChapter } from '../../api/types';
import type { RouteStop } from '../../map/MapView';
import { useStoryChapters, useStoryPlayback } from './useStory';

/** Número de cada capítulo, igual que en la lista: las detecciones cuentan; lo agregado lleva "+" y los
    antecedentes "—". */
export const chapterNums = (chs: StoryChapter[]) => {
  let seq = 0;
  return chs.map((c) => (c.source === 'sistema' ? String(++seq).padStart(2, '0') : c.source === 'analista' ? '+' : '—'));
};

export function storyStops(chs: StoryChapter[]): RouteStop[] {
  const nums = chapterNums(chs);
  return routeStops(chs).map((c) => {
    const n = nums[chs.indexOf(c)];
    const clip = c.evidence.find((e) => e.type === 'clip' && e.src);
    // Sin clip: la captura si la hay; si no, el marcador B/N (Evidence ya lo resuelve con 'pendiente').
    const ev = c.evidence.find((e) => e.type === 'imagen' && e.src) ?? c.evidence[0] ?? { type: 'pendiente' as const, caption: c.place };
    const camera = c.cameraId ?? (c.source === 'analista' ? 'Agregado' : '—');
    return {
      lat: c.lat!, lon: c.lon!, label: n, time: hhmm(c.at), title: `${dateTime(c.at)} · ${c.cameraId ? `${c.cameraId} · ` : ''}${c.place}`,
      kind: c.source === 'analista' ? 'add' as const : 'det' as const,
      clip: clip ? { src: clip.src!, poster: clip.poster } : undefined,
      snap: { camera, street: c.place, evidence: ev, confidence: c.confidence },
    };
  });
}

/** Lo que el mapa necesita en modo historia. Sin historia: todo vacío y `at` null. */
export function useStoryRoute(story: Story | null): { stops: RouteStop[]; at: number | null; count: { now: string; total: number } | null } {
  const chs = useStoryChapters(story);
  const { at } = useStoryPlayback(chs.length);
  const stops = useMemo(() => storyStops(chs), [chs]);
  const nums = useMemo(() => chapterNums(chs), [chs]);
  if (!story || !chs.length) return { stops: [], at: null, count: null };
  return { stops, at: routeStopAt(chs, at), count: { now: nums[at] ?? nums[0], total: chs.length } };
}
