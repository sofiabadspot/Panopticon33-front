'use strict';
/* =====================================================================
   §1 CONFIG — constantes, paleta y utilidades
   ===================================================================== */
/** Espejo de css/theme.css para three.js, canvas y Cesium (no leen variables CSS).
    Solo grises; el color es solo para estados (red, yellow, green = status-*). */
const COLOR = {
  primary: 0xb9b9b9, subtle: 0x737373, muted: 0xa8a8a8, red: 0xe0453c, yellow: 0xf3ff00,
  green: 0x6cd300, bg: 0x080808, panel: 0x111111, white: 0xf5f5f5, police: 0xbdbdbd,
};
/** Origen local: Monumento al Divino Salvador del Mundo (metros ↔ lat/lon). En producción todo viaja en WGS84. */
const ORIGIN = { lat: 13.7013, lon: -89.2243 };
/** Factor de escala de marcadores: el sector mide ~3 km, se observa desde más lejos. */
const MK = 2;
const KX = Math.cos(ORIGIN.lat * Math.PI / 180) * 111320;
const KZ = 110540;
const toLatLon = (x, z) => ({ lat: ORIGIN.lat - z / KZ, lon: ORIGIN.lon + x / KX });
const TZ = 'America/El_Salvador';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** PRNG determinista: el prototipo se ve igual en cada demo. */
function mulberry32(a) { return function () { a |= 0; a = a + 0x4c4c4cF5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(33);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const $ = (s, el = document) => el.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('es-SV');
const pct = (n) => (n >= 0 ? '+' : '') + Math.round(n * 100) + ' %';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function nowSV() { return new Date(); }
function hhmmss(d) { return d.toLocaleTimeString('es-SV', { timeZone: TZ, hour12: false }); }
function hhmm(d) { return d.toLocaleTimeString('es-SV', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' }); }
function ago(d) { const s = Math.max(0, Math.round((Date.now() - d) / 1000)); if (s < 60) return `hace ${s} s`; const m = Math.round(s / 60); return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; }

/* =====================================================================
   §1b ROUTES — red vial real del sector (OpenStreetMap) como grafo.
   Sirve para que todo lo que se mueve o se traza en el mapa siga calles
   reales: patrullaje de unidades, rutas de despacho de MAIC y recorridos
   de vehículos y personas entre cámaras.
   GEO.gn = nodos [x0,z0,x1,z1…] en metros locales · GEO.ge = aristas [a0,b0,a1,b1…].
   En producción las rutas las entrega el backend (GET /v1/routes) o MAIC.
   ===================================================================== */
const Routes = (() => {
  const N = GEO.gn.length / 2, X = (i) => GEO.gn[i * 2], Z = (i) => GEO.gn[i * 2 + 1];
  const adj = Array.from({ length: N }, () => []);
  for (let i = 0; i < GEO.ge.length; i += 2) { const a = GEO.ge[i], b = GEO.ge[i + 1], d = Math.hypot(X(a) - X(b), Z(a) - Z(b)); adj[a].push([b, d]); adj[b].push([a, d]); }
  // Índice espacial en celdas de 80 m para encontrar el nodo de calle más cercano a un punto
  const CELL = 80, grid = new Map(); const key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  for (let i = 0; i < N; i++) { if (!adj[i].length) continue; const k = key(X(i), Z(i)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  function nearest(x, z) {
    let best = -1, bd = Infinity;
    for (let r = 0; r < 6 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const list = grid.get((Math.floor(x / CELL) + dx) + ',' + (Math.floor(z / CELL) + dz)); if (!list) continue;
      for (const i of list) { const d = Math.hypot(X(i) - x, Z(i) - z); if (d < bd) { bd = d; best = i; } }
    }
    return best;
  }
  /** Ruta más corta por calles entre dos nodos (A*). Devuelve la lista de nodos o null. */
  function pathNodes(a, b) {
    if (a < 0 || b < 0) return null; if (a === b) return [a];
    const g = new Map([[a, 0]]), prev = new Map(), open = [[Math.hypot(X(a) - X(b), Z(a) - Z(b)), a]], done = new Set();
    while (open.length) {
      let mi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
      const [, u] = open.splice(mi, 1)[0]; if (u === b) break; if (done.has(u)) continue; done.add(u);
      for (const [v, d] of adj[u]) { const ng = g.get(u) + d; if (ng < (g.get(v) ?? Infinity)) { g.set(v, ng); prev.set(v, u); open.push([ng + Math.hypot(X(v) - X(b), Z(v) - Z(b)), v]); } }
    }
    if (!prev.has(b)) return null; const out = [b]; let c = b; while (c !== a) { c = prev.get(c); out.push(c); } return out.reverse();
  }
  /** Ruta por calles entre dos puntos cualesquiera, como lista de [x, z]. Si no hay ruta, línea recta. */
  function path(x1, z1, x2, z2) {
    const nodes = pathNodes(nearest(x1, z1), nearest(x2, z2)); if (!nodes) return [[x1, z1], [x2, z2]];
    return [[x1, z1], ...nodes.map((i) => [X(i), Z(i)]), [x2, z2]];
  }
  /** Recorrido por calles que pasa, en orden, por una serie de puntos {x, z}. */
  function through(points) { let out = []; for (let i = 0; i < points.length - 1; i++) { const seg = path(points[i].x, points[i].z, points[i + 1].x, points[i + 1].z); out = out.concat(i ? seg.slice(1) : seg); } return out; }
  const length = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return d; };
  /** Punto a una fracción k (0 a 1) de la longitud de una ruta. */
  function along(pts, k) {
    const total = length(pts); let want = clamp(k, 0, 1) * total;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (want <= d || i === pts.length - 1) { const t = d ? Math.min(1, want / d) : 0; return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)]; } want -= d; }
    return pts[pts.length - 1];
  }
  return { nearest, path, through, length, along, neighbors: (i) => adj[i], pos: (i) => [X(i), Z(i)], count: N };
})();

/* =====================================================================
   §1b ICONS — iconografía de la interfaz.
   Se usan los iconos de Blueprint, la librería de Palantir (Apache-2.0):
   trazo sólido y geométrico, pensado para consolas de análisis.
   El marcado no cambia: <span class="ms">nombre</span>. Este módulo
   sustituye cada nombre por su SVG, también en lo que se dibuja después
   (observa el documento). Los trazados están en data/icons.js (BP_ICONS).
   La cámara CCTV y la unidad policial son glifos propios (Glyph, §4b).
   ===================================================================== */
const Icons = (() => {
  const missing = new Set();
  function hydrate(el) {
    if (el.firstElementChild) return; const name = el.textContent.trim(); if (!name) return;
    const paths = BP_ICONS[name] || (missing.add(name), BP_ICONS.radio_button_unchecked);
    el.dataset.i = name; el.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map((d) => `<path fill-rule="evenodd" d="${d}"/>`).join('')}</svg>`;
  }
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.classList.contains('ms')) hydrate(n); n.querySelectorAll('.ms').forEach(hydrate); };
  function start() {
    scan(document.body);
    new MutationObserver((list) => list.forEach((m) => { if (m.target.nodeType === 1 && m.target.classList.contains('ms')) hydrate(m.target); m.addedNodes.forEach(scan); })).observe(document.body, { childList: true, subtree: true });
  }
  return { start, missing };
})();
Icons.start();

/* =====================================================================
   §1c GEO — geometría y georreferencia.
   Regla del proyecto: todo lo que aparece en el mapa tiene coordenadas
   (latitud y longitud, WGS84). Las coordenadas locales x/z en metros son
   solo para dibujar; cada entidad lleva además `lat` y `lon`, que es lo
   que viaja en el contrato de APIs.
   ===================================================================== */
const Geo = (() => {
  /** Añade lat/lon a un objeto que tiene x/z (y lo devuelve). */
  const tag = (o) => { const p = toLatLon(o.x, o.z); o.lat = p.lat; o.lon = p.lon; return o; };
  /** Texto de coordenadas con 5 decimales (precisión de ~1 metro). */
  const str = (o) => { const p = o.lat !== undefined ? o : toLatLon(o.x, o.z); return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; };
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; };
  function centroid(p) { let a = 0, cx = 0, cz = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length], f = p[i][0] * q[1] - q[0] * p[i][1]; a += f; cx += (p[i][0] + q[0]) * f; cz += (p[i][1] + q[1]) * f; } return a ? [cx / (3 * a), cz / (3 * a)] : p[0]; }
  /** ¿El punto (x, z) cae dentro del polígono? (regla par-impar) */
  function inside(p, x, z) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }
  const circle = (x, z, r, n = 24) => Array.from({ length: n }, (_, i) => [x + Math.cos(i / n * 2 * Math.PI) * r, z + Math.sin(i / n * 2 * Math.PI) * r]);
  /** Corredor: polígono que acompaña una vía a `half` metros a cada lado (geocerca de una avenida). */
  function corridor(line, half) {
    const L = [], R = [];
    for (let i = 0; i < line.length; i++) { const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / d, nz = (b[0] - a[0]) / d; L.push([line[i][0] + nx * half, line[i][1] + nz * half]); R.push([line[i][0] - nx * half, line[i][1] - nz * half]); }
    return L.concat(R.reverse());
  }
  /** Punto al azar dentro de un polígono (para repartir personas y calor). */
  function sample(p, r) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; p.forEach(([x, z]) => { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }); for (let k = 0; k < 40; k++) { const x = a + r() * (b - a), z = c + r() * (d - c); if (inside(p, x, z)) return [x, z]; } return centroid(p); }
  /** Punto donde ocurre una detección: dentro del campo de visión de la cámara, no en el poste.
      `snap` lo ajusta a la calzada más cercana (vehículos). k (0 a 1) fija la posición de forma reproducible. */
  function eventPoint(cam, k, snap) {
    const d = 28 + k * 105, a = cam.heading + (((k * 7919) % 1) - .5) * .55; let x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
    if (snap) { const n = Routes.nearest(x, z); if (n >= 0) { const p = Routes.pos(n); if (Math.hypot(p[0] - x, p[1] - z) < 45) { x = p[0]; z = p[1]; } } }
    return tag({ x, z });
  }
  return { tag, str, area, centroid, inside, circle, corridor, sample, eventPoint };
})();

/* =====================================================================
   §2 MOCKDB — datos simulados con la forma exacta del contrato de APIs.
   Ningún dato corresponde a personas o vehículos reales.
   ===================================================================== */
const MockDB = (() => {
  /* --- Zonas de concentración (sector Salvador del Mundo) --- */
  /* Cada zona es una geocerca con perímetro real: polígono de OpenStreetMap (plaza, estadio, estación)
     o corredor sobre la avenida. De ahí salen su centroide (lat/lon), su área y su radio envolvente. */
  const zones = [
    { id: 'Z-01', name: 'Plaza Salvador del Mundo', poly: GEO.zp.plaza, planned: 10000, est: 78000, officers: 22, growth: 420 },
    { id: 'Z-02', name: 'Alameda Roosevelt', poly: Geo.corridor(Routes.path(235, 24, 640, 52).slice(1, -1), 24), planned: 4000, est: 31000, officers: 9, growth: 180 },
    { id: 'Z-03', name: 'Paseo General Escalón', poly: Geo.corridor(Routes.path(-520, -50, -170, -22).slice(1, -1), 22), planned: 3000, est: 19500, officers: 7, growth: 110 },
    { id: 'Z-04', name: 'Estación Salvador del Mundo', poly: GEO.zp.estacion, planned: 1000, est: 6200, officers: 4, growth: 30 },
    { id: 'Z-05', name: 'Redondel Olímpico', poly: Geo.circle(262, 270, 55), planned: 500, est: 470, officers: 3, growth: 2 },
    { id: 'Z-06', name: 'Estadio Mágico González', poly: GEO.zp.estadio, planned: 1500, est: 900, officers: 6, growth: 1 },
  ].map((z) => { const c = Geo.centroid(z.poly); return Geo.tag({ ...z, x: c[0], z: c[1], r: Math.max(...z.poly.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))), area: Geo.area(z.poly),
    history: Array.from({ length: 30 }, (_, i) => z.est * (0.55 + 0.45 * Math.pow(i / 29, 1.4)) * (0.97 + rnd() * .06)) }); });
  const EVENT = { name: 'Concentración por evento en Salvador del Mundo', planned: 20000, officersPerPerson: 250 };

  /* --- Cámaras: 40 intersecciones reales del sector (cruces con nombre de OpenStreetMap), con al menos
         una avenida principal y separación mínima de ~185 m. GEO.ix = [x, z, víaA, víaB, rangoA, rangoB, rumbo de la vía A]. --- */
  const cands = GEO.ix.filter((i) => i[4] >= 2 && !/Redondel/.test(GEO.names[i[2]] + GEO.names[i[3]])).map((i) => ({ x: i[0], z: i[1], a: GEO.names[i[2]], b: GEO.names[i[3]], dir: i[6], d: Math.hypot(i[0] - 180, i[1] - 60) })).filter((c) => c.d < 1250);
  cands.sort((p, q) => p.d - q.d);
  const camPts = [];
  for (const c of cands) { if (camPts.length >= 40) break; if (camPts.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 185)) camPts.push(c); }
  const statusAt = { 8: 'degraded', 17: 'degraded', 31: 'offline' };
  const cameras = camPts.map((p, i) => {
    const id = 'SM-' + String(i + 1).padStart(2, '0');
    const zone = zones.map((z) => ({ z, d: Math.hypot(z.x - p.x, z.z - p.z) })).sort((a, b) => a.d - b.d)[0];
    const ll = toLatLon(p.x, p.z);
    return {
      id, street: `${p.a} y ${p.b}`, x: p.x, z: p.z, lat: ll.lat, lon: ll.lon,
      heading: p.dir + (i % 2 ? Math.PI : 0) + (rnd() - .5) * .3, status: statusAt[i] || 'online', fps: statusAt[i] === 'degraded' ? 9 : 25,
      zoneId: (zones.find((q) => Geo.inside(q.poly, p.x, p.z) || q.poly.some((v) => Math.hypot(v[0] - p.x, v[1] - p.z) < 140)) || {}).id || null, compute: i % 10 < 8 ? 'SPOTBOX' : 'GPU del cliente',
      capabilities: ['multitudes', 'placas', 'rostros'],
    };
  });
  zones.forEach((z) => { z.cameras = cameras.filter((c) => c.zoneId === z.id).map((c) => c.id); if (!z.cameras.length) z.cameras = [cameras[0].id]; });

  /* --- Unidades de la PNC (dato que en producción entrega MAIC) --- */
  const roadPts = [];
  GEO.roads.forEach(([rank, pts]) => { if (rank >= 1) for (let i = 0; i < pts.length; i += 6) if (Math.hypot(pts[i], pts[i + 1]) < 1500) roadPts.push([pts[i], pts[i + 1]]); });
  const units = Array.from({ length: 36 }, (_, i) => { const q = pick(roadPts), node = Routes.nearest(q[0], q[1]), p = Routes.pos(node); return { id: 'PNC-' + (210 + i * 7), node, x: p[0], z: p[1], type: i % 4 === 0 ? 'Motorizada' : i % 5 === 0 ? 'A pie' : 'Patrulla', status: 'patrullando', plate: i % 5 === 0 && i % 4 !== 0 ? null : `N ${String(4120 + i * 37).padStart(4, '0')}`, crew: i % 4 === 0 ? 1 + (i % 2) : 2 + (i % 3 === 0 ? 1 : 0), radio: `Delta ${String(i + 1).padStart(2, '0')}` }; });

  /* --- Listas autorizadas (simuladas) --- */
  const plateWatch = {
    'P 512-884': { reason: 'Reporte de robo', since: '10 nov 2026', vehicle: { type: 'Pickup', color: 'Gris', make: 'Toyota Hilux' }, case: 'DEN-2026-114827' },
    'P 377-019': { reason: 'Reporte de robo', since: '11 nov 2026', vehicle: { type: 'Sedán', color: 'Rojo', make: 'Mazda 3' }, case: 'DEN-2026-115302' },
    'M 204-551': { reason: 'Vinculada a investigación', since: '8 nov 2026', vehicle: { type: 'Motocicleta', color: 'Negro', make: 'Honda' }, case: 'INV-2026-0931' },
  };
  const faceWatch = [
    { ref: 'LB-0291', list: 'Orden de captura vigente' },
    { ref: 'LB-1180', list: 'Persona desaparecida' },
    { ref: 'LB-0733', list: 'Orden de captura vigente' },
    { ref: 'LB-2054', list: 'Persona de interés' },
  ];
  /* --- Tránsito: eventos con EVIDENCIA REAL. Los clips son salidas de Panopticon sobre video de
         cámaras municipales de San Salvador (los datos del evento se leen del propio clip). --- */
  const traffic = [
    { id: 'T-2201', kind: 'collision', severity: 'critical', clip: 'colision', cameraId: cameras[14].id, source: 'Cámara municipal de San Salvador', title: 'Colisión entre dos vehículos',
      vehicles: [{ tag: '#47', desc: 'Auto azul oscuro' }, { tag: '#1', desc: 'Camión blanco' }],
      detail: [['Impacto detectado', 'a los 4.64 s de seguimiento'], ['Cambio de velocidad', 'de 30 a 7 px por cuadro'], ['Vehículos en cuadro', '10'], ['Placas', 'No legibles desde este ángulo']] },
    { id: 'T-2198', kind: 'infraction', severity: 'medium', clip: 'infraccion', cameraId: cameras[22].id, source: 'Cámara municipal S274 FIJA 1', title: 'Giro prohibido a la izquierda',
      vehicles: [{ tag: '#3', desc: 'Pickup negro' }],
      detail: [['Maniobra', 'Cruce de doble línea amarilla y giro de más de 63°'], ['Duración', '3.98 s'], ['Vehículos en cuadro', '14'], ['Placa', 'Detectada, no legible']] },
    { id: 'T-2187', kind: 'infraction', severity: 'medium', clip: 'infraccion2', cameraId: cameras[27].id, source: 'Cámara municipal S271 PTZ', title: 'Giro prohibido a la izquierda',
      vehicles: [{ tag: '#2', desc: 'Van blanca' }],
      detail: [['Maniobra', 'Giro a la izquierda en cruce no permitido'], ['Duración', '5.27 s'], ['Vehículos en cuadro', '14'], ['Placa', 'Detectada, no legible']] },
  ];
  /* --- Trazabilidad de personas: seguimiento real de re-identificación (14 avistamientos, 9 cámaras).
         bq = calidad de la captura de cuerpo · fr = calidad de la captura de rostro (0 = de espaldas).
         Los identificadores de cámara originales se asignan a cámaras del sector para el mapa. --- */
  const rawSight = [
    ['8fbe5eeb', .86, .84, '93×222', '22:10:07', '22:10:37', 'fd0d39a1'], ['9c208b4b', .81, .70, '95×230', '22:11:48', '22:11:58', '2a7460f3'],
    ['e7ee77d8', .90, .88, '95×225', '22:11:58', '22:12:13', '592c21f2'], ['95cc2e6d', .95, .94, '205×398', '22:12:17', '22:12:54', '45587791'],
    ['a0ed9054', .59, 0, '199×414', '22:13:00', '22:13:20', '592c21f2'], ['afbf1e19', .90, .94, '94×225', '22:25:39', '22:25:52', '01a970df'],
    ['fb0e99ee', .87, .81, '95×238', '22:26:49', '22:27:02', '83c0db2d'], ['cfcc5661', .60, 0, '184×382', '22:27:05', '22:27:37', '58709a2f', true],
    ['f61600f1', .80, .63, '154×397', '22:27:12', '22:27:53', '60c64b92', true], ['43346e37', .60, 0, '185×366', '23:00:44', '23:00:51', '60c64b92'],
    ['cc435f80', .89, .87, '103×224', '23:01:10', '23:01:28', '58709a2f'], ['92a70ed5', .59, 0, '229×387', '23:01:32', '23:01:45', '83c0db2d'],
    ['51142650', .61, 0, '216×350', '23:01:46', '23:02:01', '0053ffef'], ['457b3370', .91, .97, '88×230', '23:04:58', '23:05:12', '0053ffef'],
  ];
  traffic.forEach((t, i) => { t.ts = new Date(Date.now() - [1, 11, 24][i] * 60000); Object.assign(t, Geo.eventPoint(cameras.find((c) => c.id === t.cameraId), [.35, .6, .5][i], true)); });
  const srcCams = [...new Set(rawSight.map((s) => s[6]))];
  const chain = []; { let cur = cameras.slice().sort((a, b) => Math.hypot(a.x + 520, a.z + 80) - Math.hypot(b.x + 520, b.z + 80))[0]; const used = new Set();
    for (let i = 0; i < srcCams.length; i++) { chain.push(cur); used.add(cur.id); const nx = cameras.filter((c) => !used.has(c.id) && c.status !== 'offline').sort((a, b) => Math.hypot(a.x - cur.x, a.z - cur.z) - Math.hypot(b.x - cur.x, b.z - cur.z))[0]; if (!nx) break; cur = nx; } }
  const track = { id: 'TR-0412', from: '22:10', to: '23:05', minutes: 55,
    sightings: rawSight.map(([id, bq, fr, px, from, to, src, overlap], i) => { const c = chain[srcCams.indexOf(src) % chain.length]; return Geo.tag({ id, bq, fr, px, from, to, sourceCam: src, cameraId: c.id, street: c.street, x: c.x, z: c.z, overlap: !!overlap, img: i }); }) };
  track.cameras = new Set(track.sightings.map((s) => s.cameraId)).size;
  /* --- Fuentes de identidad (conectores). Solo la lista interna de la demo está conectada.
         Las instituciones son las que previsiblemente tienen el dato en El Salvador; cuáles se conectan
         y con qué alcance lo define el Ministerio. Mientras una fuente no esté conectada, la consola no muestra datos de ella. --- */
  const sources = [
    { id: 'panopticon', group: 'spotvision', status: 'connected', name: 'Listas autorizadas en Panopticon', inst: 'Ministerio de Seguridad · listas cargadas para la demo', gives: 'candidatos con puntaje de similitud', fields: ['referencia', 'lista', 'puntaje'] },
    { id: 'rnpn', group: 'identidad', status: 'pending', name: 'Registro de identidad (DUI)', inst: 'Registro Nacional de las Personas Naturales (RNPN)', gives: 'nombre, número de DUI y fotografía oficial', fields: ['dui', 'nombres', 'apellidos', 'fotografia', 'fecha_emision'] },
    { id: 'dgme', group: 'identidad', status: 'pending', name: 'Pasaportes y movimientos migratorios', inst: 'Dirección General de Migración y Extranjería (DGME)', gives: 'pasaporte, nacionalidad, entradas y salidas del país', fields: ['pasaporte', 'nacionalidad', 'fotografia', 'movimientos'] },
    { id: 'pnc', group: 'policial', status: 'pending', name: 'Órdenes de captura y antecedentes', inst: 'Policía Nacional Civil (PNC)', gives: 'órdenes de captura vigentes y antecedentes policiales', fields: ['identificador', 'orden', 'estado', 'fotografia'] },
    { id: 'fgr', group: 'policial', status: 'pending', name: 'Expedientes de investigación', inst: 'Fiscalía General de la República (FGR)', gives: 'expedientes abiertos y medidas vigentes', fields: ['expediente', 'delito', 'estado'] },
    { id: 'dgcp', group: 'policial', status: 'pending', name: 'Registro penitenciario', inst: 'Dirección General de Centros Penales (DGCP)', gives: 'historial penitenciario y fotografías de registro', fields: ['registro', 'centro', 'estado', 'fotografia'] },
    { id: 'interpol', group: 'policial', status: 'pending', name: 'Notificaciones internacionales', inst: 'INTERPOL · Oficina Central Nacional de San Salvador', gives: 'notificaciones rojas y difusiones internacionales', fields: ['notificacion', 'tipo', 'pais', 'fotografia'] },
    { id: 'vmt', group: 'movilidad', status: 'pending', name: 'Licencias y registro de vehículos', inst: 'Viceministerio de Transporte (VMT)', gives: 'licencia de conducir, vehículos a su nombre y placas', fields: ['licencia', 'placa', 'vehiculo', 'propietario'] },
    { id: 'osint', group: 'abiertas', status: 'pending', name: 'Redes sociales y web abierta', inst: 'Proveedor autorizado, por definir', gives: 'perfiles públicos con imágenes coincidentes', fields: ['plataforma', 'perfil', 'url', 'puntaje'] },
  ];
  /* --- Caso de demostración con datos ficticios (data dummy) aportados por SPOTVISION:
         una captura de cámara, un retrato de "base de datos" y un documento de muestra.
         Sirve para enseñar cómo se vería una coincidencia cuando exista una base conectada.
         Las cajas son porcentajes sobre la captura: `box` es el rostro analizado. --- */
  sources.splice(1, 0, { id: 'muestra', group: 'identidad', status: 'demo', name: 'Registro de identidad de muestra', inst: 'Datos ficticios cargados para la demostración', gives: 'ficha de identidad ficticia con fotografía y documento', fields: ['identificacion', 'nombre', 'fecha_nacimiento', 'nacionalidad', 'fotografia'] });
  const demoCase = {
    faceId: 'F-DEMO', cameraId: cameras[0].id, box: { l: 35.3, t: 19.6, w: 4.9, h: 14.2 }, others: [{ l: 25.7, t: 18.6, w: 3.4, h: 12.2 }],
    record: { ref: 'JM-1234-5678', name: 'JOHN WICK', dob: '15/04/1984', nat: 'Salvadoreña (ficticia)', exp: '15/04/2034', score: .96, list: 'Registro de identidad de muestra' },
  };
  return { zones, cameras, units, EVENT, plateWatch, faceWatch, roadPts, traffic, track, sources, demoCase };
})();

/* Cobertura de cámaras sobre vías principales (avenidas y bulevares del sector).
   Es una medida honesta de la "omnipresencia": qué parte de la red vial principal queda dentro del
   campo de visión de una cámara operativa, y dónde están los puntos ciegos. En producción la calcula
   el backend con el campo de visión real calibrado de cada cámara (GET /v1/coverage). */
const Coverage = (() => {
  const REACH = 200, FOV = 62 * Math.PI / 180, CELL = 250, R = 1250, CX = 180, CZ = 60;
  const inView = (c, x, z) => { const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz); if (d > REACH) return false; if (d < 12) return true; let a = Math.atan2(dz, dx) - c.heading; a = Math.atan2(Math.sin(a), Math.cos(a)); return Math.abs(a) <= FOV / 2; };
  /** Devuelve { pct, blind:[{x,z,size}], samples } para el conjunto de cámaras dado. */
  function compute(cameras) {
    const live = cameras.filter((c) => c.status !== 'offline'); const cells = new Map(); let total = 0, covered = 0;
    GEO.roads.forEach(([rank, p]) => {
      if (rank < 2) return;
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 25));
        for (let k = 0; k < n; k++) {
          const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n; if (Math.hypot(x - CX, z - CZ) > R) continue;
          const ok = live.some((c) => inView(c, x, z)); total++; if (ok) covered++;
          const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL), cell = cells.get(key) || { n: 0, ok: 0, x: Math.floor(x / CELL) * CELL, z: Math.floor(z / CELL) * CELL }; cell.n++; if (ok) cell.ok++; cells.set(key, cell);
        }
      }
    });
    const blind = [...cells.values()].filter((c) => c.n >= 8 && c.ok / c.n < .08).sort((a, b) => b.n - a.n).slice(0, 16).map((c) => ({ x: c.x, z: c.z, size: CELL }));
    return { pct: total ? covered / total : 0, blind, samples: total };
  }
  /** Polígono del campo de visión de una cámara, en coordenadas locales. */
  function cone(c, steps = 10) { const pts = [[c.x, c.z]]; for (let i = 0; i <= steps; i++) { const a = c.heading - FOV / 2 + FOV * i / steps; pts.push([c.x + Math.cos(a) * REACH, c.z + Math.sin(a) * REACH]); } pts.push([c.x, c.z]); return pts; }
  return { compute, cone, REACH, FOV };
})();

/* Generadores de eventos simulados (forma = contrato) */
const Gen = {
  seq: { A: 4100, P: 880000, F: 7300, M: 300, AUD: 52000 },
  id(k) { return k + '-' + (++this.seq[k]); },
  plate() {
    const pre = rnd() < .82 ? 'P' : pick(['C', 'M', 'A', 'N']);
    return `${pre} ${String(100 + Math.floor(rnd() * 900))}-${String(Math.floor(rnd() * 1000)).padStart(3, '0')}`;
  },
  vehicle(plate) {
    if (MockDB.plateWatch[plate]) return MockDB.plateWatch[plate].vehicle;
    if (plate.startsWith('M')) return { type: 'Motocicleta', color: pick(['Negro', 'Rojo', 'Azul']), make: pick(['Honda', 'Yamaha', 'Suzuki']) };
    return { type: pick(['Sedán', 'Pickup', 'SUV', 'Microbús', 'Hatchback']), color: pick(['Blanco', 'Gris', 'Negro', 'Plata', 'Rojo', 'Azul']), make: pick(['Toyota', 'Nissan', 'Mazda', 'Kia', 'Hyundai', 'Mitsubishi', 'Isuzu']) };
  },
};

/* =====================================================================
   §3 API — capa de servicios. La UI SOLO habla con este objeto.
   Cada método documenta el endpoint que Santiago debe implementar.
   Transporte previsto: REST (contrato OpenAPI) + WebSocket (contrato AsyncAPI).
   ===================================================================== */
const Api = (() => {
  const subs = {};
  const delay = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));
  const state = { alerts: [], reads: [], faces: [], dispatches: [], audit: [], platesToday: 18204, facesToday: 2316,
    /** Última actualización recibida de cada fuente (para los indicadores de frescura del HUD). */
    fresh: { vision: Date.now(), maic: Date.now() } };
  return {
    state,
    /** WS /v1/stream — temas: alerts, plates, faces, zones, cameras, maic */
    on(topic, cb) { (subs[topic] = subs[topic] || []).push(cb); },
    emit(topic, payload) { (subs[topic] || []).forEach((cb) => cb(payload)); },
    /** GET /v1/tenants/{tenant}/cameras */
    async getCameras() { await delay(120); return MockDB.cameras; },
    /** GET /v1/tenants/{tenant}/zones?include=occupancy */
    async getZones() { await delay(120); return MockDB.zones; },
    /** GET /v1/traffic/events  ·  clip de evidencia: GET /v1/events/{id}/clip */
    async getTrafficEvents() { await delay(100); return MockDB.traffic; },
    /** GET /v1/persons/tracks/{id}  → auditado (seguimiento por re-identificación) */
    getTrackSync(id) { return MockDB.track.id === id ? MockDB.track : null; },
    /** GET /v1/maic/units?bbox=… (proxy hacia MAIC) */
    async getUnits() { await delay(120); return MockDB.units; },
    /** GET /v1/plates/search?q={plate}&from=&to=  → auditado */
    async searchPlate(q) {
      const plate = q.toUpperCase().replace(/\s+/g, ' ').trim();
      this.audit('Búsqueda de placa', plate);
      await delay(650);
      return { plate, watch: MockDB.plateWatch[plate] || null, sightings: this.tracePlateSync(plate) };
    },
    /** GET /v1/plates/{plate}/trajectory */
    tracePlateSync(plate) {
      let seed = 0; for (const ch of plate) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      const r = mulberry32(seed);
      const cams = MockDB.cameras.filter((c) => c.status !== 'offline');
      let cur = cams[Math.floor(r() * cams.length)];
      const path = [cur]; const used = new Set([cur.id]);
      for (let i = 0; i < 5; i++) {
        const next = cams.filter((c) => !used.has(c.id)).map((c) => ({ c, d: Math.hypot(c.x - cur.x, c.z - cur.z) + r() * 140 })).sort((a, b) => a.d - b.d)[1 + Math.floor(r() * 2)];
        if (!next) break; cur = next.c; used.add(cur.id); path.push(cur);
      }
      const end = Date.now();
      return path.map((c, i) => Geo.tag({ cameraId: c.id, street: c.street, x: c.x, z: c.z, ts: new Date(end - (path.length - 1 - i) * (240 + r() * 300) * 1000), confidence: .9 + r() * .09 }));
    },
    /** POST /v1/maic/dispatch  { alertId, zoneId|location, unitsRequested } */
    async dispatch(req) {
      this.audit('Solicitud de despacho a MAIC', req.label);
      const d = { id: Gen.id('M'), ...req, status: 'enviado', created: new Date(), steps: [] };
      state.dispatches.push(d);
      const step = (s, ms) => new Promise((r) => setTimeout(() => { d.steps.push({ s, ts: new Date() }); d.status = s; this.emit('maic', d); r(); }, REDUCED ? 10 : ms));
      step('Evento recibido por MAIC', 700)
        .then(() => step('Unidades asignadas', 1300))
        .then(() => step('Unidades en ruta', 900));
      return d;
    },
    /** POST /v1/faces/{eventId}/analyze  → auditado; devuelve candidatos, nunca identidad */
    async analyzeFace(face) { this.audit('Análisis facial', face.id); await delay(200); return face.candidates; },
    /** POST /v1/identity/search { faceId, sources, reason, caseId } → auditado.
        Devuelve, por fuente conectada, candidatos con puntaje. Las fuentes sin conectar no devuelven nada. */
    async searchIdentity(face, { sources, reason, caseId }) {
      this.audit('Búsqueda de identidad', `${face.id} · ${sources.length} fuentes · motivo: ${reason}${caseId ? ' · caso ' + caseId : ''}`);
      await delay(1500); const out = {};
      MockDB.sources.filter((s) => sources.includes(s.id) && s.status === 'connected').forEach((s) => { out[s.id] = face.demo ? [] : face.candidates; });
      // La base de muestra solo responde al caso de demostración (datos ficticios)
      if (sources.includes('muestra')) out.muestra = face.demo ? { record: MockDB.demoCase.record } : [];
      return out;
    },
    /** POST /v1/scenes/reconstruct { cameraIds, from, to } */
    async reconstructScene(cameraIds) { this.audit('Reconstrucción de escena 3D', cameraIds.join(', ')); await delay(200); return { jobId: Gen.id('A') }; },
    /** POST /v1/audit (en producción lo registra el backend en cada endpoint) */
    audit(action, target) { const e = { id: Gen.id('AUD'), action, target, user: 'Operador · Turno A', ts: new Date() }; state.audit.push(e); this.emit('audit', e); return e; },
  };
})();

/* =====================================================================
   §4 SFX — audio de interfaz con Web Audio (sin archivos externos).
   Tonos cortos y graves: futurista pero sobrio, apto para turnos largos.
   ===================================================================== */
const Sfx = {
  ctx: null, out: null, on: false, hum: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.out = this.ctx.createGain(); this.out.gain.value = .9;
    const comp = this.ctx.createDynamicsCompressor(); this.out.connect(comp); comp.connect(this.ctx.destination);
  },
  set(on) {
    this.init(); if (!this.ctx) return; this.on = on;
    if (on) { this.ctx.resume(); this.humStart(); } else this.humStop();
    const b = $('#soundBtn'); if (b) { b.classList.toggle('on', on); b.firstElementChild.textContent = on ? 'volume_up' : 'volume_off'; }
  },
  tone(f, dur, type = 'sine', g = .04, f2 = null, when = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), a = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + .01); a.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(a); a.connect(this.out); o.start(t); o.stop(t + dur + .05);
  },
  noise(dur, f1, f2, g = .05) {
    if (!this.on || !this.ctx) return;
    const n = this.ctx.sampleRate * dur, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(), bp = this.ctx.createBiquadFilter(), a = this.ctx.createGain(), t = this.ctx.currentTime;
    s.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.setValueAtTime(f1, t); bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + dur * .4); a.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp); bp.connect(a); a.connect(this.out); s.start(t);
  },
  humStart() {
    if (this.hum || !this.ctx) return;
    const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.out);
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(); o1.frequency.value = 55; o2.frequency.value = 55.6; o2.type = 'triangle';
    o1.connect(g); o2.connect(g); o1.start(); o2.start(); g.gain.linearRampToValueAtTime(.018, this.ctx.currentTime + 2);
    this.hum = { g, o1, o2 };
  },
  humStop() { if (!this.hum) return; const h = this.hum; this.hum = null; h.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + .4); setTimeout(() => { h.o1.stop(); h.o2.stop(); }, 500); },
  blip() { this.tone(1320, .07, 'sine', .035); this.tone(1760, .06, 'sine', .025, null, .06); },
  tick() { this.tone(2600, .012, 'square', .006); },
  select() { this.tone(880, .09, 'sine', .03, 1100); },
  medium() { this.tone(740, .16, 'triangle', .045); this.tone(554, .22, 'triangle', .04, null, .17); },
  critical() { [0, .42].forEach((w) => { this.tone(659, .16, 'triangle', .06, null, w); this.tone(440, .26, 'triangle', .06, null, w + .17); }); },
  whoosh() { this.noise(1.6, 180, 2600, .06); this.tone(110, 1.4, 'sine', .05, 55); },
  confirm() { this.tone(660, .08, 'sine', .04); this.tone(990, .12, 'sine', .04, null, .08); },
};
