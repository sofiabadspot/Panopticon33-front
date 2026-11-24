/* Secciones de Configuración (administrador). Las usa ConfigSheet.
   "¿Está todo funcionando y bien configurado?" Cámaras y presets con su estado, zonas dibujadas
   en el mapa, reglas y umbrales, listas con su última sincronización, usuarios y territorios.
   Los umbrales los fija el Ministerio, no SPOTVISION. */
import { useState } from 'react';
import {
  isListStale, setCameraPreset, setPoliceSource, setUserActive, syncList, updateRule, useApi,
} from '../../api';
import { ago, fmt } from '../../api/format';
import { CAMERA_LABEL, KIND_LABEL, ROLE_LABEL } from '../../api/labels';
import type { Camera, Rule } from '../../api/types';
import { useSession } from '../../shell/session';
import { Dialog, Icon, useNow, useToast } from '../../ui/kit';

export const TABS = [
  ['camaras', 'Cámaras', 'videocam'], ['zonas', 'Zonas', 'layers'], ['reglas', 'Reglas y umbrales', 'tune'],
  ['listas', 'Listas', 'database'], ['ubicacion', 'Ubicación policial', 'local_police'], ['usuarios', 'Usuarios y territorios', 'person'],
] as const;

const camChip = (c: Camera) => `chip ${c.status === 'operativa' ? 'ok' : c.status === 'caida' ? 'critica' : c.status === 'degradada' ? 'media' : 'nodata'}`;

