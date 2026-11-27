/* Configuración · Acceso: quién ve qué. Primero se definen los roles (qué pestañas ve cada uno y en qué orden,
   qué capas del mapa, qué alertas le llegan y qué puede hacer con ellas, si tiene a Jules y si entra a
   Configuración); después cada usuario hereda lo de su rol. Altas, contraseñas y el rol de cada persona se
   gestionan en Keycloak. Un cambio en un rol se aplica al instante a quien esté conectado con ese rol. */
import { useState, type DragEvent, type FormEvent } from 'react';
import {
  createRole, deleteRole, roleName, roleProblems, saveRole, setUserActive, useApi,
} from '../../api';
import { SEVERITY_LABEL } from '../../api/labels';
import type { AlertAction, LayerAccess, LayerKey, RoleConfig, Severity, TabId } from '../../api/types';
import { useSession } from '../../shell/session';
import { EmptyState, Icon, useToast } from '../../ui/kit';
import { UnsavedGuard, useConsole } from '../ctx';
import { ALL_TABS, TAB_ICON, TAB_LABEL } from '../permissions';
import { ConfirmDelete, SectionHead } from './configPlace';
import { SheetHead, SheetNotFound } from './SheetHead';
import { Segmented } from '../../ui/Segmented';

const LAYERS: [LayerKey, string, string?][] = [
  ['alerts', 'Alertas'], ['events', 'Eventos'], ['zones', 'Zonas'], ['units', 'Unidades policiales', 'La ubicación de cada agente: no todos los roles deberían verla'],
  ['cameras', 'Cámaras'], ['hex', 'Mapa de calor'], ['drones', 'Drones'], ['helis', 'Helicópteros'],
];
const ACCESS: [LayerAccess, string][] = [['inicio', 'Al entrar'], ['disponible', 'Disponible'], ['oculta', 'Oculta']];

/* Gestión de alertas por niveles; por debajo se guarda la lista de acciones. */
type Level = 'ver' | 'decidir' | 'despachar' | 'personalizado';
const LEVELS: [Level, string, AlertAction[]][] = [
  ['ver', 'Solo ver', []],
  ['decidir', 'Decidir', ['decidir', 'decidir_facial']],
  ['despachar', 'Decidir y enviar unidades', ['decidir', 'decidir_facial', 'despachar', 'registrar']],
  ['personalizado', 'Personalizado', []],
];
const ACTIONS: [AlertAction, string, string][] = [
  ['decidir', 'Confirmar o descartar alertas', 'Con motivo cuando descarta'],
  ['decidir_facial', 'Confirmar o descartar coincidencias faciales', 'Si el rostro es el de la persona de la lista'],
  ['despachar', 'Enviar unidades', 'Elige cuántos policías van y cuáles'],
  ['registrar', 'Registrar incidentes', 'Marca en el mapa algo que pasó'],
];
const sameSet = (a: AlertAction[], b: AlertAction[]) => a.length === b.length && a.every((x) => b.includes(x));
const levelOf = (acts: AlertAction[]): Level => LEVELS.find(([k, , xs]) => k !== 'personalizado' && sameSet(xs, acts))?.[0] ?? 'personalizado';
const LEVEL_TEXT: Record<Level, string> = { ver: 'Solo ve las alertas', decidir: 'Decide alertas', despachar: 'Decide y envía unidades', personalizado: 'Gestión personalizada' };

/** Con qué abre la consola este rol, en palabras. */
const opensWith = (r: RoleConfig) => (r.tabs[0] ? TAB_LABEL[r.tabs[0]] : r.config ? 'Configuración' : '—');

