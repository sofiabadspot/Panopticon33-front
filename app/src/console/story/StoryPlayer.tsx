/* Reproductor de la historia: play/pausa, capítulo actual, barra con un punto por capítulo (a la misma
   distancia, sin escala de tiempo), velocidad y salida. Atajos: Espacio, ← →, Esc. */
import { useEffect, useMemo, useRef } from 'react';
import { dateShort, dateTime, hhmm } from '../../api/format';
import type { StoryChapter } from '../../api/types';
import { chapterNums } from './storyRoute';
import { useStoryPlayback, type StorySpeed } from './useStory';
import { CHAPTER_MS } from '../../api/story';

const SPEEDS: { v: StorySpeed; label: string }[] = [{ v: 0.5, label: '0,5×' }, { v: 1, label: '1×' }, { v: 2, label: '2×' }];
const TYPING = 'input, textarea, select, [contenteditable], [role="dialog"]';
const PRESSABLE = 'button, a, [role=button]';

export function StoryPlayer({ chapters, onExit }: { chapters: StoryChapter[]; onExit: () => void }) {
  const n = chapters.length;
  const { at, setAt, playing, setPlaying, speed, setSpeed } = useStoryPlayback(n);
  const nums = useMemo(() => chapterNums(chapters), [chapters]);
  const cur = chapters[at];

  const toggle = () => {
    if (!n) return;
    if (!playing && at >= n - 1) { setAt(0); setPlaying(true); return; }
    setPlaying(!playing);
  };
  // El handler de la ventana siempre ve la última versión, sin volver a suscribirse en cada cambio.
  const live = useRef({ toggle, at, setAt, setPlaying, onExit });
  live.current = { toggle, at, setAt, setPlaying, onExit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest(TYPING)) return;
      const s = live.current;
      if (e.key === ' ' || e.code === 'Space') {
        // Sobre un botón o enlace, Espacio ya lo activa: no se reproduce dos veces.
        if (t instanceof Element && t.closest(PRESSABLE)) return;
        e.preventDefault(); if (!e.repeat) s.toggle();
      }
      else if (e.key === 'ArrowRight') { e.preventDefault(); s.setAt(s.at + 1); s.setPlaying(false); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); s.setAt(s.at - 1); s.setPlaying(false); }
      else if (e.key === 'Escape') { e.preventDefault(); s.onExit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const left = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  // Lo recorrido: sin capítulos, nada; con uno solo, la barra entera (ya se está en el único capítulo).
  const done = n > 1 ? left(at) : n === 1 ? 100 : 0;
  // Extremos de la barra: la hora, y la fecha si no es de hoy.
  const today = dateShort(Date.now());
  const end = (t: number) => (dateShort(t) === today ? hhmm(t) : dateTime(t));
  const label = cur ? (cur.source === 'antecedente' ? dateTime(cur.at) : `${nums[at]} / ${String(n).padStart(2, '0')}`) : '— / —';

  return (
    <footer className="story-player" aria-label="Reproductor de la historia">
      <button className="story-play" onClick={toggle} disabled={!n} aria-label={playing ? 'Pausar' : 'Reproducir'} title={`${playing ? 'Pausar' : 'Reproducir'} (Espacio)`}>
        <svg viewBox="0 0 14 14" aria-hidden>{playing ? <path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" /> : <path d="M3 1.5v11L12 7z" />}</svg>
      </button>
      <div className="story-cur">
        <b>{label}{cur && cur.source !== 'antecedente' ? ` · ${hhmm(cur.at)}` : ''}</b>
        <span>{cur?.cameraId ?? 'Sin cámara'} · <span className="kbd">←</span> <span className="kbd">→</span> capítulo · <span className="kbd">Espacio</span></span>
      </div>
      <div className="story-track">
        {n > 0 && <span className="hrs l">{end(chapters[0].at)}</span>}
        {n > 1 && <span className="hrs r">{end(chapters[n - 1].at)}</span>}
        <div className="rail">
          <div className="line" />
          {/* Reproduciendo, la barra avanza de forma continua hacia el próximo hecho (llega justo cuando cambia). */}
          <div className="done" style={playing && at < n - 1
            ? { width: `${left(at + 1)}%`, transition: `width ${CHAPTER_MS / speed}ms linear` }
            : { width: `${done}%`, transition: 'width .3s ease' }} />
          {chapters.map((c, i) => (
            <span key={c.id}>
              {c.key && <span className="star" style={{ left: `${left(i)}%` }} aria-hidden>★</span>}
              <button
                className={`pt ${c.source} ${i < at ? 'on' : ''} ${i === at ? 'head' : ''}`} style={{ left: `${left(i)}%` }}
                onClick={() => { setAt(i); setPlaying(false); }} aria-current={i === at ? 'step' : undefined}
                aria-label={`Capítulo ${nums[i]}, ${hhmm(c.at)}${c.key ? ', momento clave' : ''}`} title={`${nums[i]} · ${hhmm(c.at)} · ${c.place}`}
              />
              {n <= 14 && <span className={`pt-t ${i === at ? 'now' : ''}`} style={{ left: `${left(i)}%` }} aria-hidden>{hhmm(c.at)}</span>}
            </span>
          ))}
        </div>
      </div>
      <div className="seg" role="group" aria-label="Velocidad">
        {SPEEDS.map((s) => <button key={s.v} className={speed === s.v ? 'on' : ''} onClick={() => setSpeed(s.v)} aria-pressed={speed === s.v}>{s.label}</button>)}
      </div>
      <button className="btn secondary" onClick={onExit}>Salir de la historia <span className="kbd">Esc</span></button>
    </footer>
  );
}
