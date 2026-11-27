/* Reproducción de la historia del analista: un solo estado (capítulo actual, en pausa o no, velocidad y
   ventana) que comparten el panel, los capítulos, el mapa y el reproductor. Vive en StoryPlaybackProvider,
   que monta la consola; vuelve a empezar cada vez que se abre otra historia. */
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { storyChapters, useApi } from '../../api';
import { CHAPTER_MS } from '../../api/story';
import type { Story, StoryChapter } from '../../api/types';
import { useConsole } from '../ctx';

export type StorySpeed = 0.5 | 1 | 2;
export type StoryRange = 'ventana' | 'todo';

interface Playback {
  at: number; setAt: (i: number) => void;
  playing: boolean; setPlaying: (b: boolean) => void;
  speed: StorySpeed; setSpeed: (s: StorySpeed) => void;
  range: StoryRange; setRange: (r: StoryRange) => void;
  n: number; setN: (n: number) => void;
  /** Al cambiar la cantidad de capítulos, ir a este (p. ej. la evidencia recién agregada) en vez de al primero. */
  jumpTo: (chapterId: string) => void;
}
const P = createContext<Playback | null>(null);

/** Abrir una historia desde el buscador (o cualquier entrada) la reproduce sola: se ve el recorrido
    entero un instante y después arranca. Reabrirla desde la lista de Historias no la pone en marcha. */
let autoplayNext = false;
export const playWhenOpened = () => { autoplayNext = true; };
const AUTOPLAY_DELAY = 1200;

export function StoryPlaybackProvider({ children }: { children: ReactNode }) {
  const { storyId } = useConsole();
  const [at, setAtRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<StorySpeed>(1);
  const [range, setRange] = useState<StoryRange>('ventana');
  const [n, setN] = useState(0);
  // Los capítulos que se ven ahora: para encontrar el capítulo pedido con jumpTo.
  const story = useApi((s) => (storyId ? s.stories.find((x) => x.id === storyId) ?? null : null));
  const chs = useMemo(() => (story ? storyChapters(story, story.window ? range : 'todo') : []), [story, range]);
  const live = useRef(chs); live.current = chs;
  const target = useRef<string | null>(null);

  // Otra historia: arranca en pausa, en el capítulo 1, a 1× y en la ventana del hecho.
  useEffect(() => {
    target.current = null; setAtRaw(0); setPlaying(false); setSpeed(1); setRange('ventana');
    const go = autoplayNext && !!storyId; autoplayNext = false;
    if (!go) return undefined;
    const t = setTimeout(() => setPlaying(true), AUTOPLAY_DELAY);
    return () => clearTimeout(t);
  }, [storyId]);
  // Cambió la cantidad de capítulos: si se pidió un capítulo (evidencia recién agregada), va a ese;
  // si no (otra ventana), vuelve al primero.
  useEffect(() => {
    const id = target.current; target.current = null;
    const i = id ? live.current.findIndex((c) => c.id === id) : -1;
    setAtRaw(Math.max(i, 0));
  }, [n]);
  // Avanza un capítulo cada CHAPTER_MS / velocidad; en el último se detiene.
  useEffect(() => {
    if (!playing) return undefined;
    if (at >= n - 1) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setAtRaw((i) => Math.min(i + 1, Math.max(n - 1, 0))), CHAPTER_MS / speed);
    return () => clearTimeout(t);
  }, [playing, at, n, speed]);

  const value = useMemo<Playback>(() => ({
    at, setAt: (i) => setAtRaw(Math.max(0, Math.min(i, Math.max(n - 1, 0)))),
    playing, setPlaying, speed, setSpeed, range, setRange, n, setN,
    jumpTo: (id) => { target.current = id; setPlaying(false); },
  }), [at, playing, speed, range, n]);
  return createElement(P.Provider, { value }, children);
}

const usePlayback = () => {
  const p = useContext(P);
  if (!p) throw new Error('useStoryPlayback necesita StoryPlaybackProvider');
  return p;
};

/** Capítulo actual y controles. `n` es la cantidad de capítulos que se están mostrando. */
export function useStoryPlayback(n: number): { at: number; setAt(i: number): void; playing: boolean; setPlaying(b: boolean): void; speed: StorySpeed; setSpeed(s: StorySpeed): void } {
  const p = usePlayback();
  const { setN } = p;
  useEffect(() => { setN(n); }, [n, setN]);
  return { at: Math.min(p.at, Math.max(n - 1, 0)), setAt: p.setAt, playing: p.playing, setPlaying: p.setPlaying, speed: p.speed, setSpeed: p.setSpeed };
}

/** Ir a un capítulo que todavía no está en la lista (la evidencia que se está agregando): se aplica cuando
    cambia la cantidad de capítulos. */
export function useStoryJump(): (chapterId: string) => void {
  return usePlayback().jumpTo;
}

/** Ventana elegida: la del hecho (si la historia viene de una investigación) o todo. */
export function useStoryRange(): { range: StoryRange; setRange(r: StoryRange): void } {
  const { range, setRange } = usePlayback();
  return { range, setRange };
}

/** Los capítulos que se muestran, con la ventana elegida. Sin historia (null): ninguno. */
export function useStoryChapters(story: Story | null): StoryChapter[] {
  const { range } = usePlayback();
  return useMemo(() => (story ? storyChapters(story, story.window ? range : 'todo') : []), [story, range]);
}
