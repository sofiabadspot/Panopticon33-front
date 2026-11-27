/* Buscador de la consola: zonas, alertas, placas, cámaras, calles, eventos y unidades.
   Elegir un resultado lo abre en el lugar (ficha o panel) y mueve el mapa hacia él.
   Guarda las búsquedas recientes de cada rol en este navegador. Atajo: / o ⌘K. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { canOpenStory, forOperator, grantVehicle, inScope, storyPlates, useApi } from '../api';
import { UNKNOWN_FACES, useFacial } from '../api/facial';
import { normalizePlate } from '../api/format';
import { KIND_LABEL, KIND_PHRASE } from '../api/labels';
import { useSession } from '../shell/session';
import { Icon } from '../ui/kit';
import { useConsole, type Recent } from './ctx';
import { useOpenStory } from './story/OpenStory';
import { usePermissions } from './permissions';

interface Result { group: string; icon: string; label: string; sub?: string; ref: string; run: () => void }

const PLATE_RE = /^[A-Z?*]{1,2}\s?[0-9?*][0-9A-Z?*-]{1,7}$/i;

export function Search() {
  const { role, user } = useSession();
  const perm = usePermissions();
  const c = useConsole();
  const investigations = useApi((s) => s.investigations);
  /* Ficha de vehículo: con una investigación abierta, su motivo la cubre; si no, la ficha pide motivo. */
  const openVehicle = (plate: string) => {
    const inv = investigations.find((x) => x.id === c.invId);
    if (inv) grantVehicle(plate, inv.reason, user, `Abrir ficha de vehículo · ${inv.id}`);
    c.open({ k: 'vehiculo', id: plate });
  };
  const zones = useApi((s) => s.zones);
  const alerts = useApi((s) => s.alerts);
  const cameras = useApi((s) => s.cameras);
  const events = useApi((s) => s.events);
  const units = useApi((s) => s.units);
  /* Historias: solo el analista. De una persona de lista, nunca de una coincidencia descartada. */
  const faces = useFacial();
  const openStory = useOpenStory();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, select, textarea');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', k); window.addEventListener('mousedown', out);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('mousedown', out); };
  }, []);

  const results = useMemo<Result[]>(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const has = (s: string) => s.toLowerCase().includes(t);
    const out: Result[] = [];
    const np = normalizePlate(q);
    /* Historias primero (analista): placas reales que coinciden con lo escrito, aunque sea a medias, y personas.
       Elegir una abre la historia y la reproduce. */
    if (perm.has('investigar')) {
      for (const p of storyPlates(q.replace(/[*?]/g, '')))
        out.push({ group: 'Investigar', icon: 'route', label: `Investigar ${p.plate}`, sub: `${p.reads} ${p.reads === 1 ? 'lectura' : 'lecturas'} en 7 días${p.listed ? ' · en lista' : ''}`, ref: 'historia:placa:' + p.plate, run: () => openStory({ k: 'placa', plate: p.plate }) });
      for (const m of faces.filter((m) => (has(m.name) || has(m.listRef) || has(m.docId)) && canOpenStory({ k: 'persona', matchId: m.id })).slice(0, 4))
        out.push({ group: 'Investigar', icon: 'person_search', label: `Investigar a ${m.name}`, sub: `${m.listRef} · ${m.docId}`, ref: 'historia:persona:' + m.id, run: () => openStory({ k: 'persona', matchId: m.id }) });
      for (const u of UNKNOWN_FACES.filter((u) => has(u.label) || has(u.id) || (t.length >= 4 && has('persona sin identificar'))))
        out.push({ group: 'Investigar', icon: 'person_search', label: `Investigar a la persona sin identificar ${u.id}`, sub: u.label, ref: 'historia:sin_identificar:' + u.id, run: () => openStory({ k: 'sin_identificar', faceId: u.id }) });
    }
    if (perm.jules) out.push({ group: 'Jules', icon: 'auto_awesome', label: `Preguntar a Jules: "${q.trim()}"`, sub: 'Consulta y recomienda; no ejecuta acciones', ref: 'jules:' + q.trim(), run: () => c.askJules(q.trim()) });
    if (PLATE_RE.test(q.trim())) {
      if (perm.has('investigar') && !/[*?]/.test(q)) out.push({ group: 'Placas', icon: 'badge', label: `Ficha del vehículo ${q.trim().toUpperCase()}`, sub: 'Pide motivo; queda en la bitácora', ref: 'vehiculo:' + q.trim().toUpperCase(), run: () => openVehicle(q.trim().toUpperCase()) });
      for (const a of alerts.filter((x) => x.plate && inScope(x, user) && (normalizePlate(x.plate.listed).includes(np.replace(/[*?]/g, '')) || normalizePlate(x.plate.read).includes(np.replace(/[*?]/g, ''))))) {
        if (!perm.seesAlerts) break;
        out.push({ group: 'Placas', icon: 'directions_car', label: `${a.plate!.listed} · ${KIND_PHRASE[a.kind]}`, sub: a.id, ref: 'alerta:' + a.id, run: () => c.open({ k: 'alerta', id: a.id }) });
      }
    }
    for (const z of zones.filter((z) => has(z.name) || has(z.id))) out.push({ group: 'Zonas', icon: 'layers', label: z.name, sub: z.id, ref: 'zona:' + z.id, run: () => c.open({ k: 'zona', id: z.id }) });
    if (perm.seesAlerts) for (const a of alerts.filter((a) => forOperator(a) && inScope(a, user) && (has(a.id) || has(KIND_LABEL[a.kind]) || has(KIND_PHRASE[a.kind]))).slice(0, 6))
      out.push({ group: 'Alertas', icon: 'notifications', label: `${KIND_PHRASE[a.kind]}${a.plate ? ' · ' + a.plate.listed : ''}`, sub: a.id, ref: 'alerta:' + a.id, run: () => c.open({ k: 'alerta', id: a.id }) });
    for (const e of events.filter((e) => has(e.name) || has(e.id))) out.push({ group: 'Eventos', icon: 'flag', label: e.name, sub: e.id, ref: 'evento:' + e.id, run: () => c.open({ k: 'evento', id: e.id }) });
    for (const x of cameras.filter((x) => has(x.id)).slice(0, 5)) out.push({ group: 'Cámaras', icon: 'videocam', label: x.id, sub: x.street, ref: 'camara:' + x.id, run: () => c.open({ k: 'camara', id: x.id }) });
    // Calles: las de los cruces con cámara (en producción, el buscador de lugares del mapa)
    const streets = new Map<string, typeof cameras[number]>();
    for (const x of cameras) for (const s of x.street.split(' y ')) if (has(s) && !streets.has(s)) streets.set(s, x);
    for (const [s, x] of [...streets].slice(0, 5)) out.push({ group: 'Calles', icon: 'place', label: s, sub: `cruce con cámara ${x.id}`, ref: 'calle:' + s, run: () => { c.setPin({ lat: x.lat, lon: x.lon, label: s }); c.focus([[x.lon - 0.002, x.lat - 0.0015], [x.lon + 0.002, x.lat + 0.0015]], 'calle'); } });
    for (const u of units.filter((u) => has(u.id)).slice(0, 4)) out.push({ group: 'Unidades', icon: 'local_police', label: u.id, sub: u.type, ref: 'unidad:' + u.id, run: () => { c.setPin({ lat: u.lat, lon: u.lon, label: u.id }); c.focus([[u.lon - 0.0015, u.lat - 0.001], [u.lon + 0.0015, u.lat + 0.001]], 'unidad'); } });
    return out;
  }, [q, zones, alerts, cameras, events, units, role, perm.cfg, c, investigations, faces, openStory]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromRecent = (r: Recent): Result => {
    const [kind, ...rest] = r.ref.split(':'); const id = rest.join(':');
    const run = () => {
      if (kind === 'zona') c.open({ k: 'zona', id });
      else if (kind === 'alerta') c.open({ k: 'alerta', id });
      else if (kind === 'evento') c.open({ k: 'evento', id });
      else if (kind === 'camara') c.open({ k: 'camara', id });
      else if (kind === 'vehiculo' || (kind === 'placa' && perm.has('investigar'))) openVehicle(kind === 'placa' ? r.q.toUpperCase() : id);
      else if (kind === 'jules' && perm.jules) c.askJules(id);
      else { setQ(r.q); setOpen(true); return; }
    };
    return { group: 'Recientes', icon: 'history', label: r.label, sub: r.kind, ref: r.ref, run };
  };
  const shown: Result[] = q.trim().length >= 2 ? results : c.recents.map(fromRecent);

  const choose = (r: Result) => {
    if (r.group !== 'Recientes' && r.group !== 'Jules') c.remember({ q: q.trim(), label: r.label, kind: r.group, ref: r.ref });
    r.run(); setOpen(false); setQ(''); input.current?.blur();
  };

  let lastGroup = '';
  return (
    <div className="search-box" ref={box}>
      <div className="search-in">
        <Icon name="search" />
        <input ref={input} value={q} placeholder="Buscar zona, placa, cámara… o preguntarle a Jules"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && shown[sel]) choose(shown[sel]);
            if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
          }}
          role="combobox" aria-expanded={open} aria-controls="search-pop" aria-label="Buscar" />
        <span className="kbd">/</span>
      </div>
      {open && (
        <div className="search-pop" id="search-pop" role="listbox">
          {q.trim().length < 2 && !c.recents.length && <div className="hint">Escribe al menos dos letras. Tus búsquedas recientes aparecerán aquí.</div>}
          {q.trim().length >= 2 && !results.length && <div className="hint">Sin resultados para "{q.trim()}".</div>}
          {shown.map((r, i) => {
            const head = r.group !== lastGroup ? <div className="grp" key={'g' + r.group}>{r.group === 'Recientes' ? 'Búsquedas recientes' : r.group}</div> : null;
            lastGroup = r.group;
            return [head, (
              <button key={r.ref + i} role="option" aria-selected={i === sel} className={`res ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(r)}>
                <Icon name={r.icon} /><span>{r.label}{r.sub && <><br /><small>{r.sub}</small></>}</span>
                {i === sel && <span className="kbd">↵</span>}
              </button>
            )];
          })}
        </div>
      )}
    </div>
  );
}
