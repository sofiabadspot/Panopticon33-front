/* =====================================================================
   §6b GEOMAP — vista fotorrealista del territorio.
   Motor: CesiumJS. Datos: Google Photorealistic 3D Tiles (Map Tiles API).

   Cómo encaja en la consola
   - City (§6) sigue siendo la fuente de verdad del mapa: guarda cámaras,
     zonas, unidades y la simulación. GeoMap es un "espejo": City le reenvía
     las mismas órdenes (flyTo, pulse, showTrace…) mediante City.setMirror().
   - Si no hay clave de Google, o Cesium no carga, GeoMap queda inactivo y la
     consola funciona completa con la vista táctica. Nada depende de Google.

   Requisitos de uso de Google que este módulo respeta
   - La atribución y el logo de Google se muestran siempre (#geoCredits).
   - No se guarda ni se descarga contenido de los mosaicos.
   - El mapa solo se usa para visualizar; Panopticon nunca analiza estas imágenes.
   - No hay buscador de direcciones (tendría que ser el de Google).

   Configuración: window.P33_CONFIG (archivo config.local.js, fuera del código).
   ===================================================================== */
const GeoMap = (() => {
  const CFG = window.P33_CONFIG || {};
  const VERSION = CFG.CESIUM_VERSION || '1.146.0';
  const BASE = `https://cdn.jsdelivr.net/npm/cesium@${VERSION}/Build/Cesium/`;
  /** Vista general del sector (coordenadas locales en metros, ver ORIGIN en §1). */
  const HOME = { x: 180, z: 70, range: 2300, heading: 18, pitch: -38 };
  const S = {
    available: false, active: false, viewer: null, tileset: null, shader: null, night: true,
    ground: 700,            // altura elipsoidal aproximada del terreno en el sector (se afina al cargar)
    spin: true,             // balanceo lento del globo durante la intro
    zones: new Map(), trace: [], lastPick: 0,
  };
  let C = null; // atajo a window.Cesium una vez cargado
  const NEAR = 30000; // las capas operativas solo se dibujan a menos de 30 km (no ensucian la vista de planeta)

  /* ---------- Carga diferida de CesiumJS (solo si hay clave) ---------- */
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
  const loadCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };

  /* ---------- Conversión de coordenadas locales (x este, z sur, en metros) ---------- */
  const pos = (x, z, h = 0) => { const ll = toLatLon(x, z); return C.Cartesian3.fromDegrees(ll.lon, ll.lat, h); };
  const css = (hex, a = 1) => C.Color.fromCssColorString('#' + hex.toString(16).padStart(6, '0')).withAlpha(a);
  const camColor = (st) => st === 'online' ? COLOR.muted : st === 'degraded' ? COLOR.yellow : COLOR.red;
  const zoneColor = (st) => st === 'critical' ? COLOR.red : st === 'medium' ? COLOR.yellow : COLOR.muted;
  const labelStyle = (text, size = 13) => ({
    text, font: `500 ${size}px "IBM Plex Sans", sans-serif`, fillColor: C.Color.fromCssColorString('#fcfcfc'),
    showBackground: true, backgroundColor: C.Color.fromCssColorString('#0d0d0d').withAlpha(.88), backgroundPadding: new C.Cartesian2(9, 6),
    heightReference: C.HeightReference.RELATIVE_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
    verticalOrigin: C.VerticalOrigin.BOTTOM, scaleByDistance: new C.NearFarScalar(600, 1.1, 9000, .7), distanceDisplayCondition: new C.DistanceDisplayCondition(0, NEAR),
  });

  /* ---------- Arranque ---------- */
  /** Devuelve true si la vista fotorrealista quedó disponible. Nunca lanza: ante un fallo, la consola sigue en modo táctico. */
  async function init() {
    if (!CFG.GOOGLE_MAPS_API_KEY) return false;
    try {
      window.CESIUM_BASE_URL = BASE; loadCss(BASE + 'Widgets/widgets.css'); await loadScript(BASE + 'Cesium.js'); C = window.Cesium;
      const host = document.getElementById('geo'); host.classList.remove('hidden'); host.style.visibility = 'hidden'; // con tamaño real, pero oculto hasta activarse
      const viewer = new C.Viewer('geo', {
        globe: false,               // los mosaicos de Google ya traen terreno e imagen de todo el planeta
        geocoder: false,            // exigencia de Google: sin buscador de direcciones ajeno
        baseLayerPicker: false, timeline: false, animation: false, homeButton: false, sceneModePicker: false,
        navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
        creditContainer: 'geoCredits', // atribución de Google siempre visible, por encima de la viñeta
      });
      viewer.scene.backgroundColor = css(COLOR.bg);
      viewer.scene.highDynamicRange = false;
      viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      S.viewer = viewer;

      const tileset = await C.createGooglePhotorealistic3DTileset({ key: CFG.GOOGLE_MAPS_API_KEY, onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: 16, showCreditsOnScreen: true });
      viewer.scene.primitives.add(tileset); S.tileset = tileset;
      // Filtro nocturno: desatura y oscurece la fotografía diurna para el ambiente de sala de control.
      S.shader = new C.CustomShader({
        lightingModel: C.LightingModel.UNLIT,
        uniforms: { u_night: { type: C.UniformType.FLOAT, value: 1 } },
        fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          vec3 c = material.diffuse; float l = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 n = mix(vec3(l), c, 0.32) * vec3(0.40, 0.48, 0.55);
          material.diffuse = mix(c, n, u_night); }`,
      });
      tileset.customShader = S.shader;

      country(); introPose(); bindPicking();
      viewer.scene.preRender.addEventListener(() => { if (S.spin) viewer.camera.rotate(C.Cartesian3.UNIT_Z, Math.cos(performance.now() / 9000) * .00022); });
      S.available = true; setActive(false); return true;
    } catch (err) {
      console.warn('[GeoMap] Vista fotorrealista no disponible:', err);
      const el = document.getElementById('geo'); if (el) el.classList.add('hidden');
      return false;
    }
  }

  /** Contorno y tinte de El Salvador para ubicar el territorio desde la vista de planeta. */
  function country() {
    const ring = GEO.sv[0]; const v = S.viewer;
    const outline = []; for (let i = 0; i < ring.length; i += 2) outline.push(ring[i], ring[i + 1], 2500);
    v.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArrayHeights(outline), width: 2.5, material: css(COLOR.primary, .95) } });
    // Tinte del territorio: se pinta sobre los mosaicos y solo se ve de lejos (no interfiere con la operación).
    v.entities.add({ polygon: {
      hierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(ring)), material: css(COLOR.primary, .16),
      classificationType: C.ClassificationType.CESIUM_3D_TILE, distanceDisplayCondition: new C.DistanceDisplayCondition(60000, Number.MAX_VALUE),
    } });
  }

  /* ---------- Cámara ---------- */
  function introPose() {
    const cam = S.viewer.camera;
    cam.lookAt(C.Cartesian3.fromDegrees(-86.5, 8, 0), new C.HeadingPitchRange(0, C.Math.toRadians(-80), 10200000));
    cam.lookAtTransform(C.Matrix4.IDENTITY);
  }
  function fly(center, headingDeg, pitchDeg, range, duration, complete) {
    S.viewer.camera.flyToBoundingSphere(new C.BoundingSphere(center, 1), {
      offset: new C.HeadingPitchRange(C.Math.toRadians(headingDeg), C.Math.toRadians(pitchDeg), range), duration: REDUCED ? 0 : duration, complete,
    });
  }
  /** Vuelo de entrada: planeta → El Salvador → sector Salvador del Mundo. `onCountry` avisa al llegar al país. */
  function flyIn(onCountry) {
    S.spin = false;
    fly(C.Cartesian3.fromDegrees(-88.9, 13.75, 0), 0, -62, 430000, 2.8, () => { onCountry && onCountry(); enterSector(4.2); });
  }
  /** Vuelo de entrada solo hasta la vista de país (cuando la consola abre en la vista Mapa de Google). */
  function flyCountry(done) { S.spin = false; fly(C.Cartesian3.fromDegrees(-88.9, 13.75, 0), 0, -88, 430000, 2.8, done); }
  /** Pasa a modo operación: encuadra el sector y limita el zoom para no salir del territorio vigilado. */
  function enterSector(duration) {
    S.spin = false; S.inSector = true; overview(duration);
    const ctl = S.viewer.scene.screenSpaceCameraController; ctl.minimumZoomDistance = 120; ctl.maximumZoomDistance = 14000;
    refineGround();
  }
  function overview(duration = 1.8) { fly(pos(HOME.x, HOME.z, S.ground), HOME.heading, HOME.pitch, HOME.range, duration); }
  /** Misma firma que City.flyTo: (x, z, distancia, inclinación desde la vertical en radianes). */
  function flyTo(x, z, r = 1000, phi = .82) {
    if (!S.available) return;
    fly(pos(x, z, S.ground), C.Math.toDegrees(S.viewer.camera.heading), -(90 - phi * 180 / Math.PI), Math.max(380, r * .85), 1.6);
  }
  /** Afina la altura del terreno con los mosaicos ya cargados (los marcadores usan altura relativa y no dependen de esto). */
  async function refineGround() {
    try { const ll = toLatLon(HOME.x, HOME.z); const [c] = await S.viewer.scene.sampleHeightMostDetailed([C.Cartographic.fromDegrees(ll.lon, ll.lat)]); if (c && isFinite(c.height)) S.ground = c.height; } catch (e) { /* se conserva la estimación */ }
  }
  /** Punto de San Salvador en pantalla, para anclar la tarjeta de la intro. */
  function anchor() {
    const p = C.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat, 800), sc = S.viewer.scene;
    const w = C.SceneTransforms.worldToWindowCoordinates(sc, p);
    const vis = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, sc.camera.positionWC).isPointVisible(p);
    return w ? { x: w.x, y: w.y, vis } : { x: 0, y: 0, vis: false };
  }
  /** Estado de la vista para el HUD (mismo contrato que City.view). */
  function view() {
    const cam = S.viewer.camera, cv = S.viewer.scene.canvas;
    const hit = cam.pickEllipsoid(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2), C.Ellipsoid.WGS84);
    const cg = hit ? C.Cartographic.fromCartesian(hit) : cam.positionCartographic;
    const lat = C.Math.toDegrees(cg.latitude), lon = C.Math.toDegrees(cg.longitude);
    return { lat, lon, x: (lon - ORIGIN.lon) * KX, z: -(lat - ORIGIN.lat) * KZ, alt: Math.max(0, cam.positionCartographic.height - S.ground), heading: C.Math.toDegrees(cam.heading), tilt: 90 + C.Math.toDegrees(cam.pitch) };
  }

  /* ---------- Capas operativas ---------- */
  const marker = (color, size) => ({
    pixelSize: size, color: css(color), outlineColor: css(COLOR.bg, .9), outlineWidth: 2,
    heightReference: C.HeightReference.RELATIVE_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
    scaleByDistance: new C.NearFarScalar(500, 1.4, 9000, .65), distanceDisplayCondition: new C.DistanceDisplayCondition(0, NEAR),
  });
  /** Placa de icono sobre los mosaicos (misma iconografía que las otras vistas). */
  const plate = (canvas, size = 24) => ({ image: canvas, width: size, height: size, heightReference: C.HeightReference.RELATIVE_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new C.NearFarScalar(500, 1.25, 9000, .6), distanceDisplayCondition: new C.DistanceDisplayCondition(0, NEAR) });
  /** Recibe los mismos datos que City: cámaras, zonas y los objetos de unidad (para leer su posición en vivo). */
  function setData({ cameras, zones, unitObjs }) {
    if (!S.available) return; const E = S.viewer.entities;
    cameras.forEach((c) => { const e = E.add({ position: pos(c.x, c.z, 9), billboard: plate(Glyph.badge('cctv', camColor(c.status))) }); e.p33 = { kind: 'camera', id: c.id }; c._geo = e; });
    zones.forEach((z) => {
      // Geocerca con su perímetro real, proyectada sobre los mosaicos
      const area = E.add({ polygon: { hierarchy: new C.PolygonHierarchy(z.poly.map(([px, pz]) => pos(px, pz))), material: css(zoneColor(z.status), .34), classificationType: C.ClassificationType.CESIUM_3D_TILE, distanceDisplayCondition: new C.DistanceDisplayCondition(0, NEAR) } });
      area.p33 = { kind: 'zone', id: z.id };
      const label = E.add({ position: pos(z.x, z.z, 46), label: labelStyle(z.name) }); label.p33 = area.p33;
      S.zones.set(z.id, { area, label, status: z.status });
    });
    unitObjs.forEach((o) => {
      const kind = Glyph.unitKind(o.u), idle = Glyph.badge('unit', COLOR.police, { kind }), busy = Glyph.badge('unit', 0xf4f4f4, { kind, busy: true });
      const e = E.add({ position: new C.CallbackProperty(() => pos(o.s.position.x, o.s.position.z, 5), false), billboard: plate(idle, 20) });
      e.billboard.image = new C.CallbackProperty(() => (o.u.status === 'patrullando' ? idle : busy), false);
      e.p33 = { kind: 'unit', id: o.u.id };
    });
  }
  function updateZone(z) {
    const o = S.zones.get(z.id); if (!o) return;
    o.label.label.text = `${z.name} · ${fmt(z.est)}`;
    if (o.status !== z.status) { o.status = z.status; o.area.polygon.material = css(zoneColor(z.status), .34); }
  }
  /* ---------- Incidentes: mismo marcador que en las otras vistas, anclado a su coordenada ---------- */
  function syncIncidents(alerts) {
    if (!S.available) return; const E = S.viewer.entities, seen = new Set(); S.incidents = S.incidents || new Map();
    alerts.filter((a) => a.status !== 'cerrada' && a.x !== undefined).slice(0, 24).forEach((a) => {
      seen.add(a.id); let e = S.incidents.get(a.id);
      if (!e) { e = E.add({ position: pos(a.x, a.z, 16), billboard: plate(Glyph.incident(a.severity, false), 28) }); e.p33 = { kind: 'incident', id: a.id }; S.incidents.set(a.id, e); }
      e.billboard.image = Glyph.incident(a.severity, a.status === 'en atención');
    });
    S.incidents.forEach((e, id) => { if (!seen.has(id)) { E.remove(e); S.incidents.delete(id); } });
  }
  function setCameraStatus(id, status) { const c = MockDB.cameras.find((q) => q.id === id); if (c && c._geo) c._geo.billboard.image = Glyph.badge('cctv', camColor(status)); }
  /** Pulso de alerta: tres anillos en pantalla que crecen y se desvanecen. */
  function pulse(x, z, color = COLOR.red, big = 1) {
    if (!S.available) return; const E = S.viewer.entities;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now() + k * 420, dur = 2300, prog = () => clamp((performance.now() - t0) / dur, 0, 1);
      const e = E.add({ position: pos(x, z, 4), point: {
        color: C.Color.TRANSPARENT, outlineWidth: 2, heightReference: C.HeightReference.RELATIVE_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelSize: new C.CallbackProperty(() => 8 + prog() * 110 * big, false), outlineColor: new C.CallbackProperty(() => css(color, .95 * (1 - prog())), false),
      } });
      setTimeout(() => E.remove(e), dur + k * 420 + 100);
    }
  }
  /** Línea pegada al terreno y a los edificios (se dibuja sobre los mosaicos de Google). */
  const groundLine = (positions, material, width = 4) => ({ positions, width, material, clampToGround: true, classificationType: C.ClassificationType.CESIUM_3D_TILE });
  function showTrace(sightings, opts = {}) {
    clearTrace(); if (!S.available || !sightings || sightings.length < 2) return; const E = S.viewer.entities, color = opts.color || COLOR.red;
    S.trace.push(E.add({ polyline: groundLine((opts.path || sightings.map((s) => [s.x, s.z])).map(([x, z]) => pos(x, z)), css(color, .95), 5) }));
    sightings.forEach((s, i) => {
      S.trace.push(E.add({ position: pos(s.x, s.z, 6), point: marker(color, 11) }));
      if (s.label === false) return;
      const st = labelStyle(s.label || `${i + 1} · ${hhmm(s.ts)}`, 12); st.font = '500 12px "IBM Plex Mono", monospace';
      S.trace.push(E.add({ position: pos(s.x, s.z, 34), label: st }));
    });
  }
  function clearTrace() { if (!S.available) return; S.trace.forEach((e) => S.viewer.entities.remove(e)); S.trace = []; }
  /** Rutas de despacho de MAIC. Las unidades se mueven solas: su posición se lee de City en cada cuadro. */
  function dispatchUnits(ids, dest) {
    if (!S.available) return;
    ids.forEach((id) => { const o = City.unitObjs.get(id); if (!o) return;
      S.viewer.entities.add({ polyline: groundLine((o.path || [[o.s.position.x, o.s.position.z], [dest.x, dest.z]]).map(([x, z]) => pos(x, z)), new C.PolylineDashMaterialProperty({ color: css(COLOR.primary, .95), dashLength: 18 }), 3) });
    });
  }

  /* ---------- Interacción ---------- */
  function bindPicking() {
    const h = new C.ScreenSpaceEventHandler(S.viewer.scene.canvas);
    const at = (p) => { const hit = S.viewer.scene.pick(p); return hit && hit.id && hit.id.p33 ? hit.id.p33 : null; };
    h.setInputAction((m) => { const now = performance.now(); if (now - S.lastPick < 90) return; S.lastPick = now; UI.tip(at(m.endPosition), m.endPosition.x, m.endPosition.y);
      const sc = S.viewer.scene, p = (sc.pickPositionSupported && sc.pickPosition(m.endPosition)) || S.viewer.camera.pickEllipsoid(m.endPosition); if (p) { const cg = C.Cartographic.fromCartesian(p); UI.cursor(C.Math.toDegrees(cg.latitude), C.Math.toDegrees(cg.longitude)); } }, C.ScreenSpaceEventType.MOUSE_MOVE);
    h.setInputAction((m) => { const info = at(m.position); if (info && GeoMap.onPick) GeoMap.onPick(info); }, C.ScreenSpaceEventType.LEFT_CLICK);
  }

  /* ---------- Conmutación con la vista táctica ---------- */
  function setActive(on) {
    if (!S.available) return false; S.active = on;
    document.getElementById('geo').style.visibility = on ? 'visible' : 'hidden';
    document.getElementById('geoCredits').style.display = on ? '' : 'none';
    document.getElementById('gl').style.visibility = on ? 'hidden' : 'visible';
    S.viewer.useDefaultRenderLoop = on; // sin trabajo de GPU mientras está oculto
    if (on && S.requireSector && !S.inSector) enterSector(0); // se activó desde la consola sin pasar por el vuelo de entrada
    return true;
  }
  function setNight(on) { if (!S.available) return; S.night = on; S.shader.setUniform('u_night', on ? 1 : 0); }

  return {
    init, flyIn, flyCountry, requireSector() { S.requireSector = true; }, overview: () => S.available && overview(), flyTo, anchor, view, setData, updateZone, setCameraStatus, syncIncidents, pulse, showTrace, clearTrace, dispatchUnits, setActive, setNight,
    get available() { return S.available; }, get active() { return S.active; }, get night() { return S.night; }, onPick: null,
  };
})();
