/* Configuración · Lugar: dónde se vigila. Por ahora hay un solo territorio (San Salvador), que no se
   edita. Se arma en este orden: zona (el polígono que se mide, con su capacidad) → cámara (lo que mide la zona).
   Las dos secciones dejan el mapa a la vista: lo que se elige en la lista se señala en el mapa. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  addCameras, deleteZone, importZones, newCameraId, newZoneId, saveZone, setRuleOverrides,
  setCameraPreset, updateCamera, useApi,
} from '../../api';
import { ago, fmt } from '../../api/format';
import { CAMERA_LABEL } from '../../api/labels';
import type { Camera, LngLat, Zone } from '../../api/types';
import { useSession } from '../../shell/session';
import { Dialog, EmptyState, Icon, useNow, useToast } from '../../ui/kit';
import { UnsavedGuard, useConsole, useOverlay } from '../ctx';
import { cellsArea, cellsAround, cellsShape, growCells, isContiguous, toggleCell, zoneCore, zoneHexes } from '../../api/coverage';
import { bearing } from '../../map/markers';
import { CsvImport, type CsvColumn, type RowResult } from './CsvImport';
import { SheetHead, SheetNotFound } from './SheetHead';
import { Segmented } from '../../ui/Segmented';

/* ---------------- Comunes ---------------- */
export function SectionHead({ group, icon, title, sub }: { group: string; icon: string; title: string; sub: string }) {
  return <SheetHead kicker={`Configuración · ${group}`} title={<><Icon name={icon} />{title}</>} sub={sub} />;
}
const camChip = (c: Camera) => `chip ${c.status === 'operativa' ? 'ok' : c.status === 'caida' ? 'critica' : c.status === 'degradada' ? 'media' : 'nodata'}`;
const KIND_NAME: Record<Camera['kind'], string> = { mixta: 'Mixta (personas y placas)', vehicular: 'Vehicular (lee placas)', peatonal: 'Peatonal (cuenta personas)' };
const KIND_SHORT: Record<Camera['kind'], string> = { mixta: 'Mixta', vehicular: 'Vehicular', peatonal: 'Peatonal' };
const COMPUTE = ['SPOTBOX', 'GPU del cliente', 'Por asignar'];
/** Encuadre cercano (unos 900 m) al centro del sector, para que se vea la grilla de hexágonos al elegir. */
export const closeUp = (zones: Zone[]): LngLat[] => {
  const zs = zones.filter((z) => z.cameras.length).length ? zones.filter((z) => z.cameras.length) : zones;
  const lon = zs.reduce((n, z) => n + z.lon, 0) / (zs.length || 1), lat = zs.reduce((n, z) => n + z.lat, 0) / (zs.length || 1);
  return [[lon - 0.0045, lat - 0.003], [lon + 0.0045, lat + 0.003]];
};
const inSV = (lat: number, lon: number) => lat > 12.9 && lat < 14.5 && lon > -90.2 && lon < -87.6;
const num = (v: string) => Number(v.replace(',', '.'));

/** Confirmación de borrado: dice qué se borra y qué pasa después. */
/** También confirma cambios con impacto operativo (apagar una regla, quitar un acceso): tone="primary". */
export function ConfirmDelete({ title, children, action, onConfirm, onClose, tone = 'danger' }: { title: string; children: ReactNode; action: string; onConfirm: () => void; onClose: () => void; tone?: 'danger' | 'primary' | 'positive' }) {
  return (
    <Dialog title={title} onClose={onClose} dismissOnBackdrop footer={<>
      <button className="btn ghost sm" onClick={onClose}>Cancelar</button>
      <button className={`btn ${tone} sm`} onClick={onConfirm}>{action}</button>
    </>}>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{children}</p>
    </Dialog>
  );
}

/* ================= Zonas ================= */
/** Herramienta para elegir hexágonos sobre el mapa: cuántos van, el área y la capacidad estimada,
    y los botones para deshacer, agrandar un anillo o empezar de nuevo. La usan zonas y eventos. */
