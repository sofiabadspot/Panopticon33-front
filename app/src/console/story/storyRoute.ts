/* El recorrido de la historia en el mapa: las paradas (solo lo que tiene posición), cuál es la actual
   según el capítulo que se está mirando y el número que lleva en el HUD. Sale de la misma lista de
   capítulos que muestran el panel y la columna de capítulos. */
import { useMemo, useRef } from 'react';
import { dateTime, hhmm } from '../../api/format';
import { routeStopAt, routeStops } from '../../api/story';
import type { Story, StoryChapter } from '../../api/types';
import type { RouteStop } from '../../map/MapView';
import { useStoryChapters, useStoryPlayback, useStoryRange } from './useStory';

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
    const ev = c.evidence.find((e) => e.type === 'imagen' && e.src) ?? { type: 'pendiente' as const, caption: c.evidence[0]?.caption ?? c.place };
    const camera = c.cameraId ?? '—';
    return {
      lat: c.lat!, lon: c.lon!, label: n, time: hhmm(c.at), title: `${dateTime(c.at)} · ${c.cameraId ? `${c.cameraId} · ` : ''}${c.place}`,
      kind: c.source === 'analista' ? 'add' as const : 'det' as const,
      clip: clip ? { src: clip.src!, poster: clip.poster } : undefined,
      snap: { camera, street: c.place, evidence: ev, confidence: c.confidence },
    };
  });
}

/** Lo que el mapa necesita en modo historia. Sin historia: todo vacío y `at` null.
    - `overview`: la historia recién abierta (o con otro recorrido) arranca en pausa en el capítulo 1 con el
      recorrido entero visto desde lejos; deja de serlo al reproducir o al cambiar de capítulo.
    - `card`: el capítulo actual tiene lugar. Si no (antecedente sin cámara), el recorrido se queda en la
      parada anterior pero sin su captura como «ahora». */
export function useStoryRoute(story: Story | null): { stops: RouteStop[]; at: number | null; count: { now: string; total: number } | null; overview: boolean; card: boolean } {
  const chs = useStoryChapters(story);
  const { at, playing } = useStoryPlayback(chs.length);
  const { range } = useStoryRange();
  const stops = useMemo(() => storyStops(chs), [chs]);
  const nums = useMemo(() => chapterNums(chs), [chs]);
  // Vista de conjunto: por historia y ventana. Al cambiar de ventana el reproductor vuelve al capítulo 1: esa
  // vuelta no cuenta como navegar; otro salto, sí. Una vez hecha, no vuelve con cambios de paradas (evidencia agregada).
  const key = story ? story.id + '|' + range : '';
  const ov = useRef({ key: '', at: 0, done: false, reset: false });
  if (ov.current.key !== key) ov.current = { key, at, done: false, reset: at !== 0 };
  else if (!ov.current.done && at !== ov.current.at) {
    if (ov.current.reset && at === 0) ov.current = { ...ov.current, at: 0, reset: false };
    else ov.current = { ...ov.current, done: true };
  }
  if (playing && !ov.current.done) ov.current = { ...ov.current, done: true };
  if (!story || !chs.length) return { stops: [], at: null, count: null, overview: false, card: false };
  const c = chs[at];
  return { stops, at: routeStopAt(chs, at), count: { now: nums[at] ?? nums[0], total: chs.length }, overview: !ov.current.done, card: !!c && c.lat !== null && c.lon !== null };
}
