/* Mapa 2D (MapLibre GL).
   Base: Google (Map Tiles API, roadmap oscuro o satélite) si hay clave y conexión;
   si no, la base local sin conexión: GeoJSON de Natural Earth y OpenStreetMap (ODbL)
   generados por scripts/sync-assets.mjs.
   Las capas operativas (calor, zonas, cámaras, unidades, alertas, recorridos) son propias.
   No se usan capas de texto (no hay servidor de glifos): los rótulos son marcadores HTML. */
import * as maplibregl from 'maplibre-gl';
import type { CanvasSource, GeoJSONSource, LngLatBoundsLike, Map as MLMap, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import geo from '../data/generated/geo.json';
import type { Alert, Camera, Evidence as Ev, LngLat, Unit, Zone, ZoneStatus } from '../api/types';
import { fmtCrowd, hhmm, inTime } from '../api/format';
import { Evidence, Icon } from '../ui/kit';
import { streetRoute } from './streets';
import { cellAt, cellsAtRes, HEX_TIERS, hexesInView, hexesOutline, zoneHexes, hexRing, hexSignature, type HexData, type HexMetric } from '../api/coverage';
import { drawHexLayer, makeHexLayer, unmeasured, type HexColors, type HexLayer } from './hexCanvas';
import { CAM_REACH, cone, MapCard, type GroupCat, type Hover } from './markers';
import { AirSprite, AlertMark, GroupChip, UnitHex } from './icons';
import { AIRCRAFT, airAt, airTrail } from '../api/aircraft';
import { SEVERITY_RANK } from '../api/labels';
import { waitingSince } from '../views/shared';

/** Confirmada con unidades en camino: se ve gestionada (gris con tick) y lo dice, hasta que llegan. */
const goingTo = (a: Alert) => a.review === 'confirmada' && a.dispatch === 'en_camino';
import { GOOGLE_LOGO, googleCopyright, googleSession, googleTiles, hasGoogleKey, type GoogleBase } from './google';
import { provideConsoleMap } from './handoff';
// El worker del mapa se empaqueta con la app (sin CDN). Vite lo emite como archivo propio.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(workerUrl);

export const COUNTRY_BOUNDS: LngLatBoundsLike = [[-90.15, 13.13], [-87.68, 14.46]];

export interface MapLayers { zones: boolean; cameras: boolean; units: boolean; alerts: boolean;
  /** Eventos en curso: su área y su rótulo. Aparte de las zonas: un evento puede abarcar varias. */
  events?: boolean;
  /** Campo de visión de las cámaras (ángulo y alcance). Apagado por defecto: carga mucho el mapa. */
  fov?: boolean;
  /** Hexágonos: qué muestran (personas, cobertura o alertas). null = apagados. */
  hex?: HexMetric | null;
  /** Medios aéreos: drones y helicópteros. Prendidos por defecto. */
  drones?: boolean; helis?: boolean }
export interface RouteStop { lat: number; lon: number; label: string; title: string; /** Hora de la lectura, al lado del número. */ time?: string; /** Captura de la cámara que hizo la lectura: se proyecta sobre la parada. */
  snap?: { camera: string; street: string; evidence: Ev; confidence?: number };
  /** 'add': evidencia agregada por el analista (rombo). Por defecto, una detección de cámara. */
  kind?: 'det' | 'add';
  /** Clip de la cámara: en la tarjeta de la parada actual se ve en bucle en lugar de la captura. */
  clip?: { src: string; poster?: string } }

interface Props {
  zones: Zone[];
  zoneStatus?: Record<string, ZoneStatus>;
  cameras?: Camera[];
  units?: Unit[] | null;
  alerts?: Alert[];
  layers?: Partial<MapLayers>;
  /** Encuadre: se aplica cada vez que cambia `fitKey`. */
  bounds?: LngLatBoundsLike;
  fitKey?: string;
  /** Cada vez que cambia, el mapa se aleja un poco (al cerrar una ficha de detalle). */
  backOutKey?: string;
  selectedZone?: string | null;
  highlightZones?: string[];
  route?: RouteStop[];
  /** Nombre del recorrido (p. ej. la placa), para la lectura del HUD. */
  routeLabel?: string;
  /** Recorrido controlado (historia del analista): índice de la parada actual. No se anima solo: se dibuja
      lo recorrido hasta acá y lo que falta tenue, y la cámara va a la parada. null/undefined: animación de siempre. */
  routeAt?: number | null;
  /** Historia del analista: el recorrido no arranca solo. Se ve entero, con todos los eventos, y se reproduce
      cada vez que cambia este número (el botón ▶). Al reproducir la cámara sigue el recorrido de evento en evento. */
  routePlay?: number;
  /** Lectura del HUD en el recorrido controlado: número del capítulo actual y total de capítulos. */
  routeCount?: { now: string; total: number } | null;
  /** Recorrido controlado: mientras es true, el mapa encuadra todas las paradas (vista de conjunto) en vez de ir a la actual. */
  routeOverview?: boolean;
  /** Recorrido controlado: false si el capítulo actual no tiene lugar; la parada sigue marcada pero sin captura «ahora». */
  routeCard?: boolean;
  /** Reproduciendo: mientras dura el capítulo, la línea avanza (y el mapa la sigue) desde la parada actual
      hasta la siguiente, en `ms`. Así nunca queda quieto esperando. `key` cambia solo con la parada destino. */
  routeLead?: { ms: number; key: string } | null;
  sketch?: LngLat[];
  /** Hexágonos elegidos para una zona o un evento (se suman y se quitan con clic). */
  pickCells?: string[];
  /** Mapa de configuración: cada zona pintada con su área de hexágonos y un color (su territorio);
      `dim` la atenúa (p. ej. no le falta nada cuando se miran los pendientes). */
  zonePaint?: { color: (z: Zone) => string; dim: (z: Zone) => boolean };
  /** Marcador del sector de la beta, visible con el mapa alejado. */
  region?: { lat: number; lon: number; title: string; sub: string; onClick: () => void };
  onZoneClick?: (id: string) => void;
  onAlertClick?: (id: string) => void;
  onMapClick?: (p: LngLat) => void;
  /** Clic en una parte vacía del mapa (sin zona, cámara ni marcador): cierra el detalle. */
  onEmptyClick?: () => void;
  onZoom?: (z: number) => void;
  severityOf?: (zoneId: string) => 'critica' | 'media' | null;
  /** Evento de la zona: el que está en curso o, si no hay, el próximo programado (live = false).
      Una zona puede ser parte de un evento con varias zonas; venueZone es donde se hace (ahí va su rótulo). */
  eventOf?: (zoneId: string) => { id: string; name: string; start: number; end: number; live: boolean; venueZone?: string; cells?: string[] } | null;
  /** Clic en el rótulo de un evento: abre su ficha. */
  onEventClick?: (id: string) => void;
  compact?: boolean;
  /** Base de Google pedida; si no está disponible queda la base local. */
  base?: GoogleBase;
  onBaseStatus?: (s: 'google' | 'local') => void;
  /** Espacio ocupado por paneles encima del mapa, para encuadrar en la parte visible. */
  padding?: { top: number; right: number; bottom: number; left: number };
  onCameraClick?: (id: string) => void;
  /** Clic en un dron o helicóptero: abre su ficha (transmisión y telemetría) en el lateral. */
  onAirClick?: (id: string) => void;
  onPointer?: (p: LngLat | null) => void;
  /** Lo abierto en el lateral: se destaca y el resto del mapa queda atenuado. */
  focusSel?: { k: 'alerta' | 'zona' | 'camara'; id: string } | null;
  /** Medición de cobertura alrededor de un punto (radio y hexágonos que toca). */
  measure?: { p: LngLat; radius: number; cells: string[]; state: 'cubierta' | 'cerca' | 'sin_cobertura' } | null;
  /** Alerta bajo el mouse en la lista (o en el mapa). */
  hoverAlert?: string | null;
  /** Alertas que acaban de llegar y nadie abrió: caen sobre el punto con anillos. */
  freshAlerts?: string[];
  onAlertHover?: (id: string | null) => void;
  /** Emisión al confirmar una alerta (sale sobre el punto). */
  signal?: { lat: number; lon: number; label: string; key: string } | null;
  /** Punto destacado (resultado de búsqueda). */
  pin?: { lat: number; lon: number; label: string } | null;
  /** Incidentes registrados a mano: un punto con su tipo. */
  incidents?: { id: string; lat: number; lon: number; label: string; title: string; icon?: string }[];
  /** Alt + clic en el mapa: atajo para registrar lo que pasó en ese punto, sin elegir herramienta. */
  onAltClick?: (p: LngLat) => void;
  /** Sigue un punto en pantalla (px dentro del mapa) mientras el mapa se mueve: para lo que se abre junto
      al punto tocado (el abanico de acciones). */
  track?: { p: LngLat; onXY: (xy: [number, number]) => void } | null;
}

const token = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888888';
const SHOW_DETAIL = 12.2;
/** Desde qué zoom se rotula cada cosa. Alejado, los rótulos se amontonan y tapan el mapa: primero se van
    los de zona (a 14,5 ya se ven las cuadras y no se pisan) y queda el del evento como referencia hasta 13;
    más lejos solo quedan la línea del área y los hexágonos. */
const ZONE_LABEL_Z = 14.5;
const EVENT_LABEL_Z = 13;
/** Escala de las alertas según el zoom: nunca bajan de 0,95 (de lejos siguen siendo lo que más se ve) y de cerca crecen hasta 1,5. */
const alertScale = (z: number) => Math.min(1.5, Math.max(0.95, 1 + (z - 15) * 0.14));
/** Desde este zoom se ve cada elemento suelto; más lejos, lo que cae cerca se agrupa. */
const UNGROUP = 17;
/** Hasta este zoom, todo lo que pertenece a una zona se junta en un solo grupo de esa zona. */
const ZONE_GROUP = 16.4;
void CAM_REACH;

function baseStyle(): StyleSpecification {
  const G = geo as unknown as Record<string, GeoJSON.FeatureCollection>;
  return {
    version: 8,
    sources: {
      region: { type: 'geojson', data: G.region },
      country: { type: 'geojson', data: G.country },
      parks: { type: 'geojson', data: G.parks },
      buildings: { type: 'geojson', data: G.buildings },
      roads: { type: 'geojson', data: G.roads },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': token('--surface') } },
      { id: 'region', type: 'fill', source: 'region', paint: { 'fill-color': token('--surface-panel'), 'fill-outline-color': token('--border-strong') } },
      { id: 'country', type: 'fill', source: 'country', paint: { 'fill-color': token('--surface-raised'), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 0.35] } },
      { id: 'country-line', type: 'line', source: 'country', paint: { 'line-color': token('--border-control'), 'line-width': 1 } },
      { id: 'parks', type: 'fill', source: 'parks', minzoom: 12, paint: { 'fill-color': token('--surface-raised'), 'fill-opacity': 0.8 } },
      { id: 'buildings', type: 'fill', source: 'buildings', minzoom: 13.5, paint: { 'fill-color': token('--border'), 'fill-opacity': 0.9 } },
      { id: 'roads-minor', type: 'line', source: 'roads', minzoom: 12.5, filter: ['<', ['get', 'rank'], 2], paint: { 'line-color': token('--border-strong'), 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 3] } },
      { id: 'roads-major', type: 'line', source: 'roads', minzoom: 11, filter: ['>=', ['get', 'rank'], 2], paint: { 'line-color': token('--border-control'), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 6] } },
    ],
  };
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
/** Áreas de eventos ya calculadas, por tamaño de grilla y celdas (se piden en cada sincronización del mapa). */
const areaCache = new Map<string, { cells: string[]; shape: LngLat[][][] }>();
/** Corre `f` cuando el navegador está libre (o enseguida, si no tiene cómo avisar). */
const idle = (f: () => void) => { const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }; if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 3000 }); else setTimeout(f, 200); };
/** Cada cuánto, como mucho, se repintan los hexágonos por cambios en los datos (ms). */
const FIELD_EVERY = 4000;
/** Capa de cada grilla de hexágonos (una por franja de zoom). */
const HEX_LAYERS = HEX_TIERS.map((t) => `hex${t.res}`);

