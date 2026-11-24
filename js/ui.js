/* =====================================================================
   §7 EVIDENCE — evidencia que muestra la consola.
   Regla: solo se muestra material real (clips y recortes generados por
   Panopticon). Donde todavía no hay material de demostración aparece un
   marcador con el logo de SPOTVISION en blanco y negro; la consola nunca
   dibuja imágenes inventadas. En producción: GET /v1/events/{id}/evidence.
   ===================================================================== */
const Evidence = (() => {
  /** Marcador de "sin material". label: qué falta · meta: línea técnica (cámara, hora, coordenadas). */
  function placeholder(label = 'Sin material de demostración', meta = '') {
    return `<div class="ph-ev"><img src="${MEDIA.logo}" alt="SPOTVISION">${label ? `<b>${label}</b>` : ''}${meta ? `<span>${meta}</span>` : ''}</div>`;
  }
  /** Miniatura con el isotipo, para listas y candidatos. */
  function thumb() { return `<span class="ph-thumb"><img src="${MEDIA.mark}" alt=""></span>`; }
  /** Clip real asociado a una cámara (hoy: las cámaras con eventos de tránsito), o null. */
  function clipFor(cameraId) { const ev = MockDB.traffic.find((t) => t.cameraId === cameraId); return ev ? MEDIA.clips[ev.clip] : null; }
  const coords = (o) => { const p = toLatLon(o.x, o.z); return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; };
  /** Captura del caso de demostración con las detecciones de Panopticon: el rostro analizado y los demás rostros del cuadro. */
  function demoFrame() {
    const d = MockDB.demoCase, box = (b, cls, label) => `<i class="fbox ${cls}" style="left:${b.l}%;top:${b.t}%;width:${b.w}%;height:${b.h}%"><em>${label}</em></i>`;
    return `<div class="demo-frame"><img src="${MEDIA.demo.cctv}" alt="Captura de muestra">${d.others.map((b) => box(b, '', 'Rostro')).join('')}${box(d.box, 'main', 'Rostro analizado')}<span class="tagx">Imagen de muestra</span></div>`;
  }
  return { demoFrame, placeholder, thumb, clipFor, coords };
})();

/* =====================================================================
   §8 UI — navegación, vistas y hojas laterales
   ===================================================================== */
