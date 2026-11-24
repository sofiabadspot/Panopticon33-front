/* Panóptico 33 · consola.
   Tres columnas fijas de borde a borde, todas de la misma altura:
   - izquierda: pestañas con nombre según el rol y la lista de la tarea;
   - centro: el mapa, con una franja de capas debajo;
   - derecha: el detalle de lo abierto (alerta, zona, evento, cámara, Jules…).
     Sin nada abierto, el mapa ocupa ese espacio.
   Abrir algo nunca cambia de pantalla: el mapa se mueve hacia ello. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SECTOR, forOperator, sessionFor, useApi } from '../api';
import { useFacial } from '../api/facial';
import { hhmm, hhmmss } from '../api/format';
import { KIND_LABEL, KIND_PHRASE } from '../api/labels';
import { nearZone } from '../api/place';
import { ROLE_LABEL } from '../api/labels';
import type { LngLat, Role } from '../api/types';
import type { GoogleBase } from '../map/google';
import { AlertMark, AlertTile, CameraNode, UnitHex } from '../map/icons';
import { coverageAt } from '../api/coverage';
import { MapView, type MapLayers } from '../map/MapView';
import { useSession } from '../shell/session';
import { Icon, useNow } from '../ui/kit';
import { P33Logo } from '../ui/Logo';
import { Menu } from '../jules/ds/Menu';
import { boundsOf, useZoneSeverity } from '../views/shared';
import { ConsoleProvider, TOOLS, useConsole } from './ctx';
import { Search } from './Search';
import { VideoWall } from './VideoWall';
import { StatusPanel } from './panels/StatusPanel';
import { QueuePanel } from './panels/QueuePanel';
import { InvestigatePanel } from './panels/InvestigatePanel';
import { EventsPanel } from './panels/EventsPanel';
import { AuditNav, ConfigNav } from './panels/AdminPanels';
import { AlertSheet } from './sheets/AlertSheet';
import { ZoneSheet } from './sheets/ZoneSheet';
import { EventSheet, EventFormSheet } from './sheets/EventSheet';
import { CameraSheet } from './sheets/CameraSheet';
import { ConfigSheet } from './sheets/ConfigSheet';
import { AuditSheet } from './sheets/AuditSheet';
import { JulesSheet } from './sheets/JulesSheet';
import { FacialPanel, FacialSheet } from './sheets/FacialSheet';
import { VehicleSheet } from './sheets/VehicleSheet';

/** Iniciales para el avatar (solo palabras con mayúscula: sin títulos como "Cmdte."). */
const initials = (name: string) => name.split(' ').filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w) && !/\.$/.test(w)).slice(0, 2).map((w) => w[0]).join('');

export function Console() {
  const { role } = useSession();
  return <ConsoleProvider key={role} role={role}><Layout /></ConsoleProvider>;
}

