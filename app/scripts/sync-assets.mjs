// Prepara los recursos locales de la app a partir del prototipo (raíz del repo).
// Todo queda empaquetado: la consola corre sin internet en el servidor del Ministerio.
//   - src/data/generated/geo.json   capas del mapa en GeoJSON (WGS84): vías, edificios, parques, El Salvador
//   - src/data/generated/seed.json  zonas, cámaras y unidades del prototipo (MockDB), con lat/lon
//   - src/data/generated/icons.json iconos de Blueprint (Apache-2.0)
//   - public/media, public/assets   evidencia real y logos
// Uso: node scripts/sync-assets.mjs  (lo corre `npm run dev` y `npm run build`)
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';

const APP = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(APP, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// El prototipo es JS de navegador: se ejecuta en un contexto aislado con lo mínimo que necesita.
const ctx = {
  window: { matchMedia: () => ({ matches: true }) },
  document: { body: { nodeType: 1, classList: { contains: () => false }, querySelectorAll: () => [] }, querySelector: () => null },
  MutationObserver: class { observe() {} },
  console, Math, Date, Map, Set, JSON, Array, Object, Number, String, Promise, setTimeout,
};
vm.createContext(ctx);
const expose = (src, names) => src + '\n' + names.map((n) => `globalThis.${n} = ${n};`).join('\n');
vm.runInContext(expose(read('data/geo.js'), ['GEO']), ctx);
vm.runInContext(expose(read('data/icons.js'), ['BP_ICONS']), ctx);
vm.runInContext(expose(read('js/core.js'), ['MockDB', 'toLatLon', 'Coverage']), ctx);
const { GEO, BP_ICONS, MockDB, toLatLon } = ctx;

const ll = (x, z) => { const p = toLatLon(x, z); return [+p.lon.toFixed(6), +p.lat.toFixed(6)]; };
const pairs = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push(ll(flat[i], flat[i + 1])); return out; };
const ring = (pts) => { const r = pts.map(([x, z]) => ll(x, z)); r.push(r[0]); return r; };
const feat = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const fc = (features) => ({ type: 'FeatureCollection', features });

const roads = fc(GEO.roads.map(([rank, pts]) => feat({ type: 'LineString', coordinates: pairs(pts) }, { rank })));
const closeRing = (c) => (c.push(c[0]), c);
const buildings = fc(GEO.bld.map(([, pts]) => feat({ type: 'Polygon', coordinates: [closeRing(pairs(pts))] })));
const parks = fc(GEO.parks.map((pts) => feat({ type: 'Polygon', coordinates: [closeRing(pairs(pts))] })));
const lonlat = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
const country = fc(GEO.sv.map((pts) => feat({ type: 'Polygon', coordinates: [closeRing(lonlat(pts))] }, { name: 'El Salvador' })));
const region = fc(GEO.ca.map((pts) => feat({ type: 'Polygon', coordinates: [closeRing(lonlat(pts))] })));

const zones = MockDB.zones.map((z) => ({
  id: z.id, name: z.name, lat: z.lat, lon: z.lon, areaM2: Math.round(z.area), capacity: z.planned, est: z.est,
  officers: z.officers, growth: z.growth, cameras: z.cameras, history: z.history.map(Math.round), ring: ring(z.poly),
}));
const cameras = MockDB.cameras.map((c) => ({
  id: c.id, street: c.street, lat: c.lat, lon: c.lon, heading: c.heading, status: c.status, fps: c.fps, zoneId: c.zoneId, compute: c.compute,
}));
const units = MockDB.units.map((u) => { const [lon, lat] = ll(u.x, u.z); return { id: u.id, type: u.type, lat, lon }; });
const plateWatch = MockDB.plateWatch;

const gen = join(APP, 'src/data/generated');
mkdirSync(gen, { recursive: true });
writeFileSync(join(gen, 'geo.json'), JSON.stringify({ roads, buildings, parks, country, region }));
writeFileSync(join(gen, 'seed.json'), JSON.stringify({ zones, cameras, units, plateWatch, origin: { lat: 13.7013, lon: -89.2243 } }));
writeFileSync(join(gen, 'icons.json'), JSON.stringify(BP_ICONS));
// El tema es uno solo para el prototipo y la app: se copia, no se duplica a mano.
cpSync(join(ROOT, 'css/theme.css'), join(gen, 'theme.css'));
for (const d of ['media', 'assets']) cpSync(join(ROOT, d), join(APP, 'public', d), { recursive: true });
// Clave de Google (Map Tiles API) desde config.local.js del prototipo → app/.env.local (no versionado).
// Sin clave, la consola usa el mapa local sin conexión.
try {
  const cfgCtx = { window: {} }; vm.createContext(cfgCtx);
  vm.runInContext(read('config.local.js'), cfgCtx);
  const key = cfgCtx.window.P33_CONFIG?.GOOGLE_MAPS_API_KEY;
  if (key && !key.startsWith('PEGA_')) writeFileSync(join(APP, '.env.local'), `VITE_GOOGLE_MAPS_KEY=${key}\n`);
  console.log('sync-assets: clave de Google', key && !key.startsWith('PEGA_') ? 'encontrada' : 'ausente (mapa local)');
} catch { console.log('sync-assets: sin config.local.js (mapa local)'); }
console.log(`sync-assets: ${roads.features.length} vías, ${buildings.features.length} edificios, ${zones.length} zonas, ${cameras.length} cámaras, ${units.length} unidades, ${Object.keys(BP_ICONS).length} iconos`);