export function HexPicker({ cells, onChange, hint, allowSplit = false }: { cells: string[]; onChange: (c: string[]) => void; hint?: ReactNode; /** Un evento puede tener partes separadas; una zona no. */ allowSplit?: boolean }) {
  /* Historial para deshacer: cada cambio (clic en el mapa o botón) guarda cómo estaba antes. */
  const [history, setHistory] = useState<string[][]>([]);
  const prev = useRef(cells), undoing = useRef(false);
  useEffect(() => {
    if (!undoing.current && prev.current.join() !== cells.join()) setHistory((h) => [...h.slice(-30), prev.current]);
    undoing.current = false; prev.current = cells;
  }, [cells.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: string[]) => onChange(next);
  const area = cellsArea(cells);
  const split = !allowSplit && !isContiguous(cells);
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="callout"><Icon name="layers" /><span className="grow">Haz clic en los hexágonos del mapa para sumarlos; otro clic lo quita. {hint}</span></div>
      <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
        {cells.length ? <>{cells.length} {cells.length === 1 ? 'hexágono' : 'hexágonos'} · {fmt(area)} m² · capacidad estimada {fmt(Math.round((area * 4) / 100) * 100)} personas</> : 'Ningún hexágono elegido todavía.'}
      </div>
      {split && <span className="err"><Icon name="error" />Los hexágonos quedaron en dos o más grupos sueltos. Únelos para que sea una sola área.</span>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" disabled={!history.length} onClick={() => { undoing.current = true; onChange(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); }}><Icon name="undo" />Deshacer</button>
        <button type="button" className="btn ghost sm" disabled={!cells.length} onClick={() => set(growCells(cells))}><Icon name="add" />Sumar un anillo alrededor</button>
        <button type="button" className="btn ghost sm" disabled={!cells.length} onClick={() => set([])}>Empezar de nuevo</button>
      </div>
    </div>
  );
}

export function ZonesSection() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const territories = useApi((s) => s.territories);
  const territory = territories[0]?.name ?? 'San Salvador';
  const [drawing, setDrawing] = useState(false);
  const [cells, setCells] = useState<string[]>([]);
  const [f, setF] = useState({ name: '' });
  const [importing, setImporting] = useState(false);
  useOverlay(drawing ? { pickCells: cells, onMapClick: (p) => setCells(toggleCell(cells, p)) }
    : { highlightZones: zones.map((z) => z.id), fit: { points: zones.flatMap((z) => z.ring), key: 'zonas' } }, [drawing, cells.join(), zones.length]);

  const shape = cells.length ? cellsShape(cells) : null;
  const taken = new Set(zones.flatMap(zoneCore));
  const overlap = cells.filter((x) => taken.has(x)).length;
  const ok = cells.length > 0 && isContiguous(cells) && !!f.name.trim();
  const finish = () => {
    if (!ok || !shape) return;
    const a = cellsArea(cells);
    const id = newZoneId();
    saveZone({ id, name: f.name.trim(), lat: shape.lat, lon: shape.lon, ring: shape.ring, cells, areaM2: a, capacity: Math.round((a * 4) / 100) * 100, cameras: [], territory }, user);
    toast(`Zona "${f.name.trim()}" creada con ${cells.length} ${cells.length === 1 ? 'hexágono' : 'hexágonos'}. Revisa su capacidad y asígnale cámaras.`);
    setDrawing(false); setCells([]); setF({ name: '' });
    c.open({ k: 'config', tab: 'zonas', id });
  };
  const shown = zones;

  return (
    <>
      <SectionHead group="Lugar" icon="layers" title="Zonas" sub="Lugares que se miden, delimitados por hexágonos. Toca una zona en el mapa o en la lista para editarla." />
      <div className="pb">
        {!drawing ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary sm" onClick={() => { setDrawing(true); c.focus(closeUp(zones), 'nueva-zona'); }}><Icon name="add" />Nueva zona</button>
            <button className="btn ghost sm" onClick={() => setImporting(true)}><Icon name="arrow_upward" />Importar CSV</button>
          </div>
        ) : (
          <div className="box"><div className="bh"><h3>Nueva zona</h3></div><div className="bb grid">
            <HexPicker cells={cells} onChange={setCells} />
            {overlap > 0 && <div className="callout warn"><Icon name="warning" /><span className="grow">{overlap} {overlap === 1 ? 'hexágono ya es' : 'hexágonos ya son'} de otra zona. Las personas de ahí se contarían dos veces.</span></div>}
            <div className="field"><label htmlFor="zn">Nombre</label><input id="zn" className="fld sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Catedral Metropolitana" /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost sm" onClick={() => { setDrawing(false); setCells([]); }}>Cancelar</button>
              <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={finish} disabled={!ok}>Crear zona</button>
            </div>
          </div></div>
        )}
        <div className="box flush">
          <ul className="list">
            {!shown.length && <li><EmptyState icon="layers" title="Todavía no hay zonas">Crea la primera con Nueva zona: eliges sus hexágonos en el mapa.</EmptyState></li>}
            {shown.map((z) => (
              <li key={z.id}><button className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'config', tab: 'zonas', id: z.id })}>
                <div><div className="t">{z.name}</div><div className="s">{zoneHexes([z]).length} hexágonos · capacidad {fmt(z.capacity)} · {z.cameras.length} {z.cameras.length === 1 ? 'cámara' : 'cámaras'}</div></div>
                <div className="r">{!z.cameras.length ? <span className="chip media">Sin cámara</span> : status[z.id]?.coverage === 'medida' ? <span className="chip ok">Medida</span> : <span className="chip nodata">Sin medición</span>}</div>
              </button></li>
            ))}
          </ul>
        </div>
        <div className="callout"><Icon name="info" /><span className="grow">Una zona es un lugar fijo. Un <button className="linklike" onClick={() => c.open({ k: 'config', tab: 'eventos' })}>evento</button> es algo que pasa durante unas horas: también se delimita con hexágonos y puede abarcar varias zonas.</span></div>
      </div>
      {importing && (
        <CsvImport title="Importar zonas" what="zonas" columns={ZONE_COLUMNS} fileName="plantilla-zonas.csv"
          parse={(row, i) => parseZone(row, i, zones.length, territory)}
          preview={{ head: ['Zona', 'Hexágonos', 'Capacidad'], row: (z) => [z.name, <span className="mono">{z.cells?.length ?? 0}</span>, <span className="mono">{fmt(z.capacity)}</span>] }}
          onImport={(items) => { importZones(items, user); toast(`${items.length} ${items.length === 1 ? 'zona importada' : 'zonas importadas'}. Asígnales cámaras para medirlas.`); setImporting(false); c.focus(items.flatMap((z) => z.ring), 'import'); }}
          onClose={() => setImporting(false)} />
      )}
    </>
  );
}