/* ================= Lista de roles ================= */
export function RolesSection() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const configs = useApi((s) => s.roleConfigs);
  const users = useApi((s) => s.users);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', from: '' });
  const taken = configs.some((r) => r.name.trim().toLowerCase() === f.name.trim().toLowerCase());
  const ok = !!f.name.trim() && !taken;
  const create = (e: FormEvent) => {
    e.preventDefault(); if (!ok) return;
    const r = createRole(f.name, configs.find((x) => x.role === f.from) ?? null, user);
    toast(`Rol «${r.name}» creado. Revisa qué ve y qué puede hacer.`);
    setAdding(false); setF({ name: '', from: '' });
    c.open({ k: 'config', tab: 'roles', id: r.role });
  };
  return (
    <>
      <SectionHead group="Acceso" icon="shield" title="Roles" sub="Qué ve y qué puede hacer cada rol. Cada usuario hereda lo de su rol; un cambio se aplica al instante a quien esté conectado." />
      <div className="pb">
        {!adding ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary sm" onClick={() => setAdding(true)}><Icon name="add" />Nuevo rol</button>
          </div>
        ) : (
          <form className="box" onSubmit={create} noValidate><div className="bh"><h3>Nuevo rol</h3></div><div className="bb grid">
            <div className="field"><label htmlFor="rn">Nombre</label><input id="rn" className="fld sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Supervisor 911" aria-invalid={taken} autoFocus />
              {taken && <span className="err"><Icon name="error" />Ya hay un rol que se llama así.</span>}</div>
            <div className="field"><label htmlFor="rf">Empezar desde</label>
              <select id="rf" className="fld sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
                <option value="">Desde cero: solo Estado, sin acciones ni Jules</option>
                {configs.map((r) => <option key={r.role} value={r.role}>Copia de {r.name}</option>)}
              </select></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setF({ name: '', from: '' }); }}>Cancelar</button>
              <button type="submit" className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={!ok}>Crear rol</button>
            </div>
          </div></form>
        )}
        <div className="box flush">
          <ul className="list">
            {!configs.length && <li><EmptyState icon="shield" title="Todavía no hay roles">Crea el primero con Nuevo rol.</EmptyState></li>}
            {configs.map((r) => {
              const n = users.filter((u) => u.role === r.role).length;
              return (
                <li key={r.role}><button className="item" onClick={() => c.open({ k: 'config', tab: 'roles', id: r.role })}>
                  <span className="ic"><Icon name={r.config ? 'admin_panel_settings' : 'shield'} /></span>
                  <div><div className="t">{r.name}</div><div className="s">{r.description ? `${r.description} · ` : ''}Abre {opensWith(r)} · {LEVEL_TEXT[levelOf(r.actions)]}{r.jules ? ' · Jules' : ''}</div></div>
                  <div className="r"><span className="chip">{n} {n === 1 ? 'usuario' : 'usuarios'}</span></div>
                </button></li>
              );
            })}
          </ul>
        </div>
        <div className="callout"><Icon name="info" /><span className="grow">Qué rol tiene cada persona se decide en Keycloak. Aquí se define qué significa cada rol. Ver <button className="linklike" onClick={() => c.open({ k: 'config', tab: 'usuarios' })}>Usuarios</button>.</span></div>
      </div>
    </>
  );
}

