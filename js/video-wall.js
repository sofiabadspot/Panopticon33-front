/* =====================================================================
   §8b WALL — muro de video: todas las cámaras del sector en una rejilla.
   Pensado para la videopared del centro de monitoreo y para el puesto
   del operador. Ideas tomadas de tableros de vigilancia abiertos (en
   especial God's Eye View): filtros visuales de imagen, salto a las
   cámaras vecinas de la que se observa, y estado honesto de cada señal.

   Regla de evidencia: una cámara con clip real lo reproduce; el resto
   muestra el logo de SPOTVISION en blanco y negro (ver Evidence, §7).
   En producción cada mosaico es el flujo en vivo de la cámara
   (WebRTC o HLS entregado por el servidor de video).
   ===================================================================== */
const Wall = (() => {
  const GRIDS = [[2, 2], [3, 3], [4, 3], [5, 4]];
  const LOOKS = [['normal', 'Normal'], ['flir', 'Térmico'], ['nvg', 'Nocturno']];
  const S = { open: false, filter: 'all', grid: 2, page: 0, look: 'normal', auto: false, focus: null, seen: false, timer: null, clock: null };
  const el = () => document.getElementById('wall');
  const cams = () => MockDB.cameras;
  /** Alerta abierta más grave de una cámara (o de su zona), o null. */
  function alertOf(c) {
    const list = Api.state.alerts.filter((a) => a.status === 'abierta' && (a.cameraId === c.id || (a.zoneId && a.zoneId === c.zoneId && UI.S.zones.find((z) => z.id === a.zoneId).cameras[0] === c.id)));
    return list.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1))[0] || null;
  }
  const hasVideo = (c) => c.status !== 'offline' && !!Evidence.clipFor(c.id);
  /** Orden del muro: primero lo que exige atención, luego lo que tiene video, luego el resto por identificador. */
  function ordered() {
    let list = cams().map((c) => ({ c, a: alertOf(c), v: hasVideo(c) }));
    if (S.filter === 'alert') list = list.filter((t) => t.a); if (S.filter === 'video') list = list.filter((t) => t.v);
    return list.sort((p, q) => (q.a ? (q.a.severity === 'critical' ? 2 : 1) : 0) - (p.a ? (p.a.severity === 'critical' ? 2 : 1) : 0) || (q.v ? 1 : 0) - (p.v ? 1 : 0) || p.c.id.localeCompare(q.c.id));
  }
  const coords = (c) => `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
  function feed(c, big) {
    if (c.status === 'offline') return `<div class="ph-ev off"><img src="${MEDIA.logo}" alt="SPOTVISION"><b>Sin señal</b><span>Técnico notificado</span></div>`;
    const clip = Evidence.clipFor(c.id);
    return clip ? `<video src="${clip.src}" poster="${clip.poster}" muted loop autoplay playsinline ${big ? 'controls' : ''}></video>` : Evidence.placeholder(big ? 'Señal en vivo no incluida en la demo' : '', '');
  }
  function tile({ c, a }) {
    return `<button class="wt ${a ? a.severity : ''} ${c.status}" data-wcam="${c.id}" title="${esc(c.street)}">
      <header>${Glyph.svg('cctv', 15)}<b>${c.id}</b><span class="st">${esc(c.street)}</span><i class="dot ${c.status === 'online' ? '' : c.status === 'degraded' ? 'yellow' : 'red'}"></i></header>
      <div class="feed look-${S.look}">${feed(c)}</div>
      ${a ? `<div class="al"><span class="ms">warning</span>${esc(a.title)}</div>` : ''}
      <footer><span>${coords(c)}</span><span>${c.status === 'offline' ? '— fps' : c.fps + ' fps'}</span><span class="wt-time"></span></footer></button>`;
  }
  function toolbar(total, pages) {
    const n = cams().length, live = cams().filter((c) => c.status !== 'offline').length, vid = cams().filter(hasVideo).length, al = cams().filter(alertOf).length;
    const seg = (items, cur, attr) => `<span class="seg">${items.map(([id, label]) => `<button class="${cur === id ? 'on' : ''}" data-${attr}="${id}">${label}</button>`).join('')}</span>`;
    return `<div class="w-bar">
      <div class="w-title"><h2>Muro de video</h2><span>${live} de ${n} cámaras con señal · ${vid} con video de demostración · ${al} con alerta</span></div>
      ${seg([['all', `Todas ${n}`], ['alert', `Con alerta ${al}`], ['video', `Con video ${vid}`]], S.filter, 'wfilter')}
      ${seg(GRIDS.map(([a, b], i) => [String(i), `${a}×${b}`]), String(S.grid), 'wgrid')}
      <span class="seg" title="Filtro de visualización sobre la imagen. No es un sensor térmico ni infrarrojo.">${LOOKS.map(([id, label]) => `<button class="${S.look === id ? 'on' : ''}" data-wlook="${id}">${label}</button>`).join('')}</span>
      <button class="btn secondary sm ${S.auto ? 'on' : ''}" data-waction="auto" title="Recorre las páginas del muro cada 7 segundos"><span class="ms">${S.auto ? 'pause' : 'autoplay'}</span>Ronda</button>
      <span class="w-pager"><button class="iconbtn" data-waction="prev" aria-label="Página anterior"><span class="ms">chevron_left</span></button><b>${total ? S.page + 1 : 0} / ${pages}</b><button class="iconbtn" data-waction="next" aria-label="Página siguiente"><span class="ms">chevron_right</span></button></span></div>`;
  }
  function render() {
    if (!S.open) return; if (S.focus) return renderFocus();
    const list = ordered(), [cols, rows] = GRIDS[S.grid], per = cols * rows, pages = Math.max(1, Math.ceil(list.length / per)); S.page = clamp(S.page, 0, pages - 1);
    const page = list.slice(S.page * per, S.page * per + per);
    el().innerHTML = toolbar(list.length, pages) + `<div class="w-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">${page.map(tile).join('') || `<div class="w-empty">${Evidence.placeholder(S.filter === 'alert' ? 'Ninguna cámara tiene alertas abiertas' : 'Ninguna cámara en este filtro', '')}</div>`}</div>`;
    tick();
  }
  /** Vista de una cámara: señal grande, datos, alertas y salto a las cámaras vecinas. */
  function renderFocus() {
    const c = cams().find((q) => q.id === S.focus), a = Api.state.alerts.filter((q) => q.cameraId === c.id).slice(0, 4);
    const near = cams().filter((q) => q.id !== c.id).map((q) => ({ q, d: Math.hypot(q.x - c.x, q.z - c.z) })).sort((p, q) => p.d - q.d).slice(0, 4);
    el().innerHTML = `<div class="w-bar"><button class="btn secondary sm" data-waction="back"><span class="ms">arrow_back</span>Volver al muro</button>
        <div class="w-title"><h2>${c.id} · ${esc(c.street)}</h2><span>${coords(c)}</span></div>
        <span class="seg" title="Filtro de visualización sobre la imagen. No es un sensor térmico ni infrarrojo.">${LOOKS.map(([id, label]) => `<button class="${S.look === id ? 'on' : ''}" data-wlook="${id}">${label}</button>`).join('')}</span></div>
      <div class="w-focus"><div class="wt big ${c.status}"><div class="feed look-${S.look}">${feed(c, true)}</div><footer><span>${Glyph.svg('cctv', 14)} ${c.id}</span><span>${coords(c)}</span><span class="wt-time"></span></footer></div>
        <aside>
          <dl class="details"><dt>Estado</dt><dd>${c.status === 'online' ? 'En línea' : c.status === 'degraded' ? 'Degradada' : 'Sin señal'}${c.status === 'offline' ? '' : ' · ' + c.fps + ' fps'}</dd><dt>Cómputo</dt><dd>${c.compute}</dd><dt>Análisis de SENTINEL</dt><dd>Multitudes · Placas · Rostros</dd><dt>Campo de visión</dt><dd>62° · alcance 200 m</dd></dl>
          <div><div class="caption" style="margin-bottom:8px">Alertas de esta cámara</div>${a.length ? `<ul class="list" style="border:1px solid var(--line);border-radius:10px;overflow:hidden">${a.map((q) => UI.feedItem(q)).join('')}</ul>` : '<div class="dim" style="font-size:13px">Sin alertas en este turno.</div>'}</div>
          <div><div class="caption" style="margin-bottom:8px">Cámaras vecinas</div><div class="mosaic">${near.map(({ q, d }) => `<button class="tile" data-wcam="${q.id}" title="${esc(q.street)}">${q.status === 'offline' ? Evidence.placeholder('Sin señal', '') : (Evidence.clipFor(q.id) ? `<video src="${Evidence.clipFor(q.id).src}" poster="${Evidence.clipFor(q.id).poster}" muted loop autoplay playsinline></video>` : Evidence.placeholder('', ''))}<span>${q.id} · ${Math.round(d)} m</span></button>`).join('')}</div></div>
          <button class="btn secondary" data-waction="map"><span class="ms">map</span>Ver en el mapa</button>
        </aside></div>`;
    tick();
  }
  function tick() { const t = hhmmss(new Date()); el().querySelectorAll('.wt-time').forEach((n) => { n.textContent = t; }); }
  /** Entrada tipo "reuniendo señales": se muestra una sola vez por sesión. */
  function collate(done) {
    const n = cams().length, vid = cams().filter(hasVideo).length;
    el().innerHTML = `<div class="w-collate"><div><h3>Reuniendo señales disponibles</h3><p>${n} cámaras del sector · ${vid} con video de demostración</p><div class="prog"><i id="wc1"></i></div><div class="prog" style="margin-top:8px"><i id="wc2"></i></div></div></div>`;
    requestAnimationFrame(() => { const a = $('#wc1'), b = $('#wc2'); if (a) { a.style.transition = 'width .9s ease'; a.style.width = '100%'; } if (b) { b.style.transition = 'width 1.2s ease .15s'; b.style.width = Math.round(vid / n * 100) + '%'; } });
    setTimeout(done, REDUCED ? 0 : 1500);
  }
  function open(focusId) {
    S.open = true; S.focus = focusId || null; document.body.classList.add('wall-on'); el().classList.remove('hidden'); Sfx.whoosh();
    clearInterval(S.clock); S.clock = setInterval(tick, 1000);
    if (!S.seen && !focusId) { S.seen = true; collate(render); } else render();
  }
  function close() { if (!S.open) return; S.open = false; S.focus = null; setAuto(false); clearInterval(S.clock); document.body.classList.remove('wall-on'); el().classList.add('hidden'); el().innerHTML = ''; }
  function setAuto(on) { S.auto = on; clearInterval(S.timer); if (on) S.timer = setInterval(() => { const [c, r] = GRIDS[S.grid], pages = Math.max(1, Math.ceil(ordered().length / (c * r))); S.page = (S.page + 1) % pages; render(); }, 7000); }
  function bind() {
    el().addEventListener('click', (e) => {
      const t = e.target.closest('[data-wcam],[data-wfilter],[data-wgrid],[data-wlook],[data-waction],[data-alert]'); if (!t) return; if (t.dataset.alert) { close(); return; } e.stopPropagation(); Sfx.tick();
      if (t.dataset.wcam) { S.focus = t.dataset.wcam; setAuto(false); }
      else if (t.dataset.wfilter) { S.filter = t.dataset.wfilter; S.page = 0; }
      else if (t.dataset.wgrid) { S.grid = +t.dataset.wgrid; S.page = 0; }
      else if (t.dataset.wlook) S.look = t.dataset.wlook;
      else if (t.dataset.waction === 'auto') setAuto(!S.auto);
      else if (t.dataset.waction === 'back') S.focus = null;
      else if (t.dataset.waction === 'map') { const id = S.focus; UI.go('mando'); UI.selectCamera(id); return; }
      else { const [c, r] = GRIDS[S.grid], pages = Math.max(1, Math.ceil(ordered().length / (c * r))); S.page = (S.page + (t.dataset.waction === 'next' ? 1 : pages - 1)) % pages; }
      render();
    });
    document.addEventListener('keydown', (e) => { if (!S.open || /INPUT|TEXTAREA/.test(e.target.tagName)) return; if (e.key === 'Escape' && S.focus) { S.focus = null; render(); } if (e.key === 'ArrowRight' && !S.focus) { S.page++; render(); } if (e.key === 'ArrowLeft' && !S.focus) { S.page--; render(); } });
  }
  return { open, close, render, bind, get isOpen() { return S.open; } };
})();