/** Nodo de cámara como imagen para la capa del mapa. Misma geometría que CameraNode (src/map/icons.tsx). */
function cameraSvg(st: Camera['status'], c: { ink: string; muted: string; subtle: string }) {
  const ringStroke = st === 'caida' ? c.subtle : c.muted, core = st === 'caida' ? c.subtle : st === 'fuera_de_preset' ? c.muted : c.ink;
  const [cx, cy] = st === 'fuera_de_preset' ? [13, 7] : [10, 10];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="-3 -3 26 26">`
    + `<circle cx="10" cy="10" r="8.2" fill="#090909" fill-opacity=".8" stroke="${ringStroke}" stroke-width="1.6"${st === 'degradada' ? ' stroke-dasharray="2.6 2.2"' : ''}/>`
    + `<circle cx="${cx}" cy="${cy}" r="3.2" fill="${core}"/>`
    + `<path d="M10 -1.5v3M21.5 10h-3M10 21.5v-3M-1.5 10h3" stroke="${ringStroke}" stroke-width="1.6" stroke-linecap="round"/>`
    + (st === 'caida' ? `<path d="M4 16L16 4" stroke="${c.ink}" stroke-width="1.8" stroke-linecap="round"/>` : '')
    + `</svg>`;
}

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; root: Root; el: HTMLElement; onClick?: () => void; hover?: (x: number, y: number) => Hover }>());
  const cb = useRef(p); cb.current = p;
  const pickGridRef = useRef<() => void>(() => {});
  const [google, setGoogle] = useState<{ session: string; copyright: string | null } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [view, setView] = useState({ bearing: p.compact ? 0 : -18, pitch: p.compact ? 0 : 45 });
  const hoverCam = useRef<string | null>(null);
  /** Hexágonos: cada grilla cargada (y el último valor pintado en cada celda), con qué lectura y datos
      se pintó y cuándo. */
  const field = useRef<{ grids: HexLayer[]; building: Set<number>;
    metric: HexMetric | null; sig: string; at: number; timer: ReturnType<typeof setTimeout> | null; colors: HexColors | null }>(
    { grids: [], building: new Set(), metric: null, sig: '', at: 0, timer: null, colors: null });
  /* Recorrido animado: se dibuja de punta a punta con una estela; cada parada se enciende al pasar. */
  /** Medios aéreos: si se dibujan, y cuándo se actualizó la estela por última vez. */
  const air = useRef({ on: false, show: [] as typeof AIRCRAFT, trailAt: 0, trailShown: false });
  const anim = useRef<{ key: string; raf: number; reached: number; head: maplibregl.Marker | null; arrows: { p: LngLat; deg: number }[]; eased?: string; playTok?: number; follow?: boolean; ctlKey?: string; ctlPrev?: number; segRaf?: number; leadKey?: string; leadRaf?: number; leadTo?: number }>({ key: '', raf: 0, reached: -1, head: null, arrows: [] });
  const [hud, setHud] = useState<{ reached: number; n: number; done: boolean } | null>(null);
  /* Capturas proyectadas sobre las paradas del recorrido: se pueden ocultar desde el HUD. */
  const [snaps, setSnaps] = useState(true); const snapsRef = useRef(snaps); snapsRef.current = snaps;

  // Crear el mapa una vez
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!, style: baseStyle(), bounds: p.bounds ?? COUNTRY_BOUNDS, fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true, customAttribution: 'Natural Earth · © colaboradores de OpenStreetMap (ODbL)' },
      // Vista inclinada, como una sala de control: 45° y un rumbo leve. Botón derecho para girar e inclinar.
      pitch: p.compact ? 0 : 45, bearing: p.compact ? 0 : -18, maxPitch: 60,
      dragRotate: !p.compact, pitchWithRotate: !p.compact, doubleClickZoom: !p.onMapClick, maxZoom: 18.5, minZoom: 5,
      // Mosaicos ya vistos quedan en memoria: al volver a una zona no se piden de nuevo.
      maxTileCacheSize: 1000,
    });
    if (p.compact) map.touchZoomRotate.disableRotation();
    // Zoom con rueda y trackpad algo más ágil que el de MapLibre (1/450 y 1/100 por defecto).
    map.scrollZoom.setWheelZoomRate(1 / 300);
    map.scrollZoom.setZoomRate(1 / 70);
    // La perspectiva se maneja con el control propio (ViewControl, abajo): el de MapLibre aplanaba el mapa al tocar la brújula.
    map.on('rotate', () => setView((v) => ({ ...v, bearing: map.getBearing() })));
    map.on('pitch', () => setView((v) => ({ ...v, pitch: map.getPitch() })));
    map.on('load', () => {
      const negative = token('--status-negative'), alertC = token('--status-alert'), muted = token('--ink-muted'), subtle = token('--ink-subtle'), ink = token('--ink');
      const positive = token('--status-positive'), surface = token('--surface');
      for (const st of ['operativa', 'degradada', 'fuera_de_preset', 'caida'] as const) {
        const img = new Image(48, 48);
        img.onload = () => { if (!map.hasImage('cam-' + st)) map.addImage('cam-' + st, img, { pixelRatio: 2 }); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cameraSvg(st, { ink, muted, subtle }));
      }
      map.addSource('measure', { type: 'geojson', data: fc([]) });

      map.addSource('zones', { type: 'geojson', data: fc([]) });
      map.addSource('cameras', { type: 'geojson', data: fc([]) });
      map.addSource('route', { type: 'geojson', data: fc([]) });
      map.addSource('routeGhost', { type: 'geojson', data: fc([]) });
      // Estela de drones y helicópteros: se desvanece hacia la cola (line-progress necesita lineMetrics).
      map.addSource('airTrail', { type: 'geojson', data: fc([]), lineMetrics: true });
      map.addSource('focusDim', { type: 'geojson', data: fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] }, properties: {} }]) });
      // Modo foco: con un recorrido en pantalla, la base se oscurece y lo demás se esconde.
      map.addLayer({ id: 'focus-dim', type: 'fill', source: 'focusDim', paint: { 'fill-color': '#000', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 500, delay: 0 } } });
      map.addSource('sketch', { type: 'geojson', data: fc([]) });
      map.addSource('pick', { type: 'geojson', data: fc([]) });
      map.addSource('zonePaint', { type: 'geojson', data: fc([]) });
      map.addSource('pickGrid', { type: 'geojson', data: fc([]) });
      map.addSource('cones', { type: 'geojson', data: fc([]) });
      map.addSource('coneHi', { type: 'geojson', data: fc([]) });
      // Hexágonos: colores del tema para pintar los lienzos (ver hexCanvas.ts y loadHexGrid).
      field.current.colors = { positive: token('--status-positive'), alert: alertC, negative };
      /* Zonas: ya no se dibujan. La capa queda invisible solo para poder tocarlas y abrir su ficha;
         el nombre y el conteo van en su rótulo. */
      map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': muted, 'fill-opacity': 0 } });
      /* Lo que se delimita es el evento en curso (y la zona elegida en el lateral). Un evento se delimita
         eligiendo hexágonos, así que su área es la forma de esas celdas: un velo claro, el contorno de la
         figura en una línea fina continua y, adentro, las aristas de cada hexágono apenas marcadas. El
         nombre del evento va en su propio rótulo, arriba del área (ver los marcadores). */
      map.addSource('area', { type: 'geojson', data: fc([]) });
      map.addSource('areaCells', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', filter: ['!=', ['get', 'k'], 'sinmedicion'], paint: {
        'fill-color': ink, 'fill-opacity': ['case', ['get', 'dim'], 0.02, ['match', ['get', 'k'], 'sel', 0.08, 'programado', 0.035, 0.06]] } });
      map.addLayer({ id: 'area-cells', type: 'line', source: 'areaCells', minzoom: 14, paint: {
        'line-color': ink, 'line-width': 0.6, 'line-opacity': ['case', ['get', 'dim'], 0.05, 0.16] } });
      /* Zona sin medición (ninguna cámara la mide): contorno gris punteado y, adentro, sin mapa de calor. */
      map.addLayer({ id: 'nodata-line', type: 'line', source: 'area', filter: ['==', ['get', 'k'], 'sinmedicion'], layout: { 'line-join': 'round' }, paint: {
        'line-color': muted, 'line-width': 1.8, 'line-dasharray': [2, 1.6], 'line-opacity': ['case', ['get', 'dim'], 0.45, 1] } });
      /* Evento programado (todavía no empezó): la misma área, con el contorno en trazos y el velo más tenue. */
      map.addLayer({ id: 'next-line', type: 'line', source: 'area', filter: ['==', ['get', 'k'], 'programado'], layout: { 'line-join': 'round' }, paint: {
        'line-color': ink, 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': ['case', ['get', 'dim'], 0.3, 0.7] } });
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', filter: ['!', ['in', ['get', 'k'], ['literal', ['sinmedicion', 'programado']]]], layout: { 'line-join': 'round' }, paint: {
        'line-color': ink, 'line-width': ['match', ['get', 'k'], 'sel', 2, 1.4],
        'line-opacity': ['case', ['get', 'dim'], 0.3, ['match', ['get', 'k'], 'sel', 0.9, 0.7]] } });
      // Campo de visión de cada cámara: hacia dónde mira, con qué ángulo y hasta dónde llega.
      map.addLayer({ id: 'cones-fill', type: 'fill', source: 'cones', minzoom: 15, paint: { 'fill-color': ink, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.04, 17, 0.09] } });
      map.addLayer({ id: 'cones-line', type: 'line', source: 'cones', minzoom: 15, paint: { 'line-color': ink, 'line-opacity': 0.28, 'line-width': 1 } });
      map.addLayer({ id: 'cone-hi-fill', type: 'fill', source: 'coneHi', paint: { 'fill-color': ink, 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'cone-hi-line', type: 'line', source: 'coneHi', paint: { 'line-color': ink, 'line-opacity': 0.9, 'line-width': 1.5 } });
      map.addLayer({ id: 'cameras-hit', type: 'circle', source: 'cameras', minzoom: 11, paint: { 'circle-radius': 12, 'circle-color': '#000', 'circle-opacity': 0 } });
      // Cámaras: el nodo del sistema iconográfico. La salud cambia el dibujo, no el color.
      map.addLayer({ id: 'cameras', type: 'symbol', source: 'cameras', minzoom: 11, layout: {
        'icon-image': ['concat', 'cam-', ['get', 'st']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1],
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      }, paint: { 'icon-opacity': ['case', ['==', ['get', 'dim'], true], 0.25, 1] } });
      map.addLayer({ id: 'air-trail-glow', type: 'line', source: 'airTrail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 10], 'line-blur': 6,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.55)'] } });
      map.addLayer({ id: 'air-trail', type: 'line', source: 'airTrail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 3.5],
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)', 0.6, 'rgba(255,255,255,0.45)', 1, 'rgba(255,255,255,0.95)'] } });
      map.addLayer({ id: 'route-ghost', type: 'line', source: 'routeGhost', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 1.2, 'line-opacity': 0.28, 'line-dasharray': [1, 2.5] } });
      /* Entre dos detecciones no siempre hay cámara: el tramo es inferido (camino más corto por las calles,
         ver streets.ts). Se dibuja punteado y con un halo más tenue; lo único seguro son las paradas. */
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 10, 'line-blur': 9, 'line-opacity': 0.22 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 2.6, 'line-dasharray': [2.2, 1.6] } });
      map.addLayer({ id: 'sketch-fill', type: 'fill', source: 'sketch', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ink, 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'sketch-line', type: 'line', source: 'sketch', paint: { 'line-color': ink, 'line-width': 2 } });
      // Grilla de hexágonos mientras se elige (zona o evento): muestra dónde cae cada uno.
      map.addLayer({ id: 'zp-fill', type: 'fill', source: 'zonePaint', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'dim'], 0.04, 0.2] } });
      map.addLayer({ id: 'zp-line', type: 'line', source: 'zonePaint', layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': ['case', ['get', 'dim'], 0.25, 0.9] } });
      map.addLayer({ id: 'pick-grid', type: 'line', source: 'pickGrid', filter: ['==', ['get', 'k'], 'grid'], paint: { 'line-color': ink, 'line-opacity': 0.16, 'line-width': 0.8 } });
      map.addLayer({ id: 'pick-hover', type: 'fill', source: 'pickGrid', filter: ['==', ['get', 'k'], 'hover'], paint: { 'fill-color': ink, 'fill-opacity': 0.1 } });
      map.addLayer({ id: 'pick-fill', type: 'fill', source: 'pick', filter: ['==', ['get', 'k'], 'cell'], paint: { 'fill-color': ink, 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'pick-cells', type: 'line', source: 'pick', filter: ['==', ['get', 'k'], 'cell'], paint: { 'line-color': ink, 'line-opacity': 0.45, 'line-width': 1 } });
      map.addLayer({ id: 'pick-line', type: 'line', source: 'pick', filter: ['==', ['get', 'k'], 'outline'], layout: { 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 2.4 } });
      map.addLayer({ id: 'sketch-pts', type: 'circle', source: 'sketch', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': ink } });
      map.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure', filter: ['==', ['get', 'k'], 'circle'], paint: { 'fill-color': ['match', ['get', 'st'], 'cubierta', positive, 'cerca', alertC, negative], 'fill-opacity': 0.1 } });
      map.addLayer({ id: 'measure-cells', type: 'line', source: 'measure', filter: ['==', ['get', 'k'], 'cell'], paint: { 'line-color': ink, 'line-opacity': 0.25, 'line-width': 0.8 } });
      map.addLayer({ id: 'measure-center', type: 'circle', source: 'measure', filter: ['==', ['get', 'k'], 'center'], paint: { 'circle-radius': 5, 'circle-color': ink, 'circle-stroke-color': surface, 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['get', 'k'], 'circle'], paint: { 'line-color': ['match', ['get', 'st'], 'cubierta', positive, 'cerca', alertC, negative], 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      map.on('click', 'zones-fill', (e: MapLayerMouseEvent) => { if (!cb.current.onMapClick && !(e.originalEvent.altKey && cb.current.onAltClick)) cb.current.onZoneClick?.(String(e.features?.[0]?.properties?.id)); });
      map.on('mouseenter', 'zones-fill', () => { if (cb.current.onZoneClick && !cb.current.onMapClick) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = cb.current.onMapClick ? 'crosshair' : ''; });
      map.on('click', (e: maplibregl.MapMouseEvent) => {
        setHover(null);
        if (e.originalEvent.altKey && cb.current.onAltClick) { cb.current.onAltClick([e.lngLat.lng, e.lngLat.lat]); return; }
        if (cb.current.onMapClick) { cb.current.onMapClick([e.lngLat.lng, e.lngLat.lat]); return; }
        const hit = map.queryRenderedFeatures(e.point, { layers: ['zones-fill', 'cameras-hit'].filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none') });
        if (!hit.length) cb.current.onEmptyClick?.();
      });
      // Al mover el mapa, la ficha flotante se va
      map.on('movestart', () => setHover(null));
      map.on('zoomend', () => cb.current.onZoom?.(map.getZoom()));
      /* Grilla para elegir hexágonos: solo mientras se elige y con el mapa cerca (de lejos serían miles). */
      let hoverCell: string | null = null, gridKey = '';
      const pickGrid = () => {
        const src = map.getSource('pickGrid') as GeoJSONSource | undefined; if (!src) return;
        const b = map.getBounds();
        const on = !!cb.current.pickCells && map.getZoom() >= 13.5;
        // Solo se recalcula si cambió algo: se llama también cuando el mapa queda quieto (idle).
        const key = on ? `${b.toArray().flat().map((x) => x.toFixed(5)).join()}|${hoverCell}` : 'off';
        if (key === gridKey) return; gridKey = key;
        if (!on) { src.setData(fc([])); return; }
        const cells = hexesInView([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], 5000);
        src.setData(fc([
          ...cells.map((c): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hexRing(c)] }, properties: { k: 'grid' } })),
          ...(hoverCell ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hexRing(hoverCell)] }, properties: { k: 'hover' } } as GeoJSON.Feature] : []),
        ]));
      };
      pickGridRef.current = pickGrid;
      map.on('moveend', pickGrid); map.on('idle', pickGrid);
      map.on('mousemove', (e) => {
        if (!cb.current.pickCells) { if (hoverCell) { hoverCell = null; pickGrid(); } return; }
        const c = cellAt([e.lngLat.lng, e.lngLat.lat]); if (c !== hoverCell) { hoverCell = c; pickGrid(); }
      });
      // Tamaño de las alertas: sigue al zoom en cada cuadro (una sola variable CSS, sin redibujar marcadores).
      const setAz = () => map.getContainer().style.setProperty('--az', String(alertScale(map.getZoom())));
      setAz(); map.on('zoom', setAz);
      map.on('click', 'cameras', (e: MapLayerMouseEvent) => { if (!cb.current.onMapClick && !(e.originalEvent.altKey && cb.current.onAltClick)) { e.originalEvent.stopPropagation(); cb.current.onCameraClick?.(String(e.features?.[0]?.properties?.id)); } });
      map.on('click', 'cameras-hit', (e: MapLayerMouseEvent) => { if (!cb.current.onMapClick && !(e.originalEvent.altKey && cb.current.onAltClick)) { e.originalEvent.stopPropagation(); cb.current.onCameraClick?.(String(e.features?.[0]?.properties?.id)); } });
      // Al pasar por una cámara se resalta su cono y se abre su ficha con el video en vivo
      const camHover = (id: string | null, x = 0, y = 0) => {
        if (id !== hoverCam.current) {
          hoverCam.current = id;
          setHover(id ? { kind: 'camera', id, x, y } : null);
          // Sin cámara bajo el puntero vuelve el cono de la cámara abierta en el lateral (si hay).
          const sel = cb.current.focusSel?.k === 'camara' ? cb.current.focusSel.id : null;
          const c = (id ?? sel) ? cb.current.cameras?.find((q) => q.id === (id ?? sel)) : null;
          (map.getSource('coneHi') as GeoJSONSource).setData(fc(c && c.status !== 'caida' ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [cone(c, 28)] }, properties: {} }] : []));
        }
      };
      map.on('mousemove', 'cameras-hit', (e: MapLayerMouseEvent) => { map.getCanvas().style.cursor = 'pointer'; camHover(String(e.features?.[0]?.properties?.id), e.originalEvent.clientX, e.originalEvent.clientY); });
      map.on('mouseleave', 'cameras-hit', () => { map.getCanvas().style.cursor = cb.current.onMapClick ? 'crosshair' : ''; camHover(null); });
      map.on('mousemove', (e: maplibregl.MapMouseEvent) => cb.current.onPointer?.([e.lngLat.lng, e.lngLat.lat]));
      map.on('mouseout', () => cb.current.onPointer?.(null));
      ready.current = true;
      sync();
      if (cb.current.base) applyBase(cb.current.base);
    });
    mapRef.current = map;
    // Las columnas cambian de ancho (abrir o cerrar el detalle): el mapa se reajusta.
    const ro = new ResizeObserver(() => map.resize()); ro.observe(el.current!);
    // Relevo con la entrada: el mapa principal publica su cámara para que el globo vuele hasta ella.
    const box = el.current!;
    const unprovide = p.compact ? () => {} : provideConsoleMap({
      jump: (v) => map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }),
      camera: () => {
        const c = map.getCenter(), r = box.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
          fov: map.getVerticalFieldOfView() * Math.PI / 180, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
      },
    });
    if (import.meta.env.DEV) ((window as unknown as { __maps: MLMap[] }).__maps ??= []).push(map);
    return () => { unprovide(); ro.disconnect(); markers.current.forEach(({ m, root }) => { m.remove(); setTimeout(() => root.unmount()); }); markers.current.clear(); ready.current = false; map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Encuadre. El primero es inmediato: el mapa arranca ya encuadrado (el globo de la entrada vuela hasta esa cámara).
  const fitted = useRef(false);
  useEffect(() => {
    if (!p.bounds || !mapRef.current) return;
    const pad = p.padding ? { top: p.padding.top + 40, right: p.padding.right + 40, bottom: p.padding.bottom + 40, left: p.padding.left + 40 } : p.compact ? 24 : 60;
    const mm = mapRef.current;
    mm.fitBounds(p.bounds, { padding: pad, duration: fitted.current ? 800 : 0, maxZoom: 17.2, bearing: mm.getBearing(), pitch: mm.getPitch() });
    fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fitKey]);

  useEffect(() => {
    const mm = mapRef.current; if (!p.backOutKey || !mm) return;
    mm.easeTo({ zoom: Math.max(13.5, mm.getZoom() - 1.2), duration: 700 });
  }, [p.backOutKey]);

  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = p.onMapClick ? 'crosshair' : ''; }, [p.onMapClick]);
  // Mientras se marca en el mapa (hexágonos, un punto), los rótulos y marcadores no se pueden tocar: el clic va al mapa.
  useEffect(() => { mapRef.current?.getContainer().classList.toggle('map-picking', !!p.onMapClick); }, [p.onMapClick]);
  const trackCb = useRef(p.track?.onXY); trackCb.current = p.track?.onXY;
  useEffect(() => {
    const map = mapRef.current, pt = p.track?.p; if (!map || !pt) return undefined;
    const send = () => { const q = map.project(pt); trackCb.current?.([q.x, q.y]); };
    send(); map.on('move', send); map.on('resize', send);
    return () => { map.off('move', send); map.off('resize', send); };
  }, [p.track?.p[0], p.track?.p[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al empezar o terminar de elegir hexágonos, la grilla aparece o se va.
  useEffect(() => { pickGridRef.current(); }, [!!p.pickCells]);

  // Base de Google: se agrega debajo de las capas operativas; ante un fallo queda la base local.
  const LOCAL_LAYERS = ['region', 'country', 'parks', 'buildings', 'roads-minor', 'roads-major'];
  async function applyBase(kind: GoogleBase) {
    const map = mapRef.current; if (!map || !hasGoogleKey()) { cb.current.onBaseStatus?.('local'); return; }
    try {
      const session = await googleSession(kind);
      if (mapRef.current !== map) return;
      for (const k of ['mapa', 'satelite'] as const) {
        const id = 'g-' + k;
        if (k === kind && !map.getSource(id)) {
          map.addSource(id, { type: 'raster', tiles: googleTiles(session), tileSize: 256, maxzoom: 20 });
          // Cada mosaico aparece apenas llega, sin fundido (por defecto MapLibre tarda 300 ms más en mostrarlo).
          map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0, ...(k === 'satelite' ? { 'raster-brightness-max': 0.7, 'raster-saturation': -0.4 } : {}) } }, 'country-line');
          // El mapa local queda debajo de Google como respaldo: mientras un mosaico no llega (tarda ~300 ms),
          // se ven las calles propias en la misma paleta en vez de un hueco. Al llegar, el mosaico las tapa.
          for (const l of ['parks', 'buildings', 'roads-minor', 'roads-major']) map.moveLayer(l, id);
          // Debajo, la misma base en baja resolución (mosaicos de zoom 13 como mucho, cada uno cubre 16 de
          // los de zoom 15): llega mucho antes y llena la pantalla con una versión borrosa mientras cargan
          // los nítidos, como en Google Maps. Va sin rótulos (ampliados se verían gigantes). Afuera del
          // sector, donde no hay mapa local, es el respaldo.
          const bare = await googleSession(kind, true).catch(() => null);
          if (bare && mapRef.current === map && !map.getSource(id + '-lo')) {
          map.addSource(id + '-lo', { type: 'raster', tiles: googleTiles(bare), tileSize: 256, maxzoom: 13 });
          map.addLayer({ id: id + '-lo', type: 'raster', source: id + '-lo', paint: { 'raster-fade-duration': 0, ...(k === 'satelite' ? { 'raster-brightness-max': 0.7, 'raster-saturation': -0.4 } : {}) } }, id);
          }
        }
        for (const l of [id, id + '-lo']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', k === kind ? 'visible' : 'none');
      }
      for (const l of LOCAL_LAYERS) map.setLayoutProperty(l, 'visibility', 'visible');
      setGoogle({ session, copyright: null });
      cb.current.onBaseStatus?.('google');
    } catch {
      for (const l of LOCAL_LAYERS) map.setLayoutProperty(l, 'visibility', 'visible');
      setGoogle(null);
      cb.current.onBaseStatus?.('local');
    }
  }
  useEffect(() => { if (ready.current && p.base) applyBase(p.base); }, [p.base]); // eslint-disable-line react-hooks/exhaustive-deps
  // Texto de derechos de Google para el encuadre actual
  useEffect(() => {
    const map = mapRef.current; if (!map || !google) return;
    let t: ReturnType<typeof setTimeout>;
    const upd = () => { clearTimeout(t); t = setTimeout(async () => {
      const b = map.getBounds();
      const c = await googleCopyright(google.session, map.getZoom(), { n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest() });
      setGoogle((g) => (g && g.session === google.session ? { ...g, copyright: c } : g));
    }, 400); };
    upd(); map.on('moveend', upd);
    return () => { clearTimeout(t); map.off('moveend', upd); };
  }, [google?.session]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Hexágonos ---- */
  /** Datos de los hexágonos tal como están ahora (para pintar una grilla que terminó de cargar después). */
  function hexDataNow(): HexData {
    const P = cb.current; return { zones: P.zones, status: P.zoneStatus ?? {}, cameras: P.cameras ?? [], units: P.units ?? null, alerts: P.alerts ?? [] };
  }
  /** Arma el lienzo de una franja de zoom y lo apoya en el mapa como imagen. Una sola vez; se arma en
      tandas sin congelar la pantalla y, cuando está, el mapa se vuelve a sincronizar para pintarlo. */
  async function loadHexGrid(i: number, d: HexData) {
    const F = field.current; if (F.grids[i] || F.building.has(i)) return; F.building.add(i);
    const L = await makeHexLayer(i, d.zones), id = HEX_LAYERS[i], tier = HEX_TIERS[i];
    const map = mapRef.current; if (!map || map.getSource(id)) return;
    map.addSource(id, { type: 'canvas', canvas: L.canvas, coordinates: L.coords, animate: false });
    map.addLayer({ id, type: 'raster', source: id, minzoom: tier.minzoom, maxzoom: tier.maxzoom, layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, map.getLayer('zones-fill') ? 'zones-fill' : undefined);
    F.grids[i] = L; sync();
    paintLater(i);
  }
  /** Pinta una franja que no se ve cuando el navegador está libre y el mapa quieto, para que tenga
      imagen al cruzar hacia ella con el zoom. Solo al cargarla o al cambiar de lectura. */
  function paintLater(i: number) {
    idle(() => { const map = mapRef.current, L = field.current.grids[i]; if (!map || !L?.dirty) return; if (map.isMoving()) { paintLater(i); return; } paintHex(i, hexDataNow()); });
  }
  /** Vuelve a pintar el lienzo de una franja y le avisa al mapa que la imagen cambió. */
  function paintHex(i: number, d: HexData) {
    const map = mapRef.current, F = field.current, L = F.grids[i]; if (!map || !L || !F.metric || !F.colors) return;
    drawHexLayer(L, F.metric, d, F.colors);
    const src = map.getSource(HEX_LAYERS[i]) as CanvasSource | undefined;
    if (src) { src.play(); requestAnimationFrame(() => src.pause()); }
  }

  // Datos → fuentes y marcadores
  function sync() {
    const map = mapRef.current; if (!map || !ready.current) return;
    // Con el mapa en movimiento (zoom, arrastre, transición) no se toca nada: rearmar fuentes y marcadores
    // a mitad de un zoom lo hace saltar. Al terminar el movimiento (moveend) se sincroniza con lo último.
    if (map.isMoving()) return;
    const P = cb.current; const st = P.zoneStatus ?? {};
    // Selección del lateral: la alerta abierta (y su zona), la zona o la cámara.
    const selAlert = P.focusSel?.k === 'alerta' ? P.alerts?.find((x) => x.id === P.focusSel!.id) ?? null : null;
    const selZone = P.focusSel?.k === 'zona' ? P.focusSel.id : selAlert?.zoneId ?? null;
    const L: MapLayers = { zones: true, events: true, cameras: false, units: false, alerts: true, fov: false, hex: null, ...P.layers };
    // Hexágonos: la grilla del zoom actual se carga al momento; las otras, cuando el navegador está libre.
    // Los valores se recalculan solo si cambian los datos que usa la lectura, y como mucho cada FIELD_EVERY.
    const F = field.current;
    if (L.hex) {
      const data: HexData = { zones: P.zones, status: st, cameras: P.cameras ?? [], units: P.units ?? null, alerts: P.alerts ?? [] };
      const z = map.getZoom(); const now = Math.max(0, HEX_TIERS.findIndex((tr) => z >= tr.minzoom && z < tr.maxzoom));
      void loadHexGrid(now, data);
      HEX_TIERS.forEach((_, i) => { if (i !== now && !F.grids[i] && !F.building.has(i)) idle(() => void loadHexGrid(i, hexDataNow())); });
      const sig = hexSignature(L.hex, data);
      const wait = FIELD_EVERY - (Date.now() - F.at);
      if (F.metric !== L.hex || (sig !== F.sig && wait <= 0)) {
        const newMetric = F.metric !== L.hex;
        F.metric = L.hex; F.sig = sig; F.at = Date.now();
        F.grids.forEach((g, i) => { if (!g) return; g.dirty = true; if (newMetric && i !== now) paintLater(i); });
      } else if (sig !== F.sig && !F.timer) F.timer = setTimeout(() => { F.timer = null; sync(); }, wait);
      // Se repinta solo la franja que se ve, y nunca con el mapa en movimiento: repintar sube el lienzo
      // entero a la placa de video y, en pleno movimiento, se notaría. Al terminar el movimiento el mapa
      // vuelve a sincronizar (moveend) y ahí se pinta. Las otras franjas guardan su última imagen hasta
      // que el zoom las vuelve visibles.
      if (F.grids[now]?.dirty && !map.isMoving()) paintHex(now, data);
    } else F.metric = null;
    // Medición de cobertura alrededor de un punto
    const M = P.measure;
    (map.getSource('measure') as GeoJSONSource).setData(fc(M ? [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * 2 * Math.PI; return [M.p[0] + (Math.cos(a) * M.radius) / (111320 * Math.cos((M.p[1] * Math.PI) / 180)), M.p[1] + (Math.sin(a) * M.radius) / 111320]; })] }, properties: { k: 'circle', st: M.state } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: M.p }, properties: { k: 'center' } },
      ...M.cells.map((cell): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hexRing(cell)] }, properties: { k: 'cell' } })),
    ] : []));
    // Zonas: siempre neutras (gris); en rojo solo si tienen una alerta esperando decisión.
    (map.getSource('zones') as GeoJSONSource).setData(fc(L.zones ? P.zones.map((z) => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [z.ring] },
      properties: { id: z.id, sev: P.severityOf?.(z.id) ? 'alerta' : 'none', sel: P.selectedZone === z.id || !!P.highlightZones?.includes(z.id), dim: (!!P.highlightZones && !P.highlightZones.includes(z.id) && P.selectedZone !== z.id) || (!!selZone && z.id !== selZone) || (!!P.focusSel && !selZone), nodata: !!P.zoneStatus && (st[z.id]?.coverage ?? 'sin_datos') !== 'medida' },
    })) : []));
    // Áreas delimitadas: cada evento en curso (sus zonas juntas) y la zona elegida
    const area: GeoJSON.Feature[] = [], areaCells: GeoJSON.Feature[] = [];
    const eventAreas: { id: string; name: string; start: number; end: number; live: boolean; top: LngLat; dim: boolean }[] = [];
    // Las celdas se dibujan al tamaño de la grilla que se ve a este zoom, para que el área calce con los hexágonos.
    const zNow = map.getZoom(), gridRes = (HEX_TIERS.find((tr) => zNow >= tr.minzoom && zNow < tr.maxzoom) ?? HEX_TIERS[0]).res;
    const areaOf = (data: string[]) => {
      const key = gridRes + ':' + data.join(',');
      let hit = areaCache.get(key);
      if (!hit) { const cells = cellsAtRes(data, gridRes); hit = { cells, shape: hexesOutline(cells) }; if (areaCache.size > 40) areaCache.clear(); areaCache.set(key, hit); }
      return hit;
    };
    /** El punto más al norte de un área, para apoyar un rótulo. */
    const northOf = (shape: LngLat[][][]) => shape.flat(2).reduce((a, q) => (q[1] > a[1] ? q : a));
    const addArea = (data: string[], k: 'evento' | 'programado' | 'sel' | 'sinmedicion', dim: boolean) => {
      const { cells, shape } = areaOf(data); if (!shape.length) return null;
      area.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: shape }, properties: { k, dim } });
      if (k !== 'sinmedicion') for (const c of cells) areaCells.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hexRing(c)] }, properties: { dim } });
      return northOf(shape); // el punto más al norte, para el rótulo
    };
    if (L.events) {
      const events = new Map<string, { id: string; start: number; end: number; live: boolean; venueZone?: string; cells?: string[]; zones: Zone[] }>();
      for (const z of P.zones) { const ev = P.eventOf?.(z.id); if (ev) events.set(ev.name, { id: ev.id, start: ev.start, end: ev.end, live: ev.live, venueZone: ev.venueZone, cells: ev.cells, zones: [...(events.get(ev.name)?.zones ?? []), z] }); }
      for (const [name, e] of events) {
        const dim = !!selZone && !e.zones.some((z) => z.id === selZone);
        // El área del evento son los hexágonos que se eligieron; los eventos anteriores, los de sus zonas.
        const whole = addArea(e.cells?.length ? e.cells : zoneHexes(e.zones), e.live ? 'evento' : 'programado', dim);
        // El rótulo va sobre el lugar del evento (el estadio, la plaza), no sobre la zona más al norte del área.
        const venue = e.zones.find((z) => z.id === e.venueZone);
        const venueShape = venue ? areaOf(zoneHexes([venue])).shape : [];
        const top = whole && (venueShape.length ? northOf(venueShape) : whole);
        if (top) eventAreas.push({ id: e.id, name, start: e.start, end: e.end, live: e.live, top, dim });
      }
    }
    if (L.zones && P.zoneStatus) for (const z of unmeasured({ zones: P.zones, status: st })) addArea(zoneHexes([z]), 'sinmedicion', !!selZone && selZone !== z.id);
    if (L.zones) {
      const sel = P.zones.filter((z) => z.id === selZone || z.id === P.selectedZone || P.highlightZones?.includes(z.id));
      if (sel.length) addArea(zoneHexes(sel), 'sel', false);
    }
    (map.getSource('area') as GeoJSONSource).setData(fc(area));
    (map.getSource('areaCells') as GeoJSONSource).setData(fc(areaCells));
    // Agrupación al alejar el zoom (cámaras, unidades y alertas por separado). Se calcula en pantalla:
    // lo que cae en la misma celda se junta. Desde UNGROUP en adelante todo va suelto.
    const zoom = map.getZoom(), detailZ = zoom >= SHOW_DETAIL, cell = zoom >= UNGROUP ? 0 : zoom >= 15.6 ? 30 : zoom >= 14.4 ? 40 : 56;
    /** opts.zoneBelow: hasta qué zoom se agrupa por zona; opts.cell: radio en px para juntar lo que se pisa. */
    function split<T>(items: T[], _pos: (t: T) => LngLat, zoneOfIt?: (t: T) => string | null, slot = 0, opts: { zoneBelow?: number; cell?: number } = {}) {
      const cellNow = opts.cell ?? cell;
      if (!cellNow) return { singles: items, groups: [] as { key: string; items: T[]; c: LngLat }[] };
      // Primero por zona: si todas las unidades están en la Plaza, al alejar se ve un solo grupo en la Plaza.
      const byZone = new Map<string, T[]>(); const rest: T[] = [];
      for (const it of items) { const zid = zoom < (opts.zoneBelow ?? ZONE_GROUP) && zoneOfIt ? zoneOfIt(it) : null; if (zid) { if (!byZone.has(zid)) byZone.set(zid, []); byZone.get(zid)!.push(it); } else rest.push(it); }
      const zoneGroups: { key: string; items: T[]; c: LngLat }[] = []; const zoneSingles: T[] = [];
      byZone.forEach((list, zid) => { const z = P.zones.find((q) => q.id === zid); if (list.length < 2 || !z) zoneSingles.push(...list); else {
        // El grupo va debajo del rótulo de la zona (que está en el centro), no encima.
        const q = map!.project([z.lon, z.lat]); const below = map!.unproject([q.x + slot * 46, q.y + 46]); // cada categoría en su lugar: cámaras a la izquierda, unidades a la derecha
        zoneGroups.push({ key: 'z' + zid, items: list, c: [below.lng, below.lat] });
      } });
      const d = cluster(rest, cellNow);
      return { singles: [...zoneSingles, ...d.singles], groups: [...zoneGroups, ...d.groups] };
    }
    function cluster<T>(items: T[], cell: number) {
      const pos = (it: T) => (it as unknown as { lon: number; lat: number });
      // Por distancia en pantalla: cada elemento se suma al grupo más cercano a menos de `cell` px;
      // si no hay ninguno, abre uno nuevo. Así no quedan pegados dos elementos a cada lado de una celda.
      const seeds: { x: number; y: number; items: T[] }[] = [];
      for (const it of items) {
        const q = map!.project([pos(it).lon, pos(it).lat]); let best: (typeof seeds)[number] | null = null, bd = cell;
        for (const s of seeds) { const d = Math.hypot(s.x - q.x, s.y - q.y); if (d < bd) { bd = d; best = s; } }
        if (best) best.items.push(it); else seeds.push({ x: q.x, y: q.y, items: [it] });
      }
      const singles: T[] = [], groups: { key: string; items: T[]; c: LngLat }[] = [];
      seeds.forEach((s) => { if (s.items.length < 2) singles.push(...s.items); else groups.push({ key: `${Math.round(s.x / 8)}:${Math.round(s.y / 8)}`, items: s.items, c: [s.items.reduce((a, it) => a + pos(it).lon, 0) / s.items.length, s.items.reduce((a, it) => a + pos(it).lat, 0) / s.items.length] }); });
      return { singles, groups };
    }
    const camSplit = L.cameras && detailZ ? split(P.cameras ?? [], (c) => [c.lon, c.lat], (c) => c.zoneId, -1) : { singles: L.cameras ? P.cameras ?? [] : [], groups: [] };
    // Cámara abierta en el lateral: se ve siempre (aunque la capa Cámaras esté apagada o la cámara esté en un grupo),
    // con su campo de visión y una marca que late; las demás quedan atenuadas.
    const selCam = P.focusSel?.k === 'camara' ? P.cameras?.find((c) => c.id === P.focusSel!.id) ?? null : null;
    if (selCam) {
      camSplit.groups = camSplit.groups.map((g) => ({ ...g, items: g.items.filter((x) => x.id !== selCam.id) })).filter((g) => g.items.length > 1 || (g.items.length === 1 && (camSplit.singles.push(g.items[0]), false)));
      if (!camSplit.singles.some((x) => x.id === selCam.id)) camSplit.singles = [...camSplit.singles, selCam];
    }
    if (!hoverCam.current) (map.getSource('coneHi') as GeoJSONSource).setData(fc(selCam && selCam.status !== 'caida' ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [cone(selCam, 28)] }, properties: {} }] : []));
    (map.getSource('cameras') as GeoJSONSource).setData(fc(camSplit.singles.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { id: c.id, st: c.status, dim: !!P.focusSel && !(P.focusSel.k === 'camara' && P.focusSel.id === c.id) } }))));
    (map.getSource('cones') as GeoJSONSource).setData(fc(camSplit.singles.filter((c) => L.fov && c.status !== 'caida').map((c) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [cone(c)] }, properties: {} }))));
    // ---- Recorrido: modo foco y animación ----
    // Con `routeAt` el recorrido lo maneja quien lo muestra (historia del analista): no se anima solo y alcanza 1 parada.
    const ctl = P.routeAt != null && P.route?.length ? Math.max(0, Math.min(P.routeAt, P.route.length - 1)) : null;
    const R = P.route && (P.route.length > 1 || ctl !== null) ? P.route : null; const focus = !!R;
    map.setPaintProperty('focus-dim', 'fill-opacity', focus ? 0.55 : 0);
    for (const id of HEX_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', focus || !L.hex ? 'none' : 'visible');
    for (const id of ['zones-fill', 'cameras', 'cameras-hit', 'cones-fill', 'cones-line', 'cone-hi-fill', 'cone-hi-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', focus ? 'none' : 'visible');
    map.setPaintProperty('area-line', 'line-opacity', focus ? 0.22 : ['case', ['get', 'dim'], 0.3, ['match', ['get', 'k'], 'sel', 0.9, 0.7]]);
    if (map.getLayer('area-cells')) map.setLayoutProperty('area-cells', 'visibility', focus ? 'none' : 'visible');
    const manual = P.routePlay !== undefined && ctl === null;
    const rkey = R ? (ctl !== null ? 'ctl:' : manual ? 'man:' : '') + JSON.stringify(R.map((s) => [s.lon, s.lat])) : '';
    if (rkey !== anim.current.key) {
      anim.current.key = rkey; anim.current.playTok = P.routePlay ?? 0;
      if (R && manual) { stopRoute(); fitRoute(R); }
      else if (R && ctl === null) playRoute(R); else stopRoute();
    } else if (R && manual && (P.routePlay ?? 0) !== anim.current.playTok) {
      anim.current.playTok = P.routePlay ?? 0; playRoute(R, true);
    }
    if (R && ctl !== null) {
      // Recorrido controlado: lo hecho hasta la parada actual va fuerte (punteado: es inferido entre cámaras);
      // lo que falta, tenue. Con una sola parada no hay línea.
      const { path, stopAt } = streetRoute(R.map((s) => [s.lon, s.lat] as LngLat)); const cut = stopAt[ctl];
      const line = (c: LngLat[]) => (c.length > 1 ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: c }, properties: {} }] : []);
      // Al pasar al hecho siguiente (reproduciendo o con →), la línea avanza por la calle con el punto
      // luminoso adelante, en vez de saltar. Cualquier otro cambio (saltar a otro hecho, otra historia) es directo.
      const A = anim.current, prev = A.ctlKey === rkey ? A.ctlPrev : undefined;
      if (A.ctlKey !== rkey || A.ctlPrev !== ctl) {
        A.ctlKey = rkey; A.ctlPrev = ctl; cancelAnimationFrame(A.segRaf ?? 0); A.segRaf = 0;
        const reducedSeg = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        (map.getSource('routeGhost') as GeoJSONSource).setData(fc(line(path.slice(cut))));
        if (prev !== undefined && prev === ctl - 1 && A.leadTo === ctl) {
          // La línea ya llegó sola mientras corría el capítulo anterior: no se vuelve a animar.
          (map.getSource('route') as GeoJSONSource).setData(fc(line(path.slice(0, cut + 1))));
          A.head?.setLngLat(path[cut]);
        } else if (prev !== undefined && prev === ctl - 1 && !reducedSeg && cut > stopAt[prev]) {
          const from = stopAt[prev], D = 1600, t0 = performance.now();
          if (!A.head) { const el = document.createElement('div'); el.className = 'mk-comet'; el.innerHTML = '<i></i><b></b>'; A.head = new maplibregl.Marker({ element: el }).setLngLat(path[from]).addTo(map); }
          A.head.getElement().classList.remove('done');
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            const x = from + (cut - from) * e, i = Math.min(cut - 1, Math.floor(x)), f = x - i;
            const p: LngLat = [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
            (map.getSource('route') as GeoJSONSource).setData(fc(line([...path.slice(0, i + 1), p])));
            A.head?.setLngLat(p);
            if (k < 1) A.segRaf = requestAnimationFrame(step); else { A.segRaf = 0; A.head?.getElement().classList.add('done'); }
          };
          A.segRaf = requestAnimationFrame(step);
        } else {
          A.head?.remove(); A.head = null;
          (map.getSource('route') as GeoJSONSource).setData(fc(line(path.slice(0, cut + 1))));
        }
      }
      anim.current.reached = ctl; anim.current.arrows = routeArrows(path, stopAt);
      // Vista de conjunto (historia recién abierta, en pausa): todas las paradas, respetando las columnas.
      // Después, la cámara va a la parada actual; si ya está cerca (zoom 15 o más) no cambia el zoom.
      const reducedMo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const ek = rkey + '@' + (P.routeOverview ? 'all' : ctl);
      if (anim.current.eased !== ek) {
        anim.current.eased = ek; const z = map.getZoom();
        if (P.routeOverview) {
          const b = new maplibregl.LngLatBounds([R[0].lon, R[0].lat], [R[0].lon, R[0].lat]); R.forEach((s) => b.extend([s.lon, s.lat]));
          // Arriba más aire: el cuadro «Recorrido» y la captura que se levanta sobre la parada.
          const pad = P.padding ? { top: P.padding.top + 180, right: P.padding.right + 60, bottom: P.padding.bottom + 60, left: P.padding.left + 60 } : { top: 180, right: 60, bottom: 60, left: 60 };
          // Al abrir la historia cambian las columnas en este mismo render: se encuadra en el cuadro siguiente,
          // con el mapa ya en su tamaño nuevo (si no, el encuadre queda corrido).
          requestAnimationFrame(() => {
            if (anim.current.eased !== ek) return;
            map.resize();
            map.fitBounds(b, { padding: pad, maxZoom: 16, duration: reducedMo ? 0 : 800, bearing: map.getBearing(), pitch: map.getPitch() });
          });
        } else map.easeTo({ center: [R[ctl].lon, R[ctl].lat], zoom: z >= 15 ? z : 16, duration: reducedMo ? 0 : 700 });
      }
      // Avance continuo (reproduciendo): de la parada actual a la siguiente durante todo el capítulo, a ritmo
      // parejo, con el punto luminoso adelante y el mapa acompañando. En pausa se queda donde llegó.
      const A2 = anim.current, lead = P.routeLead && ctl < R.length - 1 && !P.routeOverview ? P.routeLead : null;
      const lk = lead ? `${rkey}#${ctl}#${lead.key}` : '';
      if (A2.leadKey !== lk) {
        A2.leadKey = lk; cancelAnimationFrame(A2.leadRaf ?? 0); A2.leadRaf = 0; A2.leadTo = undefined;
        const from = stopAt[ctl], to = lead ? stopAt[ctl + 1] : from;
        if (lead && !reducedMo && to > from) {
          A2.leadTo = ctl + 1;
          if (!A2.head) { const el = document.createElement('div'); el.className = 'mk-comet'; el.innerHTML = '<i></i><b></b>'; A2.head = new maplibregl.Marker({ element: el }).setLngLat(path[from]).addTo(map); }
          A2.head.getElement().classList.remove('done');
          const z = map.getZoom(), t0 = performance.now(), D = lead.ms;
          map.easeTo({ center: [R[ctl + 1].lon, R[ctl + 1].lat], zoom: z >= 15 ? z : 16, duration: D, easing: (t) => t });
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / D), x = from + (to - from) * k, i = Math.min(to - 1, Math.floor(x)), f = x - i;
            const pt: LngLat = [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
            (map.getSource('route') as GeoJSONSource).setData(fc(line([...path.slice(0, i + 1), pt])));
            (map.getSource('routeGhost') as GeoJSONSource).setData(fc(line([pt, ...path.slice(i + 1)])));
            A2.head?.setLngLat(pt);
            if (k < 1) A2.leadRaf = requestAnimationFrame(step); else A2.leadRaf = 0;
          };
          A2.leadRaf = requestAnimationFrame(step);
        }
      }
    } else {
      anim.current.eased = undefined;
      (map.getSource('routeGhost') as GeoJSONSource).setData(fc(R ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: streetRoute(R.map((s) => [s.lon, s.lat])).path }, properties: {} }] : []));
    }
    const zp = P.zonePaint;
    (map.getSource('zonePaint') as GeoJSONSource).setData(fc(zp && L.zones ? P.zones.map((z): GeoJSON.Feature => ({
      type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: hexesOutline(zoneHexes([z])) }, properties: { id: z.id, color: zp.color(z), dim: zp.dim(z) },
    })) : []));
    const pk = P.pickCells ?? [];
    (map.getSource('pick') as GeoJSONSource).setData(fc(pk.length ? [
      ...pk.map((cell): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hexRing(cell)] }, properties: { k: 'cell' } })),
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: hexesOutline(pk) }, properties: { k: 'outline' } } as GeoJSON.Feature,
    ] : []));
    const sk = P.sketch ?? [];
    (map.getSource('sketch') as GeoJSONSource).setData(fc([
      ...sk.map((c): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
      ...(sk.length >= 3 ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...sk, sk[0]]] }, properties: {} } as GeoJSON.Feature]
        : sk.length === 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: sk }, properties: {} } as GeoJSON.Feature] : []),
    ]));

    // Marcadores HTML (rótulos de zona, alertas, unidades, paradas del recorrido, sector).
    // Se reconcilian por clave: se actualizan en su lugar en vez de recrearse en cada refresco.
    const seen = new Set<string>();
    const add = (key: string, lngLat: LngLat, node: React.ReactNode, onClick?: () => void, anchor: maplibregl.PositionAnchor = 'center', label?: string, hv?: (x: number, y: number) => Hover, offset: [number, number] = [0, 0]) => {
      seen.add(key);
      let h = markers.current.get(key);
      if (!h) {
        const div = document.createElement(onClick ? 'button' : 'div');
        if (onClick) div.addEventListener('click', (e) => { e.stopPropagation(); h!.onClick?.(); });
        // Drones y helicópteros se mueven: al salir el cursor la ficha espera un instante, por si el ícono solo se corrió.
        let leave = 0;
        div.addEventListener('mouseenter', (e) => { clearTimeout(leave); const me = e as MouseEvent; if (h!.hover) setHover(h!.hover(me.clientX, me.clientY)); });
        div.addEventListener('mouseleave', () => { if (!h!.hover) return; if (key.startsWith('air')) leave = window.setTimeout(() => setHover(null), 600); else setHover(null); });
        const root = createRoot(div);
        h = { m: new maplibregl.Marker({ element: div, anchor }).setLngLat(lngLat).addTo(map), root, el: div };
        markers.current.set(key, h);
      } else h.m.setLngLat(lngLat);
      h.m.setOffset(offset);
      h.onClick = onClick; h.hover = hv;
      if (label) h.el.setAttribute('aria-label', label);
      h.root.render(node);
    };
    const detail = map.getZoom() >= SHOW_DETAIL && !focus;
    if (P.region && !detail && !focus) add('region', [P.region.lon, P.region.lat], <span className="mk-region"><b>{P.region.title}</b><span>{P.region.sub}</span></span>, P.region.onClick, 'bottom', P.region.title);
    const zonesShown: Zone[] = [];
    if (detail && L.zones && !P.compact && map.getZoom() >= ZONE_LABEL_Z) for (const z of P.zones) {
      const dimZ = !!P.highlightZones && !P.highlightZones.includes(z.id) && P.selectedZone !== z.id;
      // El rótulo de la zona es neutro: que tenga una alerta lo dice el ícono de la alerta, no un color
      // (en el mapa, los íconos son alertas y los colores son lo que miden los hexágonos).
      const s = st[z.id];
      // Sin `zoneStatus` el mapa no mide (placas, formularios): solo el nombre, nunca "Sin datos".
      if (!P.zoneStatus) { zonesShown.push(z); add('z' + z.id, [z.lon, z.lat], <span className={`mk-zone ${dimZ ? 'dimz' : ''}`}><i className="zdot" aria-hidden /><span className="zl"><span className="zn">{z.name}</span></span></span>, P.onZoneClick ? () => P.onZoneClick!(z.id) : undefined, 'center', `Zona ${z.name}`); continue; }
      const nodata = !s || s.count == null;
      const ev = P.eventOf?.(z.id);
      zonesShown.push(z);
      add('z' + z.id, [z.lon, z.lat], (
        // Rótulo mínimo: un punto en el centro de la zona y su nombre chico. El conteo (o por qué no hay)
        // aparece al pasar el mouse o con la zona elegida. El evento no se repite en cada zona: tiene su
        // propio rótulo sobre su área.
        <span className={`mk-zone ${nodata ? 'nodata' : ''} ${P.selectedZone === z.id || P.highlightZones?.includes(z.id) ? 'sel' : ''} ${dimZ ? 'dimz' : ''}`}>
          <i className="zdot" aria-hidden />
          <span className="zl"><span className="zn">{z.name}</span><b>{nodata ? (!z.cameras.length ? 'Sin cámara' : s?.coverage === 'sin_cobertura' ? 'Sin medición' : 'Sin datos') : fmtCrowd(s.count!)}</b></span>
        </span>
      ), P.onZoneClick ? () => P.onZoneClick!(z.id) : undefined, 'center', `Zona ${z.name}: ${nodata ? (!z.cameras.length ? 'sin cámara' : s?.coverage === 'sin_cobertura' ? 'sin medición' : 'sin datos') : fmtCrowd(s.count!) + ' personas'}${ev?.live ? ` · evento en curso hasta ${hhmm(ev.end)}` : ''}`);
    }
    // Rótulo del evento: arriba de su área (en el punto más al norte), con su nombre y hasta qué hora dura.
    if (!focus && !P.compact && map.getZoom() >= EVENT_LABEL_Z) for (const e of eventAreas) {
      const when = e.live ? `Evento en curso · hasta ${hhmm(e.end)}` : `Programado · empieza ${inTime(e.start)}`;
      add('ev' + e.name, e.top, (
        <span className={`mk-event ${e.live ? '' : 'next'} ${e.dim ? 'dimz' : ''} ${P.onEventClick ? 'link' : ''}`}>
          <span className="el"><Icon name="flag" className="eflag" /><span className="en">{e.name}</span><em>{when}</em></span>
          <u className="estem" aria-hidden />
        </span>
      ), P.onEventClick ? () => P.onEventClick!(e.id) : undefined, 'bottom', `${e.live ? `Evento en curso: ${e.name}, hasta ${hhmm(e.end)}` : `Evento programado: ${e.name}, empieza ${inTime(e.start)}`}${P.onEventClick ? '. Abrir ficha' : ''}`);
    }
    // Nombres de zona que se pisan con otro rótulo: el de la zona elegida siempre queda; después, los de
    // las zonas con más gente. Los que no entran quedan como punto hasta que hay lugar (al acercarse).
    // El rótulo del evento va primero, como obstáculo.
    {
      const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
      const hits = (b: (typeof taken)[number]) => taken.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
      if (!focus && !P.compact && map.getZoom() >= EVENT_LABEL_Z) for (const e of eventAreas) { const q = map.project(e.top), w = Math.max(e.name.length * 6.6, 150) + 36; taken.push({ x0: q.x - w / 2, x1: q.x + w / 2, y0: q.y - 52, y1: q.y }); }
      const isSel = (z: Zone) => P.selectedZone === z.id || selZone === z.id || !!P.highlightZones?.includes(z.id);
      const order = [...zonesShown].sort((a, b) => Number(isSel(b)) - Number(isSel(a)) || (st[b.id]?.count ?? -1) - (st[a.id]?.count ?? -1));
      for (const z of order) {
        const q = map.project([z.lon, z.lat]), b = { x0: q.x - 6, x1: q.x + 16 + z.name.length * 5.8, y0: q.y - 9, y1: q.y + 9 };
        const solo = !isSel(z) && hits(b);
        markers.current.get('z' + z.id)?.el.classList.toggle('z-solo', solo);
        if (!solo) taken.push(b);
      }
    }
    const zoomTo = (c: LngLat) => () => map.easeTo({ center: c, zoom: Math.min(17.2, zoom + 1.8), duration: 400 });
    const groupMk = (cat: GroupCat, g: { key: string; items: { id: string }[]; c: LngLat }) =>
      add(`g${cat}${g.key}`, g.c, <GroupChip cat={cat} n={g.items.length} />, zoomTo(g.c), 'center', `${g.items.length} agrupados · acercar`, (x, y) => ({ kind: 'group', cat, ids: g.items.map((i) => i.id), x, y }));
    if (detail) camSplit.groups.forEach((g) => groupMk('cameras', g));
    if (detail && P.units) {
      // Las que van en camino no se agrupan: se dibujan aparte, latiendo, con "En camino".
      // Se ven siempre, aunque la capa Unidades esté apagada: son la respuesta a una alerta gestionada.
      // No se dice hacia dónde: la unidad sigue a una alerta que puede moverse (un auto); a qué responde
      // va en la tarjeta al pasar el mouse.
      const going = P.units.filter((u) => u.enRoute);
      for (const u of going) {
        add('u' + u.id, [u.lon, u.lat], (
          <span className="mk-unit-go">
            <i className="ug-ring" aria-hidden /><i className="ug-ring r2" aria-hidden />
            <UnitHex type={u.type} status={u.status} size={24} />
            <em className="ug-tag">En camino</em>
          </span>
        ), undefined, 'center', `${u.id} en camino · ${u.enRoute!.label}`, (x, y) => ({ kind: 'unit', id: u.id, x, y }));
      }
    }
    if (detail && L.units && P.units) {
      // Unidades: se ven sueltas hasta más lejos. Por zona recién debajo de zoom 14,5; antes solo se juntan las que se pisan (22 px).
      const us = split(P.units.filter((u) => !u.enRoute), (u) => [u.lon, u.lat], (u) => u.zoneId, 1, { zoneBelow: 14.5, cell: zoom >= 17 ? 0 : zoom >= 13.5 ? 22 : 44 });
      for (const u of us.singles) add('u' + u.id, [u.lon, u.lat], <UnitHex type={u.type} status={u.status} size={22} />, undefined, 'center', `${u.id} · ${u.type}`, (x, y) => ({ kind: 'unit', id: u.id, x, y }));
      us.groups.forEach((g) => groupMk('units', g));
    }
    // Drones y helicópteros: siempre a la vista (son pocos y no dependen de la capa Unidades, que arranca apagada), nunca agrupados. La posición la mueve la animación
    // de cada cuadro (moveAir); acá solo se crean, con la altitud al lado si hay zoom.
    // Al pasar el mouse, la ficha de monitoreo; con un clic, su ficha en el lateral con la transmisión de la
    // cámara de a bordo (como lo vio el ministro en el sistema del Gobierno, reunión del 25/11).
    // Cada tipo tiene su chip en la franja de capas (Drones, Helicópteros).
    air.current.show = AIRCRAFT.filter((a) => (a.type === 'Dron' ? L.drones !== false : L.helis !== false));
    air.current.on = detail && air.current.show.length > 0;
    // Si se apaga el tipo con su ficha abierta, la ficha se cierra.
    setHover((h) => (h?.kind === 'air' && !(air.current.on && air.current.show.some((x) => x.id === h.id)) ? null : h));
    if (air.current.on) for (const a of air.current.show) {
      const f = airAt(a, Date.now());
      const open = P.onAirClick ? () => { setHover(null); P.onAirClick!(a.id); } : undefined;
      add('air' + a.id, [f.lon, f.lat], <span className="mk-air"><AirSprite type={a.type} heading={f.heading} />{zoom >= 15.5 && <em className="air-tag">{f.altM} m</em>}</span>,
        open, 'center', `${a.type} ${a.id} · ${a.mission} · ver transmisión`, (x, y) => ({ kind: 'air', id: a.id, x, y }));
    }
    const alertSplit = focus ? { singles: [] as Alert[], groups: [] } : L.alerts && P.alerts && detail && !P.compact ? split(P.alerts, (a) => [a.lon, a.lat], (a) => a.zoneId) : { singles: P.compact && L.alerts ? P.alerts ?? [] : [], groups: [] };
    // La alerta abierta en el lateral se dibuja siempre: aunque la capa Alertas esté apagada o quede dentro de un grupo.
    if (selAlert && !focus) {
      alertSplit.groups = alertSplit.groups.map((g) => ({ ...g, items: g.items.filter((x) => x.id !== selAlert.id) })).filter((g) => g.items.length > 1 || (g.items.length === 1 && (alertSplit.singles.push(g.items[0]), false)));
      if (!alertSplit.singles.some((x) => x.id === selAlert.id)) alertSplit.singles.push(selAlert);
    }
    // Grupo de alertas: la criticidad más alta y el atraso más grande de las que esperan decisión.
    alertSplit.groups.forEach((g) => {
      const worst = g.items.reduce((w, x) => (SEVERITY_RANK[x.severity] < SEVERITY_RANK[w] ? x.severity : w), 'baja' as Alert['severity']);
      const info = g.items.map((x) => ({ severity: x.severity, createdAt: waitingSince(x), waiting: x.review === 'por_revisar' }));
      add(`galerts${g.key}`, g.c, <GroupChip cat="alerts" n={g.items.length} severity={worst} alerts={info} />, zoomTo(g.c), 'center', `${g.items.length} alertas agrupadas · acercar`, (x, y) => ({ kind: 'group', cat: 'alerts', ids: g.items.map((i) => i.id), x, y }));
    });
    if (P.alerts) for (const a of alertSplit.singles) {
      // Chapa con la punta en el lugar exacto: el dibujo dice el tipo, las barras la criticidad y el borde la espera.
      // .mk-alert-scale crece con el zoom del mapa (variable --az, ver onZoom), sin esperar a que termine.
      add('a' + a.id, [a.lon, a.lat], <span className={`mk-alert-scale ${P.freshAlerts?.includes(a.id) ? 'is-new' : ''}`} onMouseEnter={() => P.onAlertHover?.(a.id)} onMouseLeave={() => P.onAlertHover?.(null)}><AlertMark kind={a.kind} severity={a.severity} since={waitingSince(a)} state={a.review === 'por_revisar' ? 'espera' : a.review === 'confirmada' ? 'confirmada' : 'descartada'} units={P.units?.filter((u) => u.enRoute?.alertId === a.id).length ?? 0} size={34} />{a.review === 'descartada' && <i className="mk-done" aria-label="Descartada" />}{goingTo(a) && <i className="mk-go-tag">Unidades en camino</i>}{P.freshAlerts?.includes(a.id) && <><i className="new-ring" /><i className="new-ring r2" /><i className="new-ring r3" /></>}</span>, P.onAlertClick ? () => P.onAlertClick!(a.id) : undefined, 'bottom', `Alerta ${a.id}${goingTo(a) ? ' · unidades en camino' : ''}`);
    }
    if (selCam && !focus) add('csel' + selCam.id, [selCam.lon, selCam.lat], <span className="mk-camsel" aria-hidden><i /><i className="r2" /><b>{selCam.id}</b></span>);
    if (P.signal) add('sig' + P.signal.key, [P.signal.lon, P.signal.lat], <span className="mk-signal" aria-hidden><i /><i /><i /><s /><b /><em>{P.signal.label}</em></span>);
    // Con un recorrido en foco solo se dibuja el punto que se está marcando ("nuevo"), p. ej. evidencia de la historia.
    if (P.incidents) for (const x of P.incidents) if (!focus || x.id === 'nuevo') add('inc' + x.id, [x.lon, x.lat], <span className={`mk-incident ${x.id === 'nuevo' ? 'new' : ''}`} title={x.title}><i><Icon name={x.icon ?? 'report'} /></i><b>{x.label}</b></span>, undefined, 'bottom', x.title);
    if (P.pin) add('pin', [P.pin.lon, P.pin.lat], <span className="mk-pin"><i /><b>{P.pin.label}</b></span>, undefined, 'bottom');
    if (R) {
      const reached = anim.current.reached;
      // Pasar el mouse por una parada (o por su captura) pone esa captura adelante de las demás.
      const front = (i: number, on: boolean) => markers.current.get(`rs${i}`)?.el.classList.toggle('is-front', on);
      // Controlado: las paradas que faltan se ven (huecas); en la animación aparecen al pasar.
      R.forEach((s, i) => add(`r${i}`, [s.lon, s.lat], <span className={`mk-stop ${ctl !== null ? 'ctl' : ''} ${s.kind === 'add' ? 'add' : ''} ${i === 0 ? 'first' : ''} ${i === R.length - 1 ? 'last' : ''} ${i <= reached ? 'on' : ctl !== null || manual ? 'ahead' : 'pending'} ${i === reached ? 'now' : ''}`} title={s.title} onMouseEnter={() => front(i, true)} onMouseLeave={() => front(i, false)}>{s.label}{s.time && <em>{s.time}</em>}</span>));
      // Proyección de cámara: cada lectura ya alcanzada levanta su captura sobre la parada, con un haz
      // que baja hasta el punto. Alternan de lado y de altura para no taparse entre paradas vecinas.
      if (snapsRef.current) R.forEach((s, i) => {
        // Controlado: solo la captura de la parada actual, y ninguna si el capítulo actual no tiene lugar.
        // Siguiendo el recorrido (historia): solo la captura del evento actual, para no tapar el mapa.
        if (!s.snap || i > reached || (ctl !== null && (i !== ctl || P.routeCard === false)) || (anim.current.follow && i !== reached)) return;
        add(`rs${i}`, [s.lon, s.lat], <SnapCard s={s} n={ctl !== null ? s.label : String(i + 1).padStart(2, '0')} side={i % 2 ? 'l' : 'r'} beam={SNAP_BEAM + (i % 3) * 40} now={i === reached} last={i === R.length - 1} />, undefined, 'bottom');
      });
      // Sentido del recorrido: una flecha a mitad de cada tramo ya recorrido
      anim.current.arrows.forEach((ar, i) => {
        if (i >= reached) return; const deg = ar.deg;
        add(`ra${i}`, ar.p, <span className="mk-dir" style={{ transform: `rotate(${deg}deg)` }} aria-hidden><svg viewBox="0 0 12 12"><path d="M6 1.5l4 6H2z" fill="currentColor" /></svg></span>);
      });
    }
    // Atenuar todo lo que no es lo seleccionado en el lateral
    // Hexágonos atenuados mientras hay algo seleccionado en el lateral
    const dim = P.focusSel && !focus ? 0.4 : 1;
    for (const id of HEX_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', dim);
    for (const [key, h] of markers.current) {
      const keep = !P.focusSel || focus || key === 'a' + (selAlert?.id ?? '') || (selZone && key === 'z' + selZone) || key === 'pin' || key.startsWith('inc') || key.startsWith('sig') || key.startsWith('csel') || /^r[as]?\d/.test(key);
      h.el.classList.toggle('is-dim', !keep && key !== 'a' + P.hoverAlert);
      h.el.classList.toggle('is-hover', !!P.hoverAlert && key === 'a' + P.hoverAlert);
      h.el.classList.toggle('is-sel', !!P.focusSel && !focus && (key === 'a' + (selAlert?.id ?? '') || (P.focusSel.k === 'zona' && key === 'z' + P.focusSel.id)));
    }
    for (const [key, h] of markers.current) {
      if (seen.has(key)) continue;
      h.m.remove(); const root = h.root; setTimeout(() => root.unmount());
      markers.current.delete(key);
    }
  }
  /* ---------- Animación del recorrido ---------- */
  function stopRoute() {
    cancelAnimationFrame(anim.current.raf); cancelAnimationFrame(anim.current.segRaf ?? 0); anim.current.segRaf = 0; cancelAnimationFrame(anim.current.leadRaf ?? 0); anim.current.leadRaf = 0; anim.current.leadKey = undefined; anim.current.leadTo = undefined; anim.current.ctlKey = undefined; anim.current.reached = -1;
    anim.current.head?.remove(); anim.current.head = null; setHud(null);
    const map = mapRef.current; if (map && ready.current) (map.getSource('route') as GeoJSONSource).setData(fc([]));
  }
  /** Todo el recorrido a la vista (historia recién abierta, antes de reproducir). */
  function fitRoute(R: RouteStop[]) {
    const map = mapRef.current; if (!map) return;
    const b = new maplibregl.LngLatBounds([R[0].lon, R[0].lat], [R[0].lon, R[0].lat]); R.forEach((s) => b.extend([s.lon, s.lat]));
    const pad = cb.current.padding ? { top: cb.current.padding.top + 180, right: cb.current.padding.right + 60, bottom: cb.current.padding.bottom + 60, left: cb.current.padding.left + 60 } : { top: 180, right: 60, bottom: 60, left: 60 };
    requestAnimationFrame(() => { map.resize(); map.fitBounds(b, { padding: pad, maxZoom: 16, duration: 800, bearing: map.getBearing(), pitch: map.getPitch() }); });
  }
  /** `follow`: la cámara va de evento en evento (como en God's Eye View) y cada tramo dura lo mismo. */
  function playRoute(R: RouteStop[], follow = false) {
    const map = mapRef.current; if (!map || !ready.current) return;
    cancelAnimationFrame(anim.current.raf); anim.current.follow = follow;
    // El vehículo va por las calles: camino más corto por la red vial entre lecturas consecutivas.
    const { path: pts, stopAt } = streetRoute(R.map((s) => [s.lon, s.lat] as LngLat)); const kx = Math.cos((pts[0][1] * Math.PI) / 180);
    const seg = pts.slice(1).map((q, i) => Math.hypot((q[0] - pts[i][0]) * kx, q[1] - pts[i][1]));
    const cum = [0]; seg.forEach((d) => cum.push(cum[cum.length - 1] + d)); const total = cum[cum.length - 1] || 1;
    const stopD = stopAt.map((ix) => cum[ix]);
    // Flecha de sentido a mitad de cada tramo, sobre la calle y orientada como la calle en ese punto.
    const at = (d: number) => { let i = 0; while (i < seg.length - 1 && cum[i + 1] <= d) i++; const f = seg[i] ? Math.min(1, (d - cum[i]) / seg[i]) : 0; return { i, p: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f] as LngLat }; };
    anim.current.arrows = stopD.slice(1).map((d1, k) => { const m = at((stopD[k] + d1) / 2); const a = pts[m.i], b = pts[m.i + 1]; return { p: m.p, deg: (Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI }; });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced ? 0 : follow ? 3200 * Math.max(1, R.length - 1) : Math.min(9000, Math.max(3200, 1300 * (R.length - 1)));
    // Siguiendo: cada tramo entre dos eventos dura lo mismo (tiempo lineal por tramo, no por distancia).
    const distAt = (k: number) => { const segs = Math.max(1, stopD.length - 1), x = k * segs, j = Math.min(segs - 1, Math.floor(x)), f = x - j; return stopD.length > 1 ? stopD[j] + (stopD[j + 1] - stopD[j]) * f : 0; };
    if (follow) map.easeTo({ center: [R[0].lon, R[0].lat], zoom: Math.max(map.getZoom(), 15.5), duration: reduced ? 0 : 900 });
    if (!anim.current.head) { const el = document.createElement('div'); el.className = 'mk-comet'; el.innerHTML = '<i></i><b></b>'; anim.current.head = new maplibregl.Marker({ element: el }).setLngLat(pts[0]).addTo(map); }
    anim.current.head.getElement().classList.remove('done');
    anim.current.reached = -1; const t0 = performance.now();
    const frame = (now: number) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1; const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; const d = follow ? distAt(k) : e * total;
      const { i, p } = at(d);
      (map.getSource('route') as GeoJSONSource).setData(fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [...pts.slice(0, i + 1), p] }, properties: {} }]));
      anim.current.head?.setLngLat(p);
      const reached = k >= 1 ? R.length - 1 : stopD.findLastIndex((c) => c <= d + 1e-12);
      if (reached !== anim.current.reached) {
        anim.current.reached = reached; setHud({ reached, n: R.length, done: k >= 1 });
        if (follow && reached >= 0) map.easeTo({ center: [R[reached].lon, R[reached].lat], duration: reduced ? 0 : 900 });
        sync();
      }
      if (k < 1) anim.current.raf = requestAnimationFrame(frame); else anim.current.head?.getElement().classList.add('done');
    };
    anim.current.raf = requestAnimationFrame(frame);
  }
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setHover(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const replay = () => { const R = cb.current.route; if (R && R.length > 1) playRoute(R, !!anim.current.follow); };
  useEffect(() => () => { cancelAnimationFrame(anim.current.raf); if (field.current.timer) clearTimeout(field.current.timer); }, []);
  /* ---------- Drones y helicópteros: se mueven en cada cuadro, sin pasar por React ---------- */
  useEffect(() => {
    let raf = 0;
    const moveAir = () => {
      raf = requestAnimationFrame(moveAir);
      const map = mapRef.current; if (!map || !ready.current) return;
      const A = air.current, now = Date.now();
      if (A.on) for (const a of A.show) {
        const h = markers.current.get('air' + a.id); if (!h) continue;
        const f = airAt(a, now);
        h.m.setLngLat([f.lon, f.lat]);
        (h.el.querySelector('.air3d') as HTMLElement | null)?.style.setProperty('--hdg', `${f.heading}deg`);
      }
      // La estela se recalcula unas 8 veces por segundo: alcanza para que se vea continua.
      const src = map.getSource('airTrail') as GeoJSONSource | undefined; if (!src) return;
      if (A.on && now - A.trailAt > 120) {
        A.trailAt = now; A.trailShown = true;
        src.setData(fc(A.show.map((a) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: airTrail(a, now, 0.5) }, properties: { id: a.id } }))));
      } else if (!A.on && A.trailShown) { A.trailShown = false; src.setData(fc([])); }
    };
    raf = requestAnimationFrame(moveAir);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(sync);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const on = () => sync();
    map.on('zoomend', on); map.on('moveend', on); return () => { map.off('zoomend', on); map.off('moveend', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctlAt = p.routeAt != null && p.route?.length ? Math.max(0, Math.min(p.routeAt, p.route.length - 1)) : null;
  return (
    <>
      <div ref={el} className="map" role="region" aria-label="Mapa" />
      {!p.compact && <ViewControl view={view} map={mapRef} />}
      {p.route && (ctlAt !== null || (hud && p.route.length > 1)) && (() => {
        // Controlado (historia): el HUD sigue a `routeAt` y a `routeCount`; si no, al avance de la animación.
        const H = ctlAt !== null ? { reached: ctlAt, n: p.route.length, done: true } : hud!;
        // Un recorrido puede reemplazar a otro antes de reiniciar el HUD: el índice no debe pasarse del nuevo
        const s = p.route[Math.min(p.route.length - 1, Math.max(0, H.reached))];
        return (
          <div className="route-hud" role="status" aria-live="polite">
            <div className="rh-top"><span className="rh-eyebrow">Recorrido{p.routeLabel ? ` · ${p.routeLabel}` : ''}</span><span className="rh-count">{ctlAt !== null && p.routeCount ? p.routeCount.now : String(Math.max(1, H.reached + 1)).padStart(2, '0')}<small>/{String(ctlAt !== null && p.routeCount ? p.routeCount.total : H.n).padStart(2, '0')}</small></span></div>
            <div className="rh-now"><b>{s.time ?? ''}</b><span>{s.title.split(' · ').slice(1).join(' · ') || s.title}</span></div>
            <div className="rh-bar"><i style={{ width: `${((Math.max(0, H.reached) + (H.done ? 1 : 0.5)) / H.n) * 100}%` }} /></div>
            {/* Qué es seguro y qué no: las paradas son lecturas de cámara; lo de entre medio, la ruta probable. */}
            <div className="rh-key" aria-label="Referencia del recorrido">
              <span><i className="rk-stop" aria-hidden />Detección de cámara</span>
              <span title="Entre estas dos cámaras no hay otra que lo haya visto: se muestra la ruta más corta por las calles"><i className="rk-inf" aria-hidden />Tramo inferido · sin cámara</span>
              {p.route.some((x) => x.kind === 'add') && <span title="Evidencia que agregó el analista: no es una lectura de cámara"><i className="rk-add" aria-hidden />Agregado</span>}
            </div>
            <div className="rh-actions">
              {p.route.some((x) => x.snap) && <button className="rh-replay" onClick={() => setSnaps(!snaps)}><Icon name={snaps ? 'visibility_off' : 'image'} />{snaps ? 'Ocultar capturas' : 'Ver capturas'}</button>}
              {ctlAt === null && H.done && <button className="rh-replay" onClick={replay}><Icon name="refresh" />Repetir trazado</button>}
            </div>
          </div>
        );
      })()}
      {hover && <MapCard h={hover} units={p.units ?? []} cameras={p.cameras ?? []} zones={p.zones} alerts={p.alerts ?? []} />}
      {google && (
        <div className="gcredits" style={p.padding ? { left: p.padding.left + 12, bottom: p.padding.bottom + 8 } : undefined}>
          <img src={GOOGLE_LOGO} alt="Google" /><span>{google.copyright ?? 'Datos del mapa © Google'}</span>
        </div>
      )}
    </>
  );
}


/* ---------- Control de perspectiva ----------
   Acercar y alejar, 2D/3D en un solo botón, girar 30° a cada lado y una brújula que muestra hacia
   dónde mira el mapa (clic: vuelve al norte sin perder la inclinación). Todo con transición suave.
   Con el mouse: botón derecho (o Ctrl + arrastrar) gira e inclina. */
function ViewControl({ view, map }: { view: { bearing: number; pitch: number }; map: React.RefObject<MLMap | null> }) {
  const ease = (o: maplibregl.EaseToOptions) => map.current?.easeTo({ duration: 650, ...o });
  const is3d = view.pitch > 10;
  const card = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round((((view.bearing % 360) + 360) % 360) / 45) % 8];

  // Brújula arrastrable: mientras se mantiene apretada, mover a los lados gira el mapa y mover arriba/abajo
  // lo inclina (como un joystick). Sigue al dedo/mouse en vivo, sin transición. Si no se movió, es un clic.
  const [drag, setDrag] = useState(false);
  const start = useRef<{ x: number; y: number; bearing: number; pitch: number } | null>(null);
  const moved = useRef(false);
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const m = map.current; if (!m || e.button !== 0) return;
    m.stop();
    start.current = { x: e.clientX, y: e.clientY, bearing: m.getBearing(), pitch: m.getPitch() };
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current, m = map.current; if (!s || !m) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!moved.current && Math.hypot(dx, dy) < 4) return;
    if (!moved.current) { moved.current = true; setDrag(true); }
    // 1 px = 0,8° de giro; arrastrar hacia arriba inclina (más 3D), hacia abajo endereza (vista cenital).
    m.jumpTo({ bearing: s.bearing + dx * 0.8, pitch: Math.max(0, Math.min(m.getMaxPitch(), s.pitch - dy * 0.5)) });
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!start.current) return;
    start.current = null; setDrag(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: { bearing: view.bearing - 15 }, ArrowRight: { bearing: view.bearing + 15 }, ArrowUp: { pitch: Math.min(60, view.pitch + 10) }, ArrowDown: { pitch: Math.max(0, view.pitch - 10) } }[e.key];
    if (!step) return;
    e.preventDefault(); ease({ ...step, duration: 250 });
  };

  return (
    <div className="viewctl" role="group" aria-label="Vista del mapa">
      <button onClick={() => ease({ zoom: (map.current?.getZoom() ?? 14) + 1, duration: 300 })} aria-label="Acercar" title="Acercar"><svg viewBox="0 0 20 20" aria-hidden><path d="M10 4v12M4 10h12" /></svg></button>
      <button onClick={() => ease({ zoom: (map.current?.getZoom() ?? 14) - 1, duration: 300 })} aria-label="Alejar" title="Alejar"><svg viewBox="0 0 20 20" aria-hidden><path d="M4 10h12" /></svg></button>
      <span className="viewctl-sep" />
      <button className={`viewctl-3d ${is3d ? 'on' : ''}`} aria-pressed={is3d} onClick={() => ease({ pitch: is3d ? 0 : 45 })} title={is3d ? 'Ver en 2D (desde arriba)' : 'Ver en 3D (inclinado)'}>{is3d ? '3D' : '2D'}</button>
      <button onClick={() => ease({ bearing: view.bearing - 30 })} aria-label="Girar a la izquierda" title="Girar a la izquierda"><svg viewBox="0 0 20 20" aria-hidden><path d="M6 6.5A6 6 0 1 1 4.2 11" /><path d="M6 2.8v3.7H2.3" /></svg></button>
      <button onClick={() => ease({ bearing: view.bearing + 30 })} aria-label="Girar a la derecha" title="Girar a la derecha"><svg viewBox="0 0 20 20" aria-hidden><path d="M14 6.5A6 6 0 1 0 15.8 11" /><path d="M14 2.8v3.7h3.7" /></svg></button>
      <button
        className={`viewctl-compass ${drag ? 'dragging' : ''}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onClick={() => { if (moved.current) { moved.current = false; return; } ease({ bearing: 0 }); }}
        onKeyDown={onKey}
        aria-label={`Mira hacia ${card}, inclinación ${Math.round(view.pitch)}°. Arrastra para girar e inclinar; flechas del teclado también. Clic: volver al norte`}
        title="Arrastra: ↔ girar · ↕ inclinar · Clic: volver al norte">
        <svg viewBox="0 0 24 24" aria-hidden style={{ transform: `rotate(${-view.bearing}deg)` }}><path d="M12 3l3.2 9H8.8z" className="n" /><path d="M12 21l-3.2-9h6.4z" className="s" /></svg>
        <small>{card}</small>
      </button>
    </div>
  );
}

/* ---------- Captura proyectada de una lectura ----------
   Cuadro de la cámara flotando sobre la parada, unido al punto por un haz (como una proyección de
   cámara). Solo muestra evidencia real; mientras no la hay, el marcador con el logo en B/N. */
const SNAP_W = 152, SNAP_H = 128, SNAP_GAP = 14, SNAP_BEAM = 44;

/** Flecha de sentido a mitad de cada tramo del camino (por distancia), orientada como la calle en ese punto. */
function routeArrows(pts: LngLat[], stopAt: number[]): { p: LngLat; deg: number }[] {
  if (pts.length < 2) return [];
  const kx = Math.cos((pts[0][1] * Math.PI) / 180);
  const seg = pts.slice(1).map((q, i) => Math.hypot((q[0] - pts[i][0]) * kx, q[1] - pts[i][1]));
  const cum = [0]; seg.forEach((d) => cum.push(cum[cum.length - 1] + d));
  return stopAt.slice(1).map((ix, k) => {
    const d = (cum[stopAt[k]] + cum[ix]) / 2; let i = 0;
    while (i < seg.length - 1 && cum[i + 1] <= d) i++;
    const f = seg[i] ? Math.min(1, (d - cum[i]) / seg[i]) : 0; const a = pts[i], b = pts[i + 1];
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] as LngLat, deg: (Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI };
  });
}
/** `n`: número que se lee en la tarjeta, el mismo que el de la parada (en la historia, el del capítulo). */
function SnapCard({ s, n, side, beam, now, last }: { s: RouteStop; n: string; side: 'l' | 'r'; beam: number; now: boolean; last: boolean }) {
  const sn = s.snap!; const W = 2 * (SNAP_W + SNAP_GAP); const cx = W / 2;
  const x0 = side === 'r' ? cx + SNAP_GAP : 0, x1 = x0 + SNAP_W;
  return (
    <span className={`mk-snap ${now ? 'now' : ''} ${last ? 'last' : ''}`} style={{ width: W, height: SNAP_H + beam }} role="img" aria-label={`${s.kind === 'add' ? 'Evidencia agregada' : `Captura ${n}: cámara ${sn.camera}`}, ${s.time ?? ''}`}>
      <span className="sn-card" style={{ left: x0, width: SNAP_W }}>
        <span className="sn-frame">{s.clip ? <span className="thumb"><video src={s.clip.src} poster={s.clip.poster} muted loop autoPlay playsInline /></span> : <Evidence ev={sn.evidence} small />}<i className="sn-scan" aria-hidden /><b className="sn-idx">{n}</b></span>
        <span className="sn-row"><b>{s.kind === 'add' ? 'Agregado' : `CAM ${sn.camera}`}</b><em>{s.time}</em></span>
        <span className="sn-row sub"><span>{sn.street}</span>{sn.confidence != null && <em>{Math.round(sn.confidence * 100)} %</em>}</span>
      </span>
      <svg className="sn-beam" width={W} height={beam} viewBox={`0 0 ${W} ${beam}`} aria-hidden>
        <polygon points={`${x0},0 ${x1},0 ${cx},${beam}`} />
        <path d={`M${x0} 0L${cx} ${beam}M${x1} 0L${cx} ${beam}`} />
      </svg>
    </span>
  );
}
