'use strict';
/* =====================================================================
   §13 OPERACIÓN — Jules copiloto, cola de incidentes y modos de uso.
   Propuesta UX del 20/11 (docs/propuesta-ux.html):
   · P1 Jules avisa: frase del momento arriba y avisos con su voz y
     acciones fijas según el tipo de alerta.
   · P5 Cola de incidentes con ciclo de vida: Nueva → Asignada →
     En atención → Cerrada, tiempo en cada estado y orden por urgencia.
   · P2 Dos modos: Ministro (territorio y tendencias) y Operador 911
     (cola, video y despacho).
   Usa las mismas funciones que el resto de la consola (UI.dispatchZone,
   UI.intercept…): no hay un camino paralelo hacia MAIC.
   ===================================================================== */
const Ops = (() => {
  const SEV_W = { critical: 3, medium: 2, low: 1 };
  const SEV_LABEL = { critical: 'Crítica', medium: 'Media', low: 'Baja' };
  const STAGES = { nueva: 'Nueva', asignada: 'Asignada', atencion: 'En atención', cerrada: 'Cerrada' };
  const STAGE_ORDER = { nueva: 0, asignada: 1, atencion: 2, cerrada: 3 };
  /** Minutos que puede esperar un incidente en cada estado antes de ponerse en rojo. */
  const SLA = { nueva: { critical: 2, medium: 5, low: 15 }, asignada: { critical: 5, medium: 10, low: 30 } };
  const ICON = { crowd: 'groups', plate: 'directions_car', face: 'face', camera: 'videocam_off', traffic: 'car_crash', track: 'person_search' };

  const S = { mode: 'ministro', sel: null, since: {}, notices: new Map(), briefKey: '', t0: Date.now() };
  try { S.mode = localStorage.getItem('p33-mode') || 'ministro'; } catch (e) { /* sin almacenamiento: queda el modo por defecto */ }

  const alerts = () => Api.state.alerts;
  const byId = (id) => alerts().find((a) => a.id === id);
  const mark = (s) => window.JulesMark && window.JulesMark.state(s);
  const zoneOf = (a) => UI.S.zones.find((z) => z.id === a.zoneId);

  /* ---------- Ciclo de vida ---------- */
  function stage(a) {
    const st = a.status === 'cerrada' ? 'cerrada' : a.status === 'en atención' ? 'atencion' : a.assigned ? 'asignada' : 'nueva';
    const k = S.since[a.id];
    // Las alertas que ya estaban al abrir la consola cuentan desde el inicio del turno simulado
    // (como mucho 1 minuto antes), para que la demo no arranque con todo fuera de tiempo.
    if (!k || k.stage !== st) S.since[a.id] = { stage: st, at: k ? Date.now() : Math.max(+a.ts, S.t0 - 60000) };
    return st;
  }
  const waited = (a) => (Date.now() - S.since[a.id].at) / 60000;
  function overdue(a) { const st = stage(a); const lim = SLA[st] && SLA[st][a.severity]; return lim ? waited(a) > lim : false; }
  function urgency(a) { const st = stage(a); const lim = (SLA[st] && SLA[st][a.severity]) || 30; return SEV_W[a.severity] * (1 + waited(a) / lim); }
  function queue(includeClosed) {
    return alerts().filter((a) => includeClosed || stage(a) !== 'cerrada')
      // Primero el estado (lo nuevo arriba), después el nivel (una crítica nunca queda debajo de
      // una media) y, dentro del mismo nivel, la urgencia: cuánto lleva esperando frente a su límite.
      .sort((a, b) => STAGE_ORDER[stage(a)] - STAGE_ORDER[stage(b)] || SEV_W[b.severity] - SEV_W[a.severity] || urgency(b) - urgency(a));
  }
  const clock = (min) => { const s = Math.max(0, Math.round(min * 60)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  /* ---------- La voz de Jules ----------
     Cada aviso se dice como lo diría una persona en la sala: qué pasa, dónde
     y qué propone. Las acciones son fijas por tipo (siempre hay opción manual). */
  function voice(a) {
    if (a.type === 'crowd') {
      const z = zoneOf(a); if (!z) return esc(a.title);
      const near = City.nearestUnits(z.x, z.z, 8).length;
      return `${esc(z.name)} está ${Math.round((z.est / z.planned - 1) * 100)} % sobre lo previsto: ${fmt(z.est)} personas. Hay ${Math.min(near, z.officers || 2)} unidades en la zona. ¿Envío refuerzos?`;
    }
    if (a.type === 'plate') return `${esc(a.title.split('·')[0].trim())}: <b class="mono">${esc((a.title.split('·')[1] || '').trim())}</b>, última lectura en ${esc(a.cameraId)}. ¿Pido a MAIC interceptarla?`;
    if (a.type === 'face') return `Hay un candidato en lista en ${esc(a.cameraId)}. Es un parecido, no una identidad: necesita la verificación de un analista.`;
    if (a.type === 'traffic') return `${esc(a.title)} en ${esc(a.cameraId || '')}. Tengo el clip de evidencia. ¿Lo envío a MAIC?`;
    if (a.type === 'camera') return `${esc(a.title)}. Deja un tramo sin cobertura; puedo avisar al técnico y mostrarte las cámaras vecinas.`;
    if (a.type === 'track') return `Sigo a la persona ${esc(a.refId || '')} entre cámaras. ¿Envío su última posición a MAIC?`;
    return esc(a.title);
  }

  /** Acciones fijas por tipo. La primera es la que propone Jules. */
  const ACTIONS = {
    crowd: [
      { id: 'refuerzos', label: 'Enviar refuerzos', run: async (a) => { const z = zoneOf(a); const d = await UI.dispatchZone(a.zoneId); if (d && z) { City.dispatchUnits(d.units, z, 9); City.pulse(z.x, z.z, COLOR.primary, 1); return `${d.units.length} unidades en camino a ${z.name}`; } return 'La zona ya estaba en atención'; } },
      { id: 'camaras', label: 'Ver cámaras', run: async (a) => { const z = zoneOf(a); if (!z) return; City.flyTo(z.x, z.z, 620, .7); z.cameras.forEach((cid) => { const c = UI.S.cameras.find((q) => q.id === cid); if (c) City.pulse(c.x, c.z, COLOR.muted, .3); }); return `${z.cameras.length} cámaras marcadas en el mapa`; } },
      { id: 'cubierto', label: 'Ya está cubierto', close: true },
    ],
    plate: [
      { id: 'interceptar', label: 'Pedir intercepción', run: async (a) => { await UI.intercept(a.refId); return 'MAIC alertó a 3 unidades'; } },
      { id: 'seguir', label: 'Seguir la placa', open: true },
      { id: 'descartar', label: 'Descartar', close: true },
    ],
    face: [
      { id: 'verificar', label: 'Verificar', open: true },
      { id: 'no-es', label: 'No es la persona', close: true },
    ],
    traffic: [
      { id: 'maic', label: 'Enviar a MAIC', run: async (a) => { await UI.trafficDispatch(a.refId); return 'Evento y clip enviados a MAIC'; } },
      { id: 'ver', label: 'Ver clip', open: true },
      { id: 'descartar', label: 'Descartar', close: true },
    ],
    camera: [
      { id: 'tecnico', label: 'Avisar a técnico', assign: true, run: async (a) => `Técnico notificado para ${a.cameraId}` },
      { id: 'vecinas', label: 'Ver cámaras vecinas', run: async (a) => { UI.go('muro', { focus: a.cameraId }); return ''; } },
    ],
    track: [
      { id: 'posicion', label: 'Enviar última posición', run: async (a) => { await UI.trackDispatch(a.refId); return 'Última posición enviada a MAIC'; } },
      { id: 'recorrido', label: 'Ver recorrido', open: true },
    ],
  };
  const actionsFor = (a) => ACTIONS[a.type] || [{ id: 'ver', label: 'Ver', open: true }];

  async function act(id, actionId) {
    const a = byId(id); if (!a) return; const ac = actionsFor(a).find((x) => x.id === actionId); if (!ac) return;
    dismissNotice(id);
    if (ac.close) { a.status = 'cerrada'; Api.audit && Api.audit(`Cerrado por operador: ${ac.label}`, a.title); refresh(); UI.toast(`${ac.label} · ${a.title}`, 'check'); return; }
    if (ac.open) { UI.openAlert(id); refresh(); return; }
    a.assigned = a.assigned || 'OP'; mark('think');
    const msg = await ac.run(a); mark('speak');
    if (msg) UI.toast(`<span class="toast-jules">Jules</span> ${msg}`, 'auto_awesome', 'primary');
    setTimeout(() => mark('idle'), 1600);
    refresh();
  }
  function take(id) { const a = byId(id); if (!a || stage(a) !== 'nueva') return; a.assigned = 'OP'; refresh(); UI.toast(`Tomaste el incidente · ${a.title}`, 'person'); }

  /* ---------- Frase del momento (P1) ---------- */
  function brief() {
    const open = queue();
    const top = open.find((a) => stage(a) === 'nueva' && a.severity === 'critical');
    const cams = UI.S.cameras, on = cams.filter((c) => c.status === 'online').length;
    if (top) return { key: top.id, text: voice(top), alert: top, tone: 'critical' };
    const pend = open.filter((a) => stage(a) === 'nueva');
    if (pend.length) { const old = pend.reduce((m, a) => (waited(a) > waited(m) ? a : m)); return { key: 'pend' + pend.length, text: `${pend.length === 1 ? 'Hay 1 aviso' : `Hay ${pend.length} avisos`} por revisar; el más antiguo espera hace ${clock(waited(old))}. Nada crítico sin atender.`, alert: old, tone: 'medium' }; }
    const units = [...City.unitObjs.values()].length;
    return { key: 'ok', text: `Todo en orden. ${on} de ${cams.length} cámaras en línea y ${units} unidades en el sector.`, tone: 'ok' };
  }
  function renderBrief(force) {
    const el = $('#brief'); if (!el) return; const b = brief();
    const key = b.key + '|' + b.text.length; if (!force && key === S.briefKey) return; S.briefKey = key;
    const ac = b.alert && b.alert.severity === 'critical' ? actionsFor(b.alert)[0] : null;
    el.className = 'brief ' + b.tone;
    el.innerHTML = `<span class="jg" data-jules-mark style="--jg-size:22px"></span>
      <p class="brief-t"><span class="brief-who">Jules</span>${b.text}</p>
      ${ac ? `<button class="btn xs ${b.tone === 'critical' ? 'danger' : 'secondary'}" data-ops-act="${b.alert.id}" data-ops-action="${ac.id}">${ac.label}</button>` : ''}
      ${b.alert ? `<button class="btn xs ghost" data-ops-focus="${b.alert.id}">Ver</button>` : ''}`;
  }

  /* ---------- Avisos de Jules (reemplazan al banner) ---------- */
  function notice(a) {
    if (S.notices.has(a.id)) return; const slot = $('#noticeSlot'); if (!slot) return;
    const el = document.createElement('section'); el.className = `notice ${a.severity}`; el.setAttribute('role', 'alert'); el.dataset.notice = a.id;
    const acts = actionsFor(a);
    el.innerHTML = `<header><span class="jg" data-jules-mark style="--jg-size:20px"></span><span class="n-who">Jules</span><span class="sevtag ${a.severity}"><i></i>${SEV_LABEL[a.severity]}</span><span class="n-time mono">${hhmm(a.ts)}</span><button class="iconbtn sm" data-ops-dismiss="${a.id}" aria-label="Ahora no"><span class="ms">close</span></button></header>
      <div class="n-body">${thumb(a)}<p>${voice(a)}</p></div>
      <div class="n-acts">${acts.map((x, i) => `<button class="btn xs ${i === 0 ? (a.severity === 'critical' ? 'danger' : 'primary') : 'secondary'}" data-ops-act="${a.id}" data-ops-action="${x.id}">${x.label}</button>`).join('')}</div>`;
    slot.prepend(el); S.notices.set(a.id, el);
    while (slot.children.length > 2) { const last = slot.lastElementChild; S.notices.delete(last.dataset.notice); last.remove(); }
    mark('listen'); setTimeout(() => mark('idle'), 2400);
    // Lo crítico queda hasta resolverse; lo demás se va solo y sigue en la cola.
    if (a.severity !== 'critical') setTimeout(() => dismissNotice(a.id), 9000);
  }
  function dismissNotice(id) { const el = S.notices.get(id); if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 180); S.notices.delete(id); } }

  /* ---------- Cola de incidentes (P5) ---------- */
  function thumb(a) {
    const clip = a.cameraId && Evidence.clipFor(a.cameraId);
    if (clip) return `<span class="q-thumb"><img src="${clip.poster}" alt=""></span>`;
    if (a.type === 'face') { const f = Api.state.faces.find((q) => q.id === a.refId); if (f && f.crop) return `<span class="q-thumb"><img src="${f.crop}" alt=""></span>`; }
    return `<span class="q-thumb icon"><span class="ms">${ICON[a.type] || 'priority_high'}</span></span>`;
  }
  function qItem(a, compact) {
    const st = stage(a), sel = S.sel === a.id, over = overdue(a);
    return `<li class="q-item ${sel ? 'sel' : ''} st-${st}" data-q="${a.id}" tabindex="-1">
      ${thumb(a)}
      <div class="q-main">
        <div class="q-t"><span class="sevtag ${a.severity}" title="${SEV_LABEL[a.severity]}"><i></i></span>${esc(a.title)}</div>
        <div class="q-s">${esc(a.sub)}</div>
        <div class="q-meta"><span class="stage ${st}">${STAGES[st]}</span><span class="q-timer mono ${over ? 'over' : ''}" data-timer="${a.id}">${clock(waited(a))}</span>${over ? '<span class="q-over">fuera de tiempo</span>' : ''}</div>
        ${sel && !compact ? `<div class="q-acts">${actionsFor(a).map((x, i) => `<button class="btn xs ${i === 0 ? (a.severity === 'critical' ? 'danger' : 'primary') : 'secondary'}" data-ops-act="${a.id}" data-ops-action="${x.id}">${x.label}</button>`).join('')}${st === 'nueva' ? `<button class="btn xs ghost" data-ops-take="${a.id}">Tomar</button>` : ''}</div>` : ''}
      </div></li>`;
  }
  function counts() { const c = { nueva: 0, asignada: 0, atencion: 0, cerrada: 0 }; alerts().forEach((a) => { c[stage(a)]++; }); return c; }
  function stageBar(c) { return `<div class="q-stages">${['nueva', 'asignada', 'atencion'].map((k) => `<span class="${k}"><b>${c[k]}</b>${STAGES[k]}</span>`).join('')}<span class="cerrada"><b>${c.cerrada}</b>Cerradas</span></div>`; }
  /** Modo Operador: la cola completa, con acciones y atajos. */
  function queuePanel() {
    const list = queue(), c = counts();
    return `<section class="panel flush q-panel" id="qPanel">
      <div class="hd"><div><h3>Cola de incidentes</h3><div class="sub">Lo nuevo primero · por nivel y tiempo esperando</div></div></div>
      ${stageBar(c)}
      <ul class="list q-list" id="qList">${list.length ? list.map((a) => qItem(a)).join('') : '<li class="q-empty">Sin incidentes abiertos. Jules te avisa apenas llegue uno.</li>'}</ul>
      <div class="q-keys mono"><kbd>J</kbd><kbd>K</kbd> moverse · <kbd>D</kbd> acción de Jules · <kbd>T</kbd> tomar · <kbd>Enter</kbd> detalle · <kbd>X</kbd> cerrar</div>
    </section>`;
  }
  /** Modo Ministro: lo que pide atención, sin repetir la lista entera. */
  function summaryPanel() {
    const list = queue().slice(0, 5), c = counts();
    return `<section class="panel flush q-panel" id="qPanel">
      <div class="hd"><div><h3>Lo que pide atención</h3><div class="sub">Las 5 más urgentes de ${c.nueva + c.asignada + c.atencion} abiertas</div></div><button class="btn xs ghost" data-ops-mode="operador">Ver cola</button></div>
      ${stageBar(c)}
      <ul class="list q-list" id="qList">${list.length ? list.map((a) => qItem(a, true)).join('') : '<li class="q-empty">Nada pendiente. Todo en orden.</li>'}</ul>
    </section>`;
  }

  function refresh() {
    if (UI.S.view === 'mando') {
      const p = $('#qPanel'); if (p) { const html = S.mode === 'operador' ? queuePanel() : summaryPanel(); const tmp = document.createElement('div'); tmp.innerHTML = html; p.replaceWith(tmp.firstElementChild); }
      const k = $('#k-open'); if (k) k.textContent = alerts().filter((a) => stage(a) !== 'cerrada').length;
    }
    renderBrief(true); UI.renderTabs();
    if (typeof City.syncIncidents === 'function') { City.syncIncidents(alerts()); GeoMap.syncIncidents(alerts()); GMap.syncIncidents(alerts(), UI.locate); }
  }
  function tick() {
    document.querySelectorAll('[data-timer]').forEach((el) => { const a = byId(el.dataset.timer); if (!a) return; el.textContent = clock(waited(a)); el.classList.toggle('over', overdue(a)); });
    renderBrief();
  }

  function focus(id, fly = true) {
    const a = byId(id); if (!a) return; S.sel = id; refresh();
    const loc = UI.locate(a); if (fly && loc) { City.flyTo(loc.x, loc.z, 750, .8); City.pulse(loc.x, loc.z, a.severity === 'critical' ? COLOR.red : COLOR.yellow, .6); }
    const el = document.querySelector(`[data-q="${id}"]`); if (el) { el.scrollIntoView({ block: 'nearest' }); el.focus({ preventScroll: true }); }
  }
  function move(step) { const list = queue(); if (!list.length) return; const i = list.findIndex((a) => a.id === S.sel); focus(list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + step))].id); }

  /* ---------- Modos (P2) ---------- */
  function setMode(m) {
    S.mode = m; try { localStorage.setItem('p33-mode', m); } catch (e) { /* sin almacenamiento */ }
    document.body.dataset.mode = m; renderModeSeg();
    if (UI.S.view !== 'mando') UI.go('mando'); else UI.render();
    UI.toast(m === 'operador' ? 'Modo Operador 911: cola, video y despacho' : 'Modo Ministro: territorio, tendencias y lo que pide atención', m === 'operador' ? 'support_agent' : 'public');
  }
  function renderModeSeg() { const el = $('#modeSeg'); if (el) el.innerHTML = [['ministro', 'Ministro'], ['operador', 'Operador 911']].map(([k, l]) => `<button data-ops-mode="${k}" class="${S.mode === k ? 'on' : ''}" aria-pressed="${S.mode === k}">${l}</button>`).join(''); }

  function bind() {
    document.body.dataset.mode = S.mode; renderModeSeg(); renderBrief(true);
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ops-act],[data-ops-mode],[data-ops-dismiss],[data-ops-focus],[data-ops-take],[data-q]'); if (!t) return;
      e.stopPropagation();
      if (t.dataset.opsAct) act(t.dataset.opsAct, t.dataset.opsAction);
      else if (t.dataset.opsMode) setMode(t.dataset.opsMode);
      else if (t.dataset.opsDismiss) dismissNotice(t.dataset.opsDismiss);
      else if (t.dataset.opsTake) take(t.dataset.opsTake);
      else if (t.dataset.opsFocus) { if (S.mode !== 'operador') setMode('operador'); focus(t.dataset.opsFocus); }
      else if (t.dataset.q) focus(t.dataset.q);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName) || S.mode !== 'operador' || UI.S.view !== 'mando' || $('#fullSlot').innerHTML) return;
      const k = e.key.toLowerCase(); const a = byId(S.sel);
      if (k === 'j' || k === 'arrowdown') { e.preventDefault(); move(1); }
      else if (k === 'k' || k === 'arrowup') { e.preventDefault(); move(-1); }
      else if (a && k === 'd') act(a.id, actionsFor(a)[0].id);
      else if (a && k === 't') take(a.id);
      else if (a && k === 'enter') UI.openAlert(a.id);
      else if (a && k === 'x') { const c = actionsFor(a).find((x) => x.close); if (c) act(a.id, c.id); }
    });
    Api.on('alerts', (a) => { refresh(); if (a.severity === 'critical' || S.mode === 'operador') notice(a); });
    Api.on('maic', () => refresh());
    setInterval(tick, 1000);
  }

  return { S, bind, refresh, queuePanel, summaryPanel, notice, voice, actionsFor, act, stage, setMode, renderBrief };
})();