const ZONE_COLUMNS: CsvColumn[] = [
  { key: 'nombre', label: 'Nombre', example: 'Catedral Metropolitana', required: true },
  { key: 'lat', label: 'Latitud del centro', example: '13.6985', required: true },
  { key: 'lon', label: 'Longitud del centro', example: '-89.1915', required: true },
  { key: 'radio_m', label: 'Radio en metros', example: '120', required: true },
  { key: 'capacidad', label: 'Capacidad (personas)', example: '5000' },
];
/** Una fila de la plantilla de zonas: centro y radio. La zona queda como los hexágonos que caben en ese círculo. */
function parseZone(row: Record<string, string>, i: number, count: number, territory: string): RowResult<Zone> {
  const name = row.nombre?.trim();
  const lat = num(row.lat ?? ''), lon = num(row.lon ?? ''), r = num(row.radio_m ?? '');
  const cap = row.capacidad?.trim() ? Number(row.capacidad.replace(/\./g, '').replace(',', '.')) : null;
  if (!name) return { error: 'Falta el nombre.' };
  if (!inSV(lat, lon)) return { error: `${name}: las coordenadas están fuera de El Salvador.` };
  if (!(r >= 20 && r <= 5000)) return { error: `${name}: el radio tiene que estar entre 20 y 5000 m.` };
  if (cap !== null && !(cap > 0)) return { error: `${name}: la capacidad tiene que ser un número mayor que 0.` };
  const cells = cellsAround([lon, lat], r);
  const shape = cellsShape(cells), areaM2 = cellsArea(cells);
  return { ok: { id: 'Z-' + String(count + i + 1).padStart(2, '0'), name, lat: shape.lat, lon: shape.lon, ring: shape.ring, cells, areaM2, capacity: cap ?? Math.round((areaM2 * 4) / 100) * 100, cameras: [], territory } };
}