function Layout() {
  const { user, role, setRole, signOut } = useSession();
  const c = useConsole();
  const navigate = useNavigate();
  const now = useNow();
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const cameras = useApi((s) => s.cameras);
  const units = useApi((s) => s.units);
  const alerts = useApi((s) => s.alerts);
  const events = useApi((s) => s.events);
  const maic = useApi((s) => s.maic);
  const policeSource = useApi((s) => s.policeSource);
  const facial = useFacial();
  const sevOf = useZoneSeverity(alerts);

  const [layers, setLayers] = useState<MapLayers>({ heat: true, zones: true, alerts: true, units: false, cameras: role === 'admin' || role === 'analyst', fov: false, hex: null, cover: false });
  /* Medir cobertura alrededor de un punto: se activa, se hace clic en el mapa y se ve el radio,
     las unidades dentro y cuánto tardaría en llegar cada una. */
  const [wallOpen, setWallOpen] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureAt, setMeasureAt] = useState<LngLat | null>(null);
  const [radius, setRadius] = useState(500);
  const [base, setBase] = useState<GoogleBase>('mapa');
  const [baseStatus, setBaseStatus] = useState<'google' | 'local' | null>(null);
  const [pointer, setPointer] = useState<LngLat | null>(null);

  const wide = c.sheet?.k === 'config' || c.sheet?.k === 'bitacora';
  // Configuración (admin) y bitácora (auditor) son tablas y formularios: el mapa no suma nada ahí
  // y repetía lo mismo que la lista. Con esas fichas abiertas, la ficha ocupa el lugar del mapa
  // (el mapa queda montado pero oculto, para volver a Estado o Eventos sin recargarlo).
  const noMap = wide;
  // Mando: Jules vive en el lateral derecho cuando no hay otra ficha abierta.
  const julesDock = role === 'command' && !c.sheet;
  // Jules minimizado (franja de 64 px) o con el ancho que eligió la persona arrastrando su borde.
  const julesW = c.jules.minimizado && !c.jules.maximizado ? '64px' : c.jules.ancho ? `${c.jules.ancho}px` : null;
  const rw = c.sheet ? (wide ? 'min(860px, 52vw)' : c.sheet.k === 'jules' && julesW ? julesW : c.sheet.k === 'alerta' ? '500px' : '440px') : julesDock ? julesW ?? '400px' : '0px';

  // Encuadre: al abrir una ficha el mapa va hacia lo abierto; al inicio, al sector.
  const sectorPts = useMemo(() => zones.flatMap((z) => z.ring).concat(cameras.map((x) => [x.lon, x.lat] as LngLat)), [zones, cameras]);
  const [fit, setFit] = useState<{ points: LngLat[]; key: string }>({ points: sectorPts, key: 'sector' });
  const sheetKey = c.sheet ? JSON.stringify(c.sheet) : '';
  useEffect(() => {
    const s = c.sheet; if (!s) return;
    const around = (lon: number, lat: number, d = 0.0025): LngLat[] => [[lon - d, lat - d * 0.7], [lon + d, lat + d * 0.7]];
    if (s.k === 'zona') { const z = zones.find((q) => q.id === s.id); if (z) setFit({ points: z.ring, key: sheetKey }); }
    if (s.k === 'alerta') { const a = alerts.find((q) => q.id === s.id); if (a) { const z = zones.find((q) => q.id === a.zoneId); // Placa leída afuera de toda zona: el encuadre incluye la zona más cercana, que es su referencia
      const near = !z ? nearZone([a.lon, a.lat], zones) : null;
      setFit({ points: z && a.kind !== 'placa_en_lista' ? z.ring : near ? [...near.zone.ring, ...around(a.lon, a.lat)] : around(a.lon, a.lat), key: sheetKey }); } }
    if (s.k === 'evento') { const e = events.find((q) => q.id === s.id); if (e) setFit({ points: zones.filter((z) => e.zoneIds.includes(z.id)).flatMap((z) => z.ring), key: sheetKey }); }
    if (s.k === 'camara') { const x = cameras.find((q) => q.id === s.id); if (x) setFit({ points: around(x.lon, x.lat, 0.002), key: sheetKey }); }
  }, [sheetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (c.fitReq) setFit(c.fitReq); }, [c.fitReq]);
  useEffect(() => { if (c.overlay.fit) setFit(c.overlay.fit); }, [c.overlay.fit?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedZone = c.sheet?.k === 'zona' ? c.sheet.id : null;
  // Lo que está abierto en el lateral: en el mapa se destaca y el resto queda atenuado.
  const focusSel = c.sheet && (c.sheet.k === 'alerta' || c.sheet.k === 'zona' || c.sheet.k === 'camara') ? { k: c.sheet.k, id: c.sheet.id } : null;
  /* Con una ficha abierta el mapa atenúa lo demás. Si la persona toca una capa (o "Ver todo"),
     el foco se suelta solo: la ficha sigue abierta, pero el mapa vuelve a mostrar todo.
     Al abrir otra ficha, el foco vuelve. */
  const [unfocus, setUnfocus] = useState(false);
  useEffect(() => { setUnfocus(false); }, [sheetKey]);
  const mapFocus = unfocus ? null : focusSel;
  const focusLabel = !focusSel ? '' : focusSel.k === 'zona' ? zones.find((z) => z.id === focusSel.id)?.name ?? focusSel.id
    : focusSel.k === 'camara' ? `cámara ${focusSel.id}`
    : (() => { const al = alerts.find((x) => x.id === focusSel.id); return al ? `${KIND_LABEL[al.kind].toLowerCase()}${al.plate ? ` ${al.plate.listed}` : ''}` : focusSel.id; })();
  const openAlerts = alerts.filter((a) => forOperator(a) && (a.review === 'por_revisar' || (a.review === 'confirmada' && a.maic !== 'cerrada')));
  // En el mapa solo las alertas que esperan una decisión (las enviadas a Maic o descartadas ya están resueltas).
  // Las mismas que la bandeja "Por revisar": cada alerta de la lista tiene su marca en el mapa.
  // La alerta abierta en el lateral se ve siempre, aunque ya esté resuelta (las demás, solo si esperan decisión).
  const openAlertId = c.sheet?.k === 'alerta' ? c.sheet.id : null;
  const mapAlerts = alerts.filter((a) => (forOperator(a) && a.review === 'por_revisar') || a.id === openAlertId);
  const pending = openAlerts.filter((a) => a.review === 'por_revisar').length;
  const badge = (id: string) => (id === 'alertas' ? pending : id === 'verificacion' ? facial.filter((m) => m.status === 'por_revisar').length : 0);

  const measure = useMemo(() => (measuring && measureAt ? { p: measureAt, ...coverageAt(measureAt, radius, policeSource ? units : null) } : null), [measuring, measureAt, radius, units, policeSource]);
  useEffect(() => { if (!measuring) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMeasuring(false); setMeasureAt(null); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [measuring]);
  /* Capas del mapa. Cada chip lleva el MISMO ícono que ese elemento tiene en el mapa, así el chip es a la vez
     el filtro y la referencia (no hay leyenda aparte). */
  const LAYER_ICON: Record<string, ReactNode> = {
    // Personas: mapa de calor, de gris (poca gente) a rojo (mucha)
    people: <span className="li-heat" aria-hidden />,
    zones: <svg className="li-zone" viewBox="0 0 20 20" aria-hidden><path d="M3 7l6-4 8 3-1 9-9 2z" /></svg>,
    alerts: <AlertMark kind="placa_en_lista" size={18} still />,
    units: <UnitHex type="Patrulla" size={18} />,
    // Cobertura: hexágonos verde, amarillo y rojo, igual que en el mapa
    cover: <svg className="li-hex cov" viewBox="0 0 30 20" aria-hidden><path className="ok" d="M6 3l5 2.9v5.8L6 14.6 1 11.7V5.9z" /><path className="near" d="M15 8.4l5 2.9v5.8l-5 2.9-5-2.9v-5.8z" /><path className="no" d="M24 3l5 2.9v5.8l-5 2.9-5-2.9V5.9z" /></svg>,
  };
  type ChipKey = 'people' | 'zones' | 'alerts' | 'units' | 'cover';
  const chips: [ChipKey, string, string, boolean?][] = [
    ['people', 'Personas', 'Mapa de calor: dónde hay gente, de gris (poca) a rojo (mucha)'],
    ['zones', 'Zonas', 'Lugares vigilados. En rojo si tienen una alerta esperando decisión. Contorno punteado: sin cámaras que midan'],
    ['alerts', 'Alertas', 'Alertas que esperan una decisión'],
    ['units', 'Unidades', 'Unidades policiales (MAIC)', !policeSource],
    // Cámaras y su campo de visión van juntos: ver el grupo más abajo
    ['cover', 'Cobertura', 'Cuánto tarda en llegar la unidad más cercana: verde 2 min o menos, amarillo hasta 4 min, rojo más de 4 min', !policeSource],
  ];
  const chipOn = (k: ChipKey) => (k === 'people' ? layers.heat : layers[k]);
  const toggleChip = (k: ChipKey) => setLayers((l) => (k === 'people' ? { ...l, heat: !l.heat } : { ...l, [k]: !l[k] }));

  // ESC vuelve al mapa: cierra el detalle abierto en el lateral
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement).closest('input, select, textarea, [role="dialog"]')) return;
      // Se decide al terminar el evento: si la ficha usó el ESC (p. ej. cancelar un descarte), no se cierra.
      queueMicrotask(() => { if (!e.defaultPrevented && c.sheet) c.close(); });
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [c]);

  return (
    <div className={`console ${noMap ? 'no-map' : ''}`} style={{ '--rw': rw } as CSSProperties}>
      <header className="cbar">
        <div className="brand"><P33Logo size={17} /></div>
        <Search />
        {/* Muro de video: flujo aparte, junto al buscador */}
        <button className={`btn secondary sm wall-btn ${wallOpen ? 'on' : ''}`} aria-pressed={wallOpen} onClick={() => setWallOpen((w) => !w)} title="Muro de video: todas las cámaras"><Icon name="grid_view" />Muro de video</button>
        <div className="right">
          <span className={`chip ${maic.connected ? 'ok' : 'critica'}`} title={`Maic ${maic.mode} · último mensaje ${hhmmss(maic.lastMessageAt)}`}><span className="dot" aria-hidden />Maic</span>
          <button className={`iconbtn sound ${c.sound ? 'on' : ''}`} onClick={() => c.setSound(!c.sound)} aria-pressed={c.sound} aria-label={c.sound ? 'Silenciar avisos' : 'Activar sonido de avisos'} title={c.sound ? 'Sonido de alertas nuevas: activado' : 'Sonido de alertas nuevas: silenciado'}><Icon name={c.sound ? 'volume_up' : 'volume_off'} /></button>
          <span className="clock">{hhmmss(now)}</span>
          {/* Cuenta: quién tiene la sesión, los roles de la demostración y, al final, cerrar sesión.
              Menú del sistema de diseño (src/jules/ds/Menu.tsx), no el select del navegador. */}
          <Menu
            fijo align="end" label="Cuenta y rol" className="user-menu" triggerClassName="user"
            trigger={<>
              <span className="av" aria-hidden>{initials(user.name)}</span>
              <span className="user-role">{ROLE_LABEL[role]}</span>
              <svg className="user-caret" viewBox="0 0 16 16" aria-hidden><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </>}
            encabezado={<div className="user-head"><b>{user.name}</b><span>{user.territory}</span></div>}
            items={[
              ...(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
                label: ROLE_LABEL[r], detalle: sessionFor(r).user.name, marcado: r === role,
                onSelect: () => { if (r !== role) { setRole(r); navigate('/'); } },
              })),
              { label: 'Cerrar sesión', icono: <Icon name="logout" />, separado: true, onSelect: signOut },
            ]}
          />
        </div>
      </header>

      <aside className="lcol" aria-label="Lista">
        <nav className="ltabs" role="tablist" aria-label="Tareas">
          {TOOLS[role].map((t) => (
            <button key={t.id} role="tab" aria-selected={c.panel === t.id} className={c.panel === t.id ? 'on' : ''} onClick={() => c.setPanel(t.id)}>
              {t.label}
              {badge(t.id) > 0 && <span key={t.id === 'alertas' ? `n${pending}` : t.id} className={`count ${t.id === 'alertas' && c.fresh.length ? 'beat' : ''}`}>{badge(t.id)}</span>}
              {t.phase && <small>{t.phase}</small>}
            </button>
          ))}
        </nav>
        {c.panel === 'estado' && <StatusPanel />}
        {c.panel === 'alertas' && <QueuePanel />}
        {c.panel === 'investigar' && <InvestigatePanel />}
        {c.panel === 'eventos' && <EventsPanel />}
        {c.panel === 'config' && <ConfigNav />}
        {c.panel === 'bitacora' && <AuditNav />}
        {c.panel === 'verificacion' && <FacialPanel />}
      </aside>

      <section className="mcol" aria-label="Mapa">
        <div className="mapwrap">
          <MapView
            zones={zones} zoneStatus={status} cameras={cameras} units={policeSource ? units : null} alerts={mapAlerts}
            layers={{ ...layers, units: layers.units && policeSource }} severityOf={sevOf} selectedZone={selectedZone} focusSel={mapFocus} hoverAlert={c.hoverAlert} onAlertHover={c.setHoverAlert} freshAlerts={c.fresh}
            highlightZones={c.overlay.highlightZones} route={c.overlay.route} routeLabel={c.overlay.routeLabel} sketch={c.overlay.sketch} pin={c.pin} signal={c.signal}
            bounds={boundsOf(fit.points, 0.0008)} fitKey={fit.key} padding={{ top: 24, right: 24, bottom: 24, left: 24 }}
            base={base} onBaseStatus={setBaseStatus} onPointer={setPointer}
            region={{ lat: SECTOR.lat, lon: SECTOR.lon, title: SECTOR.name, sub: `${zones.length} zonas · ${cameras.length} cámaras`, onClick: () => setFit({ points: sectorPts, key: 'sector' + Date.now() }) }}
            onZoneClick={c.overlay.onZoneClick ?? ((id) => c.open({ k: 'zona', id }))}
            onAlertClick={(id) => c.open({ k: 'alerta', id })}
            onCameraClick={(id) => c.open({ k: 'camara', id })}
            onMapClick={measuring ? (p) => setMeasureAt(p) : c.overlay.onMapClick} onEmptyClick={() => { if (c.sheet) c.close(); }}
            measure={measure ? { p: measure.p, radius, cells: [], state: measure.state } : null}
          />
          <ArrivalBanner />
          {measuring && (
            <section className="measure-card" aria-live="polite">
              <div className="mc2-hd"><span className="mc2-lbl">¿Quién llega a este punto?</span><button className="iconbtn" onClick={() => { setMeasuring(false); setMeasureAt(null); }} aria-label="Cerrar medición"><Icon name="close" /></button></div>
              <div className="seg" role="group" aria-label="Radio"><span className="seg-lbl">Radio</span>{[250, 500, 1000].map((r) => <button key={r} className={radius === r ? 'on' : ''} onClick={() => setRadius(r)}>{r < 1000 ? `${r} m` : '1 km'}</button>)}</div>
              {!measure ? <p className="mc2-hint">Hacé clic en el mapa donde querés medir. Te muestro qué unidades policiales están dentro del radio y cuánto tardarían en llegar.</p> : (<>
                <p className={`mc2-state ${measure.state}`}><i />{measure.state === 'cubierta' ? `Cubierta: ${measure.within.length} ${measure.within.length === 1 ? 'unidad' : 'unidades'} en el radio` : measure.state === 'cerca' ? `Sin unidades en el radio; la más cercana llega en ${Math.round(measure.nearest!.eta)} min` : 'Sin cobertura: ninguna unidad llega en menos de 4 min'}</p>
                <ol className="mc2-list">
                  {(measure.within.length ? measure.within : measure.nearest ? [measure.nearest] : []).slice(0, 6).map((x) => (
                    <li key={x.unit.id}><UnitHex type={x.unit.type} size={20} /><span><b>{x.unit.id}</b><small>{x.unit.type} · {Math.round(x.dist)} m</small></span><span className="mc2-eta">{x.eta < 1 ? '<1' : Math.round(x.eta)} min</span></li>
                  ))}
                </ol>
              </>)}
            </section>
          )}
          <div className="hud-frame" aria-hidden>
            <i className="br tl" /><i className="br tr" /><i className="br bl" /><i className="br rb" />
            <div className="hud-coords mono">{pointer ? `${pointer[1].toFixed(5)}° N   ${Math.abs(pointer[0]).toFixed(5)}° O` : SECTOR.name.toUpperCase()}</div>
          </div>
          {/* Aviso del foco: dice por qué el resto del mapa está atenuado y deja volver a verlo todo. */}
          {focusSel && !c.overlay.route && !c.overlay.onMapClick && (
            <div className={`focus-pill ${unfocus ? 'off' : ''}`} role="status">
              {unfocus ? <>
                <span className="fp-txt">Mostrando todo · ficha de <b>{focusLabel}</b> abierta</span>
                <button className="fp-btn" onClick={() => setUnfocus(false)}><Icon name="center_focus_strong" />Enfocar</button>
              </> : <>
                <span className="fp-dot" aria-hidden />
                <span className="fp-txt">Enfocado en <b>{focusLabel}</b> · el resto del mapa está atenuado</span>
                <button className="fp-btn" onClick={() => setUnfocus(true)}><Icon name="visibility" />Ver todo</button>
                <button className="fp-x" onClick={c.close} aria-label="Cerrar la ficha" title="Cerrar la ficha (Esc)"><Icon name="close" /></button>
              </>}
            </div>
          )}
          {c.overlay.onMapClick && <div className="chip" style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)', zIndex: 6, background: 'var(--surface-panel)' }}><Icon name="edit_note" />Haz clic en el mapa para marcar vértices</div>}
        </div>
        {/* Tocar cualquier capa con una ficha abierta suelta el foco: así la capa se ve al instante. */}
        <div className="mstrip" role="group" aria-label="Capas del mapa" onClickCapture={() => { if (focusSel && !unfocus) setUnfocus(true); }}>
          {chips.map(([k, label, icon, disabled]) => (
            <button key={k} className={`lchip ${chipOn(k) && !disabled ? 'on' : ''}`} aria-pressed={!!chipOn(k) && !disabled} disabled={disabled}
              title={disabled ? 'Sin acceso a la ubicación policial' : icon} onClick={() => toggleChip(k)}>
              {LAYER_ICON[k]}{label}
            </button>
          )).flatMap((el, i) => (i === 3 ? [el, (
            // Cámaras + Visión: un solo control. Visión es un filtro de Cámaras y aparece pegado cuando están prendidas.
            <div key="cams" className={`lchip-group ${layers.cameras ? 'on' : ''}`} role="group" aria-label="Cámaras">
              <button className={`lchip ${layers.cameras ? 'on' : ''}`} aria-pressed={layers.cameras} onClick={() => setLayers((l) => ({ ...l, cameras: !l.cameras, fov: l.cameras ? false : l.fov }))}>
                <CameraNode status="operativa" size={15} />Cámaras
              </button>
              {layers.cameras && (
                <button className={`lchip sub ${layers.fov ? 'on' : ''}`} aria-pressed={layers.fov} onClick={() => setLayers((l) => ({ ...l, fov: !l.fov }))} title="Mostrar el campo de visión de cada cámara (ángulo y alcance)">
                  <svg className="fov-ic" viewBox="0 0 20 20" aria-hidden><path d="M4 16L16.5 6.2A12 12 0 0 1 17.6 13.3Z" /><circle cx="4" cy="16" r="1.8" /></svg>Visión
                </button>
              )}
            </div>
          )] : [el]))}
          <span className="sep" />
          <button className={`lchip ${measuring ? 'on' : ''}`} aria-pressed={measuring} disabled={!policeSource}
            onClick={() => { setMeasuring((m) => !m); setMeasureAt(null); }}><Icon name="location_on" />¿Quién llega?</button>
          <span className="sep" />
          <div className="seg" role="group" aria-label="Base del mapa">
            <button className={base === 'mapa' ? 'on' : ''} onClick={() => setBase('mapa')}>Mapa</button>
            <button className={base === 'satelite' ? 'on' : ''} onClick={() => setBase('satelite')}>Satélite</button>
          </div>
          {baseStatus === 'local' && <span className="chip nodata" title="Sin clave de Google o sin conexión">Mapa local</span>}
        </div>
      </section>

      {julesDock && <aside className="rcol" aria-label="Jules"><JulesSheet docked /></aside>}
      {c.sheet && (
        <aside className="rcol" aria-label="Detalle">
          {c.sheet.k === 'alerta' && <AlertSheet key={c.sheet.id} id={c.sheet.id} />}
          {c.sheet.k === 'zona' && <ZoneSheet key={c.sheet.id} id={c.sheet.id} />}
          {c.sheet.k === 'evento' && <EventSheet key={c.sheet.id} id={c.sheet.id} />}
          {c.sheet.k === 'evento-form' && <EventFormSheet key={c.sheet.id ?? 'nuevo'} id={c.sheet.id} />}
          {c.sheet.k === 'camara' && <CameraSheet key={c.sheet.id} id={c.sheet.id} />}
          {c.sheet.k === 'config' && <ConfigSheet tab={c.sheet.tab} />}
          {c.sheet.k === 'bitacora' && <AuditSheet action={c.sheet.tab} />}
          {c.sheet.k === 'jules' && <JulesSheet />}
          {c.sheet.k === 'facial' && <FacialSheet key={c.sheet.id} id={c.sheet.id} />}
          {c.sheet.k === 'vehiculo' && <VehicleSheet key={c.sheet.id} id={c.sheet.id} />}
        </aside>
      )}
      {wallOpen && <VideoWall onClose={() => setWallOpen(false)} />}
    </div>
  );
}

