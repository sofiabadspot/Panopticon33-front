/* =====================================================================
   Utilidades 3D compartidas
   ===================================================================== */
const D2R = Math.PI / 180;
function glowTexture(hard = false) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) { gr.addColorStop(0, '#fff'); gr.addColorStop(.42, '#fff'); gr.addColorStop(.5, 'rgba(255,255,255,0)'); }
  else { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
const TEX = { glow: null, dot: null };
function textSprite(text, opts = {}) {
  const { size = 26, color = '#fcfcfc', bg = 'rgba(8,14,18,.88)', border = '#2e3840', font = 'IBM Plex Sans', weight = 500, worldH = 22 } = opts;
  const c = document.createElement('canvas'), g = c.getContext('2d'), pad = 14;
  g.font = `${weight} ${size}px "${font}"`; const w = Math.ceil(g.measureText(text).width) + pad * 2, h = size + pad * 1.3;
  c.width = w * 2; c.height = h * 2; g.scale(2, 2);
  g.fillStyle = bg; g.strokeStyle = border; g.lineWidth = 1.5; roundRect(g, 1, 1, w - 2, h - 2, 8); g.fill(); g.stroke();
  g.font = `${weight} ${size}px "${font}"`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set(worldH * w / h, worldH, 1); s.renderOrder = 10; return s;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

/* =====================================================================
   GLYPH — iconografía operativa propia (cámara CCTV, unidad policial).
   Trazos geométricos y sobrios, legibles a tamaño pequeño. Se usan igual
   en la interfaz (SVG) y en los tres motores de mapa (placa en canvas).
   El resto de los iconos de la interfaz son Material Symbols Sharp.
   ===================================================================== */
const Glyph = (() => {
  /** Trazados en una caja de 24 × 24 (formato de ruta SVG). */
  const PATHS = {
    // Cámara fija tipo bala sobre soporte de pared: se reconoce como cámara de vigilancia
    cctv: 'M2.5 4.5h2v15h-2z M4.5 15h5.2l1.3-2.2 1.7.9-1.9 3.3H4.5z M7.6 8.3l10.9-3.6 2 6-10.9 3.6z M19.4 4.4l2-.7 2 6-2 .7z',
    // Escudo: unidad policial
    unit: 'M12 2.2l8 3v6.1c0 4.9-3.3 9-8 10.5-4.7-1.5-8-5.6-8-10.5V5.2z M12 6.2l-4 1.5v3.6c0 2.9 1.6 5.3 4 6.5z',
  };
  const svg = (name, size = 18) => `<svg class="gl" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${PATHS[name]}"/></svg>`;
  /** Placa cuadrada para el mapa: fondo oscuro, borde y glifo del color de estado. Devuelve un canvas de 64 px. */
  function badge(name, color, opts = {}) {
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), hex = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
    g.fillStyle = opts.fill || '#070c10'; g.strokeStyle = hex; g.lineWidth = 4; roundRect(g, 5, 5, S - 10, S - 10, opts.round ? 27 : 9); g.fill(); g.stroke();
    g.save(); g.translate(12, 12); g.scale(40 / 24, 40 / 24); g.fillStyle = hex; g.fill(new Path2D(PATHS[name]), 'evenodd'); g.restore();
    return c;
  }
  /** Marcador de incidente con codificación redundante (forma + color): rombo rojo = crítica,
      triángulo amarillo = media, círculo azul = baja, anillo verde = en atención. Canvas de 64 px. */
  const incCanvas = {};
  function incident(severity, ack) {
    const key = severity + (ack ? 'a' : ''); if (incCanvas[key]) return incCanvas[key];
    const c = document.createElement('canvas'); incCanvas[key] = c; c.width = c.height = 64; const g = c.getContext('2d'); g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#05090c';
    const col = ack ? '#7fa677' : severity === 'critical' ? '#bf5a52' : severity === 'medium' ? '#cfc56a' : '#78b2c8';
    g.beginPath();
    if (ack) g.arc(32, 32, 22, 0, 6.2832);
    else if (severity === 'critical') { g.moveTo(32, 5); g.lineTo(59, 32); g.lineTo(32, 59); g.lineTo(5, 32); g.closePath(); }
    else if (severity === 'medium') { g.moveTo(32, 6); g.lineTo(60, 56); g.lineTo(4, 56); g.closePath(); }
    else g.arc(32, 32, 24, 0, 6.2832);
    g.fillStyle = ack ? '#05090c' : col; g.fill(); if (ack) { g.strokeStyle = col; g.lineWidth = 5; } g.stroke();
    g.fillStyle = ack ? col : severity === 'critical' ? '#fff' : '#05090c'; g.font = '700 30px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ack ? '✓' : '!', 32, severity === 'medium' && !ack ? 40 : 33);
    return c;
  }
  const cache = new Map();
  /** Textura de three.js de una placa (con caché). */
  function texture(name, color) { const k = name + color; if (!cache.has(k)) { const t = new THREE.CanvasTexture(badge(name, color)); t.minFilter = THREE.LinearFilter; cache.set(k, t); } return cache.get(k); }
  /** Textura de un marcador de incidente (con caché). */
  function incidentTexture(severity, ack) { const k = 'inc' + severity + ack; if (!cache.has(k)) { const t = new THREE.CanvasTexture(incident(severity, ack)); t.minFilter = THREE.LinearFilter; cache.set(k, t); } return cache.get(k); }
  return { svg, badge, texture, incident, incidentTexture, PATHS };
})();

/* =====================================================================
   §5 GLOBE — globo terráqueo 3D de la intro, centrado en El Salvador
   ===================================================================== */
const Globe = (() => {
  const R = 100;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 5000);
  const group = new THREE.Group(); scene.add(group);
  const SV = { lat: 13.72, lon: -88.95 };
  const SS = { lat: 13.7013, lon: -89.2243 };
  const arcs = []; let pings = []; const state = { fly: null };

  function v(lat, lon, r = R) { const p = (90 - lat) * D2R, t = (lon + 180) * D2R; return new THREE.Vector3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)); }

  /** Textura equirectangular dibujada en canvas: océano, tierra, fronteras y El Salvador resaltado. */
  function earthTexture() {
    const W = 4096, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#04090d'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,170,190,.05)'; g.lineWidth = 1;
    for (let lo = -180; lo <= 180; lo += 15) { const x = (lo + 180) / 360 * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let la = -75; la <= 75; la += 15) { const y = (90 - la) / 180 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const path = (ring) => { g.beginPath(); let px = null; for (let i = 0; i < ring.length; i += 2) { const x = (ring[i] + 180) / 360 * W, y = (90 - ring[i + 1]) / 180 * H; if (px === null || Math.abs(x - px) > W / 2) g.moveTo(x, y); else g.lineTo(x, y); px = x; } };
    g.fillStyle = '#0d1a20'; GEO.land.forEach((r) => { path(r); g.closePath(); g.fill(); });
    g.strokeStyle = 'rgba(110,170,195,.24)'; g.lineWidth = 1.2; GEO.borders.forEach((r) => { path(r); g.stroke(); });
    g.fillStyle = '#26350a'; GEO.sv.forEach((r) => { path(r); g.closePath(); g.fill(); });
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }

  function init() {
    TEX.glow = TEX.glow || glowTexture(); TEX.dot = TEX.dot || glowTexture(true);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), new THREE.MeshBasicMaterial({ map: earthTexture() })));
    // Brillo de borde (fresnel) y atmósfera
    const rim = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { c: { value: new THREE.Color(COLOR.skyHi) } },
      vertexShader: 'varying vec3 n; varying vec3 vp; void main(){ n=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vp=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 c; varying vec3 n; varying vec3 vp; void main(){ float f=pow(1.-max(dot(n,vp),0.),3.2); gl_FragColor=vec4(c,f*.4); }',
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.002, 96, 64), rim));
    const atm = new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { c: { value: new THREE.Color(COLOR.sky) } },
      vertexShader: 'varying vec3 n; void main(){ n=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 c; varying vec3 n; void main(){ float f=pow(.62-dot(n,vec3(0.,0.,1.)),3.); gl_FragColor=vec4(c,clamp(f,0.,1.)*.6); }',
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), atm));
    // Contorno nítido de El Salvador
    GEO.sv.forEach((ring) => {
      const pts = []; for (let i = 0; i < ring.length; i += 2) pts.push(v(ring[i + 1], ring[i], R * 1.0015));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLOR.lime, transparent: true, opacity: .95 })));
    });
    // Estrellas
    const sp = new Float32Array(3000 * 3); for (let i = 0; i < 3000; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 1600 + rnd() * 600, s = Math.sqrt(1 - u * u); sp.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfe9ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: .55 })));
    // Red SENTINEL: cabeceras departamentales conectadas al centro de mando
    const deps = [[13.9942, -89.5597], [13.4833, -88.1833], [13.6769, -89.2797], [13.7189, -89.7242], [13.9214, -89.845], [13.35, -88.45], [13.3369, -87.8439], [14.0333, -88.9333], [13.7167, -88.9333], [13.5, -88.8667], [13.6333, -88.8], [13.8667, -88.6333], [13.7, -88.1], [14.33, -89.15]];
    const origin = v(SS.lat, SS.lon, R);
    deps.forEach(([la, lo], i) => {
      const end = v(la, lo, R); const mid = origin.clone().add(end).multiplyScalar(.5).normalize().multiplyScalar(R + origin.distanceTo(end) * .35);
      const curve = new THREE.QuadraticBezierCurve3(origin, mid, end); const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLOR.skyHi, transparent: true, opacity: .75 }));
      group.add(line); arcs.push({ line, delay: 1.2 + i * .18 });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: COLOR.skyHi, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(v(la, lo, R * 1.001)); s.scale.setScalar(.9); group.add(s); pings.push({ s, ph: rnd() * 6 });
    });
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: COLOR.lime, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    core.position.copy(v(SS.lat, SS.lon, R * 1.002)); core.scale.setScalar(2.4); group.add(core); pings.push({ s: core, ph: 0, core: true });
    setPose(0);
  }
  /** Encuadre: posición de cámara interpolada entre plano regional (0) y aproximación (1). */
  function setPose(k) {
    const far = v(SV.lat - 9, SV.lon + 5, 1).normalize().multiplyScalar(330);
    const near = v(SS.lat - .25, SS.lon, 1).normalize().multiplyScalar(106.5);
    camera.position.copy(far.clone().lerp(near, k));
    const lookFar = v(SV.lat + 3, SV.lon + 5, 30), lookNear = v(SS.lat, SS.lon, 100);
    camera.lookAt(lookFar.clone().lerp(lookNear, k));
  }
  function update(t) {
    const s = t / 1000;
    if (!state.fly) group.rotation.y = Math.sin(s * .07) * .05;
    arcs.forEach((a) => { const k = clamp((s - a.delay) / 1.4, 0, 1); a.line.geometry.setDrawRange(0, Math.floor(ease(k) * 49)); });
    pings.forEach((p) => { const k = .5 + .5 * Math.sin(s * 2 + p.ph); p.s.material.opacity = p.core ? .7 + .3 * k : .35 + .65 * k; if (p.core) p.s.scale.setScalar(2.2 + k * 1.4); });
    if (state.fly) {
      const k = clamp((t - state.fly.t0) / state.fly.dur, 0, 1); group.rotation.y = lerp(state.fly.r0, 0, ease(k)); setPose(ease(k));
      if (k >= 1 && state.fly.done) { const d = state.fly.done; state.fly.done = null; d(); }
    }
  }
  /** Proyección de San Salvador a pantalla para anclar la tarjeta HTML. */
  function anchor(w, h) { const p = v(SS.lat, SS.lon, R * 1.002).applyMatrix4(group.matrixWorld).project(camera); return { x: (p.x * .5 + .5) * w, y: (-p.y * .5 + .5) * h, vis: p.z < 1 }; }
  function flyIn(done) { state.fly = { t0: performance.now(), dur: REDUCED ? 10 : 2600, r0: group.rotation.y, done }; }
  return { scene, camera, init, update, anchor, flyIn };
})();

