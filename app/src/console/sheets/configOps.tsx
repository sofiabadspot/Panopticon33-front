/* Configuración · Operación: qué se vigila y cuándo se avisa.
   - Eventos: algo que pasa en una o varias zonas por unas horas, con su aforo, sus policías y,
     si hace falta, umbrales propios. Se editan en el formulario del evento (un solo lugar).
   - Reglas y criticidad: cuándo una medición se vuelve alerta y qué tan urgente es.
   - Listas: contra qué se comparan placas y rostros. */
import { useState } from 'react';
import {
  addList, deleteList, deleteRule, restoreList, restoreRule, updateList, eventStatus, isListStale, LIST_MODES, loadListEntries, newEventId, saveEvent, setRuleOverrides, setSeverityTargets, syncList, updateRule, useApi,
} from '../../api';
import { cellsAround, zoneHexes, zonesTouching } from '../../api/coverage';
import { ago, dateShort, fmt, fmtCrowd, fromLocalInput, hhmm } from '../../api/format';
import { KIND_LABEL, SEVERITY_LABEL } from '../../api/labels';
import type { ListMode, MassEvent, Rule, RuleOverride, Severity, WatchList, Zone } from '../../api/types';
import { useSession } from '../../shell/session';
import { Dialog, EmptyState, Icon, useNow, useToast } from '../../ui/kit';
import { useConsole, useOverlay } from '../ctx';
import { EventTag } from '../panels/EventsPanel';
import { ConfirmDelete, SectionHead } from './configPlace';
import { CsvImport, type CsvColumn, type RowResult } from './CsvImport';
import { Segmented } from '../../ui/Segmented';
import { Field } from '../../ui/Field';

const SEVS: Severity[] = ['critica', 'media', 'baja'];

/* ================= Eventos ================= */
/* Carga masiva: una fila por evento. Dónde ocurre se dice con las zonas (Z-01|Z-02) o con un centro y un
   radio, que se pasa a hexágonos. */
