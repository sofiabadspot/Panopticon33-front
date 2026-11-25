/* Panóptico 33 · consola.
   Tres columnas fijas de borde a borde, todas de la misma altura:
   - izquierda: pestañas con nombre según el rol y la lista de la tarea;
   - centro: el mapa, con una franja de capas debajo;
   - derecha: el detalle de lo abierto (alerta, zona, evento, cámara, Jules…).
     Sin nada abierto, el mapa ocupa ese espacio.
   Abrir algo nunca cambia de pantalla: el mapa se mueve hacia ello. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SCENARIO_LABEL, SECTOR, eventStatus, forOperator, sessionFor, setScenario, useApi, type Scenario } from '../api';
import { useFacial } from '../api/facial';
import { dateTime, hhmm, hhmmss } from '../api/format';
import { KIND_LABEL, KIND_PHRASE } from '../api/labels';
import { nearZone } from '../api/place';
import { ROLE_LABEL } from '../api/labels';
import type { LngLat, Role } from '../api/types';
import type { GoogleBase } from '../map/google';
import { AlertMark, AlertTile, CameraNode, UnitHex } from '../map/icons';
import { coverageAt } from '../api/coverage';
import { MapView, type MapLayers } from '../map/MapView';
import type { HexMetric } from '../api/coverage';
import { useSession } from '../shell/session';
import { Icon, useNow, PanelSkeleton, SheetSkeleton } from '../ui/kit';
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
import { InvestigationDock } from './InvestigationDock';

/** Iniciales para el avatar (solo palabras con mayúscula: sin títulos como "Cmdte."). */
const initials = (name: string) => name.split(' ').filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w) && !/\.$/.test(w)).slice(0, 2).map((w) => w[0]).join('');