/* Aviso de alerta nueva, arriba al centro del mapa. No mueve el mapa ni abre nada solo:
   el operador decide. "Ver" abre la ficha (y el mapa va hacia la alerta). Se va solo a los 10 s. */
function ArrivalBanner() {
  const c = useConsole();
  const alerts = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const cameras = useApi((s) => s.cameras);
  const a = c.arrival ? alerts.find((x) => x.id === c.arrival) : null;
  useEffect(() => { if (!c.arrival) return undefined; const t = setTimeout(c.dismissArrival, 10000); return () => clearTimeout(t); }, [c.arrival]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null;
  const where = zones.find((z) => z.id === a.zoneId)?.name ?? cameras.find((x) => x.id === a.cameraId)?.street ?? a.cameraId;
  return (
    <div className="arrival" role="alert" key={a.id}>
      <AlertTile kind={a.kind} size={34} />
      <div className="arrival-txt">
        <span className="arrival-lbl">Nueva alerta · {hhmm(a.createdAt)}</span>
        <b>{KIND_PHRASE[a.kind]}{a.plate && <span className="plate">{a.plate.listed}</span>}</b>
        <span className="arrival-where">{where}</span>
      </div>
      <button className="btn primary sm" onClick={() => c.open({ k: 'alerta', id: a.id })}>Ver</button>
      <button className="iconbtn" onClick={c.dismissArrival} aria-label="Cerrar aviso"><Icon name="close" /></button>
      <i className="arrival-timer" aria-hidden />
    </div>
  );
}