const UI = (() => {
  const S = { mapMode: 'tac', night: true, layers: { cams: true, coverage: true, zones: true, units: true, incidents: true }, cov: null, view: 'mando', sel: null, zones: [], cameras: [], units: [], feedFilter: 'all', plateQuery: '', plateResult: null, liveLoops: [], dispatchByZone: {} };
  const VIEWS = [
    { id: 'mando', label: 'Mando', icon: 'radar' },
    { id: 'aglomeraciones', label: 'Aglomeraciones', icon: 'groups' },
    { id: 'placas', label: 'Placas', icon: 'directions_car' },
    { id: 'transito', label: 'Tránsito', icon: 'traffic' },
    { id: 'rostros', label: 'Personas', icon: 'person_search' },
    { id: 'escenas', label: 'Escenas 3D', icon: 'view_in_ar' },
    { id: 'muro', label: 'Muro', icon: 'grid_view' },
  ];
  const typeView = { crowd: 'aglomeraciones', plate: 'placas', face: 'rostros', camera: 'mando', traffic: 'transito', track: 'rostros' };
  const sevLabel = { critical: 'Crítica', medium: 'Media', low: 'Baja' };
  const typeIcon = { crowd: 'groups', plate: 'directions_car', face: 'face', camera: 'videocam_off', traffic: 'car_crash', track: 'person_search' };

  function toast(text, icon = 'verified_user', cls = '') { const el = document.createElement('div'); el.className = 'toast ' + cls; el.innerHTML = `<span class="ms">${icon}</span><span>${text}</span>`; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4200); }

  function zoneStatus(z) { const k = z.est / z.planned; return k >= 1.15 ? 'critical' : k >= .85 ? 'medium' : 'low'; }
  function territorySvg() {
    const r = GEO.sv[0]; let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < r.length; i += 2) { minx = Math.min(minx, r[i]); maxx = Math.max(maxx, r[i]); miny = Math.min(miny, r[i + 1]); maxy = Math.max(maxy, r[i + 1]); }
    const W = 150, H = 76, sx = W / (maxx - minx), sy = H / (maxy - miny), s = Math.min(sx, sy);
    const P = (lo, la) => [((lo - minx) * s).toFixed(1), ((maxy - la) * s).toFixed(1)];
    let d = ''; for (let i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + P(r[i], r[i + 1]).join(',');
    const [cx, cy] = P(-89.1915, 13.6985);
    return `<svg viewBox="0 0 ${W} ${H}" aria-label="El Salvador"><path d="${d}Z" fill="#232323" stroke="#a8a8a8" stroke-opacity=".5" stroke-width=".8"/><circle cx="${cx}" cy="${cy}" r="7" fill="#b9b9b9" opacity=".18"><animate attributeName="r" values="4;10;4" dur="2.4s" repeatCount="indefinite"/></circle><circle cx="${cx}" cy="${cy}" r="2.6" fill="#b9b9b9"/></svg>`;
  }

  /* ---------- Pestañas ---------- */
  function renderTabs() {
    const crit = (v) => Api.state.alerts.filter((a) => a.status === 'abierta' && a.severity === 'critical' && typeView[a.type] === v).length;
    $('#tabs').innerHTML = VIEWS.map((v) => { const n = v.id === 'mando' ? 0 : crit(v.id); return `<button class="tab ${S.view === v.id ? 'on' : ''}" role="tab" aria-selected="${S.view === v.id}" data-view="${v.id}"><span class="ms">${v.icon}</span>${v.label}${n ? `<span class="count">${n}</span>` : ''}</button>`; }).join('');
  }
  function go(view, opts = {}) {
    Wall.close();
    if (view === 'escenas') { SceneLab.open(); return; }
    if (view === 'muro') { S.view = 'muro'; S.sel = null; closeSheet(); renderTabs(); Wall.open(opts.focus); return; }
    S.view = view; S.sel = opts.sel || null; Sfx.tick();
    City.setLayer('cones', S.layers.coverage && view === 'mando'); City.setLayer('labels', S.layers.zones && (view === 'mando' || view === 'aglomeraciones')); City.setLayer('trace', view === 'placas' || view === 'rostros' || view === 'transito'); City.focusZone(null);
    City.clearTrace();
    if (view === 'aglomeraciones') City.flyTo(200, 80, 2100, .86); else if (view === 'mando') City.overview();
    render();
    if (view === 'aglomeraciones' && !S.sel) selectZone(S.zones.slice().sort((a, b) => b.est / b.planned - a.est / a.planned)[0].id, true);
  }

  /* ---------- Render por vista ---------- */
  function render() {
    renderTabs(); stopLoops();
    const L = $('#railL'), R = $('#railR');
    if (S.view === 'mando') {
      // Propuesta P2: Ministro ve el territorio y lo que pide atención; Operador 911 trabaja la cola.
      if (Ops.S.mode === 'operador') { L.innerHTML = Ops.queuePanel(); R.innerHTML = ''; R.classList.add('hidden'); }
      else { L.innerHTML = mandoLeft(); R.innerHTML = Ops.summaryPanel(); R.classList.remove('hidden'); }
      L.classList.toggle('wide', Ops.S.mode === 'operador'); closeSheet();
    } else $('#railL').classList.remove('wide');
    if (S.view === 'aglomeraciones') { L.innerHTML = crowdLeft(); R.classList.add('hidden'); }
    if (S.view === 'placas') { L.innerHTML = platesLeft(); R.classList.add('hidden'); if (!S.sel) closeSheet(); }
    if (S.view === 'transito') { L.innerHTML = trafficLeft(); R.classList.add('hidden'); if (!S.sel) closeSheet(); }
    if (S.view === 'rostros') { L.innerHTML = facesLeft(); R.classList.add('hidden'); if (!S.sel) closeSheet(); }
    refreshMapBar();
  }
  /* ---------- Vista del mapa, capas y encuadres ----------
     Modos: 'map' (Google, predeterminado) · 'sat' (Google satélite) · '3d' (Google fotorrealista) · 'tac' (táctico, sin Internet). */
  const MODES = [['map', 'Mapa'], ['sat', 'Satélite'], ['3d', '3D'], ['tac', 'Táctico']];
  const LAYERS = [['cams', 'Cámaras', 'cctv'], ['coverage', 'Cobertura', 'radar'], ['zones', 'Zonas', 'groups'], ['units', 'Unidades', 'local_police'], ['incidents', 'Incidentes', 'warning']];
  const PRESETS = [['Sector', 180, 70, 2350, .93], ['Plaza', 20, 35, 900, .85], ['Roosevelt', 420, 35, 850, .85], ['Escalón', -330, -30, 850, .85], ['Estadio', 964, 368, 1000, .85]];
  /** Motor de mapa activo: todos exponen view() con el mismo contrato. */
  function engine() { return S.mapMode === 'tac' ? City : S.mapMode === '3d' ? GeoMap : GMap; }
  function coverage() { if (!S.cov) S.cov = Coverage.compute(S.cameras); return S.cov; }
  function layerCount(id) {
    if (id === 'cams') return S.cameras.filter((c) => c.status !== 'offline').length + '/' + S.cameras.length;
    if (id === 'coverage') return Math.round(coverage().pct * 100) + ' %';
    if (id === 'zones') return S.zones.length; if (id === 'units') return City.unitObjs.size;
    return Api.state.alerts.filter((a) => a.status === 'abierta').length;
  }
  function mapBar() {
    const chips = LAYERS.map(([id, label, icon]) => `<button class="lchip ${S.layers[id] ? 'on' : ''}" data-layer="${id}" aria-pressed="${S.layers[id]}">${icon === 'cctv' ? Glyph.svg('cctv', 16) : `<span class="ms">${icon}</span>`}${label}<b>${layerCount(id)}</b></button>`).join('');
    const seg = MODES.map(([id, label]) => `<button class="${S.mapMode === id ? 'on' : ''}" data-mapmode="${id}">${label}</button>`).join('');
    const night = S.mapMode === 'sat' || S.mapMode === '3d' ? `<button class="iconbtn ${S.night ? 'on' : ''}" data-action="map-night" title="Atenuación nocturna" aria-label="Atenuación nocturna"><span class="ms">dark_mode</span></button>` : '';
    return `<div class="lchips">${chips}</div><span class="seg">${seg}</span>${night}`;
  }
  function refreshMapBar() { const el = $('#legend'); if (el) el.innerHTML = mapBar(); const p = $('#hudPresets'); if (p && !p.innerHTML) p.innerHTML = PRESETS.map(([n], i) => `<button data-preset="${i}" title="Tecla ${i + 1}">${n}</button>`).join(''); }
  function setMapMode(mode, silent) {
    if ((mode === 'map' || mode === 'sat') && !GMap.available) { toast('Las vistas Mapa y Satélite de Google requieren la versión local con la clave de Google Maps Platform configurada.', 'map'); return false; }
    if (mode === '3d' && !GeoMap.available) { toast('La vista 3D fotorrealista de Google requiere la versión local con la clave de Google Maps Platform configurada.', 'satellite_alt'); return false; }
    S.mapMode = mode; GeoMap.setActive(mode === '3d'); GMap.setActive(mode === 'map' || mode === 'sat'); if (mode === 'map' || mode === 'sat') GMap.setBase(mode);
    document.getElementById('gl').style.visibility = mode === 'tac' ? 'visible' : 'hidden';
    document.body.classList.toggle('geo-on', mode !== 'tac'); document.body.dataset.map = mode; if (!silent) Sfx.select(); refreshMapBar(); return true;
  }
  function toggleLayer(id) {
    S.layers[id] = !S.layers[id]; GMap.setLayer(id, S.layers[id]);
    if (id === 'coverage') City.setLayer('cones', S.layers[id]); if (id === 'zones') { City.setLayer('zones', S.layers[id]); City.setLayer('labels', S.layers[id]); } if (id === 'units') City.setLayer('units', S.layers[id]); if (id === 'incidents') City.setLayer('incidents', S.layers[id]);
    Sfx.tick(); refreshMapBar();
  }
  function preset(i) { const p = PRESETS[i]; if (!p) return; City.flyTo(p[1], p[2], p[3], p[4]); Sfx.tick(); }
  /** Posición de una alerta en el mapa (zona o cámara). */
  /** Punto georreferenciado de una alerta. Toda alerta nace con su coordenada (ver locateAlert en §11);
      el respaldo por zona o cámara cubre datos antiguos. */
  function locate(a) { return a.x !== undefined ? a : a.zoneId ? S.zones.find((z) => z.id === a.zoneId) : S.cameras.find((c) => c.id === a.cameraId); }
  /** Coordenadas bajo el cursor, en el HUD del mapa. */
  function cursor(lat, lon) { const el = $('#hudCur'); if (el) el.textContent = lat === null ? '—' : `${lat.toFixed(5)}, ${lon.toFixed(5)}`; }
  /** Bloque "qué hay alrededor": las 4 cámaras operativas más cercanas en mosaico y las unidades de MAIC con su tiempo estimado.
      Se añade a la hoja de cualquier alerta: verificar y despachar sin buscar a mano. */
  function nearby(loc) {
    const bd = $('#sheet .sh-bd'); if (!bd || !loc || bd.querySelector('.nearby')) return;
    const cams = S.cameras.filter((c) => c.status !== 'offline').map((c) => ({ c, d: Math.hypot(c.x - loc.x, c.z - loc.z) })).sort((a, b) => a.d - b.d).slice(0, 4);
    // Distancia y tiempo por calles reales (no en línea recta), a 30 km/h de promedio urbano
    const units = City.nearestUnits(loc.x, loc.z, 3).map((u) => { const o = City.unitObjs.get(u.id); return { ...u, d: Routes.length(Routes.path(o.s.position.x, o.s.position.z, loc.x, loc.z)) }; }).sort((a, b) => a.d - b.d);
    const box = document.createElement('div'); box.className = 'nearby';
    box.innerHTML = `<div class="caption" style="margin-bottom:8px">Cámaras más cercanas</div><div class="mosaic">${cams.map(({ c, d }) => { const clip = Evidence.clipFor(c.id); return `<button class="tile" data-cam="${c.id}" title="${esc(c.street)}">${clip ? `<video src="${clip.src}" poster="${clip.poster}" muted loop autoplay playsinline></video>` : Evidence.placeholder('', '')}<span>${c.id} · ${Math.round(d)} m</span></button>`; }).join('')}</div>
      <div class="caption" style="margin:14px 0 8px">Unidades más cercanas (MAIC)</div><div style="display:flex;flex-direction:column;gap:6px">${units.map((u) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px"><span><span class="mono">${u.id}</span> · ${City.unitObjs.get(u.id).u.type}<span class="geo" style="margin:2px 0 0">${Geo.str({ x: City.unitObjs.get(u.id).s.position.x, z: City.unitObjs.get(u.id).s.position.z })}</span></span><span class="muted">${Math.round(u.d)} m por calle · llegada ~${Math.max(1, Math.round(u.d / 500))} min</span></div>`).join('')}</div>`;
    bd.appendChild(box);
  }

  function mandoLeft() {
    const cams = S.cameras, on = cams.filter((c) => c.status === 'online').length;
    const open = Api.state.alerts.filter((a) => a.status === 'abierta').length;
    const people = S.zones.reduce((s, z) => s + z.est, 0);
    const units = [...City.unitObjs.values()].length;
    return `
    <section class="panel"><div class="hd"><div><h3>Salvador del Mundo</h3><div class="sub">San Salvador · POC Ministerio de Seguridad</div></div><span class="chip live"><span class="ms">sensors</span>En vivo</span></div>
      <div class="bd"><div class="territory">${territorySvg()}<div class="meta"><b>${cams.length} cámaras · 4.2 km²</b>Cobertura continua por Panopticon desde dic 2026</div></div></div>
      <div class="kpis">
        <div class="kpi"><div class="v" id="k-cams">${on}<small>/ ${cams.length}</small></div><div class="l">Cámaras en línea</div></div>
        <div class="kpi ${open ? 'alert' : ''}"><div class="v" id="k-open">${open}</div><div class="l">Alertas abiertas</div></div>
        <div class="kpi"><div class="v" id="k-people">${fmt(people)}</div><div class="l">Personas estimadas</div></div>
        <div class="kpi"><div class="v" id="k-plates">${fmt(Api.state.platesToday)}</div><div class="l">Placas leídas hoy</div></div>
        <div class="kpi"><div class="v">1.4<small>s</small></div><div class="l">Detección a alerta</div></div>
        <div class="kpi"><div class="v">${units}</div><div class="l">Unidades PNC visibles</div></div>
      </div></section>
    <section class="panel"><div class="hd"><h3>Sistema de visión</h3><span class="chip ok"><span class="ms">check_circle</span>Operativo</span></div>
      <div class="bd" style="display:grid;gap:10px;font-size:13px">
        <div style="display:flex;justify-content:space-between"><span class="muted">Cómputo en sitio</span><span>4 de 4 SPOTBOX</span></div>
        <div style="display:flex;justify-content:space-between"><span class="muted">Capacidades activas</span><span>Multitudes · Placas · Rostros</span></div>
        <div style="display:flex;justify-content:space-between"><span class="muted">Latencia de inferencia</span><span class="mono">182 ms</span></div>
        <div style="display:flex;justify-content:space-between"><span class="muted">Integración MAIC</span><span style="color:var(--status-positive)">Conectada</span></div>
      </div></section>
    <section class="panel"><div class="hd"><h3>Cámaras con incidencia</h3><span class="sub">${cams.length - on} de ${cams.length}</span></div>
      <ul class="list">${cams.filter((c) => c.status !== 'online').map((c) => `<li class="item" data-cam="${c.id}"><span class="ic ${c.status === 'offline' ? 'critical' : 'medium'}"><span class="ms">${c.status === 'offline' ? 'videocam_off' : 'videocam'}</span></span><div><div class="t">${c.id} · ${esc(c.street)}</div><div class="s">${c.status === 'offline' ? 'Sin señal · técnico notificado' : `Degradada · ${c.fps} fps`}</div></div><div class="r"><span class="chip ${c.status === 'offline' ? 'critical' : 'medium'}">${c.status === 'offline' ? 'Crítica' : 'Media'}</span></div></li>`).join('')}</ul></section>`;
  }
  function feedPanel() {
    const list = Api.state.alerts.filter((a) => S.feedFilter === 'all' || a.severity === 'critical').slice(0, 40);
    return `<section class="panel flush" style="display:flex;flex-direction:column;min-height:0;flex:1">
      <div class="hd"><div><h3>Alertas en vivo</h3><div class="sub">Panopticon · ${Api.state.alerts.length} hoy en este turno</div></div>
        <div class="seg"><button data-filter="all" class="${S.feedFilter === 'all' ? 'on' : ''}">Todas</button><button data-filter="crit" class="${S.feedFilter !== 'all' ? 'on' : ''}">Críticas</button></div></div>
      <ul class="list" id="feed" style="overflow-y:auto;flex:1">${list.length ? list.map(feedItem).join('') : `<li class="item" style="cursor:default"><span></span><div class="s">Sin alertas en este filtro. Las nuevas aparecerán aquí en tiempo real.</div></li>`}</ul></section>`;
  }
  function feedItem(a, isNew) {
    return `<li class="item ${isNew ? 'new' : ''}" data-alert="${a.id}"><span class="ic ${a.severity}"><span class="ms">${typeIcon[a.type]}</span></span><div><div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub)}</div>${a.lat !== undefined ? `<div class="geo"><span class="ms">location_on</span>${Geo.str(a)}</div>` : ''}</div><div class="r"><span>${hhmm(a.ts)}</span>${a.status === 'en atención' ? '<span class="chip ok">En atención</span>' : `<span class="chip ${a.severity}">${sevLabel[a.severity]}</span>`}</div></li>`;
  }

  /* ---------- Aglomeraciones ---------- */
  function crowdLeft() {
    const est = S.zones.reduce((s, z) => s + z.est, 0), plan = MockDB.EVENT.planned;
    const officers = S.zones.reduce((s, z) => s + z.officers, 0), need = Math.ceil(est / MockDB.EVENT.officersPerPerson);
    const zs = S.zones.slice().sort((a, b) => b.est / b.planned - a.est / a.planned);
    return `
    <section class="panel"><div class="hd"><div><h3>Evento en curso</h3><div class="sub">${MockDB.EVENT.name}</div></div><span class="chip critical">${pct(est / plan - 1)}</span></div>
      <div class="bd">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:2px 0 12px">
          <div><div class="caption">Previsto</div><div style="font-family:var(--font-display);font-size:30px;font-weight:300">${fmt(plan)}</div></div>
          <div><div class="caption">Estimado ahora</div><div id="evEst" style="font-family:var(--font-display);font-size:30px;font-weight:300;color:#ef6b62">${fmt(est)}</div></div>
        </div>
        <div class="callout danger"><span class="ms">local_police</span><div>Hay <b>${officers}</b> agentes en las zonas. Para esta asistencia se recomiendan <b>${need}</b> (1 por cada ${MockDB.EVENT.officersPerPerson} personas). Déficit de <b>${Math.max(0, need - officers)}</b>.</div></div>
        <button class="btn primary" style="width:100%;margin-top:12px" data-action="dispatch-all"><span class="ms">send</span>Solicitar refuerzo para zonas críticas</button>
      </div></section>
    <section class="panel flush"><div class="hd"><h3>Zonas</h3><span class="sub">Ordenadas por exceso sobre lo previsto</span></div>
      <ul class="list">${zs.map((z) => { const k = z.est / z.planned, st = zoneStatus(z), col = st === 'critical' ? 'var(--status-negative)' : st === 'medium' ? 'var(--status-alert)' : 'var(--ink-muted)'; return `<li class="item ${S.sel === z.id ? 'sel' : ''}" data-zone="${z.id}"><span class="ic ${st}"><span class="ms">groups</span></span><div><div class="t">${z.name}</div><div class="s">${fmt(z.est)} de ${fmt(z.planned)} previstos · ${z.officers} agentes</div><div class="geo"><span class="ms">location_on</span>${Geo.str(z)}</div><div class="cap"><i style="width:${clamp(k / 10 * 100, 2, 100)}%;background:${col}"></i><span class="mark" style="left:10%"></span></div></div><div class="r"><span class="chip ${st}">${sevLabel[st]}</span><span>${pct(k - 1)}</span></div></li>`; }).join('')}</ul></section>`;
  }
  function selectZone(id, silent) {
    const z = S.zones.find((q) => q.id === id); if (!z) return; S.sel = id; if (!silent) Sfx.select();
    City.flyTo(z.x, z.z, 520 + z.r * 5, .8); City.focusZone(id);
    document.querySelectorAll('[data-zone]').forEach((el) => el.classList.toggle('sel', el.dataset.zone === id));
    const st = zoneStatus(z), need = Math.ceil(z.est / MockDB.EVENT.officersPerPerson), d = S.dispatchByZone[id];
    openSheet(`
      <div class="sh-hd"><div style="flex:1"><h2>${z.name}</h2><div class="sub">${z.id} · ${z.cameras.length} cámaras · actualizado en vivo</div><div class="geo"><span class="ms">location_on</span>${Geo.str(z)} · ${fmt(z.area)} m²</div></div><span class="chip ${st}">${sevLabel[st]}</span><button class="iconbtn" data-action="close-sheet" aria-label="Cerrar"><span class="ms">close</span></button></div>
      <div class="sh-bd">
        <div class="evidence">${Evidence.placeholder('Video en vivo no incluido en la demo', `${z.cameras[0]} · ${Evidence.coords(z)}`)}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          <div><div class="caption">Estimado</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300" id="zEst">${fmt(z.est)}</div></div>
          <div><div class="caption">Previsto</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300">${fmt(z.planned)}</div></div>
          <div><div class="caption">Desviación</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300;color:${st === 'critical' ? '#ef6b62' : 'inherit'}">${pct(z.est / z.planned - 1)}</div></div>
        </div>
        <div><div class="caption" style="margin-bottom:6px">Últimos 30 minutos · línea punteada = previsto</div><canvas class="spark" id="spark"></canvas></div>
        <dl class="details"><dt>Centroide de la zona</dt><dd class="mono">${Geo.str(z)}</dd><dt>Área del perímetro</dt><dd>${fmt(z.area)} m² · ${z.poly.length} vértices</dd><dt>Agentes en la zona (MAIC)</dt><dd>${z.officers}</dd><dt>Agentes recomendados</dt><dd>${need}</dd><dt>Unidades disponibles a menos de 1 km</dt><dd>${City.nearestUnits(z.x, z.z, 99).filter((u) => u.d < 1000).length}</dd></dl>
        ${d ? maicTimeline(d) : `<div class="callout ${st === 'critical' ? 'danger' : 'warn'}"><span class="ms">bolt</span><div>${st === 'low' ? 'La zona está dentro de lo previsto. No se requiere acción.' : `Recomendación de Panopticon: enviar como primer refuerzo las <b>${Math.min(8, Math.max(2, need - z.officers))}</b> unidades más cercanas. MAIC las alertará.`}</div></div>`}
      </div>
      <div class="sh-ft"><button class="btn secondary sm" data-action="zone-cams" data-id="${z.id}"><span class="ms">videocam</span>Ver cámaras</button>${d ? '' : `<button class="btn primary sm" data-action="dispatch" data-id="${z.id}" ${st === 'low' ? 'disabled' : ''}><span class="ms">send</span>Enviar a MAIC</button>`}</div>`);
    drawSpark($('#spark'), z);
  }
  function maicTimeline(d) {
    const all = ['Evento enviado a MAIC', 'Evento recibido por MAIC', 'Unidades asignadas', 'Unidades en ruta'];
    const doneN = 1 + d.steps.length;
    return `<div><div class="caption" style="margin-bottom:8px">Despacho ${d.id} · MAIC</div><ul class="timeline">${all.map((s, i) => `<li class="${i < doneN ? 'done' : i === doneN ? 'now' : 'pending'}"><span class="b"></span>${s}${i === 2 && i < doneN ? ` · <b>${d.units.length}</b> unidades: ${d.units.join(', ')}` : ''}${i === 3 && i < doneN ? ` · llegada estimada ${d.eta} min` : ''}<div class="when">${i === 0 ? hhmmss(d.created) : i < doneN ? hhmmss(d.steps[i - 1].ts) : ''}</div></li>`).join('')}</ul></div>`;
  }
  function drawSpark(cv, z) {
    if (!cv) return; const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const hs = z.history, mx = Math.max(...hs, z.planned) * 1.12; const X = (i) => i / (hs.length - 1) * w, Y = (v) => h - 6 - v / mx * (h - 12);
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, h * k / 4); g.lineTo(w, h * k / 4); g.stroke(); }
    const st = zoneStatus(z), col = st === 'critical' ? '#e0453c' : st === 'medium' ? '#f3ff00' : '#a8a8a8';
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '00');
    g.beginPath(); hs.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillStyle = gr; g.fill();
    g.beginPath(); hs.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
    g.setLineDash([5, 5]); g.strokeStyle = '#b8b8b8'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(z.planned)); g.lineTo(w, Y(z.planned)); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.beginPath(); g.arc(w - 3, Y(hs[hs.length - 1]), 3.5, 0, Math.PI * 2); g.fill();
  }
  async function dispatchZone(id) {
    const z = S.zones.find((q) => q.id === id); if (!z || S.dispatchByZone[id]) return;
    const need = Math.ceil(z.est / MockDB.EVENT.officersPerPerson); const n = Math.min(8, Math.max(2, need - z.officers));
    const units = City.nearestUnits(z.x, z.z, n).map((u) => u.id);
    const d = await Api.dispatch({ label: z.name, zoneId: z.id, location: { lat: toLatLon(z.x, z.z).lat, lon: toLatLon(z.x, z.z).lon }, unitsRequested: n });
    d.units = units; d.eta = 4 + Math.round(rnd() * 4); S.dispatchByZone[id] = d; Sfx.confirm();
    toast(`Evento enviado a MAIC · ${z.name}`, 'send', 'primary');
    Api.state.alerts.filter((a) => a.zoneId === id && a.status === 'abierta').forEach((a) => { a.status = 'en atención'; });
    if (S.sel === id && S.view === 'aglomeraciones') selectZone(id, true);
    return d;
  }

  /* ---------- Placas ---------- */
  function platesLeft() {
    const hits = Api.state.reads.filter((r) => r.watch).slice(0, 6);
    const reads = Api.state.reads.slice(0, 14);
    return `
    <section class="panel"><div class="hd"><div><h3>Buscar placa</h3><div class="sub">Cada consulta queda en el registro de auditoría</div></div></div>
      <div class="bd"><div class="search"><span class="ms dim">search</span><input id="plateQ" placeholder="P 512-884" value="${esc(S.plateQuery)}" aria-label="Placa"><button class="btn primary xs" data-action="plate-search">Buscar</button></div></div></section>
    <section class="panel flush"><div class="hd"><h3>Coincidencias con reportes</h3><span class="sub">${hits.length}</span></div>
      <ul class="list">${hits.length ? hits.map((r) => readItem(r)).join('') : `<li class="item" style="cursor:default"><span></span><div class="s">Ninguna lectura coincide hoy con un reporte de robo. Panopticon compara cada placa en tiempo real.</div></li>`}</ul></section>
    <section class="panel flush"><div class="hd"><h3>Lecturas en vivo</h3><span class="sub" id="readsCount">${fmt(Api.state.platesToday)} hoy</span></div>
      <ul class="list" id="readsList">${reads.map((r) => readItem(r)).join('')}</ul></section>`;
  }
  function readItem(r, isNew) {
    return `<li class="item ${isNew ? 'new' : ''} ${S.sel === r.id ? 'sel' : ''}" data-read="${r.id}"><span class="ic ${r.watch ? 'critical' : ''}"><span class="ms">directions_car</span></span><div><div class="t mono" style="letter-spacing:.04em">${r.plate}</div><div class="s">${r.vehicle.make} · ${r.vehicle.color} · ${r.cameraId}</div></div><div class="r"><span>${hhmmss(r.ts)}</span>${r.watch ? `<span class="chip critical">${r.watch.reason === 'Reporte de robo' ? 'Robado' : 'Investigación'}</span>` : `<span>${Math.round(r.confidence * 100)} %</span>`}</div></li>`;
  }
  function selectRead(id) {
    const r = Api.state.reads.find((q) => q.id === id); if (!r) return; S.sel = id; Sfx.select();
    document.querySelectorAll('[data-read]').forEach((el) => el.classList.toggle('sel', el.dataset.read === id));
    const sightings = Api.tracePlateSync(r.plate); sightings[sightings.length - 1] = { ...sightings[sightings.length - 1], cameraId: r.cameraId, x: r.x, z: r.z, ts: r.ts, street: r.street };
    const path = Routes.through(sightings); S.lastPath = path;
    if (r.watch) { City.showTrace(sightings, { path }); const a = sightings[0], b = sightings[sightings.length - 1]; City.flyTo((a.x + b.x) / 2, (a.z + b.z) / 2, 1700, .78); } else { City.clearTrace(); City.flyTo(r.x, r.z, 800, .8); }
    const disp = Api.state.dispatches.find((d) => d.readId === r.id);
    openSheet(`
      <div class="sh-hd"><div style="flex:1"><div class="bigplate">${r.plate}</div><div class="sub">${r.cameraId} · ${esc(r.street)} · ${hhmmss(r.ts)}</div></div>${r.watch ? `<span class="chip critical"><span class="ms">warning</span>${r.watch.reason}</span>` : '<span class="chip neutral">Sin reportes</span>'}<button class="iconbtn" data-action="close-sheet" aria-label="Cerrar"><span class="ms">close</span></button></div>
      <div class="sh-bd">
        <div class="evidence">${Evidence.placeholder('Captura de placa no incluida en la demo', `${r.cameraId} · ${hhmmss(r.ts)}`)}</div>
        <dl class="details"><dt>Vehículo</dt><dd>${r.vehicle.type} · ${r.vehicle.make}</dd><dt>Color</dt><dd>${r.vehicle.color}</dd><dt>Confianza de lectura</dt><dd>${Math.round(r.confidence * 100)} %</dd><dt>Coordenadas</dt><dd class="mono">${toLatLon(r.x, r.z).lat.toFixed(5)}, ${toLatLon(r.x, r.z).lon.toFixed(5)}</dd>${r.watch ? `<dt>Expediente</dt><dd class="mono">${r.watch.case}</dd><dt>Reportado desde</dt><dd>${r.watch.since}</dd>` : ''}</dl>
        ${r.watch ? `<div><div class="caption" style="margin-bottom:8px">Trayectoria reconstruida · ${sightings.length} cámaras</div><ul class="timeline">${sightings.map((s, i) => `<li class="${i === sightings.length - 1 ? 'now' : 'done'}"><span class="b"></span>${s.cameraId} · ${esc(s.street)}<div class="when">${hhmmss(s.ts)} · confianza ${Math.round(s.confidence * 100)} %</div></li>`).join('')}</ul></div>
        ${disp ? maicTimeline(disp) : `<div class="callout danger"><span class="ms">bolt</span><div>El vehículo sigue dentro del sector vigilado. MAIC puede alertar a las unidades más cercanas a su última posición para interceptarlo.</div></div>`}` : `<div class="callout"><span class="ms">info</span><div>La placa no tiene reportes vigentes. La lectura se conserva según la política de retención configurada para El Salvador.</div></div>`}
      </div>
      <div class="sh-ft"><button class="btn secondary sm" data-action="trace" data-id="${r.id}"><span class="ms">route</span>Ver trayectoria</button>${r.watch && !disp ? `<button class="btn primary sm" data-action="intercept" data-id="${r.id}"><span class="ms">send</span>Enviar a MAIC para interceptar</button>` : ''}</div>`);
    S.lastSightings = sightings;
  }
  async function intercept(id) {
    const r = Api.state.reads.find((q) => q.id === id); if (!r) return;
    const units = City.nearestUnits(r.x, r.z, 3).map((u) => u.id);
    const d = await Api.dispatch({ label: `Placa ${r.plate}`, readId: r.id, unitsRequested: 3 }); d.units = units; d.eta = 3; Sfx.confirm();
    City.dispatchUnits(units, { x: r.x, z: r.z }, 7); City.pulse(r.x, r.z, COLOR.red, 1);
    toast(`Intercepción solicitada a MAIC · ${r.plate}`, 'send', 'primary');
    Api.state.alerts.filter((a) => a.refId === r.id).forEach((a) => { a.status = 'en atención'; });
    if (S.sel === id) selectRead(id);
  }

  /* ---------- Rostros ---------- */
  function facesLeft() {
    const all = Api.state.faces, fs = all.filter((f) => f.demo).concat(all.filter((f) => !f.demo).slice(0, 11)); // el caso de demostración queda fijo arriba
    return `
    <section class="panel"><div class="hd"><h3>Reconocimiento facial</h3><span class="chip info"><span class="ms">policy</span>Uso controlado</span></div>
      <div class="bd"><div class="callout"><span class="ms">gavel</span><div>Panopticon compara rostros solo contra listas autorizadas por el Ministerio. El resultado es un <b>candidato</b> con su puntaje; la identidad se confirma por un analista y cada consulta queda auditada.</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px"><div><div class="caption">Rostros procesados hoy</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300">${fmt(Api.state.facesToday)}</div></div><div><div class="caption">Umbral de coincidencia</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300">0.85</div></div></div></div></section>
    <section class="panel"><div class="hd"><h3>Fuentes de identidad</h3><span class="sub">${MockDB.sources.filter((s) => s.status === 'connected').length} conectada · ${MockDB.sources.filter((s) => s.status !== 'connected').length} por conectar</span></div>
      <div class="bd"><div class="muted" style="font-size:13px;margin-bottom:10px">Un rostro detectado se puede buscar en bases de datos institucionales o en fuentes abiertas. Cada fuente se conecta por base de datos, API o MCP.</div><button class="btn secondary sm" data-action="face-sources"><span class="ms">hub</span>Ver fuentes y conexiones</button></div></section>
    ${trackPanel()}
    <section class="panel flush"><div class="hd"><h3>Eventos faciales</h3><span class="sub">Más recientes primero</span></div>
      <ul class="list" id="facesList">${fs.map(faceItem).join('')}</ul></section>`;
  }
  function faceItem(f, isNew) {
    const top = f.candidates[0];
    return `<li class="item ${isNew ? 'new' : ''} ${S.sel === f.id ? 'sel' : ''}" data-face="${f.id}" style="grid-template-columns:44px 1fr auto">${f.demo ? `<span class="thumb"><img src="${MEDIA.demo.face}" alt="" style="width:100%;height:100%;object-fit:cover"></span>` : Evidence.thumb()}<div><div class="t">${f.demo ? 'Coincidencia en registro de muestra' : f.watch ? 'Candidato en lista de búsqueda' : 'Rostro sin coincidencia'}</div><div class="s">${f.cameraId} · calidad ${f.quality.toFixed(2)}${f.demo ? ' · ejemplo con datos ficticios' : ''}</div></div><div class="r"><span>${hhmmss(f.ts)}</span>${f.watch ? `<span class="chip critical">${Math.round(top.score * 100)} %</span>` : '<span class="chip neutral">—</span>'}</div></li>`;
  }
  function selectFace(id) {
    const f = Api.state.faces.find((q) => q.id === id); if (!f) return; S.sel = id; Sfx.select();
    document.querySelectorAll('[data-face]').forEach((el) => el.classList.toggle('sel', el.dataset.face === id));
    const cam = S.cameras.find((c) => c.id === f.cameraId); if (cam) { City.flyTo(cam.x, cam.z, 750, .78); City.pulse(cam.x, cam.z, f.watch ? COLOR.red : COLOR.muted, .6); }
    openSheet(`
      <div class="sh-hd"><div style="flex:1"><h2>${f.demo ? 'Coincidencia en registro de muestra' : f.watch ? 'Candidato en lista de búsqueda' : 'Rostro detectado'}</h2><div class="sub">${f.id} · ${f.cameraId} · ${hhmmss(f.ts)}</div></div>${f.watch ? '<span class="chip critical">Crítica</span>' : '<span class="chip neutral">Sin coincidencia</span>'}<button class="iconbtn" data-action="close-sheet" aria-label="Cerrar"><span class="ms">close</span></button></div>
      <div class="sh-bd">
        ${f.demo ? `<div class="callout warn"><span class="ms">info</span><div><b>Ejemplo con datos ficticios (data dummy).</b> La imagen, el nombre y el documento son de muestra y no corresponden a un registro oficial.</div></div>${Evidence.demoFrame()}` : `<div class="evidence">${Evidence.placeholder('Captura no incluida en la demo', `${f.cameraId} · ${hhmmss(f.ts)}`)}</div>`}
        <dl class="details"><dt>Coordenadas de la detección</dt><dd class="mono">${Geo.str(f)}</dd><dt>Calidad del rostro</dt><dd>${f.quality.toFixed(2)} · ${f.quality < .5 ? 'baja, se recomienda mejora' : 'suficiente'}</dd><dt>Ángulo</dt><dd>${f.angle}°</dd><dt>Mejor puntaje</dt><dd>${Math.round(f.candidates[0].score * 100)} % (${f.candidates[0].ref})</dd></dl>
        <div class="callout warn"><span class="ms">info</span><div>Antes de actuar, analiza el rostro: Panopticon mejora la captura, reconstruye el rostro en 3D y recalcula los candidatos.</div></div>
      </div>
      <div class="sh-ft"><button class="btn secondary sm" data-action="face-lab" data-id="${f.id}"><span class="ms">3d_rotation</span>Reconstruir en 3D</button><button class="btn primary sm" data-action="face-sources" data-id="${f.id}"><span class="ms">person_search</span>Buscar identidad</button></div>`);
  }


  /* ---------- Evidencia en video real ---------- */
  /** Reproductor de evidencia. En producción el `src` es el clip firmado que entrega Panopticon. */
  function videoEvidence(clipKey, tag) {
    const c = MEDIA.clips[clipKey];
    return `<div class="evidence"><video src="${c.src}" poster="${c.poster}" muted loop autoplay playsinline preload="auto"></video><span class="rec"><span class="dot red"></span>${tag}</span><div class="vbar"><button class="iconbtn" data-action="video-toggle" aria-label="Pausar o reproducir"><span class="ms">pause</span></button><button class="iconbtn" data-action="video-full" data-id="${clipKey}" aria-label="Ampliar video"><span class="ms">open_in_full</span></button></div></div>`;
  }
  function videoFull(clipKey) {
    const c = MEDIA.clips[clipKey]; Sfx.select();
    $('#fullSlot').innerHTML = `<section class="full" role="dialog" aria-label="Evidencia en video"><header class="f-hd"><span class="ms" style="color:var(--ink-muted)">smart_display</span><h2>Evidencia en video</h2><span class="muted" style="font-size:13px">Análisis de Panopticon sobre cámara municipal</span><div class="right"><span class="chip neutral">Video real</span><button class="iconbtn" data-close-full aria-label="Cerrar"><span class="ms">close</span></button></div></header><div class="f-bd" style="place-items:center;padding:20px;min-height:0"><video src="${c.src}" poster="${c.poster}" muted loop autoplay playsinline controls style="max-width:100%;max-height:100%;border:1px solid var(--border);border-radius:10px;background:#000"></video></div></section>`;
    $('#fullSlot [data-close-full]').addEventListener('click', () => { $('#fullSlot').innerHTML = ''; });
  }

  /* ---------- Tránsito: infracciones y colisiones ---------- */
  const kindLabel = { collision: 'Colisión', infraction: 'Infracción' };
  function trafficLeft() {
    const evs = MockDB.traffic;
    return `
    <section class="panel"><div class="hd"><div><h3>Tránsito</h3><div class="sub">Infracciones y colisiones detectadas por Panopticon</div></div><span class="chip live"><span class="ms">sensors</span>En vivo</span></div>
      <div class="kpis"><div class="kpi"><div class="v">31,480</div><div class="l">Vehículos analizados hoy</div></div><div class="kpi"><div class="v">212</div><div class="l">Infracciones registradas</div></div><div class="kpi alert"><div class="v">3</div><div class="l">Colisiones</div></div><div class="kpi"><div class="v">4.6<small>s</small></div><div class="l">Del impacto a la alerta</div></div></div></section>
    <section class="panel flush"><div class="hd"><h3>Eventos con evidencia</h3><span class="sub">Video real</span></div>
      <ul class="list">${evs.map((ev) => { const cam = S.cameras.find((c) => c.id === ev.cameraId); return `<li class="item ${S.sel === ev.id ? 'sel' : ''}" data-traffic="${ev.id}" style="grid-template-columns:84px 1fr auto"><span style="width:84px;height:48px;border-radius:6px;overflow:hidden;background:#000"><img src="${MEDIA.clips[ev.clip].poster}" alt="" style="width:100%;height:100%;object-fit:cover"></span><div><div class="t">${ev.title}</div><div class="s">${ev.cameraId} · ${esc(cam.street)}</div></div><div class="r"><span>${hhmm(ev.ts)}</span><span class="chip ${ev.severity}">${kindLabel[ev.kind]}</span></div></li>`; }).join('')}</ul></section>
    <section class="panel"><div class="bd" style="padding-top:14px"><div class="callout"><span class="ms">info</span><div>Estos clips son salidas reales de Panopticon sobre video de cámaras municipales de San Salvador. Su ubicación en el mapa es asignada para la demo.</div></div></div></section>`;
  }
  function selectTraffic(id) {
    const ev = MockDB.traffic.find((q) => q.id === id); if (!ev) return; S.sel = id; Sfx.select();
    document.querySelectorAll('[data-traffic]').forEach((el) => el.classList.toggle('sel', el.dataset.traffic === id));
    const cam = S.cameras.find((c) => c.id === ev.cameraId); City.clearTrace(); City.flyTo(cam.x, cam.z, 750, .78); City.pulse(cam.x, cam.z, ev.severity === 'critical' ? COLOR.red : COLOR.yellow, .7);
    const disp = Api.state.dispatches.find((d) => d.trafficId === id), col = ev.kind === 'collision';
    openSheet(`
      <div class="sh-hd"><div style="flex:1"><h2>${ev.title}</h2><div class="sub">${ev.id} · ${ev.cameraId} · ${esc(cam.street)} · ${hhmmss(ev.ts)}</div></div><span class="chip ${ev.severity}">${kindLabel[ev.kind]}</span><button class="iconbtn" data-action="close-sheet" aria-label="Cerrar"><span class="ms">close</span></button></div>
      <div class="sh-bd">
        ${videoEvidence(ev.clip, 'CLIP')}
        <div><div class="caption" style="margin-bottom:8px">Vehículos implicados</div><div style="display:flex;flex-direction:column;gap:6px">${ev.vehicles.map((v) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px"><span class="mono" style="color:${col ? '#ef6b62' : 'var(--status-alert)'}">${v.tag}</span><span>${v.desc}</span></div>`).join('')}</div></div>
        <dl class="details">${ev.detail.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}<dt>Origen del clip</dt><dd>${ev.source}</dd><dt>Coordenadas del hecho</dt><dd class="mono">${Geo.str(ev)}</dd></dl>
        ${disp ? maicTimeline(disp) : col
          ? '<div class="callout danger"><span class="ms">bolt</span><div>Panopticon detectó el impacto por el cambio brusco de velocidad y la superposición de ambos vehículos. Recomendación: enviar una unidad y confirmar si hay personas heridas.</div></div>'
          : '<div class="callout warn"><span class="ms">info</span><div>La maniobra queda registrada con su clip como evidencia. La placa no es legible desde esta cámara; Panopticon puede buscar el vehículo por tipo y color en las cámaras vecinas.</div></div>'}
      </div>
      <div class="sh-ft"><button class="btn secondary sm" data-action="traffic-follow" data-id="${ev.id}"><span class="ms">route</span>Buscar en cámaras vecinas</button>${disp ? '' : `<button class="btn primary sm" data-action="traffic-maic" data-id="${ev.id}"><span class="ms">send</span>Enviar a MAIC</button>`}</div>`);
  }
  async function trafficDispatch(id) {
    const ev = MockDB.traffic.find((q) => q.id === id); if (!ev || Api.state.dispatches.find((d) => d.trafficId === id)) return;
    const cam = S.cameras.find((c) => c.id === ev.cameraId), units = City.nearestUnits(cam.x, cam.z, ev.kind === 'collision' ? 2 : 1).map((u) => u.id);
    const d = await Api.dispatch({ label: ev.title, trafficId: id, unitsRequested: units.length }); d.units = units; d.eta = 3; Sfx.confirm();
    City.dispatchUnits(units, cam, 7); City.pulse(cam.x, cam.z, COLOR.primary, .8); toast(`Evento enviado a MAIC · ${ev.title}`, 'send', 'primary');
    Api.state.alerts.filter((a) => a.refId === id).forEach((a) => { a.status = 'en atención'; });
    if (S.sel === id) selectTraffic(id);
  }
  function trafficFollow(id) {
    const ev = MockDB.traffic.find((q) => q.id === id); const cam = S.cameras.find((c) => c.id === ev.cameraId);
    Api.audit('Búsqueda de vehículo por atributos', ev.vehicles[0].desc);
    const sg = Api.tracePlateSync('veh-' + id).slice(0, 4); sg.unshift({ x: cam.x, z: cam.z, ts: ev.ts });
    City.showTrace(sg, { color: COLOR.yellow, path: Routes.through(sg) }); City.flyTo((sg[0].x + sg[sg.length - 1].x) / 2, (sg[0].z + sg[sg.length - 1].z) / 2, 1700, .78);
  }

  /* ---------- Trazabilidad de personas (re-identificación) ---------- */
  function trackPanel() {
    const t = MockDB.track;
    return `<section class="panel flush"><div class="hd"><h3>Trazabilidad de personas</h3><span class="sub">Seguimiento entre cámaras</span></div>
      <ul class="list"><li class="item ${S.sel === t.id ? 'sel' : ''}" data-track="${t.id}" style="grid-template-columns:44px 1fr auto"><span style="width:44px;height:58px;border-radius:6px;overflow:hidden;background:#000"><img src="${MEDIA.crops[3]}" alt="" style="width:100%;height:100%;object-fit:cover"></span><div><div class="t">Persona en seguimiento</div><div class="s">${t.id} · ${t.sightings.length} avistamientos · ${t.cameras} cámaras</div><div class="s">${t.from} – ${t.to}</div></div><div class="r"><span class="chip info">Activo</span></div></li></ul></section>`;
  }
  function trackPath(t) { const out = []; const seen = new Set(); t.sightings.forEach((s) => { const last = out[out.length - 1]; if (last && last.cameraId === s.cameraId) return; out.push({ cameraId: s.cameraId, x: s.x, z: s.z, label: seen.has(s.cameraId) ? false : `${s.cameraId} · ${s.from.slice(0, 5)}` }); seen.add(s.cameraId); }); return out; }
  function selectTrack(id) {
    const t = Api.getTrackSync(id); if (!t) return; if (S.sel !== id) Api.audit('Consulta de trazabilidad de persona', id); S.sel = id; Sfx.select();
    document.querySelectorAll('[data-track]').forEach((el) => el.classList.toggle('sel', el.dataset.track === id));
    const path = trackPath(t); City.setLayer('trace', true); City.showTrace(path, { color: COLOR.muted, path: Routes.through(path) });
    const xs = path.map((p) => p.x), zs = path.map((p) => p.z); City.flyTo((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, 1500, .8);
    const disp = Api.state.dispatches.find((d) => d.trackId === id), ov = t.sightings.filter((s) => s.overlap);
    openSheet(`
      <div class="sh-hd"><div style="flex:1"><h2>Trazabilidad de persona</h2><div class="sub">${t.id} · ${t.from} – ${t.to} · seguimiento por apariencia</div></div><span class="chip info">Re-identificación</span><button class="iconbtn" data-action="close-sheet" aria-label="Cerrar"><span class="ms">close</span></button></div>
      <div class="sh-bd">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          <div><div class="caption">Avistamientos</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300">${t.sightings.length}</div></div>
          <div><div class="caption">Cámaras</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300">${t.cameras}</div></div>
          <div><div class="caption">Duración</div><div style="font-family:var(--font-display);font-size:26px;font-weight:300">${t.minutes}<span style="font-family:var(--font-sans);font-size:13px;color:var(--ink-muted)"> min</span></div></div>
        </div>
        <div><div class="caption" style="margin-bottom:8px">Avistamientos en orden · toca uno para verlo en el mapa</div>
          <div class="strip">${t.sightings.map((s, i) => `<button class="sight ${s.overlap ? 'ov' : ''}" data-sight="${i}"><span class="ph"><img src="${MEDIA.crops[s.img]}" alt="Avistamiento ${i + 1}">${s.overlap ? '<i>Solape</i>' : ''}</span><b>${s.from}</b><span>${s.cameraId}</span><span class="q">cuerpo ${s.bq.toFixed(2)} · rostro ${s.fr.toFixed(2)}</span></button>`).join('')}</div></div>
        <div class="callout"><span class="ms">accessibility_new</span><div>Panopticon sigue a la persona por su apariencia completa (ropa, complexión, objetos que lleva), no solo por el rostro. Por eso mantiene el seguimiento cuando está de espaldas, donde la calidad de rostro es 0.00.</div></div>
        ${ov.length ? `<div class="callout warn"><span class="ms">report</span><div><b>${ov.length} avistamientos se solapan</b> en el tiempo (${ov[0].from} – ${ov[ov.length - 1].to}) en cámaras distintas. Panopticon los marca para revisión humana: solo es válido si ambas cámaras comparten campo de visión.</div></div>` : ''}
        ${disp ? maicTimeline(disp) : ''}
        <div class="locked"><span class="ms">visibility_off</span>Rostros pixelados en este prototipo. El seguimiento no revela identidad.</div>
      </div>
      <div class="sh-ft"><button class="btn secondary sm" data-action="track-map" data-id="${t.id}"><span class="ms">route</span>Ver recorrido completo</button>${disp ? '' : `<button class="btn primary sm" data-action="track-maic" data-id="${t.id}"><span class="ms">send</span>Enviar última posición a MAIC</button>`}</div>`);
  }
  function focusSight(i) {
    const s = MockDB.track.sightings[i]; if (!s) return; Sfx.tick(); City.flyTo(s.x, s.z, 620, .76); City.pulse(s.x, s.z, s.overlap ? COLOR.red : COLOR.muted, .5);
    document.querySelectorAll('.sight').forEach((el, k) => el.classList.toggle('on', k === i));
  }
  async function trackDispatch(id) {
    const t = MockDB.track; if (Api.state.dispatches.find((d) => d.trackId === id)) return; const s = t.sightings[t.sightings.length - 1];
    const units = City.nearestUnits(s.x, s.z, 2).map((u) => u.id); const d = await Api.dispatch({ label: `Seguimiento ${id}`, trackId: id, unitsRequested: 2 }); d.units = units; d.eta = 3; Sfx.confirm();
    City.dispatchUnits(units, s, 7); City.pulse(s.x, s.z, COLOR.primary, .8); toast(`Última posición enviada a MAIC · ${s.cameraId}`, 'send', 'primary'); if (S.sel === id) selectTrack(id);
  }


  /* ---------- Cámara: ficha con su señal, estado y alertas ---------- */
  function selectCamera(id) {
    const c = S.cameras.find((q) => q.id === id); if (!c) return; Sfx.select();
    City.flyTo(c.x, c.z, 750, .78); City.pulse(c.x, c.z, c.status === 'offline' ? COLOR.red : COLOR.muted, .5);
    const clip = c.status !== 'offline' && Evidence.clipFor(c.id), al = Api.state.alerts.filter((a) => a.cameraId === c.id).slice(0, 4), zone = S.zones.find((z) => z.id === c.zoneId);
    const st = c.status === 'online' ? ['ok', 'En línea'] : c.status === 'degraded' ? ['medium', 'Degradada'] : ['critical', 'Sin señal'];
    openSheet(`
      <div class="sh-hd"><span style="color:var(--ink-muted);margin-top:3px">${Glyph.svg('cctv', 22)}</span><div style="flex:1"><h2>${c.id}</h2><div class="sub">${esc(c.street)}</div></div><span class="chip ${st[0]}">${st[1]}</span><button class="iconbtn" data-action="close-sheet" aria-label="Cerrar"><span class="ms">close</span></button></div>
      <div class="sh-bd">
        <div class="evidence">${c.status === 'offline' ? Evidence.placeholder('Sin señal', 'Técnico notificado') : clip ? `<video src="${clip.src}" poster="${clip.poster}" muted loop autoplay playsinline></video><span class="rec"><span class="dot red"></span>CLIP</span>` : Evidence.placeholder('Señal en vivo no incluida en la demo', c.id)}</div>
        <dl class="details"><dt>Coordenadas</dt><dd class="mono">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</dd><dt>Cuadros por segundo</dt><dd>${c.status === 'offline' ? '—' : c.fps + ' fps'}</dd><dt>Cómputo</dt><dd>${c.compute}</dd><dt>Análisis de Panopticon</dt><dd>Multitudes · Placas · Rostros</dd><dt>Campo de visión</dt><dd>62° · alcance 200 m</dd><dt>Zona</dt><dd>${zone ? zone.name : 'Fuera de zonas de concentración'}</dd></dl>
        <div><div class="caption" style="margin-bottom:8px">Alertas de esta cámara</div>${al.length ? `<ul class="list" style="border:1px solid var(--border);border-radius:10px;overflow:hidden">${al.map((a) => feedItem(a)).join('')}</ul>` : '<div class="dim" style="font-size:13px">Sin alertas en este turno.</div>'}</div>
      </div>
      <div class="sh-ft"><button class="btn secondary sm" data-action="cam-wall" data-id="${c.id}"><span class="ms">grid_view</span>Abrir en el muro</button></div>`);
    nearby(c);
  }

  /* ---------- Hoja lateral y bucles de evidencia en vivo ---------- */
  function openSheet(html) { const s = $('#sheet'); s.innerHTML = html; s.classList.remove('closed'); }
  function closeSheet() { $('#sheet').classList.add('closed'); stopLoops(); }
  function loop(fn, every) { let alive = true, last = 0; const step = (t) => { if (!alive) return; if (t - last > every) { fn(t); last = t; } requestAnimationFrame(step); }; requestAnimationFrame(step); S.liveLoops.push(() => { alive = false; }); }
  function stopLoops() { S.liveLoops.forEach((f) => f()); S.liveLoops = []; }

  /* ---------- Banner de alerta crítica ---------- */
  function banner(a) {
    const slot = $('#bannerSlot'); slot.innerHTML = `<div class="banner" role="alert"><span class="ms">${typeIcon[a.type]}</span><div style="flex:1;min-width:0"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub)}${a.lat !== undefined ? ' · ' + Geo.str(a) : ''}</div></div><button class="btn danger sm" data-action="open-alert" data-id="${a.id}">Atender</button><button class="iconbtn" data-action="close-banner" aria-label="Descartar"><span class="ms">close</span></button></div>`;
    clearTimeout(banner.t); banner.t = setTimeout(() => { slot.innerHTML = ''; }, 11000);
  }
  function openAlert(id) {
    const a = Api.state.alerts.find((q) => q.id === id); if (!a) return; $('#bannerSlot').innerHTML = '';
    if (a.type === 'crowd') { go('aglomeraciones', { sel: a.zoneId }); selectZone(a.zoneId); }
    else if (a.type === 'plate') { go('placas', { sel: a.refId }); selectRead(a.refId); }
    else if (a.type === 'face') { go('rostros', { sel: a.refId }); selectFace(a.refId); }
    else if (a.type === 'traffic') { go('transito', { sel: a.refId }); selectTraffic(a.refId); }
    else if (a.type === 'track') { go('rostros', { sel: a.refId }); selectTrack(a.refId); }
    else if (a.type === 'camera') { const c = S.cameras.find((q) => q.id === a.cameraId); if (c) { City.flyTo(c.x, c.z, 750); City.pulse(c.x, c.z, COLOR.red, .6); } }
    nearby(locate(a));
  }

  /* ---------- Fichas sobre el mapa ----------
     Al pasar el mouse por una unidad, una cámara o un grupo aparece una ficha HUD: lo que hace
     falta para identificarlo de un vistazo (placa, tipo, estado, a qué incidente va; o dónde mira
     la cámara, con qué ángulo y hasta dónde). Lo demás (zonas, incidentes, puntos ciegos) sigue con
     la ficha corta. */
  const UNIT_KIND = { auto: ['Patrulla', 'directions_car'], moto: ['Motorizada', 'two_wheeler'], pie: ['A pie', 'directions_walk'] };
  const UNIT_SPEED = { auto: 34, moto: 41, pie: 5 };
  function bearing(c) {
    const p0 = toLatLon(c.x, c.z), p1 = toLatLon(c.x + Math.cos(c.heading) * 50, c.z + Math.sin(c.heading) * 50);
    const deg = (Math.atan2((p1.lon - p0.lon) * Math.cos(p0.lat * Math.PI / 180), p1.lat - p0.lat) * 180 / Math.PI + 360) % 360;
    return { deg, card: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8] };
  }
  /** Abanico de la cámara visto desde arriba: el ángulo real y hacia dónde apunta (norte arriba). */
  function fovSvg(deg, fovDeg) {
    const r = 26, cx = 30, cy = 30, a0 = (deg - fovDeg / 2 - 90) * Math.PI / 180, a1 = (deg + fovDeg / 2 - 90) * Math.PI / 180;
    const P = (an) => `${(cx + Math.cos(an) * r).toFixed(1)},${(cy + Math.sin(an) * r).toFixed(1)}`;
    return `<svg class="hc-fov" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" stroke-opacity=".18"/><path d="M30 4v4M56 30h-4M30 56v-4M4 30h4" stroke="currentColor" stroke-opacity=".35"/><path d="M${cx},${cy} L${P(a0)} A${r},${r} 0 0 1 ${P(a1)} Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.2"/><circle cx="30" cy="30" r="2.6" fill="currentColor"/><text x="30" y="11" text-anchor="middle" font-size="6" fill="currentColor" fill-opacity=".6">N</text></svg>`;
  }
  const row = (k, v) => `<div class="hc-row"><span>${k}</span><b>${v}</b></div>`;
  function unitCard(id) {
    const o = City.unitObjs.get(id); if (!o) return ''; const u = o.u, k = Glyph.unitKind(u), [kind, icon] = UNIT_KIND[k];
    const d = Api.state.dispatches.slice().reverse().find((q) => q.units && q.units.includes(id));
    const busy = u.status !== 'patrullando', st = busy ? (d ? 'En ruta' : 'Asignada') : 'Patrullando';
    const p = toLatLon(o.s.position.x, o.s.position.z);
    return `<div class="hc-hd"><span class="hc-eyebrow">Unidad PNC · MAIC</span><span class="hc-state ${busy ? 'busy' : ''}"><i></i>${st}</span></div>
      <div class="hc-title"><span class="hc-ic"><span class="ms">${icon}</span></span><div><b class="mono">${u.id}</b><small>${kind} · ${u.radio || ''}</small></div></div>
      <div class="hc-grid">${row('Placa', u.plate ? `<span class="mono plate">${u.plate}</span>` : '—')}${row('Agentes', u.crew || 2)}${row('Velocidad', `${busy ? UNIT_SPEED[k] : Math.round(UNIT_SPEED[k] * .5)} km/h`)}${row('GPS', 'hace 2 s')}</div>
      ${d ? `<div class="hc-task"><span class="hc-eyebrow">Asignada a</span><b>${esc(d.label)}</b><small>Llegada estimada ~${d.eta || 4} min · ${esc(d.status || '')}</small></div>` : ''}
      <div class="hc-foot mono">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div>`;
  }
  function cameraCard(id) {
    const c = S.cameras.find((q) => q.id === id); if (!c) return ''; const b = bearing(c), fov = Math.round(Coverage.FOV * 180 / Math.PI);
    const st = c.status === 'online' ? ['En línea', ''] : c.status === 'degraded' ? ['Degradada', 'medium'] : ['Sin señal', 'critical'];
    const clip = Evidence.clipFor(c.id);
    return `<div class="hc-hd"><span class="hc-eyebrow">Cámara · ${esc(c.compute || 'Panopticon')}</span><span class="hc-state ${st[1]}"><i></i>${st[0]}</span></div>
      ${clip ? `<div class="hc-shot"><img src="${clip.poster}" alt=""><span class="mono">EN VIVO · ${c.id}</span></div>` : ''}
      <div class="hc-title"><span class="hc-ic"><span class="ms">videocam</span></span><div><b class="mono">${c.id}</b><small>${esc(c.street)}</small></div></div>
      <div class="hc-cam">${fovSvg(b.deg, fov)}<div class="hc-grid">${row('Ángulo', `${fov}°`)}${row('Alcance', `${Coverage.REACH} m`)}${row('Mira hacia', `${b.card} · ${Math.round(b.deg)}°`)}${row('Imagen', c.status === 'offline' ? '—' : `${c.fps} fps`)}</div></div>
      <div class="hc-foot mono">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</div>`;
  }
  function groupCard(info) {
    const n = info.list.length;
    if (info.cat === 'units') { const by = {}; info.list.forEach((it) => { by[it.sub] = (by[it.sub] || 0) + 1; }); const busy = info.list.filter((it) => it.busy).length; return `<div class="hc-hd"><span class="hc-eyebrow">Grupo · ${n} unidades</span></div><div class="hc-grid">${Object.entries(by).map(([k, v]) => row(UNIT_KIND[k][0], v)).join('')}${row('Asignadas', busy)}</div><div class="hc-foot">Clic para acercar</div>`; }
    if (info.cat === 'cams') { const off = info.list.filter((it) => it.sub === 'offline').length, deg = info.list.filter((it) => it.sub === 'degraded').length; return `<div class="hc-hd"><span class="hc-eyebrow">Grupo · ${n} cámaras</span></div><div class="hc-grid">${row('En línea', n - off - deg)}${row('Degradadas', deg)}${row('Sin señal', off)}</div><div class="hc-foot">Clic para acercar</div>`; }
    const by = { critical: 0, medium: 0, low: 0 }; info.list.forEach((it) => { by[it.sev]++; });
    return `<div class="hc-hd"><span class="hc-eyebrow">Grupo · ${n} incidentes</span></div><div class="hc-grid">${row('Críticos', by.critical)}${row('Medios', by.medium)}${row('Bajos', by.low)}</div><div class="hc-foot">Clic para acercar</div>`;
  }
  function tip(info, x, y) {
    const el = $('#tip'); if (!info) { el.classList.add('hidden'); return; }
    let html = '', card = false;
    const geo = (o) => `<div class="geo"><span class="ms">location_on</span>${Geo.str(o)}</div>`;
    if (info.kind === 'camera') { html = cameraCard(info.id); card = true; }
    if (info.kind === 'unit') { html = unitCard(info.id); card = true; }
    if (info.kind === 'group') { html = groupCard(info); card = true; }
    if (info.kind === 'zone') { const z = S.zones.find((q) => q.id === info.id); html = `<b>${z.name}</b><div class="muted" style="margin-top:4px">${fmt(z.est)} estimadas · ${fmt(z.planned)} previstas · ${fmt(z.area)} m²</div>${geo(z)}`; }
    if (info.kind === 'incident') { const a = Api.state.alerts.find((q) => q.id === info.id); if (!a) return; html = `<b>${esc(a.title)}</b><div class="muted" style="margin-top:4px">${esc(a.sub)} · ${hhmm(a.ts)}</div>${geo(a)}`; }
    if (info.kind === 'blind') html = `<b>Punto ciego</b><div class="muted" style="margin-top:4px">Tramo de vía principal sin cobertura de cámara</div>${geo(info)}`;
    if (!html) { el.classList.add('hidden'); return; }
    el.className = card ? 'hudcard' : ''; el.innerHTML = html;
    // La ficha se acomoda para no salirse de la pantalla
    const w = card ? 276 : 240, h = el.offsetHeight || 200;
    el.style.left = Math.min(x + 16, innerWidth - w - 12) + 'px'; el.style.top = Math.min(y + 16, innerHeight - h - 12) + 'px';
  }

  /* ---------- Eventos de interfaz (delegación) ---------- */
  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-view],[data-action],[data-alert],[data-zone],[data-read],[data-face],[data-filter],[data-cam],[data-traffic],[data-track],[data-sight],[data-mapmode],[data-layer],[data-preset]'); if (!t) return;
      if (t.dataset.view) go(t.dataset.view);
      else if (t.dataset.mapmode) setMapMode(t.dataset.mapmode);
      else if (t.dataset.layer) toggleLayer(t.dataset.layer);
      else if (t.dataset.preset) preset(+t.dataset.preset);
      else if (t.dataset.filter) { S.feedFilter = t.dataset.filter; $('#railR').innerHTML = feedPanel(); }
      else if (t.dataset.alert) openAlert(t.dataset.alert);
      else if (t.dataset.zone) { if (S.view !== 'aglomeraciones') go('aglomeraciones', { sel: t.dataset.zone }); selectZone(t.dataset.zone); }
      else if (t.dataset.read) selectRead(t.dataset.read);
      else if (t.dataset.face) selectFace(t.dataset.face);
      else if (t.dataset.traffic) selectTraffic(t.dataset.traffic);
      else if (t.dataset.track) selectTrack(t.dataset.track);
      else if (t.dataset.sight) focusSight(+t.dataset.sight);
      else if (t.dataset.cam) selectCamera(t.dataset.cam);
      else {
        const a = t.dataset.action, id = t.dataset.id;
        if (a === 'close-sheet') { closeSheet(); S.sel = null; City.clearTrace(); document.querySelectorAll('.item.sel').forEach((el) => el.classList.remove('sel')); City.focusZone(null); }
        if (a === 'dispatch') dispatchZone(id).then((d) => { const z = S.zones.find((q) => q.id === id); if (d) { City.dispatchUnits(d.units, z, 9); City.pulse(z.x, z.z, COLOR.primary, 1); } });
        if (a === 'dispatch-all') S.zones.filter((z) => zoneStatus(z) === 'critical' && !S.dispatchByZone[z.id]).forEach((z, i) => setTimeout(() => dispatchZone(z.id).then((d) => { if (d) { City.dispatchUnits(d.units, z, 9); City.pulse(z.x, z.z, COLOR.primary, 1); } }), i * 400));
        if (a === 'zone-cams') { const z = S.zones.find((q) => q.id === id); City.flyTo(z.x, z.z, 620, .7); z.cameras.forEach((cid) => { const c = S.cameras.find((q) => q.id === cid); City.pulse(c.x, c.z, COLOR.muted, .3); }); }
        if (a === 'plate-search') searchPlate($('#plateQ').value);
        if (a === 'trace') { if (S.lastSightings) { City.showTrace(S.lastSightings, { path: S.lastPath }); City.setLayer('trace', true); } }
        if (a === 'intercept') intercept(id);
        if (a === 'face-lab') FaceLab.open(Api.state.faces.find((q) => q.id === id));
        if (a === 'face-sources') SourceLab.open(Api.state.faces.find((q) => q.id === id) || Api.state.faces[0]);
        if (a === 'cam-wall') go('muro', { focus: id });
        if (a === 'open-alert') openAlert(id);
        if (a === 'close-banner') $('#bannerSlot').innerHTML = '';
        if (a === 'video-toggle') { const v = t.closest('.evidence').querySelector('video'); if (v.paused) { v.play(); t.firstElementChild.textContent = 'pause'; } else { v.pause(); t.firstElementChild.textContent = 'play_arrow'; } }
        if (a === 'video-full') videoFull(id);
        if (a === 'traffic-maic') trafficDispatch(id);
        if (a === 'traffic-follow') trafficFollow(id);
        if (a === 'track-map') selectTrack(id);
        if (a === 'track-maic') trackDispatch(id);
        if (a === 'map-night') { S.night = !S.night; GeoMap.setNight(S.night); GMap.setNight(S.night); refreshMapBar(); }
      }
    });
    document.addEventListener('keydown', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName) && /^[1-5]$/.test(e.key) && !$('#fullSlot').innerHTML && !Wall.isOpen) preset(+e.key - 1); if (e.key === 'Enter' && e.target.id === 'plateQ') searchPlate(e.target.value); if (e.key === 'Escape') { if ($('#fullSlot').innerHTML) { FaceLab.close(); SceneLab.close(); SourceLab.close(); } else closeSheet(); } });
  }
  async function searchPlate(q) {
    if (!q || !q.trim()) { toast('Escribe una placa para buscar, por ejemplo P 512-884.', 'info'); return; }
    S.plateQuery = q; const res = await Api.searchPlate(q);
    let r = Api.state.reads.find((x) => x.plate === res.plate);
    if (!r) { const last = res.sightings[res.sightings.length - 1]; r = makeRead(res.plate, S.cameras.find((c) => c.id === last.cameraId), new Date(last.ts)); Api.state.reads.unshift(r); }
    if (S.view !== 'placas') go('placas'); else $('#railL').innerHTML = platesLeft();
    selectRead(r.id);
  }
  function makeRead(plate, cam, ts = new Date()) { const watch = MockDB.plateWatch[plate] || null; return { id: Gen.id('P'), plate, cameraId: cam.id, street: cam.street, ...Geo.eventPoint(cam, rnd(), true), ts, confidence: .9 + rnd() * .09, vehicle: Gen.vehicle(plate), watch, seed: Math.floor(rnd() * 1e6) }; } // el punto de lectura cae en la calzada, dentro del campo de visión

  return { S, toast, go, render, selectCamera, cursor, setMapMode, engine, coverage, locate, refreshMapBar, selectTraffic, selectTrack, trafficDispatch, trackDispatch, renderTabs, feedItem, readItem, faceItem, selectZone, selectRead, selectFace, dispatchZone, intercept, searchPlate, makeRead, banner, openAlert, tip, bind, zoneStatus, drawSpark, mandoLeft, feedPanel, crowdLeft, platesLeft, closeSheet };
})();