/** En modo histórico las zonas no muestran la medición en vivo. */
const NO_STATUS = {};

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
  const loading = useApi((s) => s.loading);
  const scenario = useApi((s) => s.scenario);
  const policeSource = useApi((s) => s.policeSource);
  const investigations = useApi((s) => s.investigations);
  /* Analista con una investigación abierta: el mapa pasa a modo histórico. Muestra solo las alertas de la
     ventana del hecho; el calor de personas y las unidades son en vivo, así que se apagan. */
  const inv = role === 'analyst' && c.invId ? investigations.find((x) => x.id === c.invId) ?? null : null;
  const facial = useFacial();
  const sevOf = useZoneSeverity(alerts);

  const [layers, setLayers] = useState<MapLayers>({ zones: true, events: true, alerts: true, units: false, cameras: role === 'admin' || role === 'analyst', fov: false, hex: 'personas' });
  /** Última lectura elegida para los hexágonos: al volver a prenderlos, vuelven con esa. */
  const [hexPick, setHexPick] = useState<HexMetric>('personas');
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
  // Indicador de pestaña: se mueve (no salta) a la pestaña activa.
  const tabsRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = tabsRef.current; if (!nav) return undefined;
    const place = () => { const b = nav.querySelector<HTMLElement>(`[data-tab="${c.panel}"]`); if (!b) return; nav.style.setProperty('--ti-x', `${b.offsetLeft}px`); nav.style.setProperty('--ti-w', `${b.offsetWidth}px`); };
    place(); const ro = new ResizeObserver(place); ro.observe(nav); return () => ro.disconnect();
  }, [c.panel, role]);
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
  // Zona → evento en curso que la incluye (un evento puede abarcar varias zonas)
  const eventOf = useMemo(() => {
    const live = events.filter((e) => eventStatus(e, now) === 'en_curso');
    return (zoneId: string) => { const e = live.find((x) => x.zoneIds.includes(zoneId)); return e ? { name: e.name, end: e.end } : null; };
  }, [events, Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Al cerrar una ficha de detalle, el mapa se aleja un poco: se suelta el foco y vuelve el contexto.
  const prevSheet = useRef(c.sheet);
  const [backOut, setBackOut] = useState('');
  useEffect(() => {
    const was = prevSheet.current; prevSheet.current = c.sheet;
    if (was && !c.sheet && ['alerta', 'zona', 'evento', 'camara', 'vehiculo', 'facial'].includes(was.k)) setBackOut(String(Date.now()));
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
  // En el mapa, las alertas abiertas: las que esperan decisión y las confirmadas que Maic todavía gestiona
  // (se ven con "Unidad en camino" hasta que llega). Las descartadas y las cerradas en Maic no se dibujan.
  // La alerta abierta en el lateral se ve siempre, aunque ya esté resuelta.
  const openAlertId = c.sheet?.k === 'alerta' ? c.sheet.id : null;
  const mapAlerts = inv
    ? alerts.filter((a) => (forOperator(a) && a.createdAt >= inv.from && a.createdAt <= inv.to) || a.id === openAlertId)
    : alerts.filter((a) => openAlerts.includes(a) || a.id === openAlertId);
  const pending = openAlerts.filter((a) => a.review === 'por_revisar').length;
  const badge = (id: string) => (id === 'alertas' ? pending : id === 'verificacion' ? facial.filter((m) => m.status === 'por_revisar').length : 0);

  const measure = useMemo(() => (measuring && measureAt ? { p: measureAt, ...coverageAt(measureAt, radius, policeSource ? units : null) } : null), [measuring, measureAt, radius, units, policeSource]);
  useEffect(() => { if (!measuring) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMeasuring(false); setMeasureAt(null); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [measuring]);
  /* Capas del mapa. Cada chip lleva el MISMO ícono que ese elemento tiene en el mapa, así el chip es a la vez
     el filtro y la referencia (no hay leyenda aparte). */
  const LAYER_ICON: Record<string, ReactNode> = {
    zones: <svg className="li-zone" viewBox="0 0 20 20" aria-hidden><path d="M3 7l6-4 8 3-1 9-9 2z" /></svg>,
    // Eventos: la misma bandera que lleva el rótulo del evento en el mapa
    events: <Icon name="flag" className="li-event" />,
    alerts: <AlertMark kind="placa_en_lista" size={18} still />,
    units: <UnitHex type="Patrulla" size={18} />,
  };
  /* Hexágonos: una sola capa con tres lecturas. El ícono del chip es la escala de lo que se ve:
     amarillo → rojo para personas y alertas, verde → amarillo → rojo para cobertura. */
  const hexIcon = (m: HexMetric) => (
    <svg className={`li-hex ${m === 'cobertura' ? 'cov' : 'dens'}`} viewBox="0 0 30 20" aria-hidden>
      <path className={m === 'cobertura' ? 'ok' : 'lo'} d="M6 3l5 2.9v5.8L6 14.6 1 11.7V5.9z" /><path className={m === 'cobertura' ? 'near' : 'mid'} d="M15 8.4l5 2.9v5.8l-5 2.9-5-2.9v-5.8z" /><path className={m === 'cobertura' ? 'no' : 'hi'} d="M24 3l5 2.9v5.8l-5 2.9-5-2.9V5.9z" />
    </svg>
  );
  const HEX_OPTS: [HexMetric, string, string][] = [
    ['personas', 'Personas', 'Dónde hay gente: amarillo poca, rojo mucha'],
    ['cobertura', 'Cobertura', 'Cuánto tarda en llegar la unidad más cercana: verde 2 min o menos, amarillo hasta 4 min, rojo más de 4 min'],
    ['alertas', 'Alertas', 'Dónde se concentran las alertas abiertas, según su criticidad: amarillo poca, rojo mucha'],
  ];
  /* En histórico solo hay alertas de la ventana del hecho; personas y cobertura son en vivo. */
  const hexOff = (m: HexMetric) => (!!inv && m !== 'alertas') || (m === 'cobertura' && !policeSource);
  const hexTitle = (m: HexMetric) => (inv && m !== 'alertas' ? 'En vivo: no se muestra en modo histórico' : 'Sin acceso a la ubicación policial');
  type ChipKey = 'zones' | 'events' | 'alerts' | 'units';
  const chips: [ChipKey, string, string, boolean?][] = [
    ['zones', 'Zonas', 'Nombre y conteo de los lugares vigilados'],
    ['events', 'Eventos', 'Eventos en curso: el área que abarcan y su nombre'],
    ['alerts', 'Alertas', inv ? 'Alertas de la ventana del hecho' : 'Alertas que esperan una decisión'],
    ['units', 'Unidades', inv ? 'En vivo: no se muestra en modo histórico' : 'Unidades policiales (MAIC)', !policeSource || !!inv],
    // Cámaras y su campo de visión van juntos: ver el grupo más abajo
  ];
  const chipOn = (k: ChipKey) => layers[k];
  const toggleChip = (k: ChipKey) => setLayers((l) => ({ ...l, [k]: !l[k] }));

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
              // Escenario de la consola: para revisar cada estado de la interfaz (vacía, cargando, sin Maic…)
              ...(Object.keys(SCENARIO_LABEL) as Scenario[]).map((sc, i) => ({
                label: SCENARIO_LABEL[sc], detalle: i === 0 ? 'Escenario' : undefined, marcado: sc === scenario, separado: i === 0,
                onSelect: () => setScenario(sc),
              })),
              { label: 'Cerrar sesión', icono: <Icon name="logout" />, separado: true, onSelect: signOut },
            ]}
          />
        </div>
      </header>

      <aside className="lcol" aria-label="Lista">
        <nav className="ltabs" role="tablist" aria-label="Tareas" ref={tabsRef}>
          {/* Indicador que se desliza a la pestaña activa (posición medida abajo, en tabsRef). */}
          <span className="ti" aria-hidden />
          {TOOLS[role].map((t) => (
            <button key={t.id} data-tab={t.id} role="tab" aria-selected={c.panel === t.id} className={c.panel === t.id ? 'on' : ''} onClick={() => c.setPanel(t.id)}>
              {t.label}
              {!loading && badge(t.id) > 0 && <span key={t.id === 'alertas' ? `n${pending}` : t.id} className={`count ${t.id === 'alertas' && c.fresh.length ? 'beat' : ''}`}>{badge(t.id)}</span>}
              {t.phase && <small>{t.phase}</small>}
            </button>
          ))}
        </nav>
        {/* key: cada cambio de pestaña vuelve a montar el contenedor y dispara su entrada. */}
        <div key={c.panel} className="panel-swap">
          {/* Mientras llegan los datos, cada panel muestra su forma en gris (no ceros ni listas vacías) */}
          {loading ? <PanelSkeleton kind={c.panel === 'estado' ? 'estado' : c.panel === 'alertas' || c.panel === 'verificacion' ? 'imagenes' : 'lista'} /> : <>
          {c.panel === 'estado' && <StatusPanel />}
          {c.panel === 'alertas' && <QueuePanel />}
          {c.panel === 'investigar' && <InvestigatePanel />}
          {c.panel === 'eventos' && <EventsPanel />}
          {c.panel === 'config' && <ConfigNav />}
          {c.panel === 'bitacora' && <AuditNav />}
          {c.panel === 'verificacion' && <FacialPanel />}
          </>}
        </div>
      </aside>

      <section className="mcol" aria-label="Mapa">
        <div className="mapwrap">
          <MapView
            zones={zones} zoneStatus={inv ? NO_STATUS : loading ? undefined : status} cameras={cameras} units={policeSource && !inv ? units : null} alerts={mapAlerts}
            layers={{ ...layers, hex: layers.hex && !hexOff(layers.hex) ? layers.hex : null, units: layers.units && policeSource && !inv }} severityOf={sevOf} eventOf={inv ? undefined : eventOf} selectedZone={selectedZone} focusSel={mapFocus} hoverAlert={c.hoverAlert} onAlertHover={c.setHoverAlert} freshAlerts={c.fresh}
            highlightZones={c.overlay.highlightZones} route={c.overlay.route} routeLabel={c.overlay.routeLabel} sketch={c.overlay.sketch} pin={c.pin} signal={c.signal}
            bounds={boundsOf(fit.points, 0.0008)} fitKey={fit.key} backOutKey={backOut} padding={{ top: 24, right: 24, bottom: 24, left: 24 }}
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
          {focusSel && !loading && !c.overlay.route && !c.overlay.onMapClick && (
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
          {/* Estado de los datos: cargando, o Maic sin conexión (las confirmaciones quedan en cola) */}
          {!inv && loading && <div className="map-state" role="status"><i className="spin" aria-hidden /><span><b>Cargando datos</b> · cámaras, zonas y unidades</span></div>}
          {!inv && !loading && !maic.connected && <div className={`map-state warn ${focusSel && !c.overlay.route ? 'below' : ''}`} role="alert"><Icon name="warning" /><span><b>Sin conexión con Maic</b> desde las {hhmm(maic.lastMessageAt)} · las confirmaciones quedan en cola</span></div>}
          {inv && <div className="hist-pill" role="status"><Icon name="history" /><span>Histórico · <b>{dateTime(inv.from)} → {hhmm(inv.to)}</b>{c.invPick ? ' · haz clic en el mapa para mover el lugar' : ' · solo lo que pasó en esa ventana'}</span></div>}
          {c.overlay.onMapClick && !inv && role !== 'analyst' && <div className="chip" style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)', zIndex: 6, background: 'var(--surface-panel)' }}><Icon name="edit_note" />Haz clic en el mapa para marcar vértices</div>}
        </div>
        {/* Tocar cualquier capa con una ficha abierta suelta el foco: así la capa se ve al instante. */}
        <div className="mstrip" role="group" aria-label="Capas del mapa" onClickCapture={() => { if (focusSel && !unfocus) setUnfocus(true); }}>
          {/* Hexágonos + qué muestran: un solo control, como Cámaras + Visión. Las lecturas aparecen pegadas
              cuando están prendidos y se elige una por vez. Solo texto: el ícono (la escala de la lectura
              elegida) va una vez, en el chip Hexágonos. */}
          <div className={`lchip-group ${layers.hex ? 'on' : ''}`} role="group" aria-label="Hexágonos">
            <button className={`lchip ${layers.hex && !hexOff(layers.hex) ? 'on' : ''}`} aria-pressed={!!layers.hex && !hexOff(layers.hex)}
              title="Hexágonos sobre todo el mapa" onClick={() => setLayers((l) => ({ ...l, hex: l.hex && !hexOff(l.hex) ? null : !hexOff(hexPick) ? hexPick : inv ? 'alertas' : 'personas' }))}>
              {hexIcon(layers.hex && !hexOff(layers.hex) ? layers.hex : hexPick)}Hexágonos
            </button>
            {layers.hex && !hexOff(layers.hex) && HEX_OPTS.map(([m, label, help]) => (
              <button key={m} className={`lchip sub ${layers.hex === m ? 'on' : ''}`} aria-pressed={layers.hex === m} disabled={hexOff(m)}
                title={hexOff(m) ? hexTitle(m) : help} onClick={() => { setHexPick(m); setLayers((l) => ({ ...l, hex: m })); }}>
                {label}
              </button>
            ))}
          </div>
          {chips.map(([k, label, icon, disabled]) => (
            <button key={k} className={`lchip ${chipOn(k) && !disabled ? 'on' : ''}`} aria-pressed={!!chipOn(k) && !disabled} disabled={disabled}
              title={disabled && !inv ? 'Sin acceso a la ubicación policial' : icon} onClick={() => toggleChip(k)}>
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
          <div key={sheetKey} className="sheet-swap">
          {loading && !['config', 'bitacora', 'jules', 'evento-form'].includes(c.sheet.k) ? <SheetSkeleton /> : <>
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
          </>}
          </div>
        </aside>
      )}
      {/* Fila propia: la línea de tiempo ocupa el ancho del mapa y de la ficha */}
      {inv && <InvestigationDock key={inv.id} id={inv.id} />}
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