const EVENT_COLUMNS: CsvColumn[] = [
  { key: 'nombre', label: 'Nombre', example: 'Concierto de fin de año', required: true },
  { key: 'inicio', label: 'Inicio', example: '2026-12-31 18:00', required: true },
  { key: 'fin', label: 'Fin', example: '2027-01-01 02:00', required: true },
  { key: 'asistencia', label: 'Asistencia esperada', example: '40000', required: true },
  { key: 'policias', label: 'Policías previstos', example: '80', required: true },
  { key: 'zonas', label: 'Zonas (códigos separados por |)', example: 'Z-01|Z-02' },
  { key: 'lat', label: 'Latitud del centro', example: '' },
  { key: 'lon', label: 'Longitud del centro', example: '' },
  { key: 'radio_m', label: 'Radio en metros', example: '' },
  { key: 'aforo', label: 'Aforo máximo', example: '' },
  { key: 'lugar', label: 'Lugar', example: 'Plaza Salvador del Mundo' },
];
/** Fecha y hora de El Salvador: 2026-12-31 18:00 o 31/12/2026 18:00. */
function parseWhen(v: string): number | null {
  const t = v.trim(); let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  const at = (y: string, mo: string, d: string, h: string, mi: string) => fromLocalInput(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}`);
  if (m) return at(m[1], m[2], m[3], m[4], m[5]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/);
  if (m) return at(m[3], m[2], m[1], m[4], m[5]);
  return null;
}
const int = (v: string | undefined) => (v?.trim() ? Number(v.replace(/[.\s]/g, '').replace(',', '.')) : NaN);
function parseEvent(row: Record<string, string>, zones: Zone[], who: string): RowResult<Omit<MassEvent, 'id'>> {
  const name = row.nombre?.trim();
  if (!name) return { error: 'Falta el nombre.' };
  const start = parseWhen(row.inicio ?? ''), end = parseWhen(row.fin ?? '');
  if (start == null || end == null) return { error: `${name}: la fecha tiene que ser como 2026-12-31 18:00.` };
  if (end <= start) return { error: `${name}: el fin tiene que ser después del inicio.` };
  const expected = int(row.asistencia), planned = int(row.policias), cap = int(row.aforo);
  if (!(expected > 0)) return { error: `${name}: falta la asistencia esperada.` };
  if (!(planned >= 0)) return { error: `${name}: falta la cantidad de policías previstos.` };
  if (row.aforo?.trim() && !(cap > 0)) return { error: `${name}: el aforo tiene que ser un número mayor que 0.` };
  let cells: string[];
  const codes = (row.zonas ?? '').split(/[|;]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (codes.length) {
    const missing = codes.filter((x) => !zones.some((z) => z.id === x));
    if (missing.length) return { error: `${name}: no existe la zona ${missing.join(', ')}.` };
    cells = zoneHexes(zones.filter((z) => codes.includes(z.id)));
  } else {
    const lat = Number((row.lat ?? '').replace(',', '.')), lon = Number((row.lon ?? '').replace(',', '.')), r = Number((row.radio_m ?? '').replace(',', '.'));
    if (!(lat > 12.9 && lat < 14.5 && lon > -90.2 && lon < -87.6) || !(r >= 20 && r <= 5000)) return { error: `${name}: indica las zonas, o un centro (lat, lon) y un radio entre 20 y 5000 m.` };
    cells = cellsAround([lon, lat], r);
  }
  // Con códigos, las zonas son exactamente esas; con centro y radio, las que toca el área.
  const touched = codes.length ? zones.filter((z) => codes.includes(z.id)) : zonesTouching(cells, zones);
  if (!touched.length) return { error: `${name}: el área no toca ninguna zona. Créala primero en Zonas o usa sus códigos.` };
  return { ok: { name, venue: row.lugar?.trim() || name, cells, zoneIds: touched.map((z) => z.id), start, end, expected, plannedOfficers: planned, capacity: cap > 0 ? cap : null, thresholds: null, createdBy: who } };
}

export function EventsSection() {
  const { user } = useSession();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const c = useConsole();
  const now = useNow(30000);
  const events = useApi((s) => s.events);
  const zones = useApi((s) => s.zones);
  const [show, setShow] = useState<'proximos' | 'finalizados'>('proximos');
  const order = { en_curso: 0, programado: 1, finalizado: 2 } as const;
  const list = events.filter((e) => (eventStatus(e, now) === 'finalizado') === (show === 'finalizados'))
    .sort((a, b) => order[eventStatus(a, now)] - order[eventStatus(b, now)] || (show === 'finalizados' ? b.start - a.start : a.start - b.start));
  const ids = [...new Set(list.flatMap((e) => e.zoneIds))];
  useOverlay({ highlightZones: ids, fit: ids.length ? { points: zones.filter((z) => ids.includes(z.id)).flatMap((z) => z.ring), key: 'eventos' + show } : undefined }, [show, ids.join()]);
  return (
    <>
      <SectionHead group="Operación" icon="flag" title="Eventos" sub="Lo que pasa en una o varias zonas durante unas horas: aforo, policías previstos y umbrales propios mientras dure." />
      <div className="pb">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary sm" onClick={() => c.open({ k: 'evento-form' })}><Icon name="add" />Registrar evento</button>
          <button className="btn ghost sm" onClick={() => setImporting(true)}><Icon name="arrow_upward" />Importar CSV</button>
        </div>
        <Segmented label="Qué eventos ver" style={{ alignSelf: 'flex-start' }} value={show} onChange={setShow} options={[
          { value: 'proximos', label: 'En curso y próximos', count: events.filter((e) => eventStatus(e, now) !== 'finalizado').length },
          { value: 'finalizados', label: 'Finalizados', count: events.filter((e) => eventStatus(e, now) === 'finalizado').length }]} />
        <div className="box flush">
          <ul className="list">
            {!list.length && <li><EmptyState icon="flag" title={show === 'proximos' ? 'Ningún evento por delante' : 'Sin eventos finalizados'}>{show === 'proximos' ? 'Registra el evento antes de que empiece: así sus zonas usan su aforo y sus umbrales.' : undefined}</EmptyState></li>}
            {list.map((e) => {
              const st = eventStatus(e, now);
              const cap = e.capacity ?? zones.filter((z) => e.zoneIds.includes(z.id)).reduce((n, z) => n + z.capacity, 0);
              return (
                <li key={e.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'evento', id: e.id })}>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{e.name}</div>
                    <div className="s">{dateShort(e.start)} · {hhmm(e.start)}–{hhmm(e.end)} · {e.zoneIds.length} {e.zoneIds.length === 1 ? 'zona' : 'zonas'}</div>
                    <div className="s">Aforo {fmtCrowd(cap)} · esperadas {fmtCrowd(e.expected)} · {fmt(e.plannedOfficers)} policías{e.thresholds ? ' · umbrales propios' : ''}</div>
                  </div>
                  <div className="r"><EventTag s={st} cancelled={!!e.cancelled} /></div>
                </button></li>
              );
            })}
          </ul>
        </div>
      </div>
      {importing && (
        <CsvImport title="Importar eventos" what="eventos" columns={EVENT_COLUMNS} fileName="plantilla-eventos.csv"
          parse={(row) => parseEvent(row, zones, user.name)}
          preview={{ head: ['Evento', 'Cuándo', 'Zonas', 'Asistencia'], row: (e) => [e.name, `${dateShort(e.start)} ${hhmm(e.start)}–${hhmm(e.end)}`, zones.filter((z) => e.zoneIds.includes(z.id)).map((z) => z.name).join(', '), <span className="mono">{fmt(e.expected)}</span>] }}
          onImport={(items) => { for (const e of items) saveEvent({ ...e, id: newEventId() }, user); toast(`${items.length} ${items.length === 1 ? 'evento registrado' : 'eventos registrados'}. Revisa sus umbrales si hacen falta propios.`); setImporting(false); }}
          onClose={() => setImporting(false)} />
      )}
    </>
  );
}

/* ================= Reglas y criticidad ================= */
export function RulesSection() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const now = useNow(60000);
  const rules = useApi((s) => s.rules);
  const zones = useApi((s) => s.zones);
  const events = useApi((s) => s.events);
  const [edit, setEdit] = useState<Rule | null>(null);
  /* Apagar una regla deja de crear alertas en toda la ciudad: se confirma. Encenderla es inmediato. */
  const [turningOff, setTurningOff] = useState<Rule | null>(null);
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
  const withOwn = events.filter((e) => e.thresholds && eventStatus(e, now) !== 'finalizado');
  return (
    <>
      <SectionHead group="Operación" icon="tune" title="Reglas y criticidad" sub="Cuándo una medición se vuelve alerta, qué tan urgente es y cuánto tiempo hay para decidirla." />
      <div className="pb">
        <div className="callout warn"><Icon name="warning" /><span className="grow"><b>Valores por confirmar.</b> Los umbrales marcados como supuesto los tiene que fijar el Ministerio. Al guardar un umbral nuevo queda como fijado por el Ministerio.</span></div>
        <div className="panel flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Regla</th><th>Alerta que crea</th><th>Criticidad</th><th className="r">Umbral</th><th className="r">Tiene que durar</th><th>Zonas con umbral propio</th><th>Origen</th><th>Activa</th><th /></tr></thead>
            <tbody>
              {!rules.length && <tr><td colSpan={10} className="empty">Ninguna regla todavía: sin reglas, ninguna medición se vuelve alerta.</td></tr>}
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><b style={{ fontWeight: 500 }}>{r.name}</b><div className="dim" style={{ fontSize: 'var(--fs-xs)' }}>{r.scope}</div></td>
                  <td>{KIND_LABEL[r.kind]}</td>
                  <td><span className={`chip ${r.severity}`}>{SEVERITY_LABEL[r.severity]}</span></td>
                  <td className="r mono">{fmt(r.threshold ?? 0)} <span className="dim" style={{ fontFamily: 'var(--font-sans)' }}>{r.unit}</span></td>
                  <td className="r mono">{r.persistenceMin ? `${r.persistenceMin} min` : 'Al instante'}</td>
                  <td>{r.overrides.length ? r.overrides.map((o) => zoneName(o.targetId)).join(', ') : <span className="dim">Ninguna</span>}</td>
                  <td>{r.source === 'ministerio' ? <span className="chip ok">Ministerio</span> : <span className="chip media">Supuesto</span>}</td>
                  <td><label className="toggle"><input type="checkbox" checked={r.enabled} onChange={(e) => { if (!e.target.checked) { setTurningOff(r); return; } updateRule(r.id, { enabled: true }, user); toast(`${r.name}: activa`); }} /><span className="sr">Activa: {r.name}</span></label></td>
                  <td className="r"><button className="btn ghost xs" onClick={() => setEdit(r)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SeverityTargets />

        <section className="panel">
          <div className="hd"><h2>Eventos con umbrales propios</h2><span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Mientras dura el evento, reemplazan a los de sus zonas</span></div>
          <div className="bd grid">
            {!withOwn.length && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Ningún evento en curso o próximo tiene umbrales propios.</span>}
            {withOwn.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="grow"><b style={{ fontWeight: 500 }}>{e.name}</b> <span className="dim">· ocupación {e.thresholds!.occupancyPct} % · {fmt(e.thresholds!.perOfficer)} personas por policía · {e.thresholds!.persistenceMin} min</span></span>
                <button className="btn ghost xs" onClick={() => c.open({ k: 'evento-form', id: e.id })}>Editar en el evento</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {edit && <RuleDialog rule={edit} onClose={() => setEdit(null)} />}
      {turningOff && <ConfirmDelete title={`¿Apagar «${turningOff.name}»?`} action="Apagar regla" onClose={() => setTurningOff(null)}
        onConfirm={() => { const r = turningOff; updateRule(r.id, { enabled: false }, user); setTurningOff(null); toast(`${r.name}: apagada, no crea alertas`, { undo: () => updateRule(r.id, { enabled: true }, user) }); }}>
        Mientras esté apagada, no se crean alertas de «{KIND_LABEL[turningOff.kind].toLowerCase()}» en {turningOff.scope.toLowerCase()}. El 911 no se entera de lo que pase.
      </ConfirmDelete>}
    </>
  );
}

/** Editar una regla: criticidad, umbral, cuánto tiene que durar y las zonas con umbral propio.
    Se abre donde haga falta (Reglas, Listas, la ficha de una zona) sin salir de ahí. */
export function RuleDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const zones = useApi((s) => s.zones);
  const [v, setV] = useState({ threshold: String(rule.threshold ?? ''), persistenceMin: String(rule.persistenceMin), severity: rule.severity });
  const [ovr, setOvr] = useState<RuleOverride[]>(rule.overrides);
  const free = (o: RuleOverride, i: number) => !ovr.some((x, j) => j !== i && x.targetId === o.targetId);
  const ovrOk = ovr.every((o, i) => o.targetId && o.threshold > 0 && free(o, i));
  const [del, setDel] = useState(false);
  if (del) return (
    <ConfirmDelete title={`¿Eliminar la regla «${rule.name}»?`} action="Eliminar regla" onClose={() => setDel(false)}
      onConfirm={() => { const r = deleteRule(rule.id, user); onClose(); if (r) toast(`${rule.name}: eliminada`, { undo: () => restoreRule(r, user) }); }}>
      Deja de crear alertas de «{KIND_LABEL[rule.kind].toLowerCase()}» en {rule.scope.toLowerCase()}, incluidos los umbrales propios de sus zonas. Si solo quieres pausarla, apágala en la tabla.
    </ConfirmDelete>
  );
  return (
        <Dialog title={rule.name} onClose={() => onClose()} footer={<>
          <button className="btn ghost danger sm" style={{ marginRight: 'auto' }} onClick={() => setDel(true)}><Icon name="remove" />Eliminar regla</button>
          <button className="btn ghost sm" onClick={() => onClose()}>Cancelar</button>
          <button className="btn primary sm" disabled={!(Number(v.threshold) > 0) || !ovrOk} onClick={() => {
            if (Number(v.threshold) !== rule.threshold) updateRule(rule.id, { threshold: Number(v.threshold), source: 'ministerio' }, user);
            if (Number(v.persistenceMin) !== rule.persistenceMin) updateRule(rule.id, { persistenceMin: Number(v.persistenceMin) }, user);
            if (v.severity !== rule.severity) updateRule(rule.id, { severity: v.severity }, user);
            if (JSON.stringify(ovr) !== JSON.stringify(rule.overrides)) setRuleOverrides(rule.id, ovr, user);
            toast('Regla guardada'); onClose();
          }}>Guardar regla</button>
        </>}>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Crea una alerta de <b>{KIND_LABEL[rule.kind].toLowerCase()}</b> cuando la medición pasa el umbral y se mantiene el tiempo indicado.</p>
          <div className="field"><span className="lbl">Criticidad de la alerta</span>
            <Segmented label="Criticidad de la alerta" value={v.severity} onChange={(s) => setV({ ...v, severity: s })} options={SEVS.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
            <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>Define el orden en la bandeja del 911 y el tiempo que tiene para decidir.</span>
          </div>
          <div className="form-row">
            <Field label={<>Umbral ({rule.unit})</>}>{(p) => <input {...p} inputMode="decimal" className="fld mono" value={v.threshold} onChange={(e) => setV({ ...v, threshold: e.target.value })} aria-invalid={!(Number(v.threshold) > 0)} />}</Field>
            <Field label="Tiene que durar (min)" hint="0 = avisa al instante">{(p) => <input {...p} inputMode="numeric" className="fld mono" value={v.persistenceMin} onChange={(e) => setV({ ...v, persistenceMin: e.target.value.replace(/\D/g, '') })} />}</Field>
          </div>
          {rule.kind !== 'camara_caida' && rule.kind !== 'placa_en_lista' && rule.kind !== 'persona_en_lista' && <>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
              <b style={{ fontWeight: 500 }}>Zonas con umbral propio</b>
              <button className="btn ghost xs" style={{ marginLeft: 'auto' }} onClick={() => setOvr([...ovr, { target: 'zona', targetId: '', threshold: rule.threshold ?? 0, persistenceMin: rule.persistenceMin }])}><Icon name="add" />Agregar zona</button>
            </div>
            {!ovr.length && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Todas las zonas usan el umbral de arriba.</span>}
            {ovr.map((o, i) => {
              const set = (p: Partial<RuleOverride>) => setOvr(ovr.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className="form-row" style={{ gridTemplateColumns: '1fr 100px 80px auto', alignItems: 'end' }}>
                  <Field label="Zona">{(p) => (
                    <select {...p} className="fld sm" value={o.targetId} onChange={(e) => set({ targetId: e.target.value })}>
                      <option value="">Elegir zona…</option>
                      {zones.map((x) => <option key={x.id} value={x.id} disabled={!free({ ...o, targetId: x.id }, i)}>{x.name}</option>)}
                    </select>)}</Field>
                  <Field label="Umbral">{(p) => <input {...p} inputMode="decimal" className="fld sm mono" value={o.threshold || ''} onChange={(e) => set({ threshold: Number(e.target.value) || 0 })} />}</Field>
                  <Field label="Min">{(p) => <input {...p} inputMode="numeric" className="fld sm mono" value={o.persistenceMin} onChange={(e) => set({ persistenceMin: Number(e.target.value) || 0 })} />}</Field>
                  <button className="iconbtn" aria-label="Quitar esta zona" title="Quitar esta zona" onClick={() => setOvr(ovr.filter((_, j) => j !== i))}><Icon name="close" /></button>
                </div>
              );
            })}
            {(rule.id === 'R-AGL-OCUP' || rule.id === 'R-BRECHA') && <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>Un evento puede tener su propio umbral: se pone en el formulario del evento.</span>}
          </>}
        </Dialog>
  );
}

/** Tiempo objetivo para que el 911 decida, por criticidad. Pasado ese tiempo la alerta se marca atrasada. */
function SeverityTargets() {
  const { user } = useSession();
  const toast = useToast();
  const t = useApi((s) => s.severityTargets);
  const rules = useApi((s) => s.rules);
  const [v, setV] = useState(t);
  const dirty = SEVS.some((k) => v[k] !== t[k]);
  const ok = SEVS.every((k) => v[k] > 0) && v.critica <= v.media && v.media <= v.baja;
  return (
    <section className="panel">
      <div className="hd"><h2>Tiempo para decidir, por criticidad</h2><span className="chip media">Supuesto</span></div>
      <div className="bd grid">
        <p className="muted" style={{ margin: 0 }}>Cuánto tiene el operador 911 para confirmar o descartar una alerta. Pasado ese tiempo, la bandeja y el mapa la marcan como atrasada.</p>
        <div className="form-row" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) auto', alignItems: 'end' }}>
          {SEVS.map((k) => (
            <Field key={k} label={<>{SEVERITY_LABEL[k]} · minutos</>} hint={rules.filter((r) => r.severity === k).map((r) => r.name).join(', ') || 'Ninguna regla'}>{(p) => (
              <input {...p} inputMode="numeric" className="fld sm mono" value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />)}</Field>
          ))}
          <button className="btn secondary sm" disabled={!dirty || !ok} onClick={() => { setSeverityTargets(v, user); toast('Tiempos guardados'); }}>Guardar tiempos</button>
        </div>
        {!ok && <span className="err"><Icon name="error" />Cada criticidad necesita un tiempo, y una más grave no puede tener más tiempo que una más leve.</span>}
      </div>
    </section>
  );
}

/* ================= Listas ================= */
const MODE_HELP: Record<ListMode, string> = {
  API: 'Se consulta en línea a la institución dueña de la lista. No hay que hacer nada.',
  'Copia periódica': 'La institución entrega una copia cada cierto tiempo y se carga sola.',
  'Carga manual': 'La actualiza el Ministerio subiendo un archivo desde aquí.',
};
const ENTRY_COLUMNS: Record<WatchList['kind'], CsvColumn[]> = {
  vehiculos: [{ key: 'placa', label: 'Placa', example: 'P 512-884', required: true }, { key: 'motivo', label: 'Motivo', example: 'Robo', required: true }, { key: 'caso', label: 'Número de caso', example: 'PNC-2026-1182' }],
  personas: [{ key: 'documento', label: 'Documento', example: '01234567-8', required: true }, { key: 'nombre', label: 'Nombre', example: 'Nombre Apellido', required: true }, { key: 'motivo', label: 'Motivo', example: 'Orden de captura', required: true }, { key: 'foto', label: 'Archivo de foto', example: '01234567-8.jpg' }],
};

export function ListsSection() {
  const { user } = useSession();
  const toast = useToast();
  const now = useNow(10000);
  const lists = useApi((s) => s.lists);
  const rules = useApi((s) => s.rules);
  const [adding, setAdding] = useState(false);
  /* Editar usa el mismo diálogo que agregar; el tipo (vehículos o personas) no se cambia. */
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WatchList | null>(null);
  const [loading, setLoading] = useState<WatchList | null>(null);
  const [ruleEdit, setRuleEdit] = useState<Rule | null>(null);
  const [f, setF] = useState({ name: '', kind: 'vehiculos' as WatchList['kind'], origin: '', mode: 'Carga manual' as ListMode, maxAgeH: '24' });
  const ruleFor = (k: WatchList['kind']) => rules.find((r) => r.kind === (k === 'vehiculos' ? 'placa_en_lista' : 'persona_en_lista'));
  const group = (k: WatchList['kind']) => lists.filter((l) => l.kind === k);
  return (
    <>
      <SectionHead group="Operación" icon="database" title="Listas" sub="Contra qué se comparan las placas y los rostros. Cada coincidencia crea una alerta." />
      <div className="pb">
        <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}><Icon name="add" />Agregar lista</button>
        {(['vehiculos', 'personas'] as const).map((k) => {
          const r = ruleFor(k);
          return (
            <section key={k} className="panel flush">
              <div className="hd"><h2>{k === 'vehiculos' ? 'Vehículos (placas)' : 'Personas (reconocimiento facial)'}</h2>
                {r && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Alerta {SEVERITY_LABEL[r.severity].toLowerCase()} desde {r.threshold} % de confianza · <button className="linklike" onClick={() => setRuleEdit(r)}>cambiar</button></span>}</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Lista</th><th>De dónde viene</th><th>Cómo se actualiza</th><th className="r">Entradas</th><th>Última actualización</th><th /></tr></thead>
                  <tbody>
                    {!group(k).length && <tr><td colSpan={6} className="dim">Sin listas de {k === 'vehiculos' ? 'vehículos' : 'personas'}.</td></tr>}
                    {group(k).map((l) => {
                      const stale = isListStale(l, now);
                      return (
                        <tr key={l.id}>
                          <td><b style={{ fontWeight: 500 }}>{l.name}</b></td>
                          <td>{l.origin}</td>
                          <td>{l.mode}<div className="dim" style={{ fontSize: 'var(--fs-xs)', maxWidth: 260 }}>{MODE_HELP[l.mode]}</div></td>
                          <td className="r mono">{fmt(l.entries)}</td>
                          <td>{stale ? <span className="chip media"><Icon name="warning" />{ago(l.lastSyncAt, now)}</span> : <span>{ago(l.lastSyncAt, now)}</span>}
                            {stale && <div className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Pasó el plazo de {l.maxAgeMin >= 60 ? `${Math.round(l.maxAgeMin / 60)} h` : `${l.maxAgeMin} min`}: el 911 ve un aviso.</div>}</td>
                          <td className="r"><span className="row-acts">
                            <button className="btn ghost xs" aria-label={`Editar ${l.name}`} onClick={() => { setF({ name: l.name, kind: l.kind, origin: l.origin, mode: l.mode, maxAgeH: String(Math.max(1, Math.round(l.maxAgeMin / 60))) }); setEditId(l.id); setAdding(true); }}>Editar</button>
                            <button className="btn ghost danger xs" aria-label={`Eliminar ${l.name}`} onClick={() => setDeleting(l)}>Eliminar</button>
                            {l.mode === 'Carga manual'
                            ? <button className="btn secondary xs" onClick={() => setLoading(l)}><Icon name="arrow_upward" />Cargar archivo</button>
                            : <button className="btn ghost xs" onClick={() => { syncList(l.id, user); toast(`${l.name}: sincronizada`); }}><Icon name="sync" />Sincronizar ahora</button>}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        <div className="callout"><Icon name="info" /><span className="grow">Las listas de otras instituciones (API o copia periódica) se conectan una vez desde el sistema y después se actualizan solas. Las de carga manual se actualizan aquí, con la plantilla de cada tipo.</span></div>
      </div>

      {adding && (
        <Dialog title={editId ? 'Editar lista' : 'Agregar lista'} onClose={() => { setAdding(false); setEditId(null); }} footer={<>
          <button className="btn ghost sm" onClick={() => { setAdding(false); setEditId(null); }}>Cancelar</button>
          <button className="btn primary sm" disabled={!f.name.trim() || !f.origin.trim() || !(Number(f.maxAgeH) > 0)} onClick={() => {
            if (editId) {
              updateList(editId, { name: f.name.trim(), origin: f.origin.trim(), mode: f.mode, maxAgeMin: Number(f.maxAgeH) * 60 }, user);
              toast(`Lista «${f.name.trim()}» guardada`);
            } else {
              addList({ name: f.name.trim(), kind: f.kind, origin: f.origin.trim(), mode: f.mode, maxAgeMin: Number(f.maxAgeH) * 60 }, user);
              toast(f.mode === 'Carga manual' ? `Lista «${f.name.trim()}» creada. Ahora carga su archivo.` : `Lista «${f.name.trim()}» creada. Queda pendiente de conectar con ${f.origin.trim()}.`);
            }
            setAdding(false); setEditId(null); setF({ name: '', kind: 'vehiculos', origin: '', mode: 'Carga manual', maxAgeH: '24' });
          }}>{editId ? 'Guardar cambios' : 'Agregar lista'}</button>
        </>}>
          <Field label="Nombre">{(p) => <input {...p} className="fld" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Vehículos con orden de búsqueda" />}</Field>
          <div className="field"><span className="lbl">Qué contiene</span>
            <Segmented label="Qué contiene" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'vehiculos', label: 'Placas de vehículos', disabled: !!editId && f.kind !== 'vehiculos' }, { value: 'personas', label: 'Personas', disabled: !!editId && f.kind !== 'personas' }]} />
            {editId && <span className="hint">El tipo de una lista no se cambia: crea otra lista.</span>}</div>
          <Field label="De dónde viene">{(p) => <input {...p} className="fld" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} placeholder="PNC, Fiscalía, Ministerio…" />}</Field>
          <div className="form-row">
            <Field label="Cómo se actualiza">{(p) => (
              <select {...p} className="fld" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as ListMode })}>{LIST_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select>)}</Field>
            <Field label="Avisar si pasa más de (horas)">{(p) => <input {...p} inputMode="numeric" className="fld mono" value={f.maxAgeH} onChange={(e) => setF({ ...f, maxAgeH: e.target.value.replace(/\D/g, '') })} />}</Field>
          </div>
          <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>{MODE_HELP[f.mode]}</span>
        </Dialog>
      )}
      {ruleEdit && <RuleDialog rule={ruleEdit} onClose={() => setRuleEdit(null)} />}
      {deleting && (
        <ConfirmDelete title={`¿Eliminar la lista «${deleting.name}»?`} action="Eliminar lista" onClose={() => setDeleting(null)}
          onConfirm={() => { const l = deleteList(deleting.id, user); setDeleting(null); if (l) toast(`${l.name}: eliminada`, { undo: () => restoreList(l, user) }); }}>
          Sus {fmt(deleting.entries)} entradas dejan de generar alertas desde ahora. Las alertas que ya se crearon no cambian.
        </ConfirmDelete>
      )}
      {loading && (
        <CsvImport<Record<string, string>> title={`Cargar ${loading.name}`} what="entradas" columns={ENTRY_COLUMNS[loading.kind]} fileName={`plantilla-${loading.kind}.csv`}
          parse={(row) => {
            const missing = ENTRY_COLUMNS[loading.kind].filter((col) => col.required && !row[col.key]?.trim());
            return missing.length ? { error: `Falta ${missing.map((m) => m.label.toLowerCase()).join(' y ')}.` } : { ok: row };
          }}
          preview={{ head: ENTRY_COLUMNS[loading.kind].slice(0, 3).map((col) => col.label), row: (r) => ENTRY_COLUMNS[loading.kind].slice(0, 3).map((col) => r[col.key] || '—') }}
          replaces={loading.entries}
          onImport={(items) => { loadListEntries(loading.id, items.length, user); toast(`${loading.name}: ${fmt(items.length)} entradas cargadas. Reemplazan a las anteriores.`); setLoading(null); }}
          onClose={() => setLoading(null)} />
      )}
    </>
  );
}