/* ================= Editor de un rol ================= */
export function RoleDetail({ id }: { id: string }) {
  const { user, role: myRole } = useSession();
  const c = useConsole();
  const toast = useToast();
  const configs = useApi((s) => s.roleConfigs);
  const users = useApi((s) => s.users);
  const saved = configs.find((r) => r.role === id);
  const [d, setD] = useState<RoleConfig | null>(() => (saved ? structuredClone(saved) : null));
  const [custom, setCustom] = useState(() => !!saved && levelOf(saved.actions) === 'personalizado');
  const [del, setDel] = useState(false);
  const [drag, setDrag] = useState<TabId | null>(null);
  if (!saved || !d) return <SheetNotFound kicker="Rol" title="No encontrado" what="este rol" />;
  const set = (p: Partial<RoleConfig>) => setD({ ...d, ...p });
  const { errors, warnings } = roleProblems(d, configs, myRole);
  const dirty = JSON.stringify({ ...d, version: 0 }) !== JSON.stringify({ ...saved, version: 0 });
  const holders = users.filter((u) => u.role === id);
  const nameErr = errors.find((x) => x.startsWith('Ponle un nombre') || x.startsWith('Ya hay un rol'));
  const level: Level = custom ? 'personalizado' : levelOf(d.actions);

  /* Pestañas: las prendidas en su orden (se arrastran o se mueven con las flechas); las apagadas, abajo. */
  const off = ALL_TABS.filter((t) => !d.tabs.includes(t));
  const move = (t: TabId, to: number) => { const rest = d.tabs.filter((x) => x !== t); rest.splice(Math.max(0, Math.min(to, rest.length)), 0, t); set({ tabs: rest }); };
  const toggleTab = (t: TabId, on: boolean) => set({ tabs: on ? [...d.tabs, t] : d.tabs.filter((x) => x !== t) });
  const onDrop = (e: DragEvent, to: number) => { e.preventDefault(); if (drag) move(drag, to); setDrag(null); };

  const save = (e: FormEvent) => {
    e.preventDefault(); if (!dirty || errors.length) return;
    saveRole(d, user);
    toast(holders.length ? `${d.name.trim()}: guardado. Ya se aplica a ${holders.length} ${holders.length === 1 ? 'usuario' : 'usuarios'}.` : `${d.name.trim()}: guardado`);
  };
  const duplicate = () => {
    let name = `${saved.name} (copia)`, n = 2;
    while (configs.some((r) => r.name === name)) name = `${saved.name} (copia ${n++})`;
    const r = createRole(name, saved, user);
    toast(`Rol «${r.name}» creado`);
    c.open({ k: 'config', tab: 'roles', id: r.role });
  };

  return (
    <>
      <SheetHead kicker={<><span>Rol</span>·<span className="mono">{saved.role}</span></>} title={saved.name}
        sub={`${holders.length} ${holders.length === 1 ? 'usuario' : 'usuarios'} · abre ${opensWith(saved)}`}
        aside={<button type="button" className="btn ghost xs" onClick={duplicate}><Icon name="content_copy" />Duplicar</button>} />
      <form className="pb" id="role-form" onSubmit={save} noValidate>
        <div className="field"><label htmlFor="rdn">Nombre</label><input id="rdn" className="fld sm" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!nameErr} />
          {nameErr && <span className="err"><Icon name="error" />{nameErr}</span>}</div>
        <div className="field"><label htmlFor="rdd">Descripción</label><input id="rdd" className="fld sm" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="Decide las alertas de su territorio" /></div>
        {!saved.system && <div className="callout"><Icon name="key" /><span className="grow">Para darle este rol a alguien, crea en Keycloak el rol <b className="mono">{saved.role}</b> y asígnaselo.</span></div>}

        <div className="box flush">
          <div className="bh"><h3>Pestañas</h3><span className="sub">arrastra para ordenar · la primera se abre al entrar</span></div>
          <ul className="list bb role-tabs">
            {d.tabs.map((t, i) => (
              <li key={t} draggable onDragStart={() => setDrag(t)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, i)}
                className={`item ${drag === t ? 'dragging' : ''}`}>
                  <span className="ic grab" aria-hidden><Icon name="menu" /></span>
                  <div><div className="t"><Icon name={TAB_ICON[t]} />{TAB_LABEL[t]}</div>{i === 0 && <div className="s">Se abre al entrar</div>}</div>
                  <div className="r">
                    <button type="button" className="iconbtn" aria-label={`Subir ${TAB_LABEL[t]}`} title={`Subir ${TAB_LABEL[t]}`} disabled={i === 0} onClick={() => move(t, i - 1)}><Icon name="expand_less" /></button>
                    <button type="button" className="iconbtn" aria-label={`Bajar ${TAB_LABEL[t]}`} title={`Bajar ${TAB_LABEL[t]}`} disabled={i === d.tabs.length - 1} onClick={() => move(t, i + 1)}><Icon name="expand_more" /></button>
                    <label className="toggle"><input type="checkbox" checked onChange={() => toggleTab(t, false)} /><span className="sr">Ve {TAB_LABEL[t]}</span></label>
                  </div>
              </li>
            ))}
            {off.map((t) => (
              <li key={t} className="item off">
                <span className="ic" aria-hidden><Icon name={TAB_ICON[t]} /></span>
                <div><div className="t">{TAB_LABEL[t]}</div><div className="s">No la ve</div></div>
                <div className="r"><label className="toggle"><input type="checkbox" checked={false} onChange={() => toggleTab(t, true)} /><span className="sr">Ve {TAB_LABEL[t]}</span></label></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="box">
          <div className="bh"><h3>Configuración</h3></div>
          <div className="bb grid">
            <label className="toggle"><input type="checkbox" checked={d.config} onChange={(e) => set({ config: e.target.checked })} /><span>Entra a Configuración desde el menú de su usuario</span></label>
            <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>{d.tabs.length ? 'Entra a la consola por su primera pestaña y llega a Configuración desde el menú.' : 'Sin pestañas: la consola se abre directo en Configuración.'}</span>
          </div>
        </div>

        <div className="box flush">
          <div className="bh"><h3>Capas del mapa</h3></div>
          <div className="tbl-wrap bb">
            <table className="tbl">
              <tbody>
                {LAYERS.map(([k, label, help]) => (
                  <tr key={k}>
                    <td>{label}{help && <div className="dim" style={{ fontSize: 'var(--fs-xs)' }}>{help}</div>}</td>
                    <td className="r">
                      <select className="fld sm" aria-label={label} value={d.layers[k]} onChange={(e) => set({ layers: { ...d.layers, [k]: e.target.value as LayerAccess } })}>
                        {ACCESS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="details bb" style={{ fontSize: 'var(--fs-sm)' }}>
            <dt>Al entrar</dt><dd>Prendida cuando la persona abre la consola.</dd>
            <dt>Disponible</dt><dd>En la franja de capas, apagada. La prende si la necesita.</dd>
            <dt>Oculta</dt><dd>No la ve ni la puede prender.</dd>
          </dl>
        </div>

        <div className="box">
          <div className="bh"><h3>Alertas</h3></div>
          <div className="bb grid">
            <div className="field"><span className="lbl">Qué alertas le llegan</span>
              <Segmented label="Qué alertas le llegan" style={{ alignSelf: 'flex-start' }} value={d.alertScope} onChange={(alertScope) => set({ alertScope })}
                options={[{ value: 'todas', label: 'Todas' }, { value: 'territorio', label: 'Solo de su territorio' }]} /></div>
            <div className="field"><label htmlFor="rds">Desde qué criticidad</label>
              <select id="rds" className="fld sm" value={d.minSeverity ?? ''} onChange={(e) => set({ minSeverity: (e.target.value || null) as Severity | null })}>
                <option value="">Todas</option><option value="media">{SEVERITY_LABEL.media} o más</option><option value="critica">Solo {SEVERITY_LABEL.critica.toLowerCase()}s</option>
              </select></div>
            <div className="field"><span className="lbl">Qué puede hacer con una alerta</span>
              <Segmented label="Qué puede hacer con una alerta" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} value={level}
                onChange={(k) => { if (k === 'personalizado') setCustom(true); else { setCustom(false); set({ actions: LEVELS.find(([x]) => x === k)![2] }); } }}
                options={LEVELS.map(([k, label]) => ({ value: k, label }))} /></div>
            {level === 'personalizado' && ACTIONS.map(([a, label, help]) => (
              <label key={a} className="toggle"><input type="checkbox" checked={d.actions.includes(a)} onChange={(e) => set({ actions: e.target.checked ? [...d.actions, a] : d.actions.filter((x) => x !== a) })} />
                <span>{label} <span className="dim">· {help}</span></span></label>
            ))}
            {level !== 'personalizado' && <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>{level === 'ver' ? 'Ve las alertas y su evidencia, sin botones para decidir.' : `Puede: ${ACTIONS.filter(([a]) => d.actions.includes(a)).map(([, l]) => l.toLowerCase()).join(', ')}.`}</span>}
          </div>
        </div>

        <div className="box">
          <div className="bh"><h3>Jules</h3></div>
          <div className="bb grid">
            <label className="toggle"><input type="checkbox" checked={d.jules} onChange={(e) => set({ jules: e.target.checked })} /><span>Tiene a Jules en el lateral derecho</span></label>
            <span className="hint dim" style={{ fontSize: 'var(--fs-sm)' }}>Jules responde solo con lo que este rol puede ver y ofrece ir solo a lo que puede abrir.</span>
          </div>
        </div>

        {errors.filter((x) => x !== nameErr).map((x) => <span key={x} className="err"><Icon name="error" />{x}</span>)}
        {warnings.map((x) => <div key={x} className="callout warn"><Icon name="warning" /><span className="grow">{x}</span></div>)}

        {!saved.system && <div className="danger-zone">
          <button type="button" className="btn ghost danger sm" disabled={holders.length > 0} onClick={() => setDel(true)}><Icon name="remove" />Eliminar rol</button>
          {holders.length > 0 && <span className="dim">No se puede eliminar mientras {holders.length === 1 ? 'un usuario lo tenga' : `${holders.length} usuarios lo tengan`}. Cámbiales el rol en Keycloak primero.</span>}
        </div>}
      </form>
      <UnsavedGuard dirty={dirty} />
      <div className="pf"><button type="button" className="btn ghost sm" onClick={() => c.open({ k: 'config', tab: 'roles' })}>Volver a roles</button>
        {dirty && holders.length > 0 && <span className="dim" style={{ fontSize: 'var(--fs-sm)' }}>Se aplica al instante a {holders.length} {holders.length === 1 ? 'usuario' : 'usuarios'}</span>}
        <button type="submit" form="role-form" className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={!dirty || errors.length > 0}>Guardar cambios</button></div>
      {del && <ConfirmDelete title={`¿Eliminar el rol ${saved.name}?`} action="Eliminar rol" onClose={() => setDel(false)}
        onConfirm={() => { if (deleteRole(saved.role, user)) { toast('Rol eliminado'); c.open({ k: 'config', tab: 'roles' }); } setDel(false); }}>
        Nadie lo tiene asignado. Si alguien entra con este rol desde Keycloak, no va a poder usar la consola. Esto no se puede deshacer.
      </ConfirmDelete>}
    </>
  );
}

export function UsersSection() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const users = useApi((s) => s.users);
  /* Quitar el acceso saca a la persona de la consola: se confirma. Devolverlo es inmediato. */
  const [blocking, setBlocking] = useState<(typeof users)[number] | null>(null);
  return (
    <>
      <SectionHead group="Acceso" icon="person" title="Usuarios" sub="Quién tiene acceso a la consola. Lo que ve cada persona lo define su rol." />
      <div className="pb">
        <div className="panel flush tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Acceso</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.id === user.id && <span className="dim"> (tú)</span>}</td>
                  <td>{roleName(u.role)}</td>
                  <td><label className="toggle"><input type="checkbox" checked={u.active} disabled={u.id === user.id} onChange={(e) => { if (!e.target.checked) { setBlocking(u); return; } setUserActive(u.id, true, user); toast(`${u.name}: puede entrar`); }} /><span className="sr">Acceso: {u.name}</span></label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {blocking && <ConfirmDelete title={`¿Quitarle el acceso a ${blocking.name}?`} action="Quitar acceso" onClose={() => setBlocking(null)}
          onConfirm={() => { const u = blocking; setUserActive(u.id, false, user); setBlocking(null); toast(`${u.name}: ya no puede entrar`, { undo: () => setUserActive(u.id, true, user) }); }}>
          Ya no va a poder entrar a la consola. Si tiene una sesión abierta, se cierra.
        </ConfirmDelete>}
        <div className="callout"><Icon name="info" /><span className="grow">Para dar de alta a una persona, cambiar su contraseña o su rol, usa Keycloak. Lo que ve cada rol se define en <button className="linklike" onClick={() => c.open({ k: 'config', tab: 'roles' })}>Roles</button>.</span></div>
      </div>
    </>
  );
}
