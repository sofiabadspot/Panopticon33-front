/* Configuración — administrador. Ficha ancha sobre el mapa: las zonas se dibujan en el
   mismo mapa de la consola y una cámara elegida en la tabla se señala en él. */
import { useState } from 'react';
import { newZoneId, saveZone, useApi } from '../../api';
import { fmt } from '../../api/format';
import type { LngLat } from '../../api/types';
import { useSession } from '../../shell/session';
import { Icon, useToast } from '../../ui/kit';
import { useConsole, useOverlay } from '../ctx';
import { Cameras, Lists, PoliceSource, Rules, TABS, Users } from './configSections';
import { SheetHead } from './SheetHead';

export function ConfigSheet({ tab = 'camaras' }: { tab?: string }) {
  const c = useConsole();
  const sec = TABS.find(([k]) => k === tab) ?? TABS[0];
  return (
    <>
      <SheetHead kicker="Configuración · los cambios quedan en la bitácora" title={<><Icon name={sec[2]} />{sec[1]}</>} />
      <div className="pb">
        {tab === 'camaras' && <Cameras onPick={(x) => { c.setPin({ lat: x.lat, lon: x.lon, label: x.id }); c.focus([[x.lon - 0.002, x.lat - 0.0015], [x.lon + 0.002, x.lat + 0.0015]], 'cam'); }} />}
        {tab === 'zonas' && <Zones />}
        {tab === 'reglas' && <Rules />}
        {tab === 'listas' && <Lists />}
        {tab === 'ubicacion' && <PoliceSource />}
        {tab === 'usuarios' && <Users />}
      </div>
    </>
  );
}

/** Zonas: se dibujan haciendo clic en el mapa de la consola, a la izquierda de esta ficha. */
function Zones() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const zones = useApi((s) => s.zones);
  const cameras = useApi((s) => s.cameras);
  const status = useApi((s) => s.zoneStatus);
  const [drawing, setDrawing] = useState(false);
  const [pts, setPts] = useState<LngLat[]>([]);
  const [name, setName] = useState('');
  useOverlay(drawing ? { sketch: pts, onMapClick: (p) => setPts((x) => [...x, p]) } : {}, [drawing, pts]);

  const area = (ring: LngLat[]) => {
    const k = 111320, cs = Math.cos((ring[0][1] * Math.PI) / 180); let a = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * k * cs * q[1] * k - q[0] * k * cs * p[1] * k; }
    return Math.abs(a) / 2;
  };
  const finish = () => {
    if (pts.length < 3 || !name.trim()) return;
    const lon = pts.reduce((n, p) => n + p[0], 0) / pts.length, lat = pts.reduce((n, p) => n + p[1], 0) / pts.length;
    const near = cameras.filter((x) => Math.hypot(x.lon - lon, x.lat - lat) < 0.003).slice(0, 2).map((x) => x.id);
    const a = area(pts);
    saveZone({ id: newZoneId(), name: name.trim(), lat, lon, ring: [...pts, pts[0]], areaM2: a, capacity: Math.round((a * 4) / 100) * 100, cameras: near }, user);
    toast(`Zona "${name.trim()}" creada. Falta asociarle presets para medirla.`);
    setDrawing(false); setPts([]); setName('');
  };

  return (
    <>
      {!drawing ? (
        <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDrawing(true)}><Icon name="add" />Dibujar zona en el mapa</button>
      ) : (
        <div className="box"><div className="bb grid" style={{ paddingTop: 12 }}>
          <div className="callout"><Icon name="edit_note" /><span className="grow">Haz clic en el mapa, a la izquierda, para marcar cada vértice. Con 3 o más puntos, ponle nombre y guarda.</span></div>
          <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="field"><label htmlFor="zn">Nombre de la zona</label><input id="zn" className="fld sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Catedral Metropolitana" /></div>
            <div className="dim" style={{ fontSize: 'var(--fs-sm)', alignSelf: 'end', paddingBottom: 8 }}>{pts.length} vértices{pts.length >= 3 && ` · ${fmt(area(pts))} m²`}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost sm" onClick={() => setPts((p) => p.slice(0, -1))} disabled={!pts.length}><Icon name="undo" />Deshacer</button>
            <button className="btn ghost sm" onClick={() => { setDrawing(false); setPts([]); }}>Cancelar</button>
            <button className="btn solid sm" style={{ marginLeft: 'auto' }} onClick={finish} disabled={pts.length < 3 || !name.trim()}>Guardar zona</button>
          </div>
        </div></div>
      )}
      <div className="box flush">
        <table className="tbl">
          <thead><tr><th>Zona</th><th className="r">Área</th><th className="r">Capacidad</th><th className="r">Cámaras</th><th>Medición</th></tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id} className="click" onClick={() => c.focus(z.ring, 'z' + z.id)}>
                <td>{z.name}<div className="dim mono" style={{ fontSize: 'var(--fs-xs)' }}>{z.id}</div></td>
                <td className="r mono">{fmt(z.areaM2)} m²</td><td className="r mono">{fmt(z.capacity)}</td><td className="r mono">{z.cameras.length}</td>
                <td>{status[z.id]?.coverage === 'medida' ? <span className="chip ok">Medida</span> : <span className="chip nodata">Sin cobertura</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="callout"><Icon name="info" /><span className="grow">Dibujar la zona sobre la imagen de la cámara (región por preset) requiere el cuadro de referencia de cada cámara; se habilita al conectar el video del Ministerio.</span></div>
    </>
  );
}
