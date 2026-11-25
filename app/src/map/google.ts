/* Base de Google (Map Tiles API 2D), igual que el prototipo (js/map-google-2d.js).
   - "Mapa": roadmap de Google con estilo oscuro en grises (el color queda para los estados).
   - "Satélite": imagen satelital con calles; Google no permite recolorearla, solo se atenúa.
   Condiciones de uso: logo de Google y texto de derechos siempre visibles; sin caché propia
   ni descarga de mosaicos; el mapa solo se visualiza, no se analiza.
   Sin clave o sin conexión, la consola usa el mapa local (src/map/MapView.tsx). */

const API = 'https://tile.googleapis.com';
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
export const hasGoogleKey = () => !!KEY;

export type GoogleBase = 'mapa' | 'satelite';

/** Estilo del roadmap en la paleta del tema (formato de estilos JSON de Google; mismos valores que el prototipo). */
const ROADMAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#111111' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9f9f9f' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#080808' }, { weight: 3 }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#383838' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#cfcfcf' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#b7b7b7' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.fill', stylers: [{ color: '#151515' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#2b2b2b' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#111111' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#838383' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#191919' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#272727' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#111111' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#838383' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#393939' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#4c4c4c' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#484848' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#202020' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#262626' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6d6d6d' }] },
];

const sessions: Partial<Record<string, string>> = {};

/** POST /v1/createSession — una sesión por tipo de base. Lanza si Google la rechaza.
    `bare`: sin rótulos. Es para la capa de baja resolución que se ve mientras cargan los mosaicos
    nítidos: ampliada, con rótulos, mostraría nombres gigantes. */
export async function googleSession(kind: GoogleBase, bare = false): Promise<string> {
  const key = kind + (bare ? '-bare' : '');
  if (sessions[key]) return sessions[key]!;
  if (!KEY) throw new Error('sin clave');
  const hidpi = (window.devicePixelRatio || 1) >= 1.5;
  const scale = hidpi ? { scale: 'scaleFactor2x', highDpi: true } : { scale: 'scaleFactor1x' };
  const body = kind === 'mapa'
    ? { mapType: 'roadmap', language: 'es-419', region: 'SV', ...scale, styles: bare ? [...ROADMAP_STYLE, { elementType: 'labels', stylers: [{ visibility: 'off' }] }] : ROADMAP_STYLE }
    : { mapType: 'satellite', language: 'es-419', region: 'SV', ...(bare ? {} : { layerTypes: ['layerRoadmap'] }), ...scale };
  const res = await fetch(`${API}/v1/createSession?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Google rechazó la sesión (${res.status})`);
  const data = await res.json();
  sessions[key] = data.session as string;
  return sessions[key]!;
}

export const googleTiles = (session: string) => [`${API}/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${KEY}`];

/** GET /tile/v1/viewport — texto de derechos que Google exige mostrar para el encuadre actual. */
export async function googleCopyright(session: string, zoom: number, b: { n: number; s: number; e: number; w: number }) {
  try {
    const q = `session=${session}&key=${KEY}&zoom=${Math.round(zoom)}&north=${b.n}&south=${b.s}&east=${b.e}&west=${b.w}`;
    const res = await fetch(`${API}/tile/v1/viewport?${q}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.copyright as string) || null;
  } catch { return null; }
}

export const GOOGLE_LOGO = 'https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png';
