/* =====================================================================
   §9b SOURCELAB — búsqueda de identidad en fuentes conectadas.
   El operador elige dónde buscar un rostro detectado: en las bases de
   datos institucionales o en fuentes abiertas (redes sociales). Cada
   fuente es un conector con estado propio.

   - Fuente conectada: se consulta y devuelve candidatos con puntaje.
   - Fuente por conectar: no se inventa ningún dato. Se muestra el logo de
     SPOTVISION en blanco y negro, la institución dueña del dato y cómo
     conectarla: base de datos, API o servidor MCP.

   Salvaguardas de diseño: motivo de consulta obligatorio, registro de
   auditoría de cada búsqueda, resultados como candidatos (nunca como
   identidad confirmada) y verificación humana antes de actuar.
   En producción: POST /v1/identity/search { faceId, sources, reason, caseId }.
   ===================================================================== */
const SourceLab = (() => {
  let face = null; const S = { scope: { inst: true, osint: false }, results: {}, running: false, drawer: null };
  const GROUPS = [['spotvision', 'SPOTVISION'], ['identidad', 'Identidad'], ['policial', 'Policial y judicial'], ['movilidad', 'Movilidad'], ['abiertas', 'Fuentes abiertas']];
  const list = () => MockDB.sources;
  const active = (s) => (s.group === 'abiertas' ? S.scope.osint : S.scope.inst);

  function win(s) {
    const r = S.results[s.id], on = active(s), demo = s.status === 'demo', connected = s.status === 'connected' || demo;
    let body;
    if (r && r.record) return recordWin(s, r.record);
    if (!connected) body = `<div class="src-ph">${Evidence.placeholder('', '')}</div><div class="src-inst"><b>${s.inst}</b><span>Aporta: ${s.gives}</span></div><button class="btn secondary xs" data-connect="${s.id}"><span class="ms">link</span>Cómo conectar</button>`;
    else if (r === 'run') body = `<div class="src-run"><span class="ms">progress_activity</span>Consultando…</div><div class="prog"><i style="width:70%"></i></div>`;
    else if (r && !r.length) body = `<div class="src-inst"><b>${s.inst}</b></div><div class="dim" style="font-size:12px">Sin coincidencias en esta fuente.</div>`;
    else if (r) body = `<div class="src-res">${r.map((c) => `<div class="row"><span class="mono">${c.ref}</span><span class="dim">${c.list}</span><b style="color:${c.score >= .85 ? '#ef6b62' : 'inherit'}">${Math.round(c.score * 100)} %</b></div>`).join('')}</div><div class="dim" style="font-size:11px">Candidatos sobre el umbral 0.85 requieren verificación humana.</div>`;
    else body = `<div class="src-inst"><b>${s.inst}</b><span>Aporta: ${s.gives}</span></div><div class="dim" style="font-size:12px">Lista para consultar.</div>`;
    return `<section class="src-win ${connected ? 'on' : 'off'} ${on ? '' : 'muted'} ${r === 'run' ? 'run' : ''}" data-src="${s.id}"><header><div><span class="grp">${GROUPS.find((g) => g[0] === s.group)[1]}</span><b>${s.name}</b></div><span class="chip ${demo ? 'medium' : connected ? 'ok' : 'neutral'}">${demo ? 'Muestra' : connected ? 'Conectada' : 'Por conectar'}</span></header><div class="bd">${body}</div></section>`;
  }
  /** Ventana de coincidencia: captura frente a registro, ficha y documento. Solo para el caso de demostración. */
  function recordWin(s, rec) {
    return `<section class="src-win on hit" data-src="${s.id}"><header><div><span class="grp">Identidad · coincidencia</span><b>${s.name}</b></div><span class="chip medium">Muestra</span></header>
      <div class="bd">
        <div class="dummy"><span class="ms">info</span><div><b>Ejemplo con datos ficticios (data dummy).</b> No es una persona identificada ni un registro oficial: muestra cómo se vería una coincidencia con una base conectada.</div></div>
        <div class="cmp"><figure><img src="${MEDIA.demo.face}" alt="Rostro captado"><figcaption>Captado · ${face.cameraId}</figcaption></figure>
          <div class="score"><b>${Math.round(rec.score * 100)} %</b><span>similitud</span><i></i></div>
          <figure><img src="${MEDIA.demo.portrait}" alt="Fotografía del registro"><figcaption>Registro · ${rec.ref}</figcaption></figure></div>
        <dl class="details"><dt>Nombre</dt><dd>${rec.name}</dd><dt>Número de identificación</dt><dd class="mono">${rec.ref}</dd><dt>Fecha de nacimiento</dt><dd>${rec.dob}</dd><dt>Nacionalidad</dt><dd>${rec.nat}</dd><dt>Vencimiento del documento</dt><dd>${rec.exp}</dd></dl>
        <div><div class="caption" style="margin-bottom:6px">Documento en el registro</div><img class="iddoc" src="${MEDIA.demo.id}" alt="Documento de identificación de muestra"></div>
        <div class="locked"><span class="ms">verified_user</span>Es un candidato. La identidad se confirma por un analista antes de cualquier acción.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" data-verdict="confirm"><span class="ms">check</span>Enviar a verificación</button><button class="btn secondary sm" data-verdict="discard">Descartar</button></div>
      </div></section>`;
  }
  function canvas() {
    const c = $('#srcCanvas'); if (!c) return;
    c.innerHTML = `<svg id="srcLines" aria-hidden="true"></svg><div class="src-wins">${list().map(win).join('')}</div>`;
    requestAnimationFrame(lines);
  }
  /** Líneas de conexión: del sujeto a cada fuente. Continua y lima = conectada; punteada y gris = por conectar. */
  function lines() {
    const c = $('#srcCanvas'), svg = $('#srcLines'); if (!c || !svg) return; const cr = c.getBoundingClientRect();
    svg.setAttribute('width', c.scrollWidth); svg.setAttribute('height', c.scrollHeight);
    const busX = 14; let paths = '', minY = 1e9, maxY = 0;
    c.querySelectorAll('.src-win').forEach((w) => {
      const r = w.getBoundingClientRect(), x = r.left - cr.left + c.scrollLeft + r.width / 2, top = r.top - cr.top + c.scrollTop, gy = top - 10;
      minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
      const cls = w.classList.contains('muted') ? 'mut' : w.classList.contains('run') ? 'run' : w.classList.contains('on') ? 'on' : 'off';
      paths += `<path class="${cls}" d="M${busX} ${gy} H${x} V${top}"/><circle class="${cls}" cx="${x}" cy="${top}" r="3"/>`;
    });
    const mid = Math.min(c.clientHeight / 2, maxY);
    svg.innerHTML = `<path class="bus" d="M0 ${mid} H${busX} M${busX} ${minY} V${Math.max(maxY, mid)}"/>` + paths;
  }
  function left() {
    const cam = UI.S.cameras.find((c) => c.id === face.cameraId), n = list().filter((s) => s.group !== 'abiertas').length, con = list().filter((s) => s.status === 'connected').length;
    return `<div><div class="caption" style="margin-bottom:8px">Rostro detectado</div>${face.demo ? `<div class="crop scan demo"><img src="${MEDIA.demo.face}" alt="Rostro captado"></div><div style="margin-top:8px">${Evidence.demoFrame()}</div>` : `<div class="crop scan">${Evidence.placeholder('', `${face.id} · calidad ${face.quality.toFixed(2)}`)}</div>`}</div>
      <dl class="details"><dt>Cámara</dt><dd>${face.cameraId}</dd><dt>Cruce</dt><dd>${esc(cam.street)}</dd><dt>Coordenadas</dt><dd class="mono">${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}</dd><dt>Hora</dt><dd class="mono">${hhmmss(face.ts)}</dd></dl>
      <div><div class="caption" style="margin-bottom:8px">Dónde buscar</div>
        <label class="scope ${S.scope.inst ? 'on' : ''}"><input type="checkbox" data-scope="inst" ${S.scope.inst ? 'checked' : ''}><span class="ms">account_balance</span><div><b>Bases de datos institucionales</b><span>${con} conectada y 1 de muestra, de ${n} · registros oficiales</span></div></label>
        <label class="scope ${S.scope.osint ? 'on' : ''}"><input type="checkbox" data-scope="osint" ${S.scope.osint ? 'checked' : ''}><span class="ms">public</span><div><b>Redes sociales y fuentes abiertas</b><span>Por conectar · requiere proveedor autorizado</span></div></label></div>
      <div><div class="caption" style="margin-bottom:8px">Motivo de la consulta (obligatorio)</div><input class="fld" id="srcReason" placeholder="Ej.: verificación de candidato en lista de búsqueda" autocomplete="off"><input class="fld" id="srcCase" placeholder="Número de caso o expediente" autocomplete="off" style="margin-top:8px"></div>
      <button class="btn primary" id="srcGo"><span class="ms">search</span>Buscar identidad</button>
      <div class="locked"><span class="ms">verified_user</span>Cada búsqueda queda en auditoría con el operador, el motivo y las fuentes consultadas.</div>`;
  }
  /** Panel "Cómo conectar": los tres caminos técnicos para una fuente, con lo que hay que pedir a la institución. */
  function drawer(id) {
    const s = list().find((q) => q.id === id), d = $('#srcDrawer'); if (!s || !d) return; S.drawer = id; const slug = s.id;
    const osint = s.group === 'abiertas';
    d.innerHTML = `<header><div><span class="grp">Conectar fuente</span><h3>${s.name}</h3><div class="dim" style="font-size:12px">${s.inst}</div></div><button class="iconbtn" data-drawer-close aria-label="Cerrar"><span class="ms">close</span></button></header>
      <div class="bd">
        <div class="src-ph wide">${Evidence.placeholder('Sin conexión', 'No se muestra información hasta conectar la fuente')}</div>
        <div><div class="caption">Qué aportaría</div><p>${s.gives}.</p><div class="caption" style="margin-top:10px">Campos mínimos</div><p class="mono" style="font-size:12px">${s.fields.join(' · ')}</p></div>
        ${osint ? '<div class="callout warn"><span class="ms">gavel</span><div>Las redes sociales prohíben en sus condiciones la extracción automática de rostros. Esta fuente solo puede conectarse mediante un proveedor autorizado y con la base legal que defina el Ministerio.</div></div>' : ''}
        <div class="caption">Tres formas de conectarla</div>
        ${osint ? '' : `<details open><summary><span class="ms">database</span>Base de datos<span class="dim">Réplica o vista de solo lectura</span></summary><p>La institución expone una vista de solo lectura dentro de la red del Ministerio. Es la opción más rápida cuando ambas instituciones comparten red.</p><pre>conector: ${slug}
tipo: base_de_datos
motor: postgresql | oracle | sqlserver
host: &lt;servidor en la red del Ministerio&gt;
usuario: svc_panopticon_lectura
vista: v_${slug}_consulta
campos: [${s.fields.join(', ')}]</pre></details>`}
        <details ${osint ? 'open' : ''}><summary><span class="ms">api</span>API<span class="dim">Servicio web de la institución</span></summary><p>Una API es un servicio que responde consultas puntuales sin entregar la base completa. Es la opción recomendada entre instituciones distintas, porque cada consulta queda registrada en ambos lados.</p><pre>conector: ${slug}
tipo: api
url_base: https://&lt;institución&gt;/api/v1
autenticacion: oauth2_credenciales_de_cliente | mtls
operaciones:
  - POST /personas/buscar-por-rostro
  - GET  /personas/{id}
limite: 60 consultas por minuto</pre></details>
        <details><summary><span class="ms">hub</span>MCP<span class="dim">Para que Jules consulte por el operador</span></summary><p>MCP (Model Context Protocol) es un estándar abierto que permite a un agente de IA, en este caso Jules, usar un sistema externo con permisos definidos. La institución publica un servidor MCP y Jules consulta con los permisos del operador que pregunta.</p><pre>conector: ${slug}
tipo: mcp
servidor: https://&lt;institución&gt;/mcp
herramientas: [buscar_persona_por_rostro, consultar_registro]
permisos: los del operador que consulta</pre></details>
        <div><div class="caption">Requisitos previos</div><ul class="req"><li>Convenio o base legal entre el Ministerio y ${osint ? 'el proveedor' : 'la institución'}.</li><li>Responsable técnico designado en cada lado.</li><li>Credencial de servicio de solo lectura.</li><li>Registro de auditoría compartido.</li></ul></div>
      </div>
      <footer><button class="btn primary sm" data-connect-request="${s.id}"><span class="ms">send</span>Registrar solicitud de conexión</button></footer>`;
    d.classList.add('open');
  }
  async function run() {
    const reason = $('#srcReason').value.trim(); if (!reason) { UI.toast('Escribe el motivo de la consulta. Es obligatorio para buscar una identidad.', 'edit_note'); $('#srcReason').focus(); return; }
    if (!S.scope.inst && !S.scope.osint) { UI.toast('Elige al menos un tipo de fuente para buscar.', 'info'); return; }
    S.running = true; S.results = {}; const targets = list().filter(active); targets.filter((s) => s.status !== 'pending').forEach((s) => { S.results[s.id] = 'run'; }); canvas(); Sfx.whoosh();
    const out = await Api.searchIdentity(face, { sources: targets.map((s) => s.id), reason, caseId: $('#srcCase').value.trim() });
    Object.assign(S.results, out); S.running = false; canvas(); Sfx.confirm();
    const pend = targets.filter((s) => s.status === 'pending').length;
    $('#srcSummary').innerHTML = `${face.demo ? '<span class="chip medium">Ejemplo · datos ficticios</span>' : ''}<span class="chip ok">${targets.length - pend} fuentes consultadas</span><span class="chip neutral">${pend} por conectar</span>`;
  }
  function open(f) {
    face = f; S.results = {}; S.drawer = null; Sfx.whoosh(); UI.closeSheet();
    $('#fullSlot').innerHTML = `<section class="full" role="dialog" aria-label="Búsqueda de identidad">
      <header class="f-hd"><span class="ms" style="color:var(--ink-muted)">person_search</span><h2>Búsqueda de identidad · ${f.id}</h2><span class="muted" style="font-size:13px">${f.cameraId} · ${hhmmss(f.ts)}</span>
        <div class="right"><span id="srcSummary" style="display:flex;gap:6px"></span><button class="iconbtn" data-close-full aria-label="Cerrar"><span class="ms">close</span></button></div></header>
      <div class="f-bd src-grid"><aside id="srcLeft">${left()}</aside><div class="src-canvas" id="srcCanvas"></div><aside class="src-drawer" id="srcDrawer"></aside></div></section>`;
    const root = $('#fullSlot .full');
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-close-full],[data-connect],[data-drawer-close],[data-connect-request],[data-verdict],#srcGo'); if (!t) return;
      if (t.dataset.verdict) { Api.audit(t.dataset.verdict === 'confirm' ? 'Coincidencia enviada a verificación humana' : 'Coincidencia descartada', `${face.id} · ${MockDB.demoCase.record.ref} · datos ficticios`); return; }
      if (t.hasAttribute('data-close-full')) close();
      else if (t.dataset.connect) { drawer(t.dataset.connect); Sfx.select(); }
      else if (t.hasAttribute('data-drawer-close')) $('#srcDrawer').classList.remove('open');
      else if (t.dataset.connectRequest) { const s = list().find((q) => q.id === t.dataset.connectRequest); Api.audit('Solicitud de conexión de fuente', s.inst); $('#srcDrawer').classList.remove('open'); }
      else if (t.id === 'srcGo') run();
    });
    root.addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.scope; if (!k) return; S.scope[k] = e.target.checked; e.target.closest('.scope').classList.toggle('on', e.target.checked); canvas(); });
    if (f.demo) $('#srcReason').value = 'Demostración con datos ficticios';
    canvas(); window.addEventListener('resize', lines);
  }
  function close() { window.removeEventListener('resize', lines); $('#fullSlot').innerHTML = ''; }
  return { open, close };
})();