/* =====================================================================
   §6 CITY — Sector Salvador del Mundo, San Salvador, en 3D.
   Vías, edificios y áreas verdes reales de OpenStreetMap. Donde OSM no
   tiene edificios cartografiados se añade un relleno urbano genérico
   (volúmenes bajos sin borde) solo como contexto visual. En producción la
   base será fotorrealista (Google Photorealistic 3D Tiles) o la cartografía
   oficial que entregue el ministerio.
   Capas: base, vías, edificios, cámaras+cobertura, zonas (columnas
   hexagonales + personas), unidades PNC (MAIC), pulsos, trayectorias.
   ===================================================================== */
const City = (() => {
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(COLOR.bg, 3200, 8200);
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 20000);
  const HOME = { x: 180, z: 70, r: 2350, phi: .93 };
  const ctl = { target: new THREE.Vector3(HOME.x, 0, HOME.z), r: HOME.r, phi: HOME.phi, theta: -.32, cur: null, last: 0 };
  const L = { cams: new THREE.Group(), cones: null, zones: new THREE.Group(), units: new THREE.Group(), fx: new THREE.Group(), trace: new THREE.Group(), labels: new THREE.Group(), incidents: new THREE.Group() };
  const camObjs = new Map(), zoneObjs = new Map(), unitObjs = new Map();
  const pulses = [], movers = [];
  let traceRunner = null;
  const pickables = [];

  function init() {
    TEX.glow = TEX.glow || glowTexture(); TEX.dot = TEX.dot || glowTexture(true);
    scene.add(new THREE.HemisphereLight(0x9fc4d4, 0x05090c, .62));
    const dl = new THREE.DirectionalLight(0xdcecf2, .38); dl.position.set(-400, 700, 300); scene.add(dl);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), new THREE.MeshBasicMaterial({ color: 0x04080a }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    // Retícula técnica cada 100 m
    const gp = []; for (let i = -3200; i <= 3200; i += 100) { gp.push(i, .2, -3200, i, .2, 3200, -3200, .2, i, 3200, .2, i); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x101a1f, transparent: true, opacity: .6 })));
    buildParks(); buildRoads(); buildBuildings(); buildInfill();
    [L.cams, L.zones, L.units, L.fx, L.trace, L.labels].forEach((g) => scene.add(g));
  }

  function buildRoads() {
    const style = [[0x1b2d35, .5], [0x2a4450, .75], [0x3f6b7d, .85], [0x6aa3b8, .95]];
    const buckets = [[], [], [], []];
    GEO.roads.forEach(([r, p]) => { for (let i = 0; i < p.length - 2; i += 2) buckets[r].push(p[i], .6 + r * .1, p[i + 1], p[i + 2], .6 + r * .1, p[i + 3]); });
    buckets.forEach((b, r) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b, 3)); scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: style[r][0], transparent: true, opacity: style[r][1] }))); });
  }
  function buildParks() {
    const pos = [];
    GEO.parks.forEach((p) => { const pts = []; for (let i = 0; i < p.length - 2; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1])); const tri = THREE.ShapeUtils.triangulateShape(pts, []); tri.forEach((t) => t.forEach((k) => pos.push(pts[k].x, .35, pts[k].y))); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x0b1a12, side: THREE.DoubleSide, transparent: true, opacity: .85 })));
  }
  /** Extrusión manual y fusionada (una sola malla) para rendimiento con miles de edificios. */
  function buildBuildings() {
    const pos = [], col = [], edges = [], bands = [];
    const cWall = new THREE.Color(0x111d24), cTop = new THREE.Color(0x22343e);
    GEO.bld.forEach(([lv, p], idx) => {
      const n = p.length / 2 - 1; if (n < 3) return;
      const h = lv ? Math.min(lv * 3.4, 120) : 6 + (Math.sin(idx * 12.9898) * 43758.5453 % 1 + 1) % 1 * 10;
      for (let i = 0; i < n; i++) occupy(pts0(p, i)[0], pts0(p, i)[1]);
      const pts = []; for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        pos.push(a.x, 0, a.y, b.x, 0, b.y, b.x, h, b.y, a.x, 0, a.y, b.x, h, b.y, a.x, h, a.y);
        for (let k = 0; k < 6; k++) { const c = k === 2 || k >= 4 ? cWall.clone().lerp(cTop, .35) : cWall; col.push(c.r, c.g, c.b); }
        edges.push(a.x, h, a.y, b.x, h, b.y); if (i % 2 === 0) edges.push(a.x, 0, a.y, a.x, h, a.y);
        // Bandas por piso en edificios altos: lectura tipo radiografía
        if (h > 16) for (let y = 3.4; y < h - 1; y += 3.4) bands.push(a.x, y, a.y, b.x, y, b.y);
      }
      let tri; try { tri = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { tri = []; }
      tri.forEach((t) => t.forEach((k) => { pos.push(pts[k].x, h, pts[k].y); col.push(cTop.r, cTop.g, cTop.b); }));
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x5fa6c0, transparent: true, opacity: .5 })));
    const bg2 = new THREE.BufferGeometry(); bg2.setAttribute('position', new THREE.Float32BufferAttribute(bands, 3));
    scene.add(new THREE.LineSegments(bg2, new THREE.LineBasicMaterial({ color: 0x5fa6c0, transparent: true, opacity: .22 })));
  }

  /* Ocupación en rejilla de 9 m: evita que el relleno pise edificios, vías o áreas verdes reales. */
  const occ = new Set(); const CELL = 9;
  const key = (x, z) => Math.round(x / CELL) + ',' + Math.round(z / CELL);
  function occupy(x, z) { occ.add(key(x, z)); }
  const pts0 = (p, i) => [p[i * 2], p[i * 2 + 1]];
  const isFree = (x, z) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (occ.has(key(x + dx * CELL, z + dz * CELL))) return false; return true; };
  /** Relleno urbano genérico a lo largo de las calles donde OSM no tiene edificios. */
  function buildInfill() {
    const r = mulberry32(2027);
    GEO.bld.forEach(([, p]) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.max(b, p[i]); c = Math.min(c, p[i + 1]); d = Math.max(d, p[i + 1]); } for (let x = a; x <= b; x += CELL) for (let z = c; z <= d; z += CELL) occupy(x, z); });
    GEO.parks.forEach((p) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.max(b, p[i]); c = Math.min(c, p[i + 1]); d = Math.max(d, p[i + 1]); } if ((b - a) * (d - c) > 250000) return; for (let x = a; x <= b; x += CELL) for (let z = c; z <= d; z += CELL) occupy(x, z); });
    const roadOcc = new Set();
    GEO.roads.forEach(([rank, p]) => { for (let i = 0; i < p.length - 2; i += 2) { const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az), st = Math.max(1, Math.ceil(L / 5)); for (let k = 0; k <= st; k++) roadOcc.add(Math.round((ax + (bx - ax) * k / st) / 6) + ',' + Math.round((az + (bz - az) * k / st) / 6)); } });
    const nearRoad = (x, z) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (roadOcc.has((Math.round(x / 6) + dx) + ',' + (Math.round(z / 6) + dz))) return true; return false; };
    const pos = [], col = [], ed = []; const cW = new THREE.Color(0x0f191e), cT = new THREE.Color(0x1a272e);
    GEO.roads.forEach(([rank, p]) => {
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 14) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, off = 13 + rank * 5;
        for (let s = 8; s < L - 6; s += 15) for (const side of [-1, 1]) {
          const cx = ax + ux * s + nx * off * side, cz = az + uz * s + nz * off * side;
          if (Math.hypot(cx, cz) > 1900 || nearRoad(cx, cz) || !isFree(cx, cz)) continue;
          occupy(cx, cz); const w = 5.2 + r() * 1.6, d = 4.6 + r() * 2.2, h = r() < .12 ? 7 + r() * 5 : 3.2 + r() * 2.6;
          const c = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([a, b]) => [cx + ux * a + nx * b, cz + uz * a + nz * b]);
          for (let k = 0; k < 4; k++) { const A = c[k], B = c[(k + 1) % 4]; pos.push(A[0], 0, A[1], B[0], 0, B[1], B[0], h, B[1], A[0], 0, A[1], B[0], h, B[1], A[0], h, A[1]); for (let q = 0; q < 6; q++) col.push(cW.r, cW.g, cW.b); }
          for (let k = 0; k < 4; k++) ed.push(c[k][0], h, c[k][1], c[(k + 1) % 4][0], h, c[(k + 1) % 4][1]);
          pos.push(c[0][0], h, c[0][1], c[1][0], h, c[1][1], c[2][0], h, c[2][1], c[0][0], h, c[0][1], c[2][0], h, c[2][1], c[3][0], h, c[3][1]); for (let q = 0; q < 6; q++) col.push(cT.r, cT.g, cT.b);
        }
      }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ed, 3));
    scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x3f7286, transparent: true, opacity: .2 })));
  }


  /* ---------- Cámaras ---------- */
  const camColor = (s) => s === 'online' ? COLOR.skyHi : s === 'degraded' ? COLOR.yellow : COLOR.red;
  function setCameras(cams) {
    const conePos = [];
    cams.forEach((c) => {
      const g = new THREE.Group(); g.position.set(c.x, 0, c.z);
      const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 26 * MK, 0)]), new THREE.LineBasicMaterial({ color: camColor(c.status), transparent: true, opacity: .55 }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: camColor(c.status), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.y = 26 * MK; glow.scale.setScalar(32 * MK);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: Glyph.texture('cctv', camColor(c.status)), transparent: true, depthWrite: false, depthTest: false }));
      core.position.y = 26 * MK; core.scale.setScalar(13 * MK);
      g.add(pole, glow, core); L.cams.add(g);
      glow.userData = { kind: 'camera', id: c.id }; pickables.push(glow);
      camObjs.set(c.id, { g, glow, core, c, ph: rnd() * 6 });
      if (c.status !== 'offline') {
        const steps = 10, len = Coverage.REACH, fov = Coverage.FOV;
        for (let i = 0; i < steps; i++) {
          const a0 = c.heading - fov / 2 + fov * i / steps, a1 = c.heading - fov / 2 + fov * (i + 1) / steps;
          conePos.push(c.x, 1, c.z, c.x + Math.cos(a0) * len, 1, c.z + Math.sin(a0) * len, c.x + Math.cos(a1) * len, 1, c.z + Math.sin(a1) * len);
        }
      }
    });
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(conePos, 3));
    L.cones = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: COLOR.skyHi, transparent: true, opacity: .05, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(L.cones);
  }
  function setCameraStatus(id, status) { const o = camObjs.get(id); if (!o) return; o.c.status = status; o.glow.material.color.setHex(camColor(status)); o.g.children[0].material.color.setHex(camColor(status)); o.core.material.map = Glyph.texture('cctv', camColor(status)); o.core.material.needsUpdate = true; }

  /* ---------- Zonas de concentración ---------- */
  const zoneColor = (st) => st === 'critical' ? COLOR.red : st === 'medium' ? COLOR.yellow : COLOR.skyHi;
  function setZones(zones) {
    zones.forEach((z) => {
      const g = new THREE.Group(); g.position.set(z.x, 0, z.z); L.zones.add(g);
      // Perímetro real de la geocerca (polígono), relativo a su centroide
      const rel = z.poly.map(([px, pz]) => [px - z.x, pz - z.z]);
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rel.map(([px, pz]) => new THREE.Vector3(px, 1.4, pz))), new THREE.LineBasicMaterial({ color: COLOR.skyHi, transparent: true, opacity: .5 }));
      const disc = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(rel.map(([px, pz]) => new THREE.Vector2(px, -pz)))), new THREE.MeshBasicMaterial({ color: COLOR.skyHi, transparent: true, opacity: .06, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 1.2; disc.userData = { kind: 'zone', id: z.id }; pickables.push(disc);
      // Columnas hexagonales: densidad por celda
      const cells = []; const s = clamp(Math.sqrt(z.area) / 9, 9, 22);
      for (let ix = -20; ix <= 20; ix++) for (let iz = -20; iz <= 20; iz++) { const x = ix * s * 1.5, zz = iz * s * 1.732 + (ix & 1 ? s * .866 : 0); const d = Math.hypot(x, zz); if (Geo.inside(z.poly, z.x + x, z.z + zz)) cells.push({ x, z: zz, w: Math.exp(-(d * d) / (z.r * z.r * .9)) * (.6 + rnd() * .5), ph: rnd() * 6 }); }
      const hg = new THREE.CylinderGeometry(s * .82, s * .82, 1, 6); hg.translate(0, .5, 0);
      const hm = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: COLOR.skyHi, transparent: true, opacity: .42, depthWrite: false }), cells.length);
      // Personas estimadas (muestra visual, 1 punto ≈ 60 personas)
      const N = 900, pp = new Float32Array(N * 3), seeds = [];
      for (let i = 0; i < N; i++) { const q = Geo.sample(z.poly, rnd); seeds.push({ x: q[0] - z.x, z: q[1] - z.z, ph: rnd() * 6, sp: .3 + rnd() }); pp.set([seeds[i].x, 2, seeds[i].z], i * 3); }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
      const people = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xe8f7ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: .75, depthWrite: false }));
      const label = textSprite(z.name, { worldH: 17 * MK }); label.position.set(0, 62 * MK, Math.max(...rel.map((q) => q[1])) + 14); L.labels.add(label); label.userData.zone = z.id;
      g.add(ring, disc, hm, people);
      zoneObjs.set(z.id, { g, ring, disc, hm, cells, people, seeds, label, z, intensity: 0, target: 0 });
      label.position.add(g.position);
    });
  }
  function updateZone(z) {
    const o = zoneObjs.get(z.id); if (!o) return;
    const col = zoneColor(z.status); o.ring.material.color.setHex(col); o.hm.material.color.setHex(col); o.disc.material.color.setHex(col);
    o.target = clamp(z.est / 90000, .04, 1.25);
    o.people.geometry.setDrawRange(0, clamp(Math.round(z.est / 130), 20, 900));
  }

  /* ---------- Unidades PNC (MAIC) ---------- */
  function setUnits(units) {
    units.forEach((u) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Glyph.texture('unit', COLOR.police), transparent: true, depthWrite: false, depthTest: false }));
      s.scale.setScalar(11 * MK); s.position.set(u.x, 14, u.z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: COLOR.police, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(20 * MK); halo.position.copy(s.position);
      L.units.add(s, halo); s.userData = { kind: 'unit', id: u.id }; pickables.push(s);
      unitObjs.set(u.id, { s, halo, u, node: u.node, prev: -1, seg: null, speed: .09 + rnd() * .08 });
    });
  }
  /** Anima unidades asignadas por MAIC hacia el destino y traza su ruta. */
  function dispatchUnits(ids, dest, eta = 9) {
    ids.forEach((id, i) => {
      const o = unitObjs.get(id); if (!o) return; o.u.status = 'asignada'; o.s.material.map = Glyph.texture('unit', COLOR.lime); o.s.material.needsUpdate = true; o.halo.material.color.setHex(COLOR.lime);
      // La unidad llega por calles reales: ruta más corta sobre la red vial (Routes) hasta el punto del evento.
      o.path = Routes.path(o.s.position.x, o.s.position.z, dest.x + Math.cos(i * 1.7) * 28, dest.z + Math.sin(i * 1.7) * 28); o.seg = null;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(o.path.map(([x, z]) => new THREE.Vector3(x, 14, z))), new THREE.LineDashedMaterial({ color: COLOR.lime, dashSize: 22, gapSize: 16, transparent: true, opacity: .9 }));
      line.computeLineDistances(); L.fx.add(line);
      movers.push({ o, t0: performance.now() + i * 200, dur: (REDUCED ? .1 : eta) * 1000, line });
    });
  }
  function nearestUnits(x, z, n) { return [...unitObjs.values()].filter((o) => o.u.status !== 'asignada').map((o) => ({ id: o.u.id, d: Math.hypot(o.s.position.x - x, o.s.position.z - z) })).sort((a, b) => a.d - b.d).slice(0, n); }

  /* ---------- Efectos: pulsos de alerta ---------- */
  function pulse(x, z, color = COLOR.red, big = 1) {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 2, z); L.fx.add(m); pulses.push({ m, t0: performance.now() + k * 450, dur: 2400, big });
    }
  }
  /* ---------- Trayectoria de una placa ---------- */
  /** opts.color: color del recorrido · opts.path: geometría por calles · cada punto admite `label` (texto propio) o `label: false` (sin etiqueta). */
  function showTrace(sightings, opts = {}) {
    clearTrace(); if (!sightings || !sightings.length) return; const tc = opts.color || COLOR.red;
    // opts.path: recorrido por calles reales entre los puntos (lo calcula Routes); sin él, línea directa.
    const cp = (opts.path || sightings.map((s) => [s.x, s.z])).map(([x, z]) => new THREE.Vector3(x, 24, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cp), new THREE.LineBasicMaterial({ color: tc, transparent: true, opacity: .95 }));
    L.trace.add(line);
    sightings.forEach((s, i) => {
      if (s.label === false) return;
      const lb = textSprite(s.label || `${i + 1} · ${hhmm(s.ts)}`, { worldH: 15 * MK, size: 24, font: 'IBM Plex Mono', border: i === sightings.length - 1 ? '#bf5a52' : '#2e3840' });
      lb.position.set(s.x, 50 * MK, s.z); L.trace.add(lb);
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: tc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); d.scale.setScalar(30 * MK); d.position.set(s.x, 24, s.z); L.trace.add(d);
    });
    const runner = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); runner.scale.setScalar(26 * MK); L.trace.add(runner);
    traceRunner = { runner, cp };
  }
  function clearTrace() { while (L.trace.children.length) L.trace.remove(L.trace.children[0]); traceRunner = null; }

  /* ---------- Cámara orbital (arrastrar = orbitar, Shift/derecho = desplazar, rueda = acercar) ---------- */
  function bindControls(el) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, moved: 0 }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy); ctl.last = performance.now();
      if (drag.pan) { const k = ctl.r / 900; const fw = new THREE.Vector3(Math.sin(ctl.theta), 0, Math.cos(ctl.theta)); const rt = new THREE.Vector3(fw.z, 0, -fw.x); ctl.target.addScaledVector(rt, dx * k).addScaledVector(fw, dy * k); }
      else { ctl.theta -= dx * .005; ctl.phi = clamp(ctl.phi - dy * .004, .18, 1.32); }
    });
    el.addEventListener('pointerup', (e) => { const was = drag; drag = null; if (was && was.moved < 5) City.onClick && City.onClick(e); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { e.preventDefault(); ctl.r = clamp(ctl.r * Math.exp(e.deltaY * .0012), 320, 7500); ctl.last = performance.now(); }, { passive: false });
  }
  function flyTo(x, z, r = 1000, phi = .82) { ctl.target.set(x, 0, z); ctl.r = r; ctl.phi = phi; ctl.last = performance.now(); }
  function overview() { ctl.target.set(HOME.x, 0, HOME.z); ctl.r = HOME.r; ctl.phi = HOME.phi; }
  /** Estado de la vista para el HUD: coordenadas del punto observado, altitud, rumbo e inclinación. */
  function view() { const c = ctl.cur || ctl; const ll = toLatLon(c.target.x, c.target.z); return { lat: ll.lat, lon: ll.lon, x: c.target.x, z: c.target.z, alt: c.r * Math.cos(c.phi), heading: ((-c.theta * 180 / Math.PI) % 360 + 360) % 360, tilt: c.phi * 180 / Math.PI }; }
  function entrance() { ctl.cur = { target: ctl.target.clone(), r: 8200, phi: .1, theta: ctl.theta - .6 }; }

  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pick(clientX, clientY, w, h) {
    ndc.set(clientX / w * 2 - 1, -(clientY / h) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0]; return hit ? hit.object.userData : null;
  }

  function update(t) {
    if (!ctl.cur) ctl.cur = { target: ctl.target.clone(), r: ctl.r, phi: ctl.phi, theta: ctl.theta };
    if (!REDUCED && performance.now() - ctl.last > 14000) ctl.theta += .00035;
    const k = REDUCED ? 1 : .055; const c = ctl.cur;
    c.target.lerp(ctl.target, k); c.r = lerp(c.r, ctl.r, k); c.phi = lerp(c.phi, ctl.phi, k); c.theta = lerp(c.theta, ctl.theta, k);
    camera.position.set(c.target.x + c.r * Math.sin(c.phi) * Math.sin(c.theta), c.r * Math.cos(c.phi), c.target.z + c.r * Math.sin(c.phi) * Math.cos(c.theta));
    camera.lookAt(c.target);
    const s = t / 1000;
    camObjs.forEach((o) => { const a = o.c.status === 'offline' ? .25 + .35 * (Math.sin(s * 6 + o.ph) > 0 ? 1 : 0) : .55 + .3 * Math.sin(s * 1.6 + o.ph); o.glow.material.opacity = a; });
    zoneObjs.forEach((o) => {
      o.intensity = lerp(o.intensity, o.target, .03); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      o.cells.forEach((c, i) => { const h = Math.max(.5, o.intensity * 120 * MK * c.w * (.85 + .15 * Math.sin(s * 1.3 + c.ph))); p.set(c.x, 1.5, c.z); sc.set(1, h, 1); m.compose(p, q, sc); o.hm.setMatrixAt(i, m); });
      o.hm.instanceMatrix.needsUpdate = true;
      const arr = o.people.geometry.attributes.position.array; o.seeds.forEach((sd, i) => { arr[i * 3] = sd.x + Math.sin(s * sd.sp + sd.ph) * 3; arr[i * 3 + 2] = sd.z + Math.cos(s * sd.sp * .8 + sd.ph) * 3; }); o.people.geometry.attributes.position.needsUpdate = true;
      o.ring.material.opacity = .35 + .25 * Math.sin(s * 2 + o.g.position.x);
    });
    // Patrullaje: cada unidad recorre la red vial real de cruce en cruce (sin atravesar manzanas).
    unitObjs.forEach((o) => {
      if (o.u.status !== 'patrullando') return;
      if (!o.seg) { const nb = Routes.neighbors(o.node); if (!nb.length) return; const opts = nb.filter(([n]) => n !== o.prev); const [to, len] = (opts.length ? opts : nb)[Math.floor(Math.random() * (opts.length || nb.length))]; o.seg = { from: Routes.pos(o.node), to: Routes.pos(to), node: to, len: Math.max(1, len), t: 0 }; }
      o.seg.t += o.speed * 1.5 / o.seg.len; const k = Math.min(1, o.seg.t);
      o.s.position.set(lerp(o.seg.from[0], o.seg.to[0], k), 14, lerp(o.seg.from[1], o.seg.to[1], k)); o.halo.position.copy(o.s.position);
      if (k >= 1) { o.prev = o.node; o.node = o.seg.node; o.seg = null; }
    });
    const now = performance.now();
    for (let i = movers.length - 1; i >= 0; i--) { const m = movers[i]; const k = clamp((now - m.t0) / m.dur, 0, 1), p = Routes.along(m.o.path, ease(k)); m.o.s.position.set(p[0], 14, p[1]); m.o.halo.position.copy(m.o.s.position); m.line.material.dashOffset = -s * 60; if (k >= 1) { m.o.u.status = 'en sitio'; m.o.node = Routes.nearest(p[0], p[1]); m.line.material.opacity = .3; movers.splice(i, 1); } }
    for (let i = pulses.length - 1; i >= 0; i--) { const p = pulses[i]; const k = (now - p.t0) / p.dur; if (k < 0) { p.m.visible = false; continue; } p.m.visible = true; p.m.scale.setScalar(20 + k * 300 * p.big); p.m.material.opacity = .9 * (1 - k); if (k >= 1) { L.fx.remove(p.m); pulses.splice(i, 1); } }
    if (traceRunner) { const cp = traceRunner.cp; const k = (s * .18) % 1; traceRunner.runner.position.copy(cp[Math.floor(k * (cp.length - 1))]); }
  }
  /** Punto del suelo (x, z) bajo el cursor: de ahí salen las coordenadas que muestra el HUD. */
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), groundHit = new THREE.Vector3();
  function groundAt(clientX, clientY, w, h) { ndc.set(clientX / w * 2 - 1, -(clientY / h) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(groundPlane, groundHit) ? { x: groundHit.x, z: groundHit.z } : null; }
  /* ---------- Incidentes: marcador anclado a su coordenada, con asta hasta el suelo ---------- */
  const incObjs = new Map();
  function syncIncidents(alerts) {
    const seen = new Set();
    alerts.filter((a) => a.status !== 'cerrada' && a.x !== undefined).slice(0, 24).forEach((a) => {
      seen.add(a.id); let o = incObjs.get(a.id); const ack = a.status === 'en atención';
      if (!o) {
        const g = new THREE.Group(); g.position.set(a.x, 0, a.z);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })); s.position.y = 40 * MK; s.scale.setScalar(15 * MK); s.userData = { kind: 'incident', id: a.id }; pickables.push(s);
        const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, .5, 0), new THREE.Vector3(0, 33 * MK, 0)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 }));
        const foot = new THREE.Mesh(new THREE.RingGeometry(2.2, 4, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })); foot.rotation.x = -Math.PI / 2; foot.position.y = 1.6;
        g.add(stem, foot, s); L.incidents.add(g); o = { g, s }; incObjs.set(a.id, o);
      }
      o.s.material.map = Glyph.incidentTexture(a.severity, ack); o.s.material.needsUpdate = true;
    });
    incObjs.forEach((o, id) => { if (!seen.has(id)) { L.incidents.remove(o.g); const i = pickables.indexOf(o.s); if (i >= 0) pickables.splice(i, 1); incObjs.delete(id); } });
  }
  function setLayer(name, on) { const m = { cones: L.cones, zones: L.zones, labels: L.labels, units: L.units, trace: L.trace, incidents: L.incidents }; if (m[name]) m[name].visible = on; }
  function focusZone(id) { zoneObjs.forEach((o, k) => { o.label.material.opacity = !id || k === id ? 1 : .35; }); }
  const api = { scene, camera, init, update, setCameras, setCameraStatus, setZones, updateZone, setUnits, dispatchUnits, nearestUnits, pulse, showTrace, clearTrace, bindControls, flyTo, overview, entrance, pick, groundAt, syncIncidents, setLayer, focusZone, view, unitObjs, onClick: null };
  /* Patrón espejo: las otras vistas del mapa (Google 2D §6c, fotorrealista §6b) reciben las mismas órdenes que City.
     City sigue siendo la fuente de verdad; el espejo solo las replica si implementa el método. */
  const mirrors = [];
  ['flyTo', 'overview', 'pulse', 'showTrace', 'clearTrace', 'dispatchUnits', 'updateZone', 'setCameraStatus'].forEach((name) => {
    const own = api[name];
    api[name] = (...args) => { const out = own(...args); mirrors.forEach((m) => { if (typeof m[name] === 'function') { try { m[name](...args); } catch (e) { console.warn('[City] espejo', name, e); } } }); return out; };
  });
  api.addMirror = (m) => { mirrors.push(m); };
  return api;
})();
