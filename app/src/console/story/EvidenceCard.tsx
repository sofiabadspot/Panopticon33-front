/* Agregar evidencia a la historia: el analista marca en el mapa dónde pasó y carga qué es (origen, tipo,
   título, hora, fuente y un enlace opcional). Mismo patrón que Registrar incidentes (IncidentCard): la
   tarjeta measure-card arriba a la izquierda del mapa; un clic en otro punto la mueve. El capítulo nuevo
   entra en su lugar por hora y el reproductor salta a él. No hay archivo: se ve con el marcador B/N. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { addStoryEvidence, placeLabel } from '../../api';
import type { LngLat, Story } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon } from '../../ui/kit';
import { useStoryChapters, useStoryJump, useStoryPlayback, useStoryRange } from './useStory';

const ORIGINS = ['Interna', 'Externa'] as const;
const KINDS = ['Imagen', 'Video', 'Documento', 'Registro'] as const;

/* La hora se carga en la de El Salvador (UTC−6, sin horario de verano), la misma que muestra la consola,
   aunque el navegador esté en otra zona. */
const OFFSET = 6 * 3_600_000;
const toField = (t: number) => new Date(t - OFFSET).toISOString().slice(0, 16);
const fromField = (v: string) => { const t = Date.parse(`${v}:00Z`); return Number.isNaN(t) ? null : t + OFFSET; };

export function EvidenceCard({ story, p, onClose }: { story: Story; p: LngLat | null; onClose: () => void }) {
  const { user } = useSession();
  const chs = useStoryChapters(story);
  const { at } = useStoryPlayback(chs.length);
  const { range, setRange } = useStoryRange();
  const jumpTo = useStoryJump();
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]>('Interna');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('Imagen');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => toField(chs[at]?.at ?? Date.now()));
  const [source, setSource] = useState('');
  const [link, setLink] = useState('');
  const t = useMemo(() => fromField(when), [when]);
  const ok = !!p && title.trim().length >= 3 && source.trim().length > 0 && t !== null;

  // Esc cierra la tarjeta y no sale de la historia: se atiende antes que el reproductor (fase de captura)
  // y se marca con preventDefault, que StoryPlayer respeta.
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);

  const save = () => {
    if (!ok) return;
    const id = addStoryEvidence(story.id, {
      at: t!, lat: p![1], lon: p![0], place: placeLabel(p![1], p![0]),
      evidence: [{ type: 'pendiente', caption: title.trim() }],
      srcLabel: `${origin} · ${kind} · ${source.trim()}`,
      note: link.trim() || undefined,
    }, user);
    if (!id) return;
    jumpTo(id);
    // Fuera de la ventana del hecho no se vería: se pasa a todo.
    if (story.window && range === 'ventana' && (t! < story.window.from || t! > story.window.to)) setRange('todo');
    onClose();
  };

  const chips = <T extends string>(label: string, opts: readonly T[], v: T, set: (x: T) => void) => (
    <div className="field">
      <span className="lbl" id={`ev-${label}`}>{label}</span>
      <div className="ev-chips" role="radiogroup" aria-labelledby={`ev-${label}`}>
        {opts.map((o) => <button type="button" key={o} role="radio" aria-checked={v === o} className={`lchip ${v === o ? 'on' : ''}`} onClick={() => set(o)}>{o}</button>)}
      </div>
    </div>
  );

  return (
    <section className="measure-card ev-card" aria-label="Agregar evidencia">
      <div className="mc2-hd"><span className="mc2-lbl">Agregar evidencia</span><button className="iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)"><Icon name="close" /></button></div>
      {!p ? <p className="mc2-hint">Hacé clic en el mapa donde pasó.</p> : (
        <form className="ev-form" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
          {chips('Origen', ORIGINS, origin, setOrigin)}
          {chips('Tipo', KINDS, kind, setKind)}
          <div className="field"><label htmlFor="ev-title">Título</label>
            <input id="ev-title" className="fld sm" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: video de un vecino, cámara del portón" /></div>
          {/* Hora y fuente en filas propias: la hora completa («26/11/2026, 13:57») no entra en media tarjeta. */}
          <div className="field"><label htmlFor="ev-when">Hora</label>
            <input id="ev-when" type="datetime-local" className="fld sm" value={when} onChange={(e) => setWhen(e.target.value)} aria-invalid={t === null} /></div>
          <div className="field"><label htmlFor="ev-src">Fuente</label>
            <input id="ev-src" className="fld sm" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Ej.: Fiscalía" /></div>
          <div className="field"><label htmlFor="ev-link">Enlace o referencia <small className="hint">(opcional)</small></label>
            <input id="ev-link" className="fld sm" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… o expediente 44" /></div>
          <span className="ev-pt mono">{p[1].toFixed(5)}, {p[0].toFixed(5)} · clic en otro punto para moverlo</span>
          <div className="ev-actions">
            <button type="button" className="btn secondary sm" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary sm" disabled={!ok}>Agregar a la historia</button>
          </div>
        </form>
      )}
    </section>
  );
}