export function ZoneDetail({ id }: { id: string }) {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const zones = useApi((s) => s.zones);
  const cameras = useApi((s) => s.cameras);
  const rules = useApi((s) => s.rules);
  const events = useApi((s) => s.events);
  const status = useApi((s) => s.zoneStatus);
  const z = zones.find((x) => x.id === id);
  const [f, setF] = useState({ name: z?.name ?? '', capacity: String(z?.capacity ?? '') });
  /* Umbrales propios de la zona, por regla: vacío = usa el global. Se editan acá, sin ir a Reglas. */
  const zoneRules = rules.filter((r) => r.kind === 'aglomeracion' || r.kind === 'brecha_presencia');
  const ownOf = (rid: string) => rules.find((r) => r.id === rid)?.overrides.find((o) => o.targetId === id);
  const [thr, setThr] = useState<Record<string, string>>(() => Object.fromEntries(zoneRules.map((r) => [r.id, ownOf(r.id) ? String(ownOf(r.id)!.threshold) : ''])));
  const [cells, setCells] = useState<string[] | null>(null);
  const [del, setDel] = useState(false);
  useOverlay(cells ? { pickCells: cells, onMapClick: (p) => setCells(toggleCell(cells, p)) }
    : { highlightZones: [id], fit: z ? { points: z.ring, key: 'z' + id } : undefined }, [id, cells?.join()]);
  if (!z) return <SheetNotFound kicker="Zona" what="esta zona" />;
  const current = zoneHexes([z]);
  const zcams = cameras.filter((x) => x.zoneId === z.id || z.cameras.includes(x.id));
  const usedBy = events.filter((e) => e.zoneIds.includes(z.id));
  const capOk = Number(f.capacity) > 0;
  const thrChanged = zoneRules.filter((r) => (thr[r.id] ?? '') !== (ownOf(r.id) ? String(ownOf(r.id)!.threshold) : ''));
  const thrOk = zoneRules.every((r) => !thr[r.id] || Number(thr[r.id]) > 0);
  const fieldsDirty = f.name.trim() !== z.name || Number(f.capacity) !== z.capacity;
  const dirty = fieldsDirty || thrChanged.length > 0;
  const save = (e: FormEvent) => {
    e.preventDefault(); if (!dirty || !f.name.trim() || !capOk || !thrOk) return;
    if (fieldsDirty) saveZone({ ...z, name: f.name.trim(), capacity: Number(f.capacity) }, user);
    for (const r of thrChanged) {
      const rest = r.overrides.filter((o) => o.targetId !== z.id);
      setRuleOverrides(r.id, thr[r.id] ? [...rest, { target: 'zona', targetId: z.id, threshold: Number(thr[r.id]), persistenceMin: r.persistenceMin }] : rest, user);
    }
    toast('Zona guardada');
  };
  const saveShape = () => {
    if (!cells?.length || !isContiguous(cells)) return;
    const shape = cellsShape(cells);
    saveZone({ ...z, cells, ring: shape.ring, lat: shape.lat, lon: shape.lon, areaM2: cellsArea(cells) }, user);
    toast(`Forma guardada: ${cells.length} ${cells.length === 1 ? 'hexágono' : 'hexágonos'}`); setCells(null);
  };
  const s = status[z.id];
  return (
    <>
      <SheetHead kicker={<><span>Zona</span>·<span className="mono">{z.id}</span></>} title={z.name} sub={`${current.length} hexágonos · ${fmt(z.areaM2)} m²`}
        aside={<>{!zcams.length ? <span className="chip media">Sin cámara: no se mide</span> : s?.coverage === 'medida' ? <span className="chip ok">Medida</span> : <span className="chip nodata">Sin medición</span>}
          <button type="button" className="btn ghost xs" onClick={() => c.open({ k: 'zona', id: z.id })}><Icon name="visibility" />Ver en vivo</button></>} />
      <form className="pb" id="zone-form" onSubmit={save} noValidate>
        <div className="field"><label htmlFor="zdn">Nombre</label><input id="zdn" className="fld sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="zdc">Capacidad (personas)</label><input id="zdc" inputMode="numeric" className="fld sm mono" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} aria-invalid={!capOk} />
            {!capOk && <span className="err"><Icon name="error" />Indica cuántas personas caben.</span>}</div>
        <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>La ocupación de la zona se calcula sobre esta capacidad. La fija el Ministerio; la estimación inicial es 4 personas por m².</span>

        <div className="box">
          <div className="bh"><h3>Hexágonos de la zona</h3><span className="sub">{current.length}</span></div>
          <div className="bb grid">
            {!cells ? <button type="button" className="btn secondary sm" style={{ justifySelf: 'start' }} onClick={() => setCells(current)}><Icon name="layers" />Cambiar hexágonos</button> : <>
              <HexPicker cells={cells} onChange={setCells} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn ghost sm" onClick={() => setCells(null)}>Cancelar</button>
                <button type="button" className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={!cells.length || !isContiguous(cells)} onClick={saveShape}>Guardar forma</button>
              </div></>}
          </div>
        </div>

        <div className="box flush">
          <div className="bh"><h3>Cámaras que la miden</h3><span className="sub">{zcams.length}</span></div>
          <ul className="list bb">
            {!zcams.length && <li className="empty">Sin cámaras: la zona no se mide. Abre una cámara y elige esta zona.</li>}
            {zcams.map((x) => (
              <li key={x.id}><button type="button" className="item" onClick={() => c.open({ k: 'config', tab: 'camaras', id: x.id })}>
                <span className="ic"><Icon name={x.status === 'caida' ? 'videocam_off' : 'videocam'} /></span>
                <div><div className="t mono">{x.id}</div><div className="s">{x.street}</div></div>
                <div className="r"><span className={camChip(x)}>{CAMERA_LABEL[x.status]}</span></div>
              </button></li>
            ))}
          </ul>
        </div>

        <div className="box">
          <div className="bh"><h3>Cuándo avisar en esta zona</h3><span className="sub">umbrales propios</span></div>
          <div className="bb grid">
            {zoneRules.map((r) => (
              <div key={r.id} className="field">
                <label htmlFor={`zt-${r.id}`}>{r.name} <span className="dim">({r.unit})</span></label>
                <input id={`zt-${r.id}`} inputMode="decimal" className="fld sm mono" value={thr[r.id] ?? ''} placeholder={fmt(r.threshold ?? 0)}
                  onChange={(e) => setThr({ ...thr, [r.id]: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} aria-invalid={!!thr[r.id] && !(Number(thr[r.id]) > 0)} />
                <span className="hint dim" style={{ fontSize: 'var(--fs-xs)' }}>{thr[r.id] ? `Propio de esta zona. Para todas las zonas es ${fmt(r.threshold ?? 0)}.` : `Vacío: usa el de todas las zonas (${fmt(r.threshold ?? 0)}).`}</span>
              </div>
            ))}
            <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>Durante un evento, mandan los umbrales del evento. La criticidad de cada alerta se fija en la regla.</span>
          </div>
        </div>

        {usedBy.length > 0 && (
          <div className="box flush">
            <div className="bh"><h3>Eventos en esta zona</h3><span className="sub">{usedBy.length}</span></div>
            <ul className="list bb">{usedBy.map((e) => <li key={e.id}><button type="button" className="item" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => c.open({ k: 'evento', id: e.id })}><div className="t">{e.name}</div><Icon name="chevron_right" /></button></li>)}</ul>
          </div>
        )}
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={!!usedBy.length} onClick={() => setDel(true)}><Icon name="remove" />Eliminar zona</button>
        {usedBy.length > 0 && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>No se puede eliminar mientras un evento la use. Quítala primero del evento.</span>}
      </form>
      <UnsavedGuard dirty={dirty} />
      <div className="pf"><button type="button" className="btn ghost sm" onClick={() => c.open({ k: 'config', tab: 'zonas' })}>Volver a zonas</button>
        <button type="submit" form="zone-form" className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={!dirty || !f.name.trim() || !capOk || !thrOk}>Guardar cambios</button></div>
      {del && <ConfirmDelete title={`¿Eliminar la zona ${z.name}?`} action="Eliminar zona" onClose={() => setDel(false)}
        onConfirm={() => { deleteZone(z.id, user); toast('Zona eliminada'); c.open({ k: 'config', tab: 'zonas' }); }}>
        Sus cámaras quedan sin zona y se pierde su medición. Esto no se puede deshacer.
      </ConfirmDelete>}
    </>
  );
}

/* ================= Cámaras ================= */
const CAM_COLUMNS: CsvColumn[] = [
  { key: 'id', label: 'Identificador', example: 'CAM-120', required: true },
  { key: 'ubicacion', label: 'Ubicación', example: 'Av. Roosevelt y 49 Av. Sur', required: true },
  { key: 'lat', label: 'Latitud', example: '13.7010', required: true },
  { key: 'lon', label: 'Longitud', example: '-89.2240', required: true },
  { key: 'tipo', label: 'Tipo', example: 'mixta' },
  { key: 'ptz', label: 'PTZ', example: 'si' },
  { key: 'zona', label: 'Zona', example: 'Z-01' },
];
const newCamera = (p: Pick<Camera, 'id' | 'street' | 'lat' | 'lon' | 'kind' | 'ptz' | 'zoneId'>): Camera =>
  ({ ...p, heading: 0, status: 'degradada', presets: [], compute: 'Por asignar', fps: 0, lastFrameAt: Date.now() });
function parseCamera(row: Record<string, string>, taken: string[], zones: { id: string }[]): RowResult<Camera> {
  const id = row.id?.trim().toUpperCase(), street = row.ubicacion?.trim();
  const lat = num(row.lat ?? ''), lon = num(row.lon ?? '');
  const kind = (row.tipo?.trim().toLowerCase() || 'mixta') as Camera['kind'];
  const zone = row.zona?.trim().toUpperCase() || null;
  if (!id) return { error: 'Falta el identificador.' };
  if (taken.includes(id)) return { error: `${id} ya existe.` };
  if (!street) return { error: `${id}: falta la ubicación.` };
  if (!inSV(lat, lon)) return { error: `${id}: las coordenadas están fuera de El Salvador.` };
  if (!(kind in KIND_SHORT)) return { error: `${id}: el tipo "${row.tipo}" no existe. Usa mixta, vehicular o peatonal.` };
  if (zone && !zones.some((z) => z.id === zone)) return { error: `${id}: la zona ${zone} no existe.` };
  return { ok: newCamera({ id, street, lat, lon, kind, ptz: /^(si|sí|s|1|true|x)$/i.test(row.ptz?.trim() ?? ''), zoneId: zone }) };
}

export function CamerasSection() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const now = useNow(10000);
  const cameras = useApi((s) => s.cameras);
  const zones = useApi((s) => s.zones);
  const [filter, setFilter] = useState<'todas' | 'problemas' | 'sin_zona'>('todas');
  const [adding, setAdding] = useState<'manual' | 'csv' | null>(null);
  const probs = cameras.filter((x) => x.status !== 'operativa'), noZone = cameras.filter((x) => !x.zoneId);
  const shown = filter === 'problemas' ? probs : filter === 'sin_zona' ? noZone : cameras;
  useOverlay({ fit: { points: cameras.map((x) => [x.lon, x.lat] as LngLat), key: 'camaras' } }, [cameras.length]);
  return (
    <>
      <SectionHead group="Lugar" icon="videocam" title="Cámaras" sub="Dónde está cada cámara, qué detecta y qué zona mide. Toca una cámara para editarla." />
      <div className="pb">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary sm" onClick={() => setAdding('csv')}><Icon name="arrow_upward" />Importar CSV</button>
          <button className="btn ghost sm" onClick={() => setAdding('manual')}><Icon name="add" />Agregar una</button>
        </div>
        <Segmented label="Qué cámaras ver" style={{ alignSelf: 'flex-start' }} value={filter} onChange={setFilter} options={[
          { value: 'todas', label: 'Todas', count: cameras.length }, { value: 'problemas', label: 'Con problemas', count: probs.length }, { value: 'sin_zona', label: 'Sin zona', count: noZone.length }]} />
        <div className="box flush">
          <ul className="list">
            {!shown.length && <li><EmptyState icon="videocam" title={filter === 'problemas' ? 'Todas las cámaras funcionan' : 'Todas tienen zona'} tone="ok" /></li>}
            {shown.map((x) => (
              <li key={x.id}><button className="item" onClick={() => c.open({ k: 'config', tab: 'camaras', id: x.id })}>
                <span className="ic"><Icon name={x.status === 'caida' ? 'videocam_off' : 'videocam'} /></span>
                <div style={{ minWidth: 0 }}><div className="t"><span className="mono">{x.id}</span> · {KIND_SHORT[x.kind]}{x.ptz && ' · PTZ'}</div>
                  <div className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.street} · {zones.find((z) => z.id === x.zoneId)?.name ?? 'sin zona'}</div></div>
                <div className="r"><span className={camChip(x)}>{CAMERA_LABEL[x.status]}</span><span>{ago(x.lastFrameAt, now)}</span></div>
              </button></li>
            ))}
          </ul>
        </div>
      </div>
      {adding === 'manual' && <NewCamera onClose={() => setAdding(null)} onSave={(cam) => { addCameras([cam], user, 'manual'); toast(`Cámara ${cam.id} agregada. Completa su zona y sus presets.`); setAdding(null); c.open({ k: 'config', tab: 'camaras', id: cam.id }); }} />}
      {adding === 'csv' && (
        <CsvImport title="Importar cámaras" what="cámaras" columns={CAM_COLUMNS} fileName="plantilla-camaras.csv"
          parse={(row) => parseCamera(row, cameras.map((x) => x.id), zones)}
          preview={{ head: ['Cámara', 'Ubicación', 'Tipo', 'Zona'], row: (x) => [<span className="mono">{x.id}</span>, x.street, KIND_SHORT[x.kind] + (x.ptz ? ' · PTZ' : ''), zones.find((z) => z.id === x.zoneId)?.name ?? <span className="dim">—</span>] }}
          onImport={(items) => { const n = addCameras(items, user, 'csv'); toast(`${n} ${n === 1 ? 'cámara importada' : 'cámaras importadas'}. Quedan sin presets hasta que los cargues.`); setAdding(null); }}
          onClose={() => setAdding(null)} />
      )}
    </>
  );
}

