/* =====================================================================
   §6c GMAP — vista "Mapa" y "Satélite" de Google (vista predeterminada).
   Motor: MapLibre GL JS. Datos: mosaicos 2D de Google (Map Tiles API).

   - "Mapa": el mapa estándar de Google (roadmap) con un estilo oscuro en la
     paleta de SPOTVISION. El estilo se envía a Google al crear la sesión y
     Google devuelve los mosaicos ya coloreados (ver ROADMAP_STYLE).
   - "Satélite": imagen satelital de Google con calles y nombres encima
     (híbrido). Google no permite recolorear la imagen; solo se atenúa.
   - Las capas operativas (cámaras, cobertura, zonas, unidades, incidentes,
     recorridos) se dibujan encima con datos propios.

   Igual que GeoMap (§6b), este módulo es un espejo de City: recibe las mismas
   órdenes (flyTo, pulse, showTrace, dispatchUnits, updateZone…).

   Condiciones de uso de Google que este módulo respeta
   - Logo de Google y texto de derechos siempre visibles (#gmapCredits).
   - Sin caché propia ni descarga de mosaicos; sin análisis de las imágenes.
   ===================================================================== */
const GMap = (() => {
  const CFG = window.P33_CONFIG || {};
  const VERSION = CFG.MAPLIBRE_VERSION || '5.24.0';
  const BASE = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist/`;
  const API = 'https://tile.googleapis.com';
  const HOME = { x: 180, z: 70, r: 3300, phi: .93 };
  /** Pantallas de alta densidad (Retina) reciben mosaicos al doble de resolución; el resto, mosaicos estándar. */
  const HIDPI = (window.devicePixelRatio || 1) >= 1.5, SCALE = HIDPI ? { scale: 'scaleFactor2x', highDpi: true } : { scale: 'scaleFactor1x' };
  const S = { available: false, active: false, map: null, base: 'map', sessions: {}, night: true, zones: new Map(), marks: [], traceMarks: [], incidents: new Map(), layers: { cams: true, coverage: true, zones: true, units: true, incidents: true }, coverage: null, creditT: 0 };
  let ML = null;

  /** Estilo del mapa de Google en la paleta SPOTVISION (formato de estilos JSON de Google Maps).
      Los colores operativos (lima, rojo, amarillo) no se usan aquí para que las alertas destaquen. */
  const ROADMAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#0b1217' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8fa3af' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#05090c' }, { weight: 3 }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2a3b45' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c4d2da' }] },
    { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#a9bac4' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry.fill', stylers: [{ color: '#0e161c' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#1f2d37' }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#0b1217' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#111b22' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f8794' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1c14' }] },
    { featureType: 'poi.sports_complex', elementType: 'geometry', stylers: [{ color: '#10201a' }] },
    { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#1c2932' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0b1217' }] },
    { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#6f8794' }] },
    { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#2a3c47' }] },
    { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#35505e' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#0d4f68' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#16212a' }] },
    { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#6f8794' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a2a38' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4f7385' }] },
  ];

  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
  const loadCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  const ll = (x, z) => { const p = toLatLon(x, z); return [p.lon, p.lat]; };
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const setData = (id, features) => { const s = S.map && S.map.getSource(id); if (s) s.setData(fc(features)); };
  const circle = (x, z, r, n = 48) => { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; pts.push(ll(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return pts; };

  /** Abre una sesión de mosaicos con Google. kind: 'map' (roadmap con estilo de marca) | 'sat' (satélite + calles). */
  async function session(kind) {
    const body = kind === 'map'
      ? { mapType: 'roadmap', language: 'es-419', region: 'SV', ...SCALE, styles: ROADMAP_STYLE }
      : { mapType: 'satellite', language: 'es-419', region: 'SV', layerTypes: ['layerRoadmap'], ...SCALE };
    const res = await fetch(`${API}/v1/createSession?key=${CFG.GOOGLE_MAPS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Google rechazó la sesión de mapa (${res.status}). Revisa la clave y la Map Tiles API.`);
    const data = await res.json(); S.sessions[kind] = data.session; return data.session;
  }
  const tiles = (kind) => [`${API}/v1/2dtiles/{z}/{x}/{y}?session=${S.sessions[kind]}&key=${CFG.GOOGLE_MAPS_API_KEY}`];

  /* ---------- Arranque ---------- */
  /** Devuelve true si la vista de Google quedó disponible. Nunca lanza: ante un fallo queda la vista táctica. */
  async function init() {
    if (!CFG.GOOGLE_MAPS_API_KEY) return false;
    try {
      loadCss(BASE + 'maplibre-gl.css'); await Promise.all([loadScript(BASE + 'maplibre-gl.js'), session('map'), session('sat')]); ML = window.maplibregl;
      const host = document.getElementById('gmap'); host.classList.remove('hidden'); host.style.visibility = 'hidden';
      const raster = (kind) => ({ type: 'raster', tiles: tiles(kind), tileSize: 256, maxzoom: 20 });
      const empty = { type: 'geojson', data: fc([]) };
      S.map = new ML.Map({
        container: 'gmap', attributionControl: false, center: [-88.9, 13.75], zoom: 8.1, pitch: 0, bearing: 0, minZoom: 5, maxZoom: 19.4, maxPitch: 62, fadeDuration: 150,
        style: { version: 8,
          // Horizonte oscuro: al inclinar el mapa, el cielo y la niebla usan el fondo de la consola
          sky: { 'sky-color': '#05090c', 'horizon-color': '#0b1217', 'fog-color': '#05090c', 'fog-ground-blend': .55, 'horizon-fog-blend': .9, 'sky-horizon-blend': 1, 'atmosphere-blend': 0 },
          sources: { gmap: raster('map'), gsat: raster('sat'), country: empty, cones: empty, blind: empty, zones: empty, heat: empty, routes: empty, trace: empty, tracePts: empty, units: empty, cams: empty },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#05090c' } },
            { id: 'gmap', type: 'raster', source: 'gmap' },
            { id: 'gsat', type: 'raster', source: 'gsat', layout: { visibility: 'none' }, paint: { 'raster-brightness-max': .72, 'raster-saturation': -.35, 'raster-contrast': .08 } },
            { id: 'country', type: 'line', source: 'country', maxzoom: 12.5, paint: { 'line-color': '#b3c452', 'line-width': 2, 'line-opacity': .9 } },
            // Cobertura: campo de visión de cada cámara operativa y celdas sin cobertura (puntos ciegos)
            { id: 'blind-fill', type: 'fill', source: 'blind', minzoom: 12.5, paint: { 'fill-color': '#bf5a52', 'fill-opacity': .07 } },
            { id: 'blind-line', type: 'line', source: 'blind', minzoom: 12.5, paint: { 'line-color': '#bf5a52', 'line-opacity': .55, 'line-width': 1, 'line-dasharray': [3, 3] } },
            { id: 'cones-fill', type: 'fill', source: 'cones', minzoom: 12.5, paint: { 'fill-color': '#78b2c8', 'fill-opacity': .1 } },
            { id: 'cones-line', type: 'line', source: 'cones', minzoom: 13.5, paint: { 'line-color': '#78b2c8', 'line-opacity': .35, 'line-width': 1 } },
            // Aglomeraciones: mapa de calor de lejos, área de la zona de cerca (zoom semántico)
            { id: 'heat', type: 'heatmap', source: 'heat', minzoom: 11, paint: {
              'heatmap-weight': ['get', 'w'], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, .6, 16, 1.6], 'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 11, 6, 16, 60, 18, 190],
              'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, .75, 17, .45],
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(120,178,200,0)', .25, 'rgba(120,178,200,.3)', .55, 'rgba(207,197,106,.42)', .85, 'rgba(191,90,82,.55)', 1, 'rgba(206,120,112,.68)'] } },
            { id: 'zones-line', type: 'line', source: 'zones', minzoom: 12.5, paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': .9 } },
            { id: 'zones-fill', type: 'fill', source: 'zones', minzoom: 12.5, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': .08 } },
            { id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#b3c452', 'line-width': 2.2, 'line-dasharray': [2, 2] } },
            { id: 'trace', type: 'line', source: 'trace', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': .95 } },
            { id: 'tracePts', type: 'circle', source: 'tracePts', paint: { 'circle-radius': 6, 'circle-color': '#05090c', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } },
            { id: 'units', type: 'symbol', source: 'units', minzoom: 12, layout: { 'icon-image': ['case', ['get', 'busy'], 'unit-busy', 'unit'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, .34, 16, .62], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
            // Cámaras: color según salud (en línea, degradada, sin señal)
            { id: 'cams-halo', type: 'circle', source: 'cams', minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 13], 'circle-color': ['get', 'color'], 'circle-opacity': .18 } },
            { id: 'cams', type: 'symbol', source: 'cams', minzoom: 12, layout: { 'icon-image': ['concat', 'cam-', ['get', 'status']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, .4, 16, .78], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
          ] },
      });
      await new Promise((ok) => S.map.once('load', ok));
      // Placas de icono (cámara CCTV y unidad) compartidas con las otras vistas del mapa
      const img = (id, name, color) => { const c = Glyph.badge(name, color); S.map.addImage(id, c.getContext('2d').getImageData(0, 0, c.width, c.height), { pixelRatio: 2 }); };
      img('cam-online', 'cctv', '#78b2c8'); img('cam-degraded', 'cctv', '#cfc56a'); img('cam-offline', 'cctv', '#bf5a52'); img('unit', 'unit', '#a3c3d0'); img('unit-busy', 'unit', '#b3c452');
      setData('country', [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: GEO.sv[0].reduce((a, v, i, arr) => (i % 2 ? a : a.concat([[v, arr[i + 1]]])), []) } }]);
      bindInteraction();
      S.map.on('moveend', credits);
      S.available = true; return true;
    } catch (err) {
      console.warn('[GMap] Vista de mapa de Google no disponible:', err);
      const el = document.getElementById('gmap'); if (el) el.classList.add('hidden');
      return false;
    }
  }

  /** Atribución exigida por Google: logo + texto de derechos del área visible (se consulta a Google al mover el mapa). */
  function credits() {
    clearTimeout(S.creditT);
    S.creditT = setTimeout(async () => {
      try {
        const b = S.map.getBounds(), kind = S.base;
        const url = `${API}/tile/v1/viewport?session=${S.sessions[kind]}&key=${CFG.GOOGLE_MAPS_API_KEY}&zoom=${Math.round(S.map.getZoom())}&north=${b.getNorth()}&south=${b.getSouth()}&east=${b.getEast()}&west=${b.getWest()}`;
        const data = await (await fetch(url)).json(); const el = document.getElementById('gmapCopy'); if (el && data.copyright) el.textContent = data.copyright;
      } catch (e) { /* se conserva el último texto mostrado */ }
    }, 500);
  }

  /* ---------- Cámara ---------- */
  /** Convierte la distancia de observación de City (metros) al nivel de zoom de MapLibre. */
  function zoomFor(r, lat) { const h = S.map.getContainer().clientHeight || 800, mpp = .69 * r / h; return clamp(Math.log2(40075016.7 * Math.cos(lat * Math.PI / 180) / (512 * mpp)), 5, 19.2); }
  function flyTo(x, z, r = 1000, phi = .82, duration = 1600) {
    if (!S.available) return; const p = toLatLon(x, z);
    S.map.flyTo({ center: [p.lon, p.lat], zoom: zoomFor(r, p.lat), pitch: clamp(phi * 180 / Math.PI - 4, 0, 60), bearing: S.map.getBearing(), duration: REDUCED ? 0 : duration, essential: true });
  }
  function overview(duration) { flyTo(HOME.x, HOME.z, HOME.r, HOME.phi, duration); }
  /** Entrada desde la vista de país: arranca alejado sobre El Salvador y desciende al sector. */
  function enter() { if (!S.available) return; S.map.jumpTo({ center: [-88.9, 13.75], zoom: 8.1, pitch: 0, bearing: 0 }); const p = toLatLon(HOME.x, HOME.z); S.map.flyTo({ center: [p.lon, p.lat], zoom: zoomFor(HOME.r, p.lat), pitch: 49, bearing: -18, duration: REDUCED ? 0 : 5200, curve: 1.5, essential: true }); }
  /** Estado de la vista para el HUD (mismo contrato que City.view). */
  function view() {
    const c = S.map.getCenter(), z = S.map.getZoom(), pitch = S.map.getPitch(), h = S.map.getContainer().clientHeight || 800;
    const r = 40075016.7 * Math.cos(c.lat * Math.PI / 180) / (512 * Math.pow(2, z)) * h / .69;
    return { lat: c.lat, lon: c.lng, x: (c.lng - ORIGIN.lon) * KX, z: -(c.lat - ORIGIN.lat) * KZ, alt: r * Math.cos(pitch * Math.PI / 180), heading: (S.map.getBearing() + 360) % 360, tilt: pitch };
  }

  /* ---------- Capas operativas ---------- */
  const camColor = (st) => st === 'online' ? '#78b2c8' : st === 'degraded' ? '#cfc56a' : '#bf5a52';
  const zoneColor = (st) => st === 'critical' ? '#bf5a52' : st === 'medium' ? '#cfc56a' : '#78b2c8';
  function drawCameras() {
    const cams = MockDB.cameras;
    setData('cams', cams.map((c) => ({ type: 'Feature', properties: { kind: 'camera', id: c.id, status: c.status, color: camColor(c.status) }, geometry: { type: 'Point', coordinates: ll(c.x, c.z) } })));
    setData('cones', cams.filter((c) => c.status !== 'offline').map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [Coverage.cone(c).map(([x, z]) => ll(x, z))] } })));
    S.coverage = Coverage.compute(cams);
    setData('blind', S.coverage.blind.map((b) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[ll(b.x, b.z), ll(b.x + b.size, b.z), ll(b.x + b.size, b.z + b.size), ll(b.x, b.z + b.size), ll(b.x, b.z)]] } })));
  }
  /** Ancla un elemento propio a una coordenada. MapLibre posiciona el contenedor (clase maplibregl-marker);
      nuestro elemento va dentro, para poder cambiarle clases y estilos sin romper ese anclaje.
      (Antes se reescribía la clase del propio marcador y este dejaba de estar fijado al mapa.) */
  function pinned(el, opts, x, z) { const wrap = document.createElement('div'); wrap.appendChild(el); return new ML.Marker({ element: wrap, ...opts }).setLngLat(ll(x, z)).addTo(S.map); }
  /** Recibe los mismos datos que City. Las unidades se leen de City en vivo (ver tick). */
  function setOpsData({ zones }) {
    if (!S.available) return; drawCameras();
    zones.forEach((z) => {
      const el = document.createElement('button'); el.className = 'gm-zone'; el.dataset.zone = z.id;
      const mk = pinned(el, { anchor: 'bottom', offset: [0, -6] }, z.x, Math.min(...z.poly.map((p) => p[1]))); // etiqueta en el borde norte del perímetro
      const r = mulberry32(z.id.charCodeAt(3) * 131); const pts = Array.from({ length: 36 }, () => Geo.sample(z.poly, r));
      S.zones.set(z.id, { el, mk, pts, z });
    });
    zones.forEach(updateZone); setInterval(tick, 600); tick(); S.map.on('moveend', declutter); S.map.on('zoom', declutter);
  }
  function updateZone(z) {
    const o = S.zones.get(z.id); if (!o) return;
    o.el.className = 'gm-zone ' + z.status; o.el.innerHTML = `<b>${z.name}</b><span>${fmt(z.est)}</span><em>${Geo.str(z)}</em>`;
    const all = [...S.zones.values()];
    setData('zones', all.map((q) => ({ type: 'Feature', properties: { kind: 'zone', id: q.z.id, color: zoneColor(q.z.status) }, geometry: { type: 'Polygon', coordinates: [q.z.poly.concat([q.z.poly[0]]).map(([x, zz]) => ll(x, zz))] } })));
    setData('heat', all.flatMap((q) => q.pts.map(([x, zz]) => ({ type: 'Feature', properties: { w: clamp(q.z.est / 90000, .03, 1) }, geometry: { type: 'Point', coordinates: ll(x, zz) } }))));
  }
  /** Evita que las etiquetas de zona se monten: la de mayor asistencia conserva su lugar y las demás bajan. */
  function declutter() {
    const placed = []; const items = [...S.zones.values()].sort((a, b) => b.z.est - a.z.est);
    items.forEach((o) => { o.mk.setOffset([0, -6]); });
    items.forEach((o) => {
      let r = o.el.getBoundingClientRect(), dy = 0, guard = 0;
      while (guard++ < 6 && placed.some((p) => !(r.right < p.left - 4 || r.left > p.right + 4 || r.bottom + dy < p.top - 2 || r.top + dy > p.bottom + 2))) dy += r.height + 4;
      if (dy) o.mk.setOffset([0, -6 + dy]);
      placed.push({ left: r.left, right: r.right, top: r.top + dy, bottom: r.bottom + dy });
    });
  }
  function setCameraStatus() { if (S.available) drawCameras(); }
  /** Posición en vivo de las unidades PNC (la simulación vive en City). */
  function tick() {
    if (!S.available || !S.active) return;
    setData('units', [...City.unitObjs.values()].map((o) => ({ type: 'Feature', properties: { kind: 'unit', id: o.u.id, busy: o.u.status !== 'patrullando' }, geometry: { type: 'Point', coordinates: ll(o.s.position.x, o.s.position.z) } })));
  }
  /** Pulso de alerta: anillos animados con CSS sobre el punto. */
  function pulse(x, z, color = COLOR.red, big = 1) {
    if (!S.available) return;
    const el = document.createElement('div'); el.className = 'gm-pulse'; el.style.setProperty('--c', hex(color)); el.style.setProperty('--s', String(big)); el.innerHTML = '<i></i><i></i><i></i>';
    const mk = new ML.Marker({ element: el }).setLngLat(ll(x, z)).addTo(S.map); setTimeout(() => mk.remove(), 3200);
  }
  function showTrace(sightings, opts = {}) {
    clearTrace(); if (!S.available || !sightings || sightings.length < 2) return; const color = hex(opts.color || COLOR.red);
    setData('trace', [{ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: (opts.path || sightings.map((s) => [s.x, s.z])).map(([x, z]) => ll(x, z)) } }]);
    setData('tracePts', sightings.map((s) => ({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: ll(s.x, s.z) } })));
    sightings.forEach((s, i) => {
      if (s.label === false) return; const el = document.createElement('div'); el.className = 'gm-tag'; el.style.borderColor = i === sightings.length - 1 ? color : ''; el.textContent = s.label || `${i + 1} · ${hhmm(s.ts)}`;
      S.traceMarks.push(new ML.Marker({ element: el, anchor: 'bottom', offset: [0, -12] }).setLngLat(ll(s.x, s.z)).addTo(S.map));
    });
  }
  function clearTrace() { if (!S.available) return; setData('trace', []); setData('tracePts', []); S.traceMarks.forEach((m) => m.remove()); S.traceMarks = []; }
  function dispatchUnits(ids, dest) {
    if (!S.available) return; const src = S.map.getSource('routes'); const cur = (src._p33 = src._p33 || []);
    ids.forEach((id) => { const o = City.unitObjs.get(id); if (o && o.path) cur.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: o.path.map(([x, z]) => ll(x, z)) } }); }); // o.path: ruta por calles calculada por City
    src.setData(fc(cur));
  }

  /* ---------- Incidentes abiertos ----------
     Severidad con codificación redundante (color + forma + icono), legible también para daltónicos:
     crítica = rombo rojo con pulso · media = triángulo amarillo · baja = círculo azul. */
  const ICON = { crowd: 'groups', plate: 'directions_car', face: 'face', camera: 'videocam_off', traffic: 'car_crash', track: 'person_search' };
  function syncIncidents(alerts, locate) {
    if (!S.available) return; const seen = new Set();
    alerts.filter((a) => a.status !== 'cerrada').slice(0, 24).forEach((a) => {
      const loc = locate(a); if (!loc) return; seen.add(a.id);
      let inc = S.incidents.get(a.id);
      if (!inc) {
        const el = document.createElement('button'); el.dataset.alert = a.id; el.setAttribute('aria-label', a.title);
        el.innerHTML = `<i></i><span class="ms">${ICON[a.type] || 'priority_high'}</span><u></u>`;
        el.addEventListener('mouseenter', (e) => UI.tip({ kind: 'incident', id: a.id }, e.clientX, e.clientY)); el.addEventListener('mouseleave', () => UI.tip(null));
        const k = [...S.incidents.values()].filter((q) => Math.hypot(q.loc.x - loc.x, q.loc.z - loc.z) < 5).length; // separa los que caen en el mismo punto
        inc = { el, loc, mk: pinned(el, { anchor: 'bottom', offset: [k * 14, 0] }, loc.x, loc.z) }; // la punta del asta toca la coordenada exacta S.incidents.set(a.id, inc);
      }
      inc.el.className = `gm-inc ${a.severity} ${a.status === 'en atención' ? 'ack' : ''}`;
    });
    S.incidents.forEach((inc, id) => { if (!seen.has(id)) { inc.mk.remove(); S.incidents.delete(id); } });
    applyLayers();
  }

  /* ---------- Capas visibles y mapa base ---------- */
  function applyLayers() {
    if (!S.available) return; const vis = (on) => on ? 'visible' : 'none', L = S.layers, m = S.map;
    ['cams', 'cams-halo'].forEach((id) => m.setLayoutProperty(id, 'visibility', vis(L.cams)));
    ['cones-fill', 'cones-line', 'blind-fill', 'blind-line'].forEach((id) => m.setLayoutProperty(id, 'visibility', vis(L.coverage)));
    ['zones-fill', 'zones-line', 'heat'].forEach((id) => m.setLayoutProperty(id, 'visibility', vis(L.zones)));
    S.zones.forEach((o) => { o.el.style.display = L.zones ? '' : 'none'; });
    m.setLayoutProperty('units', 'visibility', vis(L.units));
    S.incidents.forEach((inc) => { inc.el.style.display = L.incidents ? '' : 'none'; });
  }
  function setLayer(name, on) { if (name in S.layers) { S.layers[name] = on; applyLayers(); } }
  /** base: 'map' (roadmap de marca) | 'sat' (satélite híbrido). */
  function setBase(base) {
    if (!S.available) return; S.base = base;
    S.map.setLayoutProperty('gmap', 'visibility', base === 'map' ? 'visible' : 'none');
    S.map.setLayoutProperty('gsat', 'visibility', base === 'sat' ? 'visible' : 'none');
    credits();
  }
  /** Atenuación de la imagen satelital para turnos largos (no altera el mapa de marca, que ya es oscuro). */
  function setNight(on) { if (!S.available) return; S.night = on; S.map.setPaintProperty('gsat', 'raster-brightness-max', on ? .72 : 1); S.map.setPaintProperty('gsat', 'raster-saturation', on ? -.35 : 0); }
  function setActive(on) {
    if (!S.available) return false; S.active = on;
    document.getElementById('gmap').style.visibility = on ? 'visible' : 'hidden';
    document.getElementById('gmapCredits').style.display = on ? '' : 'none';
    if (on) { S.map.resize(); tick(); credits(); setTimeout(declutter, 60); }
    return true;
  }

  /* ---------- Interacción ---------- */
  function bindInteraction() {
    const m = S.map, pickable = ['cams', 'units', 'blind-fill', 'zones-fill'];
    m.on('mousemove', (e) => { UI.cursor(e.lngLat.lat, e.lngLat.lng); const f = m.queryRenderedFeatures(e.point, { layers: pickable })[0]; m.getCanvas().style.cursor = f ? 'pointer' : ''; UI.tip(f ? (f.properties.kind ? f.properties : { kind: 'blind', lat: e.lngLat.lat, lon: e.lngLat.lng }) : null, e.originalEvent.clientX, e.originalEvent.clientY); });
    m.on('mouseout', () => UI.tip(null));
    m.on('click', (e) => { const f = m.queryRenderedFeatures(e.point, { layers: pickable })[0]; if (f && f.properties.kind && GMap.onPick) GMap.onPick(f.properties); });
  }

  return {
    init, enter, flyTo, overview: (d) => S.available && overview(d), view, setOpsData, updateZone, setCameraStatus, pulse, showTrace, clearTrace, dispatchUnits, syncIncidents, setLayer, setBase, setNight, setActive,
    get available() { return S.available; }, get active() { return S.active; }, get base() { return S.base; }, get night() { return S.night; }, get layers() { return S.layers; }, get coverage() { return S.coverage; }, onPick: null,
  };
})();
