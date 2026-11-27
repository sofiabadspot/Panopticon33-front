/* Agregar evidencia a la investigación. El botón Evidencia de la barra de abajo despliega dos opciones:
   · En un lugar del mapa: se toca el punto y junto a él se abre el abanico (QuickFan, el mismo de Registrar
     incidente): adjuntar archivo, solo título o el video de una cámara de la plataforma.
   · Sin lugar en el mapa (EvidenceLoose): documentos, fotos o informes que no pasaron en un punto de la
     ciudad. En la reproducción se ven como una escena (StoryScene).
   Siempre se pide CUÁNDO PASÓ el hecho (no cuándo se sube): con esa fecha entra en su lugar de la película.
   La fecha de carga queda aparte (addedAt). La fuente sale de la misma lista que el expediente facial, más
   las externas habituales: buena parte del relato viene de fuentes de afuera. */
import { useEffect, useMemo, useState } from 'react';
import { addStoryEvidence, placeLabel, useApi } from '../../api';
import { FACIAL_SOURCES } from '../../api/facial';
import { cameraClip } from '../../api/video';
import type { Evidence, LngLat, Story, StoryChapter } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon } from '../../ui/kit';
import { QuickFan } from '../QuickFan';
import { useStoryChapters, useStoryJump, useStoryPlayback, useStoryRange } from './useStory';
import { DateTimeField, Field, fromField, toField } from '../../ui/Field';
import { FileInput } from '../../ui/FileInput';

type Mode = 'archivo' | 'titulo' | 'plataforma';
const ITEMS: { id: Mode; label: string; icon: string; hint: string }[] = [
  { id: 'archivo', label: 'Adjuntar archivo', icon: 'description', hint: 'Imagen, video o documento' },
  { id: 'titulo', label: 'Solo título', icon: 'edit_note', hint: 'Lo que se sabe, sin archivo' },
  { id: 'plataforma', label: 'De la plataforma', icon: 'videocam', hint: 'Video de una cámara de Panopticon 33' },
];

/** De dónde viene la evidencia: las fuentes del expediente facial y las externas habituales. */
export const EVIDENCE_SOURCES = [...FACIAL_SOURCES.map((s) => s.name), 'Particular (vecino o testigo)', 'Comercio o cámara privada', 'Empresa de transporte', 'Medios o redes sociales'];
const OTHER = 'Otra fuente…';

/* La hora se carga en la de El Salvador (UTC−6), la misma que muestra la consola, aunque el navegador
   esté en otra zona: la conversión es la de toda la consola (ui/Field.tsx). */
const evOf = (f: File, caption: string): Evidence => {
  const src = URL.createObjectURL(f);
  return f.type.startsWith('image/') ? { type: 'imagen', src, caption } : f.type.startsWith('video/') ? { type: 'clip', src, caption } : { type: 'pendiente', caption: `${caption} · ${f.name}` };
};

/** Lo común a las dos formas: cuándo pasó y de qué fuente viene. */
function useWhenAndSource(story: Story) {
  const chs = useStoryChapters(story);
  const { at } = useStoryPlayback(chs.length);
  const [when, setWhen] = useState(() => toField(chs[at]?.at ?? Date.now()));
  const [pick, setPick] = useState('');
  const [other, setOther] = useState('');
  const t = useMemo(() => { const v = fromField(when); return Number.isFinite(v) ? v : null; }, [when]);
  const source = pick === OTHER ? other.trim() : pick;
  const whenField = (
    <DateTimeField label="Cuándo pasó" value={when} onChange={setWhen} max={Date.now()} error={t === null ? 'Falta la fecha y hora del hecho.' : null}
      hint="La fecha y hora del hecho (por ejemplo, cuándo se hizo la denuncia), no la de hoy. Con esta fecha entra en su lugar del recorrido." />
  );
  const sourceField = (
    <Field label="Fuente">{(p) => <>
      <select {...p} className="fld sm" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Elige de dónde viene…</option>{EVIDENCE_SOURCES.map((s) => <option key={s}>{s}</option>)}<option>{OTHER}</option>
      </select>
      {pick === OTHER && <input className="fld sm" autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="Nombre de la fuente" aria-label="Nombre de la fuente" />}</>}</Field>
  );
  return { t, source, whenField, sourceField };
}

/** Guardar un capítulo y llevar el reproductor a él. */
function useAdd(story: Story) {
  const { user } = useSession();
  const { range, setRange } = useStoryRange();
  const jumpTo = useStoryJump();
  return (ch: Omit<StoryChapter, 'id' | 'source' | 'addedBy' | 'reads'>) => {
    const id = addStoryEvidence(story.id, ch, user);
    if (!id) return false;
    jumpTo(id);
    // Fuera de la ventana del hecho no se vería: se pasa a todo.
    if (story.window && range === 'ventana' && (ch.at < story.window.from || ch.at > story.window.to)) setRange('todo');
    return true;
  };
}