export function Cameras({ onPick }: { onPick?: (c: Camera) => void }) {
  const { user } = useSession();
  const toast = useToast();
  const now = useNow(10000);
  const cameras = useApi((s) => s.cameras);
  const zones = useApi((s) => s.zones);
  const alerts = useApi((s) => s.alerts);
  const [filter, setFilter] = useState<'todas' | 'problemas'>('problemas');
  const [presetFor, setPresetFor] = useState<Camera | null>(null);
  const shown = cameras.filter((c) => filter === 'todas' || c.status !== 'operativa');
  const down = alerts.filter((a) => a.kind === 'camara_caida' && a.review === 'por_revisar');
  return (
    <div className="grid">
      {down.map((a) => (
        <div key={a.id} className="callout danger"><Icon name="videocam_off" /><span className="grow"><b>Cámara caída {a.cameraId}:</b> {a.rule.measured.toLowerCase()}. La zona que cubre queda marcada sin datos.</span></div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="seg">
          <button className={filter === 'problemas' ? 'on' : ''} onClick={() => setFilter('problemas')}>Con problemas<b>{cameras.filter((c) => c.status !== 'operativa').length}</b></button>
          <button className={filter === 'todas' ? 'on' : ''} onClick={() => setFilter('todas')}>Todas<b>{cameras.length}</b></button>
        </div>
        <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>{cameras.filter((c) => c.status === 'operativa').length} operativas de {cameras.length}</span>
      </div>
      <div className="panel flush tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Cámara</th><th>Ubicación</th><th>Tipo</th><th>Zona</th><th>Presets</th><th>Cómputo</th><th>Estado</th><th className="r">Último cuadro</th><th /></tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={onPick ? 'click' : ''} onClick={() => onPick?.(c)}>
                <td className="mono">{c.id}</td>
                <td>{c.street}</td>
                <td>{c.kind === 'mixta' ? 'Mixta' : c.kind === 'vehicular' ? 'Vehicular' : 'Peatonal'}{c.ptz && ' · PTZ'}</td>
                <td>{zones.find((z) => z.id === c.zoneId)?.name ?? <span className="dim">—</span>}</td>
                <td>{c.presets.length}</td>
                <td className="dim">{c.compute}</td>
                <td><span className={camChip(c)}>{CAMERA_LABEL[c.status]}</span></td>
                <td className="r mono">{ago(c.lastFrameAt, now)}</td>
                <td className="r">{c.status === 'fuera_de_preset' && <button className="btn secondary xs" onClick={(e) => { e.stopPropagation(); setPresetFor(c); }}>Volver a preset</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {presetFor && (
        <Dialog title={`Presets de ${presetFor.id}`} onClose={() => setPresetFor(null)}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>En movimiento la cámara solo detecta: no mide la zona ni lee placas. Elige el preset conocido al que debe volver.</p>
          {presetFor.presets.map((p) => (
            <button key={p} className="check" onClick={() => { setCameraPreset(presetFor.id, p, user); toast(`${presetFor.id} en ${p}: la zona vuelve a medirse`); setPresetFor(null); }}>
              <Icon name="center_focus_strong" /><span>{p}</span>
            </button>
          ))}
        </Dialog>
      )}
    </div>
  );
}

export function Rules() {
  const { user } = useSession();
  const toast = useToast();
  const rules = useApi((s) => s.rules);
  const [edit, setEdit] = useState<Rule | null>(null);
  const [v, setV] = useState({ threshold: '', persistenceMin: '' });
  return (
    <div className="grid">
      <div className="callout warn"><Icon name="warning" /><span className="grow"><b>Umbrales por confirmar.</b> Los valores actuales son supuestos de trabajo. Los fija el Ministerio (pregunta abierta: personas, densidad y personas por policía).</span></div>
      <div className="panel flush tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Regla</th><th>Tipo de alerta</th><th>Alcance</th><th className="r">Umbral</th><th className="r">Persistencia</th><th>Origen</th><th>Activa</th><th /></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td><b style={{ fontWeight: 500 }}>{r.name}</b><div className="dim mono" style={{ fontSize: 11 }}>{r.id}</div></td>
                <td>{KIND_LABEL[r.kind]}</td>
                <td className="dim">{r.scope}</td>
                <td className="r mono">{fmt(r.threshold ?? 0)} <span className="dim" style={{ fontFamily: 'var(--font-sans)' }}>{r.unit}</span></td>
                <td className="r mono">{r.persistenceMin ? `${r.persistenceMin} min` : 'Inmediata'}</td>
                <td>{r.source === 'ministerio' ? <span className="chip ok">Ministerio</span> : <span className="chip media">Supuesto</span>}</td>
                <td><label className="toggle"><input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(r.id, { enabled: e.target.checked }, user)} /><span className="sr">Activa</span></label></td>
                <td className="r"><button className="btn ghost xs" onClick={() => { setEdit(r); setV({ threshold: String(r.threshold ?? ''), persistenceMin: String(r.persistenceMin) }); }}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Dialog title={edit.name} onClose={() => setEdit(null)} footer={<>
          <button className="btn ghost sm" onClick={() => setEdit(null)}>Cancelar</button>
          <button className="btn solid sm" disabled={!(Number(v.threshold) > 0)} onClick={() => {
            if (Number(v.threshold) !== edit.threshold) updateRule(edit.id, { threshold: Number(v.threshold), source: 'ministerio' }, user);
            if (Number(v.persistenceMin) !== edit.persistenceMin) updateRule(edit.id, { persistenceMin: Number(v.persistenceMin) }, user);
            toast('Regla actualizada'); setEdit(null);
          }}>Guardar</button>
        </>}>
          <div className="form-row">
            <div className="field"><label htmlFor="rt">Umbral ({edit.unit})</label><input id="rt" inputMode="decimal" className="fld mono" value={v.threshold} onChange={(e) => setV({ ...v, threshold: e.target.value })} /></div>
            <div className="field"><label htmlFor="rp">Persistencia (min)</label><input id="rp" inputMode="numeric" className="fld mono" value={v.persistenceMin} onChange={(e) => setV({ ...v, persistenceMin: e.target.value })} /></div>
          </div>
          <span className="hint dim" style={{ fontSize: 12 }}>Guardar un umbral nuevo lo marca como fijado por el Ministerio.</span>
        </Dialog>
      )}
    </div>
  );
}

export function Lists() {
  const { user } = useSession();
  const toast = useToast();
  const now = useNow(10000);
  const lists = useApi((s) => s.lists);
  return (
    <div className="grid">
      {lists.map((l) => {
        const stale = isListStale(l, now);
        return (
          <section key={l.id} className="panel">
            <div className="hd"><h2>{l.name}</h2>{stale ? <span className="chip media"><Icon name="warning" />Desactualizada</span> : <span className="chip ok">Al día</span>}</div>
            <div className="bd grid">
              <dl className="details" style={{ maxWidth: 520 }}>
                <dt>Origen</dt><dd>{l.origin}</dd>
                <dt>Modo</dt><dd>{l.mode}</dd>
                <dt>Entradas vigentes</dt><dd className="mono">{fmt(l.entries)}</dd>
                <dt>Última sincronización</dt><dd style={{ color: stale ? 'var(--status-alert)' : undefined }}>{ago(l.lastSyncAt, now)}</dd>
                <dt>Plazo máximo</dt><dd>{l.maxAgeMin} min</dd>
              </dl>
              {stale && <div className="callout warn"><Icon name="warning" /><span className="grow">El operador 911 ve un aviso en su bandeja mientras la lista esté desactualizada.</span></div>}
              <button className="btn secondary sm" style={{ justifySelf: 'start' }} onClick={() => { syncList(l.id, user); toast('Lista sincronizada'); }}><Icon name="sync" />Sincronizar ahora</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function PoliceSource() {
  const { user } = useSession();
  const on = useApi((s) => s.policeSource);
  const units = useApi((s) => s.units);
  const now = useNow(10000);
  const stale = units.filter((u) => u.status === 'sin_reporte');
  const unknown = units.filter((u) => u.status === 'desconocida');
  return (
    <div className="grid" style={{ maxWidth: 760 }}>
      <section className="panel">
        <div className="hd"><h2>Plataforma de ubicación policial</h2>{on ? <span className="chip ok"><span className="dot" />Conectada</span> : <span className="chip nodata">Sin acceso</span>}</div>
        <div className="bd grid">
          <p className="muted" style={{ margin: 0 }}>Es la fuente de la mitad "presencia policial" de la omnipresencia: unidades en el mapa y personas por policía. Sin ella, el caso solo alerta por aglomeración y se muestran los policías planificados de cada evento.</p>
          <label className="toggle"><input type="checkbox" checked={on} onChange={(e) => setPoliceSource(e.target.checked, user)} />Usar la fuente de ubicación (demo: simula tener o no acceso)</label>
          <dl className="details" style={{ maxWidth: 480 }}>
            <dt>Unidades reportando</dt><dd className="mono">{units.length - stale.length - unknown.length}</dd>
            <dt>"En la zona" si está a menos de</dt><dd>200 m durante 5 min <span className="chip media" style={{ height: 18, fontSize: 10 }}>Supuesto</span></dd>
          </dl>
        </div>
      </section>
      {unknown.map((u) => <div key={u.id} className="callout warn"><Icon name="warning" /><span className="grow"><b>Unidad sin identificar.</b> Una posición llega sin identificador oficial; se muestra como desconocida hasta que se asocie.</span></div>)}
      {stale.map((u) => <div key={u.id} className="callout"><Icon name="schedule" /><span className="grow"><b className="mono">{u.id}</b> sin reportar {ago(u.lastReportAt, now)}: se muestra atenuada y no cuenta en el índice.</span></div>)}
      <p className="dim" style={{ fontSize: 12, margin: 0 }}>Las posiciones de las unidades solo se usan para el despliegue, no para evaluar al personal.</p>
    </div>
  );
}

export function Users() {
  const { user } = useSession();
  const users = useApi((s) => s.users);
  return (
    <div className="grid">
      <div className="panel flush tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Usuario</th><th>Rol (Keycloak)</th><th>Territorio</th><th>Activo</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}<div className="dim mono" style={{ fontSize: 11 }}>{u.id}</div></td>
                <td>{ROLE_LABEL[u.role]} <span className="dim mono" style={{ fontSize: 11 }}>{u.role}</span></td>
                <td>{u.territory}</td>
                <td><label className="toggle"><input type="checkbox" checked={u.active} disabled={u.id === user.id} onChange={(e) => setUserActive(u.id, e.target.checked, user)} /><span className="sr">Activo</span></label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="callout"><Icon name="info" /><span className="grow">Altas, contraseñas y roles se gestionan en Keycloak. Aquí se asignan territorios y se activan o desactivan accesos.</span></div>
    </div>
  );
}