function NewCamera({ onSave, onClose }: { onSave: (c: Camera) => void; onClose: () => void }) {
  const cameras = useApi((s) => s.cameras);
  const zones = useApi((s) => s.zones);
  const [v, setV] = useState({ id: newCameraId(), ubicacion: '', lat: '', lon: '', tipo: 'mixta', ptz: '', zona: '' });
  const [pick, setPick] = useState(false);
  useOverlay(pick ? { onMapClick: ([lon, lat]) => { setV((x) => ({ ...x, lat: lat.toFixed(5), lon: lon.toFixed(5) })); setPick(false); } } : {}, [pick]);
  const res = parseCamera(v, cameras.map((x) => x.id), zones);
  const touched = v.ubicacion || v.lat || v.lon;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  if (pick) return <div className="map-state" role="status" style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 'var(--z-popover)' }}><Icon name="pin_drop" /><span><b>Haz clic en el mapa</b> donde está la cámara</span><button className="btn ghost xs" onClick={() => setPick(false)}>Cancelar</button></div>;
  return (
    <Dialog title="Agregar cámara" onClose={onClose} footer={<>
      <button className="btn ghost sm" onClick={onClose}>Cancelar</button>
      <button className="btn primary sm" disabled={!('ok' in res)} onClick={() => 'ok' in res && onSave(res.ok)}>Agregar cámara</button>
    </>}>
      <div className="form-row">
        <div className="field"><label htmlFor="ci">Identificador</label><input id="ci" className="fld mono" value={v.id} onChange={set('id')} /></div>
        <div className="field"><label htmlFor="ct">Qué detecta</label>
          <select id="ct" className="fld" value={v.tipo} onChange={set('tipo')}>{Object.entries(KIND_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="cu">Ubicación</label><input id="cu" className="fld" value={v.ubicacion} onChange={set('ubicacion')} placeholder="Av. Roosevelt y 49 Av. Sur" /></div>
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
        <div className="field"><label htmlFor="cla">Latitud</label><input id="cla" inputMode="decimal" className="fld mono" value={v.lat} onChange={set('lat')} placeholder="13.7010" /></div>
        <div className="field"><label htmlFor="clo">Longitud</label><input id="clo" inputMode="decimal" className="fld mono" value={v.lon} onChange={set('lon')} placeholder="-89.2240" /></div>
        <button className="btn secondary sm" onClick={() => setPick(true)}><Icon name="pin_drop" />Marcar en el mapa</button>
      </div>
      <div className="form-row">
        <div className="field"><label htmlFor="cz">Zona que mide</label>
          <select id="cz" className="fld" value={v.zona} onChange={set('zona')}><option value="">Ninguna por ahora</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
        <label className="toggle" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={!!v.ptz} onChange={(e) => setV({ ...v, ptz: e.target.checked ? 'si' : '' })} />Se mueve (PTZ)</label>
      </div>
      {touched && 'error' in res && <span className="err"><Icon name="error" />{res.error}</span>}
    </Dialog>
  );
}

export function CameraDetail({ id }: { id: string }) {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const now = useNow(10000);
  const cameras = useApi((s) => s.cameras);
  const zones = useApi((s) => s.zones);
  const cam = cameras.find((x) => x.id === id);
  const init = (x?: Camera) => ({ street: x?.street ?? '', lat: String(x?.lat ?? ''), lon: String(x?.lon ?? ''), heading: String(x ? Math.round(bearing(x)) : 0), kind: x?.kind ?? 'mixta', ptz: !!x?.ptz, zoneId: x?.zoneId ?? '', compute: x?.compute ?? 'Por asignar' });
  const [f, setF] = useState(() => init(cam));
  const [pick, setPick] = useState(false);
  const [preset, setPreset] = useState('');
  const lat = num(f.lat), lon = num(f.lon);
  useEffect(() => { if (cam) { c.setPin({ lat: cam.lat, lon: cam.lon, label: cam.id }); c.focus([[cam.lon - 0.002, cam.lat - 0.0015], [cam.lon + 0.002, cam.lat + 0.0015]], 'cam' + cam.id); } return () => c.setPin(null); }, [cam?.id, cam?.lat, cam?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  useOverlay(pick ? { onMapClick: ([x, y]) => { setF((p) => ({ ...p, lat: y.toFixed(5), lon: x.toFixed(5) })); setPick(false); } } : {}, [pick]);
  if (!cam) return <SheetNotFound kicker="Cámara" what="esta cámara" />;
  const okPos = inSV(lat, lon);
  const patch: Partial<Camera> = {};
  if (f.street.trim() !== cam.street) patch.street = f.street.trim();
  if (okPos && (lat !== cam.lat || lon !== cam.lon)) { patch.lat = lat; patch.lon = lon; }
  // El mapa guarda la orientación en radianes (0 = este); aquí se edita como brújula (0 = norte, en grados).
  if (Number(f.heading) !== Math.round(bearing(cam))) patch.heading = ((((Number(f.heading) % 360) + 360) % 360) * Math.PI) / 180 - Math.PI / 2;
  if (f.kind !== cam.kind) patch.kind = f.kind;
  if (f.ptz !== cam.ptz) patch.ptz = f.ptz;
  if ((f.zoneId || null) !== cam.zoneId) patch.zoneId = f.zoneId || null;
  if (f.compute !== cam.compute) patch.compute = f.compute;
  const dirty = Object.keys(patch).length > 0;
  const save = (e: FormEvent) => {
    e.preventDefault(); if (!dirty || !okPos || !f.street.trim()) return;
    updateCamera(cam.id, patch, user); toast('Cámara actualizada');
    if (patch.lat != null) { c.setPin({ lat, lon, label: cam.id }); }
  };
  const setPresets = (presets: string[]) => updateCamera(cam.id, { presets }, user);
  const set = (k: 'street' | 'lat' | 'lon' | 'heading' | 'kind' | 'zoneId' | 'compute') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <SheetHead kicker={<><span>Cámara</span>·<span>{KIND_SHORT[cam.kind]}{cam.ptz && ' · PTZ'}</span></>} title={<span className="mono">{cam.id}</span>} sub={cam.street}
        aside={<span className={camChip(cam)}>{CAMERA_LABEL[cam.status]}</span>} />
      <form className="pb" id="cam-form" onSubmit={save} noValidate>
        {cam.status === 'caida' && <div className="callout danger"><Icon name="videocam_off" /><span className="grow"><b>No envía video desde hace {ago(cam.lastFrameAt, now).replace('hace ', '')}.</b> La zona que mide queda sin datos. Revisa la conexión en el sitio.</span></div>}
        {cam.status === 'fuera_de_preset' && <div className="callout warn"><Icon name="warning" /><span className="grow"><b>Fuera de su preset.</b> Mientras se mueve solo detecta: no mide la zona ni lee placas. Llévala a un preset abajo.</span></div>}
        {cam.status === 'degradada' && !cam.presets.length && <div className="callout warn"><Icon name="warning" /><span className="grow"><b>Sin presets.</b> Agrega al menos uno para que pueda medir su zona.</span></div>}
        <div className="field"><label htmlFor="cdu">Ubicación</label><input id="cdu" className="fld sm" value={f.street} onChange={set('street')} /></div>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
          <div className="field"><label htmlFor="cdla">Latitud</label><input id="cdla" inputMode="decimal" className="fld sm mono" value={f.lat} onChange={set('lat')} aria-invalid={!okPos} /></div>
          <div className="field"><label htmlFor="cdlo">Longitud</label><input id="cdlo" inputMode="decimal" className="fld sm mono" value={f.lon} onChange={set('lon')} aria-invalid={!okPos} /></div>
          <button type="button" className={`btn sm ${pick ? 'primary' : 'secondary'}`} onClick={() => setPick(!pick)}><Icon name="pin_drop" />{pick ? 'Haz clic en el mapa' : 'Mover en el mapa'}</button>
        </div>
        {!okPos && <span className="err"><Icon name="error" />Las coordenadas están fuera de El Salvador.</span>}
        <div className="form-row">
          <div className="field"><label htmlFor="cdk">Qué detecta</label>
            <select id="cdk" className="fld sm" value={f.kind} onChange={set('kind')}>{Object.entries(KIND_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="cdh">Hacia dónde mira (grados, 0 = norte)</label><input id="cdh" inputMode="numeric" className="fld sm mono" value={f.heading} onChange={set('heading')} /></div>
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="cdz">Zona que mide</label>
            <select id="cdz" className="fld sm" value={f.zoneId} onChange={set('zoneId')}><option value="">Ninguna</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
          <div className="field"><label htmlFor="cdc">Procesamiento</label>
            <select id="cdc" className="fld sm" value={f.compute} onChange={set('compute')}>{[...new Set([...COMPUTE, cam.compute])].map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
        </div>
        <label className="toggle"><input type="checkbox" checked={f.ptz} onChange={(e) => setF({ ...f, ptz: e.target.checked })} />Se mueve (PTZ): usa presets para medir</label>

        <div className="box flush">
          <div className="bh"><h3>Presets</h3><span className="sub">{cam.presets.length ? `${cam.presets.length}` : 'ninguno'}</span></div>
          <ul className="list bb">
            {!cam.presets.length && <li className="empty">Sin presets: la cámara no mide su zona.</li>}
            {cam.presets.map((p) => (
              <li key={p} className="item" style={{ gridTemplateColumns: '1fr auto auto' }}>
                <span className="t">{p}</span>
                {cam.status === 'fuera_de_preset' ? <button type="button" className="btn secondary xs" onClick={() => { setCameraPreset(cam.id, p, user); toast(`${cam.id} en ${p}: la zona vuelve a medirse`); }}>Llevar a este preset</button> : <span />}
                <button type="button" className="iconbtn" aria-label={`Quitar preset ${p}`} title={`Quitar preset ${p}`} onClick={() => setPresets(cam.presets.filter((x) => x !== p))}><Icon name="close" /></button>
              </li>
            ))}
          </ul>
          <div className="bb" style={{ display: 'flex', gap: 8 }}>
            <input className="fld sm" aria-label="Nombre del preset nuevo" placeholder="Nombre del preset, p. ej. Plaza norte" value={preset} onChange={(e) => setPreset(e.target.value)} />
            <button type="button" className="btn secondary sm" disabled={!preset.trim() || cam.presets.includes(preset.trim())} onClick={() => { setPresets([...cam.presets, preset.trim()]); setPreset(''); }}><Icon name="add" />Agregar preset</button>
          </div>
        </div>

        <div className="box">
          <div className="bh"><h3>Lo que informa la cámara</h3></div>
          <dl className="details bb">
            <dt>Último cuadro</dt><dd className="mono">{ago(cam.lastFrameAt, now)}</dd>
            <dt>Cuadros por segundo</dt><dd className="mono">{cam.status === 'caida' ? '—' : cam.fps}</dd>
          </dl>
        </div>
      </form>
      <UnsavedGuard dirty={dirty} />
      <div className="pf"><button type="button" className="btn ghost sm" onClick={() => c.open({ k: 'config', tab: 'camaras' })}>Volver a cámaras</button>
        <button type="submit" form="cam-form" className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={!dirty || !okPos || !f.street.trim()}>Guardar cambios</button></div>
    </>
  );
}