/** En un lugar del mapa: el abanico junto al punto tocado. */
export function EvidenceFan({ story, p, xy, onClose }: { story: Story; p: LngLat; xy: [number, number]; onClose: () => void }) {
  const cameras = useApi((s) => s.cameras);
  const { t, source, whenField, sourceField } = useWhenAndSource(story);
  const add = useAdd(story);
  const [mode, setMode] = useState<Mode | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [cam, setCam] = useState<string | null>(null);
  useEffect(() => { setMode(null); setCam(null); }, [p[0], p[1]]);
  // Cámaras con video más cercanas al punto.
  const near = useMemo(() => cameras.filter((c) => cameraClip(c.id))
    .map((c) => ({ c, d: Math.hypot((c.lat - p[1]) * 111_000, (c.lon - p[0]) * 105_000) }))
    .sort((a, b) => a.d - b.d).slice(0, 4), [cameras, p[0], p[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const camera = near.find((x) => x.c.id === cam)?.c;

  // De la plataforma, la cámara es la fuente: solo se pide cuándo pasó.
  const ok = t !== null && (mode === 'plataforma' ? !!camera : title.trim().length >= 3 && !!source && (mode !== 'archivo' || !!file));
  const save = () => {
    if (!ok || !mode) return;
    const done = mode === 'plataforma'
      // El video de la cámara lo suma la historia sola (storyChapters) al tener cameraId.
      ? add({ at: t!, lat: camera!.lat, lon: camera!.lon, place: camera!.street, cameraId: camera!.id, evidence: [{ type: 'pendiente', caption: title.trim() || `Video de la cámara ${camera!.id}` }], srcLabel: `Panopticon 33 · Cámara ${camera!.id}` })
      : add({ at: t!, lat: p[1], lon: p[0], place: placeLabel(p[1], p[0]), evidence: [mode === 'archivo' ? evOf(file!, title.trim()) : { type: 'pendiente', caption: title.trim() }], srcLabel: source });
    if (done) onClose();
  };

  return (
    <QuickFan xy={xy} items={ITEMS} active={mode} onPick={(m) => setMode(m as Mode | null)} onClose={onClose} label="Agregar evidencia en este punto">
      <div className="mc2-hd"><span className="mc2-lbl">{ITEMS.find((x) => x.id === mode)?.label}</span></div>
      <form className="qf-form" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        {mode === 'archivo' && (
          <Field label="Archivo">{(fp) => (
            <FileInput id={fp.id} aria-describedby={fp['aria-describedby']} label="Elegir archivo" accept="image/*,video/*,application/pdf" onFiles={(fs) => { const f = fs[0] ?? null; setFile(f); if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, '')); }} />)}</Field>
        )}
        {mode === 'plataforma' && (
          <div className="field"><span className="lbl" id="ev-cam">Cámara cercana</span>
            <ul className="qf-cams" role="radiogroup" aria-labelledby="ev-cam">
              {!near.length && <li className="qf-hint">No hay cámaras con video cerca de este punto.</li>}
              {near.map(({ c, d }) => (
                <li key={c.id}><button type="button" role="radio" aria-checked={cam === c.id} className={cam === c.id ? 'on' : ''} onClick={() => setCam(c.id)}>
                  <Icon name="videocam" /><span><b className="mono">{c.id}</b><small>{c.street}</small></span><em>{d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}</em>
                </button></li>
              ))}
            </ul></div>
        )}
        <Field label="Título" optional={mode === 'plataforma'}>{(fp) => (
          <input {...fp} className="fld sm" autoFocus={mode === 'titulo'} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'plataforma' ? 'Ej.: pasa frente al portón' : 'Ej.: video de un vecino'} />)}</Field>
        {whenField}
        {mode !== 'plataforma' && sourceField}
        <button type="submit" className="btn primary sm" style={{ width: '100%' }} disabled={!ok}>Agregar a la investigación</button>
      </form>
    </QuickFan>
  );
}

/** Sin lugar en el mapa: uno o varios archivos (documento, fotos, informe), qué es, cuándo pasó y de dónde
    viene. Panel sobre la barra de abajo. */
export function EvidenceLoose({ story, onClose }: { story: Story; onClose: () => void }) {
  const { t, source, whenField, sourceField } = useWhenAndSource(story);
  const add = useAdd(story);
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const ok = t !== null && title.trim().length >= 3 && !!source;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const save = () => {
    if (!ok) return;
    const evidence: Evidence[] = files.length ? files.map((f) => evOf(f, title.trim())) : [{ type: 'pendiente', caption: title.trim() }];
    if (add({ at: t!, lat: null, lon: null, place: 'Sin lugar en el mapa', evidence, srcLabel: source })) onClose();
  };
  return (
    <section className="ev-loose" role="dialog" aria-label="Evidencia sin lugar en el mapa">
      <div className="mc2-hd"><span className="mc2-lbl">Evidencia sin lugar en el mapa</span><button className="iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)"><Icon name="close" /></button></div>
      <p className="qf-hint">Un documento, fotos o un informe que no pasó en un punto de la ciudad. En el recorrido aparece como una escena, en el momento en que pasó.</p>
      <form className="qf-form" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label={<>Archivos <small className="hint">(uno o varios)</small></>}>{(fp) => (
          <FileInput id={fp.id} aria-describedby={fp['aria-describedby']} label="Elegir archivos" multiple accept="image/*,video/*,application/pdf" onFiles={(fs) => { setFiles(fs); if (fs[0] && !title.trim()) setTitle(fs[0].name.replace(/\.[^.]+$/, '')); }} />)}</Field>
        <Field label="Qué es">{(fp) => (
          <input {...fp} className="fld sm" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: denuncia de la víctima, fotos del DUI" />)}</Field>
        {whenField}
        {sourceField}
        <div className="ev-actions">
          <button type="button" className="btn secondary sm" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary sm" disabled={!ok}>Agregar a la investigación</button>
        </div>
      </form>
    </section>
  );
}
