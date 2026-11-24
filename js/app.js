/* =====================================================================
   Escenario 3D auxiliar (renderer propio) para FaceLab y SceneLab
   ===================================================================== */
function makeStage(host, opts = {}) {
  const canvas = document.createElement('canvas'); host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setClearColor(COLOR.bg);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(opts.fov || 35, 1, .05, 4000);
  const orb = { theta: opts.theta || 0, phi: opts.phi || 1.35, r: opts.r || 4, target: opts.target || new THREE.Vector3(), auto: opts.auto ?? .0025, cur: null };
  let drag = null, alive = true, onFrame = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; orb.theta -= (e.clientX - drag.x) * .006; orb.phi = clamp(orb.phi - (e.clientY - drag.y) * .005, .2, 1.55); drag = { x: e.clientX, y: e.clientY }; orb.idle = performance.now(); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); orb.r = clamp(orb.r * Math.exp(e.deltaY * .001), (opts.r || 4) * .4, (opts.r || 4) * 2.5); }, { passive: false });
  function resize() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
  function frame(t) {
    if (!alive) return; requestAnimationFrame(frame);
    if (!drag && !REDUCED && (!orb.idle || performance.now() - orb.idle > 4000)) orb.theta += orb.auto;
    if (!orb.cur) orb.cur = { ...orb }; const c = orb.cur; c.theta = lerp(c.theta, orb.theta, .08); c.phi = lerp(c.phi, orb.phi, .08); c.r = lerp(c.r, orb.r, .08);
    camera.position.set(orb.target.x + c.r * Math.sin(c.phi) * Math.sin(c.theta), orb.target.y + c.r * Math.cos(c.phi), orb.target.z + c.r * Math.sin(c.phi) * Math.cos(c.theta)); camera.lookAt(orb.target);
    onFrame && onFrame(t); renderer.render(scene, camera);
  }
  resize(); window.addEventListener('resize', resize); requestAnimationFrame(frame);
  return { scene, camera, orb, set onFrame(f) { onFrame = f; }, dispose() { alive = false; window.removeEventListener('resize', resize); renderer.dispose(); } };
}

/* =====================================================================
   §9 FACELAB — análisis facial: mejora + reconstrucción 3D + candidatos.
   La geometría es un modelo paramétrico de demostración; en producción
   Panopticon entrega la malla 3D (p. ej. 468 puntos faciales + textura).
   ===================================================================== */
const FaceLab = (() => {
  let stage = null, timers = [], face = null;
  /** Desplazamiento facial sobre una esfera unitaria → cabeza paramétrica. */
  function headPoint(theta, phi, seed) {
    const r = mulberry32(seed); const nose = .2 + r() * .06, jaw = .22 + r() * .1, cheek = .03 + r() * .03;
    const fx = Math.sin(phi) * Math.sin(theta), fy = Math.cos(phi), front = Math.max(0, Math.cos(theta)) * Math.sin(phi);
    const G = (x, y, sx, sy) => Math.exp(-(x * x) / sx - (y * y) / sy);
    let d = 0;
    d += nose * G(fx, fy + .05, .006, .035) * front;
    d += .06 * G(fx, fy + .16, .004, .004) * front;
    d -= .075 * (G(fx - .27, fy - .12, .011, .006) + G(fx + .27, fy - .12, .011, .006)) * front;
    d += .045 * G(fx, fy - .23, .2, .004) * front;
    d -= .03 * G(fx, fy + .33, .03, .0015) * front; d += .02 * (G(fx, fy + .3, .02, .001) + G(fx, fy + .36, .018, .001)) * front;
    d += .06 * G(fx, fy + .57, .025, .012) * front;
    d += cheek * (G(fx - .42, fy, .02, .02) + G(fx + .42, fy, .02, .02)) * front;
    let x = .8 * fx, y = 1.0 * fy, z = .9 * Math.sin(phi) * Math.cos(theta);
    if (fy < -.15) x *= 1 - jaw * (-fy - .15);
    const ear = Math.exp(-Math.pow(Math.cos(theta) + .08, 2) / .012 - Math.pow(fy - .02, 2) / .018) * Math.sin(phi); x += Math.sign(fx) * .075 * ear;
    z += d;
    return new THREE.Vector3(x, y, z);
  }
  function buildHead(seed) {
    const N = 16000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), scat = new Float32Array(N * 3), land = [];
    const ga = Math.PI * (3 - Math.sqrt(5)); const cA = new THREE.Color(COLOR.subtle), cB = new THREE.Color(0xf0f0f0);
    let k = 0;
    for (let i = 0; i < N; i++) {
      let p;
      if (i < N * .86) { const y = 1 - (i / (N * .86 - 1)) * 2, rad = Math.sqrt(1 - y * y), th = ga * i; const phi = Math.acos(y); const theta = Math.atan2(rad * Math.sin(th), rad * Math.cos(th)); if (y < -.9) continue; p = headPoint(theta, phi, seed); }
      else { const a = rnd() * Math.PI * 2, hh = -.82 - rnd() * .62; const rr = .3 + (hh + .82) * -.05; p = new THREE.Vector3(Math.cos(a) * rr, hh, Math.sin(a) * rr * .9 - .08); }
      pos.set([p.x, p.y, p.z], k * 3);
      const c = cA.clone().lerp(cB, clamp((p.z + .2) / 1.3, 0, 1)); col.set([c.r, c.g, c.b], k * 3);
      scat.set([(rnd() - .5) * 4, (rnd() - .5) * 4, (rnd() - .5) * 4], k * 3);
      if (p.z > .55 && rnd() < .06) land.push(k);
      k++;
    }
    return { pos: pos.slice(0, k * 3), col: col.slice(0, k * 3), scat: scat.slice(0, k * 3), n: k, land };
  }
  function meshFor(seed) {
    const g = new THREE.SphereGeometry(1, 120, 90); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const phi = Math.acos(clamp(y, -1, 1)); const theta = Math.atan2(x, z); const v = y < -.9 ? new THREE.Vector3(x * .4, -.98, z * .36) : headPoint(theta, phi, seed); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  }

  function open(f) {
    face = f; const slot = $('#fullSlot'); Sfx.whoosh();
    const audit = Api.audit('Análisis facial', f.id);
    slot.innerHTML = `<section class="full" role="dialog" aria-label="Análisis facial">
      <header class="f-hd"><span class="ms" style="color:var(--ink-muted)">face_retouching_natural</span><h2>Análisis facial · ${f.id}</h2><span class="muted" style="font-size:13px">${f.cameraId} · ${hhmmss(f.ts)}</span>
        <div class="right"><span class="chip info"><span class="ms">verified_user</span>Consulta auditada ${audit.id}</span><button class="iconbtn" data-close-full aria-label="Cerrar"><span class="ms">close</span></button></div></header>
      <div class="f-bd face-grid">
        <aside>
          <div><div class="caption" style="margin-bottom:8px">Captura original</div><div class="crop">${Evidence.placeholder('', `${f.cameraId} · 24 × 24 px`)}</div></div>
          <div><div class="caption" style="margin-bottom:8px">Mejorada por Panopticon</div><div class="crop" id="flEnh">${Evidence.placeholder('', 'En espera')}</div></div>
          <dl class="details"><dt>Resolución del rostro</dt><dd class="mono">24 × 24 px</dd><dt>Calidad</dt><dd>${f.quality.toFixed(2)}</dd><dt>Ángulo</dt><dd>${f.angle}°</dd></dl>
        </aside>
        <div class="stage3d" id="flStage">
          <div class="overlay"><div><div class="caption">Reconstrucción 3D · modelo sintético</div><div style="font-family:var(--font-display);font-size:22px;margin-top:4px" id="flHead">Preparando análisis</div></div>
            <div class="seg" id="flMode"><button data-m="points" class="on">Nube de puntos</button><button data-m="wire">Malla</button><button data-m="solid">Superficie</button></div></div>
          <div style="position:absolute;left:20px;bottom:20px;right:20px"><ul class="steps" id="flSteps"></ul><div class="prog" style="margin-top:12px"><i id="flProg"></i></div></div>
        </div>
        <aside>
          <div><h3 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:18px">Candidatos</h3><div class="dim" style="font-size:12px;margin-top:2px">Listas autorizadas · umbral 0.85</div></div>
          <div id="flCands" style="display:flex;flex-direction:column;gap:8px"><div class="dim" style="font-size:13px">Los candidatos aparecen al terminar la comparación.</div></div>
          <div class="callout warn"><span class="ms">report</span><div>La imagen mejorada y el modelo 3D son reconstrucciones sintéticas. Sirven para orientar la verificación; no constituyen evidencia por sí solos.</div></div>
          <div class="locked"><span class="ms">lock</span>Ver identidad requiere rol Analista. El acceso queda registrado.</div>
          <button class="btn secondary sm" id="flSources"><span class="ms">person_search</span>Buscar identidad en fuentes</button>
          <div style="margin-top:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary sm" data-close-full>Descartar</button><button class="btn primary sm" id="flSend" disabled><span class="ms">send</span>Confirmar candidato y enviar a MAIC</button></div>
        </aside>
      </div></section>`;
    slot.querySelectorAll('[data-close-full]').forEach((b) => b.addEventListener('click', close));
    $('#flSources').addEventListener('click', () => { close(); SourceLab.open(f); });
    stage = makeStage($('#flStage'), { r: 6.2, phi: 1.42, theta: .55, target: new THREE.Vector3(0, -.25, 0) });
    stage.scene.add(new THREE.HemisphereLight(0xe6e6e6, 0x0f0f0f, .9)); const dl = new THREE.DirectionalLight(0xffffff, .7); dl.position.set(2, 3, 4); stage.scene.add(dl);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.95, .965, 128), new THREE.MeshBasicMaterial({ color: COLOR.muted, transparent: true, opacity: .35, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = -1.48; stage.scene.add(ring);
    const H = buildHead(f.seed); const geo = new THREE.BufferGeometry(); const cur = H.scat.slice();
    geo.setAttribute('position', new THREE.BufferAttribute(cur, 3)); geo.setAttribute('color', new THREE.BufferAttribute(H.col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: .012, vertexColors: true, transparent: true, opacity: .9, depthWrite: false })); stage.scene.add(pts);
    const lg = new THREE.BufferGeometry(); const lp = new Float32Array(H.land.length * 3); H.land.forEach((k, i) => lp.set([H.pos[k * 3], H.pos[k * 3 + 1], H.pos[k * 3 + 2]], i * 3)); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const lm = new THREE.Points(lg, new THREE.PointsMaterial({ size: .035, color: COLOR.primary, transparent: true, opacity: 0, depthWrite: false })); stage.scene.add(lm);
    const mg = meshFor(f.seed);
    const wire = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: COLOR.muted, wireframe: true, transparent: true, opacity: .18 })); wire.visible = false; stage.scene.add(wire);
    const solid = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x898989, roughness: .62, metalness: .15 })); solid.visible = false; stage.scene.add(solid);
    const solidWire = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: COLOR.muted, wireframe: true, transparent: true, opacity: .06 })); solidWire.scale.setScalar(1.003); solid.add(solidWire);
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(3, .006), new THREE.MeshBasicMaterial({ color: COLOR.primary, transparent: true, opacity: .0, side: THREE.DoubleSide })); stage.scene.add(scan);
    const st = { c0: 0, c1: 0, t0: 0, dur: 1700, conv: 0, scan: false, mode: 'points' };
    const convTo = (v) => { st.c0 = st.conv; st.c1 = v; st.t0 = performance.now(); };
    $('#flMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.m; $('#flMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); Sfx.tick(); });
    stage.onFrame = (t) => {
      st.conv = lerp(st.c0, st.c1, ease(clamp((performance.now() - st.t0) / (REDUCED ? 1 : st.dur), 0, 1))); const a = geo.attributes.position.array; const e = clamp(st.conv, 0, 1);
      for (let i = 0; i < H.n * 3; i++) a[i] = H.scat[i] + (H.pos[i] - H.scat[i]) * e; geo.attributes.position.needsUpdate = true;
      pts.visible = st.mode !== 'solid' || st.conv <= .97; wire.visible = st.mode === 'wire' && st.conv > .97; solid.visible = st.mode === 'solid' && st.conv > .97; lm.visible = st.mode !== 'solid';
      if (st.scan) { scan.material.opacity = .9; scan.position.y = Math.sin(t / 500) * 1.2; scan.lookAt(stage.camera.position.x, scan.position.y, stage.camera.position.z); } else scan.material.opacity = 0;
    };
    // Secuencia del análisis (tiempos de demostración)
    const steps = ['Detección del rostro en el cuadro', 'Alineación de 468 puntos faciales', 'Mejora de resolución (×8)', 'Reconstrucción 3D del rostro', 'Comparación con listas autorizadas'];
    const setStep = (i) => { $('#flSteps').innerHTML = steps.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"><span class="ms">${k < i ? 'check_circle' : k === i ? 'progress_activity' : 'radio_button_unchecked'}</span>${s}</li>`).join(''); $('#flProg').style.width = (i / steps.length * 100) + '%'; $('#flHead').textContent = steps[Math.min(i, steps.length - 1)]; if (i < steps.length) Sfx.tick(); };
    const at = (ms, fn) => timers.push(setTimeout(fn, REDUCED ? 0 : ms));
    setStep(0); st.scan = true;
    at(1300, () => { setStep(1); convTo(.25); lm.material.opacity = .9; });
    at(2700, () => { setStep(2); enhance(); });
    at(4300, () => { setStep(3); convTo(1); });
    at(6300, () => { setStep(4); st.scan = false; });
    at(7600, async () => {
      setStep(5); $('#flHead').textContent = f.watch ? 'Candidato sobre el umbral' : 'Sin candidatos sobre el umbral'; Sfx[f.watch ? 'critical' : 'confirm']();
      const cands = await Api.analyzeFace(f);
      $('#flCands').innerHTML = cands.map((c, i) => `<label class="cand" style="cursor:pointer;${i === 0 && f.watch ? 'border-color:#e0453c80' : ''}"><div class="ph">${Evidence.thumb()}</div><div><div style="font-weight:500">${c.ref}</div><div class="dim" style="font-size:12px">${c.list}</div><div style="margin-top:4px"><input type="radio" name="cand" value="${c.ref}" ${c.score < .85 ? 'disabled' : ''}> <span style="font-size:12px" class="muted">${c.score >= .85 ? 'Seleccionar para verificar' : 'Bajo el umbral'}</span></div></div><div class="score" style="color:${c.score >= .85 ? '#ef6b62' : 'inherit'}">${Math.round(c.score * 100)}<small>%</small></div></label>`).join('');
      $('#flCands').addEventListener('change', () => { $('#flSend').disabled = false; });
      st.mode = 'solid'; $('#flMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.m === 'solid'));
    });
    $('#flSend').addEventListener('click', async () => {
      const cam = UI.S.cameras.find((c) => c.id === f.cameraId); const units = City.nearestUnits(cam.x, cam.z, 2).map((u) => u.id);
      const d = await Api.dispatch({ label: `Rostro ${f.id}`, faceId: f.id, unitsRequested: 2 }); d.units = units; Sfx.confirm();
      City.dispatchUnits(units, cam, 7); City.pulse(cam.x, cam.z, COLOR.red, .8);
      Api.state.alerts.filter((a) => a.refId === f.id).forEach((a) => { a.status = 'en atención'; });
      UI.toast(`Candidato confirmado para verificación · MAIC alertó a ${units.length} unidades`, 'send', 'primary'); close();
    });
    /** Sin material real: el marcador indica el estado del paso de mejora. */
    function enhance() { const el = $('#flEnh'); if (el) el.innerHTML = Evidence.placeholder('', 'Mejora ×8 aplicada'); }
  }
  function close() { timers.forEach(clearTimeout); timers = []; if (stage) stage.dispose(); stage = null; $('#fullSlot').innerHTML = ''; }
  return { open, close };
})();

/* =====================================================================
   §10 SCENELAB — reconstrucción 3D de una intersección a partir de
   4 cámaras que observan el mismo cuadrante desde ángulos distintos.
   ===================================================================== */
const SceneLab = (() => {
  let stage = null, timers = [], thumbLoop = null;
  const camsIds = ['SM-01', 'SM-02', 'SM-03', 'SM-05'];
  function open() {
    const slot = $('#fullSlot'); Sfx.whoosh(); UI.closeSheet();
    slot.innerHTML = `<section class="full" role="dialog" aria-label="Reconstrucción de escena">
      <header class="f-hd"><span class="ms" style="color:var(--ink-muted)">view_in_ar</span><h2>Escenas 3D · Cuadrante Plaza Salvador del Mundo</h2><span class="muted" style="font-size:13px">4 cámaras · 21:40 – 21:48</span>
        <div class="right"><span class="chip neutral">Modelo de demostración</span><button class="iconbtn" data-close-full aria-label="Cerrar"><span class="ms">close</span></button></div></header>
      <div class="f-bd scene-grid">
        <div class="stage3d" id="scStage">
          <div class="overlay"><div><div class="caption">Vista reconstruida</div><div style="font-family:var(--font-display);font-size:22px;margin-top:4px" id="scHead">Selecciona cámaras y reconstruye</div></div>
            <div class="seg" id="scMode"><button data-m="pts" class="on">Nube de puntos</button><button data-m="solid">Volúmenes</button></div></div>
          <div class="thumbs" id="scThumbs">${camsIds.map((c, i) => `<div class="thumb">${Evidence.placeholder('', '')}<span>${c}</span></div>`).join('')}</div>
        </div>
        <aside>
          <div><h3 style="margin:0;font-family:var(--font-display);font-weight:400;font-size:18px">Fuentes</h3><div class="dim" style="font-size:12px;margin-top:2px">Cámaras con campo de visión compartido</div></div>
          <ul class="list" style="border:1px solid var(--border);border-radius:10px;overflow:hidden">${camsIds.map((c, i) => `<li class="item" style="grid-template-columns:22px 1fr auto;cursor:default;${i === 0 ? 'border-top:0' : ''}"><input type="checkbox" checked aria-label="${c}"><div><div class="t">${c}</div><div class="s">${['Norte · Estación Salvador del Mundo', 'Este · Alameda Roosevelt', 'Sur · Avenida Olímpica', 'Oeste · Paseo General Escalón'][i]}</div></div><div class="r"><span class="chip ok">25 fps</span></div></li>`).join('')}</ul>
          <button class="btn primary" id="scGo"><span class="ms">deployed_code</span>Reconstruir escena</button>
          <div><ul class="steps" id="scSteps"></ul><div class="prog" style="margin-top:12px"><i id="scProg"></i></div></div>
          <dl class="details hidden" id="scStats"><dt>Puntos fusionados</dt><dd class="mono" id="scPts">0</dd><dt>Error de reproyección</dt><dd class="mono">0.8 px</dd><dt>Personas rastreadas</dt><dd class="mono">36</dd><dt>Vehículos rastreados</dt><dd class="mono">7</dd></dl>
          <div id="scPlay" class="hidden"><div class="caption" style="margin-bottom:6px">Línea de tiempo</div><div style="display:flex;gap:10px;align-items:center"><button class="iconbtn on" id="scPP" aria-label="Pausar"><span class="ms">pause</span></button><input type="range" min="0" max="480" value="0" id="scT" style="flex:1;accent-color:#b9b9b9" aria-label="Tiempo"><span class="mono dim" id="scClock" style="font-size:12px">21:40:00</span></div></div>
          <div class="callout"><span class="ms">info</span><div>La reconstrucción combina las cuatro vistas sincronizadas para revisar un incidente desde cualquier ángulo. Es un apoyo de análisis; la evidencia son los videos originales.</div></div>
        </aside>
      </div></section>`;
    slot.querySelectorAll('[data-close-full]').forEach((b) => b.addEventListener('click', close));
    stage = makeStage($('#scStage'), { r: 210, phi: 1.0, theta: .7, fov: 40, auto: .0012, target: new THREE.Vector3(0, 6, 0) });
    const sc = stage.scene; sc.fog = new THREE.Fog(COLOR.bg, 260, 520);
    sc.add(new THREE.HemisphereLight(0xe6e6e6, 0x0f0f0f, .8)); const dl = new THREE.DirectionalLight(0xffffff, .5); dl.position.set(80, 160, 60); sc.add(dl);
    const grid = new THREE.GridHelper(400, 40, 0x333333, 0x262626); sc.add(grid);
    // Volúmenes del cuadrante: 4 manzanas, calles cruzadas
    const blocks = [[-55, -55, 60, 28], [55, -55, 50, 34], [-55, 55, 52, 18], [55, 55, 58, 22]];
    const solids = new THREE.Group(); sc.add(solids); solids.visible = false;
    blocks.forEach(([x, z, s, h]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), new THREE.MeshStandardMaterial({ color: 0x333333, transparent: true, opacity: .85, roughness: .8 })); m.position.set(x, h / 2, z); solids.add(m); const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: COLOR.muted, transparent: true, opacity: .5 })); e.position.copy(m.position); solids.add(e); });
    // Cámaras: posición y pirámide de visión
    const camPos = [[0, 22, -70], [72, 18, 0], [0, 16, 74], [-74, 20, 0]];
    camPos.forEach(([x, y, z], i) => {
      const o = new THREE.Vector3(x, y, z), look = new THREE.Vector3(0, 0, 0), dir = look.clone().sub(o).normalize();
      const up = new THREE.Vector3(0, 1, 0), right = dir.clone().cross(up).normalize(), u2 = right.clone().cross(dir).normalize();
      const far = o.clone().addScaledVector(dir, 34); const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => far.clone().addScaledVector(right, a * 14).addScaledVector(u2, b * 9));
      const seg = []; c.forEach((p) => seg.push(o, p)); for (let k = 0; k < 4; k++) seg.push(c[k], c[(k + 1) % 4]);
      sc.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: COLOR.primary, transparent: true, opacity: .8 })));
      const lb = textSprite(camsIds[i], { worldH: 7, size: 24, font: 'IBM Plex Mono' }); lb.position.copy(o).add(new THREE.Vector3(0, 7, 0)); sc.add(lb);
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: COLOR.primary, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); d.scale.setScalar(10); d.position.copy(o); sc.add(d);
    });
    // Nube de puntos: muestreo de superficies (fachadas, suelo, techos), etiquetada por cámara
    const P = [], CL = [], CAMI = [];
    const add = (x, y, z, c, ci) => { P.push(x, y, z); CL.push(c.r, c.g, c.b); CAMI.push(ci); };
    const cG = new THREE.Color(0x3c3c3c), cF = new THREE.Color(0xa8a8a8), cT = new THREE.Color(0xbdbdbd);
    for (let i = 0; i < 26000; i++) { const x = (rnd() - .5) * 240, z = (rnd() - .5) * 240; const road = Math.abs(x) < 18 || Math.abs(z) < 18; add(x, .2, z, road ? cG.clone().lerp(new THREE.Color(0x474747), rnd() * .6) : cG, Math.abs(x) > Math.abs(z) ? (x > 0 ? 1 : 3) : (z > 0 ? 2 : 0)); }
    blocks.forEach(([bx, bz, s, h]) => { for (let i = 0; i < 9000; i++) { const f = Math.floor(rnd() * 5); let x, y, z; const a = (rnd() - .5) * s, b = rnd() * h; if (f === 0) { x = bx + a; y = b; z = bz - s / 2; } else if (f === 1) { x = bx + a; y = b; z = bz + s / 2; } else if (f === 2) { x = bx - s / 2; y = b; z = bz + a; } else if (f === 3) { x = bx + s / 2; y = b; z = bz + a; } else { x = bx + a; y = h; z = bz + (rnd() - .5) * s; } const win = f < 4 && (Math.floor(b / 3.2) % 2 === 0) && (Math.floor(a / 3) % 2 === 0); add(x, y, z, win ? cT : cF.clone().lerp(new THREE.Color(COLOR.subtle), rnd()), Math.abs(x) > Math.abs(z) ? (x > 0 ? 1 : 3) : (z > 0 ? 2 : 0)); } });
    const N = P.length / 3; const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(CL, 3));
    const order = [...Array(N).keys()].sort((a, b) => CAMI[a] - CAMI[b] || rnd() - .5);
    const posSorted = new Float32Array(N * 3), colSorted = new Float32Array(N * 3); order.forEach((k, i) => { posSorted.set(P.slice(k * 3, k * 3 + 3), i * 3); colSorted.set(CL.slice(k * 3, k * 3 + 3), i * 3); });
    geo.setAttribute('position', new THREE.BufferAttribute(posSorted, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colSorted, 3)); geo.setDrawRange(0, 0);
    const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: .9, depthWrite: false })); sc.add(cloud);
    // Agentes móviles: personas (puntos) y vehículos (cajas)
    const peopleN = 36, pp = new Float32Array(peopleN * 3), ppl = []; for (let i = 0; i < peopleN; i++) { const lane = rnd() < .5; ppl.push({ lane, off: (rnd() - .5) * 30 + (rnd() < .5 ? 21 : -21), ph: rnd() * 240, sp: .3 + rnd() * .5 }); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const people = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.4, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); sc.add(people);
    const cars = []; for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.8, 9), new THREE.MeshStandardMaterial({ color: i === 2 ? COLOR.red : 0xafafaf, transparent: true, opacity: 0 })); const lane = i % 2 === 0; m.userData = { lane, off: lane ? (i % 4 ? 6 : -6) : (i % 3 ? 6 : -6), ph: rnd() * 240, sp: .6 + rnd() * .6 }; if (!lane) m.rotation.y = Math.PI / 2; sc.add(m); cars.push(m); }
    const st = { rev: 0, r0: 0, r1: 0, t0: 0, play: false, time: 0, mode: 'pts', last: performance.now() };
    const revTo = (v, dur) => { st.r0 = st.rev; st.r1 = v; st.t0 = performance.now(); st.dur = dur; };
    $('#scMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.m; $('#scMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); solids.visible = st.mode === 'solid' && st.rev > .97; cloud.material.opacity = st.mode === 'solid' ? .25 : .9; Sfx.tick(); });
    stage.onFrame = () => {
      st.rev = st.dur ? lerp(st.r0, st.r1, ease(clamp((performance.now() - st.t0) / (REDUCED ? 1 : st.dur), 0, 1))) : 0; const dt = Math.min(.1, (performance.now() - st.last) / 1000); st.last = performance.now(); geo.setDrawRange(0, Math.floor(N * clamp(st.rev, 0, 1)));
      if ($('#scPts')) $('#scPts').textContent = fmt(Math.floor(N * clamp(st.rev, 0, 1)) * 4);
      if (st.play) { st.time = (st.time + dt * 36) % 480; const r = $('#scT'); if (r) r.value = st.time; }
      const vis = clamp((st.rev - .85) * 7, 0, 1); people.material.opacity = vis; cars.forEach((c) => { c.material.opacity = vis; });
      const a = pg.attributes.position.array; ppl.forEach((p, i) => { const s = ((st.time * p.sp + p.ph) % 240) - 120; if (p.lane) { a[i * 3] = s; a[i * 3 + 2] = p.off; } else { a[i * 3] = p.off; a[i * 3 + 2] = s; } a[i * 3 + 1] = 1.6; }); pg.attributes.position.needsUpdate = true;
      cars.forEach((c) => { const u = c.userData; const s = ((st.time * u.sp * 1.6 + u.ph) % 240) - 120; if (u.lane) c.position.set(u.off, 1, s); else c.position.set(s, 1, u.off); });
      if ($('#scClock')) { const sec = Math.floor(st.time); $('#scClock').textContent = `21:${String(40 + Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }
    };
    // Miniaturas: marcador hasta contar con las cuatro vistas reales del cuadrante
    $('#scGo').addEventListener('click', async () => {
      $('#scGo').disabled = true; await Api.reconstructScene(camsIds); Sfx.whoosh();
      const steps = ['Sincronización temporal de 4 fuentes', 'Calibración de cámaras', 'Estimación de profundidad', 'Fusión de nube de puntos', 'Seguimiento de personas y vehículos'];
      const set = (i) => { $('#scSteps').innerHTML = steps.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"><span class="ms">${k < i ? 'check_circle' : k === i ? 'progress_activity' : 'radio_button_unchecked'}</span>${s}</li>`).join(''); $('#scProg').style.width = (i / steps.length * 100) + '%'; $('#scHead').textContent = steps[Math.min(i, steps.length - 1)]; Sfx.tick(); };
      const at = (ms, fn) => timers.push(setTimeout(fn, REDUCED ? 0 : ms));
      set(0); $('#scStats').classList.remove('hidden');
      at(1100, () => set(1)); at(2200, () => { set(2); revTo(.35, 1500); }); at(3800, () => { set(3); revTo(1, 2400); }); at(6200, () => { set(4); });
      at(7400, () => { set(5); $('#scHead').textContent = 'Escena reconstruida'; Sfx.confirm(); st.play = true; $('#scPlay').classList.remove('hidden'); $('#scGo').innerHTML = '<span class="ms">check</span>Reconstrucción lista'; });
    });
    $('#scStage').addEventListener('click', (e) => { if (e.target.closest('#scPP')) return; });
    document.addEventListener('click', ppHandler);
    function ppHandler(e) { const b = e.target.closest('#scPP'); if (!b) return; st.play = !st.play; b.firstElementChild.textContent = st.play ? 'pause' : 'play_arrow'; }
    document.addEventListener('input', (e) => { if (e.target.id === 'scT') { st.time = +e.target.value; } });
  }
  function close() { timers.forEach(clearTimeout); timers = []; if (thumbLoop) thumbLoop(); if (stage) stage.dispose(); stage = null; $('#fullSlot').innerHTML = ''; if (UI.S.view === 'escenas') UI.go('mando'); }
  return { open, close };
})();

/* =====================================================================
   §11 JULES — agente orquestador. Entiende la petición, ejecuta las
   acciones en la consola (navega, consulta, envía a MAIC) y reporta.
   En producción: POST /v1/agent/jules/messages con herramientas
   (tools) que llaman a la misma capa Api.
   ===================================================================== */
const Jules = (() => {
  const body = () => $('#jBody'); let greeted = false; let pending = null;
  const SUGG = ['¿Dónde hay más gente ahora?', 'Envía refuerzos a la zona más crítica', 'Rastrea la placa P 512-884', 'Muéstrame la colisión', 'Abre el muro de video', 'Traza el recorrido de la persona en seguimiento', 'Analiza el último rostro en lista', 'Reconstruye en 3D el cuadrante de la plaza', 'Resume el turno'];
  function toggle(open) { const el = $('#jules'); const o = open ?? el.classList.contains('closed'); el.classList.toggle('closed', !o); document.body.classList.toggle('jules-open', o); $('#jules-btn').style.boxShadow = ''; if (o) { Sfx.select(); if (!greeted) greet(); setTimeout(() => $('#jInput').focus(), 200); } }
  function add(role, html) { const d = document.createElement('div'); d.className = 'msg ' + role; d.innerHTML = html; body().appendChild(d); body().scrollTop = 1e6; return d; }
  function greet() {
    greeted = true; const crit = UI.S.zones.filter((z) => UI.zoneStatus(z) === 'critical').length; const on = UI.S.cameras.filter((c) => c.status === 'online').length;
    add('bot', `Buenas noches. Turno A con <b>${on} de ${UI.S.cameras.length}</b> cámaras en línea. Hay <b>${crit}</b> zonas por encima de lo previsto y Panopticon sigue leyendo placas y rostros en tiempo real. ¿Qué necesitas?`);
    $('#jSugg').innerHTML = SUGG.map((s) => `<button>${s}</button>`).join('');
  }
  async function ask(text) {
    if (!text.trim()) return; $('#jSugg').classList.add('compact'); add('user', esc(text)); $('#jInput').value = '';
    const mark = (s) => window.JulesMark && window.JulesMark.state(s);
    mark('think'); const typing = add('bot', '<span class="typing"><i></i><i></i><i></i></span>'); await wait(900); mark('speak');
    const plan = route(text.toLowerCase(), text); typing.innerHTML = plan.text + (plan.actions.length ? '<div class="act"></div>' : ''); Sfx.blip(); body().scrollTop = 1e6;
    const act = typing.querySelector('.act');
    for (const a of plan.actions) { await wait(550); const r = await a.run(); act.insertAdjacentHTML('beforeend', `<div><span class="ms">check_circle</span>${a.label}${r ? ' · ' + r : ''}</div>`); Sfx.tick(); body().scrollTop = 1e6; }
    if (plan.after) { await wait(400); add('bot', plan.after()); body().scrollTop = 1e6; }
    await wait(600); mark('idle');
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));
  const topZone = () => UI.S.zones.slice().sort((a, b) => b.est / b.planned - a.est / a.planned)[0];
  function route(t, raw) {
    if (pending && /^(s[ií]|dale|hazlo|ok|adelante|confirmo|procede|env[ií]al[oa])(\s|[,.!]|$)/.test(t)) {
      const p = pending; pending = null;
      if (p.kind === 'intercept') return { text: 'Solicito a MAIC la intercepción con las unidades más cercanas a la última posición.', actions: [{ label: 'Intercepción enviada a MAIC', run: async () => { await UI.intercept(p.id); return '3 unidades'; } }] };
      if (p.kind === 'dispatch') return route('envía refuerzos', 'envía refuerzos');
      if (p.kind === 'traffic') return { text: 'Envío el evento a MAIC con su clip de evidencia.', actions: [{ label: 'Evento enviado a MAIC', run: async () => { await UI.trafficDispatch(p.id); return 'unidades más cercanas alertadas'; } }] };
      if (p.kind === 'track') return { text: 'Envío a MAIC la última posición conocida de la persona.', actions: [{ label: 'Última posición enviada a MAIC', run: async () => { await UI.trackDispatch(p.id); return '2 unidades'; } }] };
    }
    pending = null;
    if (/muro|video ?wall|videopared|todas las c[aá]maras/.test(t)) return { text: 'Abro el muro de video con las cámaras del sector, ordenadas por alerta.', actions: [{ label: 'Muro de video abierto', run: async () => { toggle(false); UI.go('muro'); return `${MockDB.cameras.length} cámaras`; } }] };
    if (/identidad|base de datos|redes sociales|fuentes|qui[eé]n es|demostraci|ejemplo|coincidencia/.test(t)) { const f = Api.state.faces.find((x) => x.demo) || Api.state.faces[0]; return { text: `Abro la búsqueda de identidad para ${f.id}. Hoy solo está conectada la lista de Panopticon; las demás fuentes indican cómo conectarse.`, actions: [{ label: 'Búsqueda de identidad abierta', run: async () => { toggle(false); UI.go('rostros', { sel: f.id }); SourceLab.open(f); } }] }; }
    if (/colisi|choque|accidente|tr[aá]nsito|infracci/.test(t)) {
      const ev = /infracci|giro/.test(t) ? MockDB.traffic[1] : MockDB.traffic[0];
      return { text: `Abro el evento <b>${ev.title.toLowerCase()}</b> (${ev.id}) con su video de evidencia.`, actions: [
        { label: 'Vista de tránsito abierta', run: async () => { UI.go('transito', { sel: ev.id }); } },
        { label: 'Clip de evidencia en reproducción', run: async () => { UI.selectTraffic(ev.id); return ev.cameraId; } },
      ], after: () => { pending = { kind: 'traffic', id: ev.id }; return `Vehículos implicados: ${ev.vehicles.map((v) => `${v.tag} ${v.desc.toLowerCase()}`).join(' y ')}. ¿Lo envío a MAIC?`; } };
    }
    if (/trazab|seguimiento|recorrido|sigue a|rastrea a la persona/.test(t)) {
      const tr = MockDB.track;
      return { text: `Reconstruyo el recorrido de <b>${tr.id}</b> entre cámaras.`, actions: [
        { label: 'Vista de personas abierta', run: async () => { UI.go('rostros', { sel: tr.id }); } },
        { label: 'Avistamientos ordenados', run: async () => { UI.selectTrack(tr.id); return `${tr.sightings.length} en ${tr.cameras} cámaras`; } },
        { label: 'Recorrido dibujado en el mapa', run: async () => '' },
      ], after: () => { pending = { kind: 'track', id: tr.id }; const last = tr.sightings[tr.sightings.length - 1]; return `Estuvo ${tr.minutes} minutos en la zona. Última vez visto a las ${last.to} en ${last.cameraId}. Hay 2 avistamientos solapados que conviene revisar. ¿Envío su última posición a MAIC?`; } };
    }
    const plateM = raw.toUpperCase().match(/\b([PCMAN])\s?-?(\d{3})-?(\d{3})\b/);
    if (plateM || /placa|veh[ií]culo|robad/.test(t)) {
      const plate = plateM ? `${plateM[1]} ${plateM[2]}-${plateM[3]}` : 'P 512-884'; const w = MockDB.plateWatch[plate];
      return { text: `Busco <b class="mono">${plate}</b> en las lecturas de Panopticon y reconstruyo su trayectoria.`, actions: [
        { label: 'Consulta registrada en auditoría', run: async () => '' },
        { label: 'Placa localizada en la red', run: async () => { await UI.searchPlate(plate); return `${Api.tracePlateSync(plate).length} cámaras`; } },
        { label: 'Trayectoria dibujada en el mapa', run: async () => '' },
      ], after: () => { if (w) pending = { kind: 'intercept', id: UI.S.sel }; return w ? `La placa tiene <b>${w.reason.toLowerCase()}</b> (${w.case}). Su última posición está en el panel. ¿Quieres que pida a MAIC interceptarla?` : 'La placa no tiene reportes vigentes. Dejé la trayectoria en pantalla por si la necesitas.'; } };
    }
    if (/refuerz|polic[ií]a|agentes|despach|maic|env[ií]a/.test(t)) {
      const z = topZone();
      return { text: `${z.name} es la zona más crítica: ${fmt(z.est)} personas frente a ${fmt(z.planned)} previstas. Pido refuerzo a MAIC.`, actions: [
        { label: 'Vista de aglomeraciones abierta', run: async () => { UI.go('aglomeraciones', { sel: z.id }); UI.selectZone(z.id, true); } },
        { label: 'Evento enviado a MAIC', run: async () => { const d = await UI.dispatchZone(z.id); if (d) { City.dispatchUnits(d.units, z, 9); City.pulse(z.x, z.z, COLOR.primary, 1); return `${d.units.length} unidades más cercanas`; } return 'ya estaba en atención'; } },
      ], after: () => 'MAIC confirmará la asignación en el panel de la zona. Te aviso si la asistencia sigue creciendo.' };
    }
    if (/gente|aglomer|concentr|multitud|personas|d[oó]nde/.test(t)) {
      const zs = UI.S.zones.slice().sort((a, b) => b.est / b.planned - a.est / a.planned);
      return { text: `Estas son las zonas con más concentración respecto a lo previsto:<br>${zs.slice(0, 3).map((z, i) => `${i + 1}. <b>${z.name}</b> · ${fmt(z.est)} personas (${pct(z.est / z.planned - 1)})`).join('<br>')}`, actions: [
        { label: 'Mapa enfocado en la zona más crítica', run: async () => { UI.go('aglomeraciones', { sel: zs[0].id }); UI.selectZone(zs[0].id, true); } },
      ], after: () => { pending = { kind: 'dispatch' }; return '¿Quieres que pida refuerzo a MAIC para la zona más crítica?'; } };
    }
    if (/rostro|facial|cara|persona buscada/.test(t)) {
      const f = Api.state.faces.find((x) => x.watch) || Api.state.faces[0];
      return { text: `Abro el último evento facial con candidato en lista (${f.id}, ${f.cameraId}) y lanzo el análisis.`, actions: [
        { label: 'Evento abierto', run: async () => { UI.go('rostros', { sel: f.id }); UI.selectFace(f.id); } },
        { label: 'Análisis 3D iniciado y auditado', run: async () => { toggle(false); FaceLab.open(f); } },
      ] };
    }
    if (/3d|escena|reconstru/.test(t)) return { text: 'Abro la reconstrucción del cuadrante de la Plaza Salvador del Mundo con sus 4 cámaras.', actions: [{ label: 'Reconstrucción abierta', run: async () => { toggle(false); SceneLab.open(); setTimeout(() => $('#scGo') && $('#scGo').click(), 800); } }] };
    if (/resum|turno|estado|c[oó]mo vamos/.test(t)) {
      const open = Api.state.alerts.filter((a) => a.status === 'abierta'), crit = open.filter((a) => a.severity === 'critical').length;
      const hits = Api.state.reads.filter((r) => r.watch).length, est = UI.S.zones.reduce((s, z) => s + z.est, 0);
      return { text: `Resumen del turno:<br>· ${open.length} alertas abiertas, ${crit} críticas.<br>· ${fmt(est)} personas estimadas en el sector (previsto ${fmt(MockDB.EVENT.planned)}).<br>· ${fmt(Api.state.platesToday)} placas leídas, ${hits} coincidencias con reportes.<br>· ${MockDB.traffic.length} eventos de tránsito con video real (1 colisión).<br>· ${Api.state.dispatches.length} despachos enviados a MAIC.<br>· ${UI.S.cameras.filter((c) => c.status !== 'online').length} cámaras con incidencia.`, actions: [] };
    }
    return { text: 'Puedo ubicar concentraciones de personas, pedir refuerzos a MAIC, rastrear placas, analizar rostros y reconstruir escenas en 3D. Prueba con alguna de las sugerencias.', actions: [] };
  }
  /** Con Jules abierto, las alertas críticas llegan por la conversación en lugar del banner. */
  function notify(a) { if (!greeted) greet(); add('bot', `${Ops.voice(a)}<div class="j-acts">${Ops.actionsFor(a).map((x, i) => `<button class="btn xs ${i === 0 ? 'danger' : 'secondary'}" data-ops-act="${a.id}" data-ops-action="${x.id}">${x.label}</button>`).join('')}</div>`); }
  function nudge() { const b = $('#jules-btn'); b.style.boxShadow = '0 0 0 6px #e0453c33, 0 0 24px #e0453c66'; window.JulesMark && window.JulesMark.state('listen'); }
  function bind() {
    $('#jules-btn').addEventListener('click', () => toggle()); $('#julesClose').addEventListener('click', () => toggle(false));
    $('#jSugg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); });
    $('#jSend').addEventListener('click', () => ask($('#jInput').value)); $('#jInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask($('#jInput').value); });
  }
  return { toggle, ask, bind, nudge, notify };
})();

/* =====================================================================
   §12 BOOT — renderer principal, intro, transición y simulador en vivo
   ===================================================================== */
(async function boot() {
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setClearColor(COLOR.bg);
  let mode = 'globe', hudN = 0;
  /** HUD del mapa: sector, coordenadas del punto observado, altitud, rumbo e inclinación (datos reales de la vista). */
  function hud() {
    const v = UI.engine().view(), el = $('#hudLat'); if (!el) return;
    el.textContent = Math.abs(v.lat).toFixed(4); $('#hudLon').textContent = Math.abs(v.lon).toFixed(4);
    const col = String.fromCharCode(65 + clamp(Math.floor((v.x + 2000) / 500), 0, 7)), row = clamp(Math.floor((v.z + 2000) / 500), 0, 7) + 1;
    hudStatus();
    $('#hudSec').textContent = `SEC. SDM-${col}${row}`; $('#hudAlt').textContent = fmt(v.alt) + ' m'; $('#hudHdg').textContent = String(Math.round(v.heading)).padStart(3, '0') + '°'; $('#hudTilt').textContent = Math.round(v.tilt) + '°';
  }
  /** Línea de omnipresencia: frescura de cada fuente, salud de cámaras, cobertura de vías principales y puntos ciegos. */
  function hudStatus() {
    const el = $('#hudStatus'); if (!el) return; const now = Date.now(), cov = UI.coverage(), cams = UI.S.cameras;
    const src = (name, ts) => { const s = Math.max(0, Math.round((now - ts) / 1000)); return `<span><i class="dot ${s > 20 ? 'red' : s > 8 ? 'yellow' : ''}"></i>${name} <b>hace ${s} s</b></span>`; };
    el.innerHTML = src('Visión', Api.state.fresh.vision) + src('MAIC', Api.state.fresh.maic) +
      `<span>Cámaras <b>${cams.filter((c) => c.status !== 'offline').length}/${cams.length}</b></span><span>Cobertura vial <b>${Math.round(cov.pct * 100)} %</b></span><span>Puntos ciegos <b>${cov.blind.length}</b></span>`;
  }
  function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); [Globe.camera, City.camera].forEach((c) => { c.aspect = w / h; c.updateProjectionMatrix(); }); }
  addEventListener('resize', resize); resize();
  try { await Promise.all(['500 16px "IBM Plex Sans"', '400 16px "IBM Plex Sans"', '600 16px "IBM Plex Sans"', '500 16px "IBM Plex Mono"', '600 16px "IBM Plex Mono"', '300 16px "IBM Plex Serif"', '400 16px "IBM Plex Serif"'].map((f) => document.fonts.load(f))); await document.fonts.ready; } catch (e) { /* fuentes del sistema */ }
  Globe.init();
  // Vista fotorrealista (Google): se intenta en paralelo; si no hay clave o falla, la consola sigue en táctico.
  let geoIntro = false;
  const gmapReady = GMap.init(); // vistas Mapa y Satélite de Google (predeterminadas si hay clave)
  const geoReady = GeoMap.init().then((ok) => { if (ok && mode === 'globe') { geoIntro = true; GeoMap.setActive(true); document.body.classList.add('geo-on'); } return ok; });

  // Intro: cifras y tarjeta anclada a San Salvador
  $('#introStats').innerHTML = [['40', 'Cámaras del sector piloto'], ['24/7', 'Presencia de Panopticon'], ['1.4 s', 'De la detección a la alerta'], ['3', 'Capacidades: multitudes, placas, rostros']].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#globeCard').innerHTML = '<div class="t"><span>Centro de mando · San Salvador</span><span>POC</span></div><div class="muted" style="margin-top:4px">40 cámaras · Ministerio de Seguridad</div><div style="display:flex;align-items:center;gap:6px;margin-top:6px;color:var(--status-positive)"><span class="dot"></span>Panopticon en línea</div>';
  const introLines = ['Salvador del Mundo — 40 cámaras sincronizadas', 'Plaza Salvador del Mundo — concentración por encima de lo previsto', 'MAIC conectado — 36 unidades PNC visibles', 'Lectura de placas activa — 18,204 hoy', 'SPOTBOX en sitio — 4 de 4 en línea'];
  let li = 0; const introTick = setInterval(() => { li = (li + 1) % introLines.length; $('#introTicker .txt').textContent = introLines[li]; }, 3200);

  function loop(t) {
    requestAnimationFrame(loop);
    if (mode === 'globe') {
      if (!geoIntro) { Globe.update(t); renderer.render(Globe.scene, Globe.camera); }
      const a = geoIntro ? GeoMap.anchor() : Globe.anchor(innerWidth, innerHeight), card = $('#globeCard');
      if (t > 2600 && a.vis && !document.body.classList.contains('flying')) { card.style.opacity = 1; card.style.left = (a.x + 24) + 'px'; card.style.top = (a.y + 18) + 'px'; } else card.style.opacity = 0;
    } else { City.update(t); if (UI.S.mapMode === 'tac') renderer.render(City.scene, City.camera); if ((hudN = (hudN + 1) % 5) === 0) hud(); }
  }
  requestAnimationFrame(loop);

  // Ciudad: se prepara en segundo plano mientras corre la intro
  City.init();
  const [cams, zones, units] = await Promise.all([Api.getCameras(), Api.getZones(), Api.getUnits()]);
  UI.S.cameras = cams; UI.S.zones = zones; zones.forEach((z) => { z.status = UI.zoneStatus(z); });
  City.setCameras(cams); City.setZones(zones); City.setUnits(units); zones.forEach(City.updateZone);
  City.bindControls(canvas);
  canvas.addEventListener('pointermove', (e) => { if (mode !== 'city') return; { const g = City.groundAt(e.clientX, e.clientY, innerWidth, innerHeight); if (g) { const p = toLatLon(g.x, g.z); UI.cursor(p.lat, p.lon); } } UI.tip(City.pick(e.clientX, e.clientY, innerWidth, innerHeight), e.clientX, e.clientY); });
  canvas.addEventListener('pointerleave', () => UI.tip(null));
  /** Clic sobre un elemento del mapa: mismo comportamiento en la vista táctica y en la fotorrealista. */
  const onMapPick = (hit) => { if (!hit) return; if (hit.kind === 'zone') { if (UI.S.view !== 'aglomeraciones') UI.go('aglomeraciones', { sel: hit.id }); UI.selectZone(hit.id); } if (hit.kind === 'camera') UI.selectCamera(hit.id); if (hit.kind === 'incident') UI.openAlert(hit.id); };
  City.onClick = (e) => onMapPick(City.pick(e.clientX, e.clientY, innerWidth, innerHeight));
  // La vista fotorrealista replica las órdenes de City y comparte los mismos datos.
  geoReady.then((ok) => { if (!ok) return; GeoMap.setData({ cameras: cams, zones, unitObjs: City.unitObjs }); zones.forEach((z) => GeoMap.updateZone(z)); GeoMap.onPick = onMapPick; City.addMirror(GeoMap); });
  gmapReady.then((ok) => { if (!ok) return; GMap.setOpsData({ zones }); GMap.onPick = onMapPick; City.addMirror(GMap); syncIncidents(); });
  seedHistory();

  // Entrar: audio + vuelo al territorio + transición a la ciudad
  $('#enterBtn').addEventListener('click', () => {
    Sfx.set(true); Sfx.whoosh(); document.body.classList.add('flying'); clearInterval(introTick);
    $('#intro').style.transition = 'opacity .8s ease'; $('#intro').style.opacity = 0;
    /** Abre la consola: se llama al terminar el vuelo de entrada (táctico o fotorrealista). */
    const openConsole = (mapMode) => {
      mode = 'city'; GeoMap.requireSector(); $('#intro').remove(); $('#app').classList.remove('hidden'); $('#jules-btn').classList.remove('hidden');
      City.entrance(); UI.render(); UI.bind(); Jules.bind(); Ops.bind(); Wall.bind(); UI.setMapMode(mapMode, true);
      $('#soundBtn').addEventListener('click', () => Sfx.set(!Sfx.on)); Sfx.set(true); startSim();
    };
    /** Corte suave entre el globo y la vista de consola. */
    const cut = (fn) => { $('#fade').classList.add('on'); setTimeout(() => { fn(); $('#fade').classList.remove('on'); }, 650); };
    // La vista predeterminada es el Mapa de Google. Si aún está cargando se espera un momento; si no hay clave, queda la táctica.
    const start = async () => {
      const gmap = await Promise.race([gmapReady, new Promise((r) => setTimeout(() => r(false), 3500))]);
      if (gmap) { const go = () => cut(() => { openConsole('map'); GMap.enter(); }); if (geoIntro) GeoMap.flyCountry(go); else Globe.flyIn(go); return; }
      if (geoIntro) { GeoMap.flyIn(() => openConsole('3d')); return; }  // planeta real → El Salvador → sector, sin corte
      Globe.flyIn(() => cut(() => openConsole('tac')));
    };
    start();
  });
  setInterval(() => { const c = $('#clock'); if (c) c.textContent = hhmmss(new Date()) + ' CST'; }, 1000);

  /* ---------- Historial inicial del turno (para que la consola no arranque vacía) ---------- */
  function seedHistory() {
    for (let i = 0; i < 16; i++) { const cam = pick(cams.filter((c) => c.status !== 'offline')); const r = UI.makeRead(Gen.plate(), cam, new Date(Date.now() - (16 - i) * 47000)); Api.state.reads.unshift(r); }
    const r0 = UI.makeRead('M 204-551', cams[12], new Date(Date.now() - 38 * 60000)); Api.state.reads.push(r0);
    addAlert({ type: 'plate', severity: 'medium', title: 'Placa vinculada a investigación · M 204-551', sub: `${r0.cameraId} · ${r0.street}`, refId: r0.id, cameraId: r0.cameraId, ts: r0.ts }, true);
    for (let i = 0; i < 6; i++) Api.state.faces.push(makeFace(false, new Date(Date.now() - (i + 1) * 6.5 * 60000)));
    { // Caso de demostración con datos ficticios (ver MockDB.demoCase)
      const d = MockDB.demoCase, cam = cams.find((c) => c.id === d.cameraId), ts = new Date(Date.now() - 4 * 60000);
      const f = { id: d.faceId, demo: true, watch: true, cameraId: cam.id, ...Geo.eventPoint(cam, .3, false), ts, seed: 7, quality: .78, angle: 12, candidates: [{ ref: d.record.ref, list: d.record.list, score: d.record.score, seed: 7 }] };
      Api.state.faces.unshift(f);
      addAlert({ type: 'face', severity: 'critical', title: 'Coincidencia en registro de muestra · 96 %', sub: `${cam.id} · ejemplo con datos ficticios`, refId: f.id, cameraId: cam.id, ts }, true);
    }
    addAlert({ type: 'crowd', severity: 'medium', title: 'Concentración en aumento · Paseo General Escalón', sub: '12,400 personas · previsto 3,000', zoneId: 'Z-03', ts: new Date(Date.now() - 21 * 60000) }, true);
    addAlert({ type: 'camera', severity: 'medium', title: `Cámara degradada · ${cams[8].id}`, sub: `${cams[8].street} · 9 fps`, cameraId: cams[8].id, ts: new Date(Date.now() - 52 * 60000) }, true);
    { const ev = MockDB.traffic[1], c = cams.find((q) => q.id === ev.cameraId); addAlert({ type: 'traffic', severity: 'medium', title: `${ev.title} · vehículo #3`, sub: `${c.id} · ${c.street} · pickup negro`, refId: ev.id, cameraId: c.id, ts: ev.ts }, true); }
    addAlert({ type: 'track', severity: 'low', title: `Seguimiento de persona activo · ${MockDB.track.id}`, sub: `${MockDB.track.sightings.length} avistamientos en ${MockDB.track.cameras} cámaras`, refId: MockDB.track.id, cameraId: MockDB.track.sightings[13].cameraId, ts: new Date(Date.now() - 8 * 60000) }, true);
    addAlert({ type: 'crowd', severity: 'critical', title: 'Asistencia excede lo previsto · Plaza Salvador del Mundo', sub: '78,000 personas · previsto 10,000', zoneId: 'Z-01', ts: new Date(Date.now() - 4 * 60000) }, true);
  }
  function makeFace(watch, ts = new Date()) {
    const cam = pick(cams.filter((c) => c.status === 'online')); const seed = Math.floor(rnd() * 1e6);
    const pool = MockDB.faceWatch.slice().sort(() => rnd() - .5).slice(0, 3);
    const candidates = pool.map((c, i) => ({ ...c, seed: seed + 11 + i, score: watch && i === 0 ? .91 + rnd() * .04 : .38 + rnd() * .3 - i * .05 })).sort((a, b) => b.score - a.score);
    return { id: Gen.id('F'), cameraId: cam.id, ...Geo.eventPoint(cam, rnd(), false), ts, seed, quality: watch ? .41 : .5 + rnd() * .4, angle: Math.round(rnd() * 30), watch, candidates };
  }
  /** Coordenada de una alerta: el punto del hecho (lectura, rostro, incidente vial), el centroide de la zona
      o, en último caso, la cámara. Ninguna alerta entra al sistema sin lat/lon. */
  function locateAlert(a) {
    let p = null;
    if (a.type === 'crowd') p = zones.find((z) => z.id === a.zoneId);
    else if (a.type === 'plate') p = Api.state.reads.find((r) => r.id === a.refId);
    else if (a.type === 'face') p = Api.state.faces.find((f) => f.id === a.refId);
    else if (a.type === 'traffic') p = MockDB.traffic.find((t) => t.id === a.refId);
    else if (a.type === 'track') p = MockDB.track.sightings[MockDB.track.sightings.length - 1];
    if (!p || p.x === undefined) p = cams.find((c) => c.id === a.cameraId) || zones.find((z) => z.id === a.zoneId);
    return p ? Geo.tag({ x: p.x, z: p.z }) : {};
  }
  /** Lleva los incidentes abiertos a las tres vistas del mapa. */
  const syncIncidents = () => { const list = Api.state.alerts; City.syncIncidents(list); GeoMap.syncIncidents(list); GMap.syncIncidents(list, UI.locate); };
  function addAlert(a, silent) {
    const al = { id: Gen.id('A'), status: 'abierta', ts: new Date(), ...a }; Object.assign(al, locateAlert(al)); Api.state.alerts.unshift(al);
    if (silent) return al;
    Api.emit('alerts', al); return al;
  }

  /* ---------- Simulador de tiempo real (en producción: WebSocket /v1/stream) ---------- */
  Api.on('alerts', (a) => {
    if (UI.S.view === 'mando') { const f = $('#feed'); if (f && (UI.S.feedFilter === 'all' || a.severity === 'critical')) f.insertAdjacentHTML('afterbegin', UI.feedItem(a, true)); const k = $('#k-open'); if (k) k.textContent = Api.state.alerts.filter((x) => x.status === 'abierta').length; }
    UI.renderTabs(); UI.refreshMapBar(); syncIncidents(); Wall.render();
    const loc = a.zoneId ? UI.S.zones.find((z) => z.id === a.zoneId) : UI.S.cameras.find((c) => c.id === a.cameraId);
    if (loc) City.pulse(loc.x, loc.z, a.severity === 'critical' ? COLOR.red : COLOR.yellow, a.severity === 'critical' ? 1 : .6);
    // Jules avisa (propuesta P1): el aviso flotante lo arma Ops; con el panel abierto entra también a la conversación.
    if (a.severity === 'critical') { Sfx.critical(); if (!$('#jules').classList.contains('closed')) Jules.notify(a); } else Sfx.medium();
  });
  Api.on('maic', (d) => { Api.state.fresh.maic = Date.now(); syncIncidents(); if (d.zoneId && UI.S.view === 'aglomeraciones' && UI.S.sel === d.zoneId) UI.selectZone(d.zoneId, true); if (d.readId && UI.S.view === 'placas' && UI.S.sel === d.readId) UI.selectRead(d.readId); if (d.trafficId && UI.S.sel === d.trafficId) UI.selectTraffic(d.trafficId); if (d.trackId && UI.S.sel === d.trackId) UI.selectTrack(d.trackId); if (d.steps.length === 2) UI.toast(`MAIC asignó ${d.units ? d.units.length : ''} unidades · ${d.label}`, 'local_police', 'primary'); });
  Api.on('audit', (e) => UI.toast(`Consulta registrada en auditoría · ${e.id}`, 'verified_user'));

  function startSim() {
    const T0 = performance.now(); const at = (s, fn) => setTimeout(fn, REDUCED ? s * 300 : s * 1000);
    // Lecturas de placa continuas
    (function plates() {
      setTimeout(() => {
        const cam = pick(cams.filter((c) => c.status !== 'offline')); const r = UI.makeRead(Gen.plate(), cam); Api.state.reads.unshift(r); Api.state.platesToday += 1 + Math.floor(rnd() * 3); Api.state.fresh.vision = Date.now();
        if (UI.S.view === 'placas') { const l = $('#readsList'); if (l) { l.insertAdjacentHTML('afterbegin', UI.readItem(r, true)); if (l.children.length > 14) l.lastElementChild.remove(); } const c = $('#readsCount'); if (c) c.textContent = fmt(Api.state.platesToday) + ' hoy'; }
        const k = $('#k-plates'); if (k) k.textContent = fmt(Api.state.platesToday);
        plates();
      }, 1600 + rnd() * 1800);
    })();
    // Crecimiento de asistencia por zona
    setInterval(() => {
      UI.S.zones.forEach((z) => {
        const prev = z.status; z.est = Math.max(200, z.est + z.growth * (.4 + rnd()) - z.growth * .25); z.history.push(z.est); z.history.shift(); z.status = UI.zoneStatus(z); City.updateZone(z);
        if (prev !== 'critical' && z.status === 'critical') addAlert({ type: 'crowd', severity: 'critical', title: `Asistencia excede lo previsto · ${z.name}`, sub: `${fmt(z.est)} personas · previsto ${fmt(z.planned)}`, zoneId: z.id });
      });
      const kp = $('#k-people'); if (kp) kp.textContent = fmt(UI.S.zones.reduce((s, z) => s + z.est, 0));
      const ev = $('#evEst'); if (ev) ev.textContent = fmt(UI.S.zones.reduce((s, z) => s + z.est, 0));
      if (UI.S.view === 'aglomeraciones' && UI.S.sel) { const z = UI.S.zones.find((q) => q.id === UI.S.sel); const e = $('#zEst'); if (e && z) e.textContent = fmt(z.est); UI.drawSpark($('#spark'), z); }
      Api.state.facesToday += Math.floor(rnd() * 4);
    }, 2000);
    // Guion de la demo: eventos clave en momentos fijos
    at(14, () => { const r = UI.makeRead('P 512-884', cams[5]); Api.state.reads.unshift(r); addAlert({ type: 'plate', severity: 'critical', title: 'Vehículo con reporte de robo · P 512-884', sub: `Toyota Hilux gris · ${r.cameraId} · ${r.street}`, refId: r.id, cameraId: r.cameraId }); if (UI.S.view === 'placas') $('#railL').innerHTML = UI.platesLeft(); });
    at(26, () => { const ev = MockDB.traffic[0], c = cams.find((q) => q.id === ev.cameraId); ev.ts = new Date(); addAlert({ type: 'traffic', severity: 'critical', title: 'Colisión detectada · vehículos #47 y #1', sub: `${c.id} · ${c.street} · auto y camión`, refId: ev.id, cameraId: c.id }); if (UI.S.view === 'transito' && !UI.S.sel) UI.render(); });
    at(38, () => { const f = makeFace(true); Api.state.faces.unshift(f); addAlert({ type: 'face', severity: 'critical', title: 'Candidato en lista de búsqueda', sub: `${f.cameraId} · coincidencia ${Math.round(f.candidates[0].score * 100)} % · requiere verificación`, refId: f.id, cameraId: f.cameraId }); if (UI.S.view === 'rostros' && !UI.S.sel) UI.render(); });
    setInterval(() => { Api.state.fresh.maic = Date.now(); }, 5000); // MAIC entrega posiciones de unidades cada 5 s (simulado)
    at(58, () => { const c = cams[30]; c.status = 'offline'; c.fps = 0; UI.S.cov = null; City.setCameraStatus(c.id, 'offline'); if (UI.S.view === 'mando') UI.render(); addAlert({ type: 'camera', severity: 'medium', title: `Cámara sin señal · ${c.id}`, sub: `${c.street} · técnico notificado`, cameraId: c.id }); });
    at(80, () => { const r = UI.makeRead('P 377-019', cams[19]); Api.state.reads.unshift(r); addAlert({ type: 'plate', severity: 'critical', title: 'Vehículo con reporte de robo · P 377-019', sub: `Mazda 3 rojo · ${r.cameraId} · ${r.street}`, refId: r.id, cameraId: r.cameraId }); });
    (function faces() { setTimeout(() => { const f = makeFace(false); Api.state.faces.unshift(f); if (UI.S.view === 'rostros') { const l = $('#facesList'); if (l) l.insertAdjacentHTML('afterbegin', UI.faceItem(f, true)); } faces(); }, 16000 + rnd() * 12000); })();
  }
})();
