/* Investigar — analista. "¿Qué pasó, dónde y con qué patrón?"
   Tres frentes sobre el mismo mapa: placas (recorrido de un vehículo), historial de alertas
   y comportamiento de zonas. Cada consulta exige motivo cuando toca datos de personas o
   vehículos, y queda en la bitácora. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { audit, exportPlates, forOperator, grantVehicle, plateWatch, searchPlates, useApi } from '../../api';
import { dateTime, fmtCrowd, fromLocalInput, hhmm, normalizePlate, pct, toLocalInput } from '../../api/format';
import { KIND_LABEL, KIND_PHRASE, REVIEW_LABEL, SEARCH_REASONS } from '../../api/labels';
import type { AlertKind, PlateRead, ReviewStatus } from '../../api/types';
import type { RouteStop } from '../../map/MapView';
import { useSession } from '../../shell/session';
import { Evidence, Icon, KindIcon, Sparkline, StatusChip, download, useToast } from '../../ui/kit';
import { useConsole, useOverlay } from '../ctx';

type Tab = 'placas' | 'alertas' | 'zonas';

export function InvestigatePanel() {
  const c = useConsole();
  const [tab, setTab] = useState<Tab>('placas');
  useEffect(() => { if (c.plateQuery) setTab('placas'); }, [c.plateQuery]);
  return (
    <>
      <div className="fbar" role="tablist" aria-label="Qué investigar">
        <button role="tab" aria-selected={tab === 'placas'} className={`fchip ${tab === 'placas' ? 'on' : ''}`} onClick={() => setTab('placas')}><Icon name="directions_car" />Placas</button>
        <button role="tab" aria-selected={tab === 'alertas'} className={`fchip ${tab === 'alertas' ? 'on' : ''}`} onClick={() => setTab('alertas')}><Icon name="notifications" />Historial de alertas</button>
        <button role="tab" aria-selected={tab === 'zonas'} className={`fchip ${tab === 'zonas' ? 'on' : ''}`} onClick={() => setTab('zonas')}><Icon name="layers" />Zonas</button>
      </div>
      {tab === 'placas' && <Plates />}
      {tab === 'alertas' && <AlertHistory />}
      {tab === 'zonas' && <ZoneHistory />}
    </>
  );
}

function Plates() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const zones = useApi((s) => s.zones);
  const now = Date.now();
  const [q, setQ] = useState({ plate: c.plateQuery ?? '', from: toLocalInput(now - 7 * 24 * 3600e3), to: toLocalInput(now), zoneId: '', reasonPick: '', reasonText: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ rows: PlateRead[]; label: string; reason: string } | null>(null);
  const [focusPlate, setFocusPlate] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (c.plateQuery) { setQ((x) => ({ ...x, plate: c.plateQuery! })); reasonRef.current?.focus(); c.setPlateQuery(null); } }, [c.plateQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const reason = [q.reasonPick, q.reasonText.trim()].filter(Boolean).join(' · ');
  const errs = { plate: normalizePlate(q.plate).replace(/[*?]/g, '').length < 2 ? 'Escribe al menos 2 caracteres.' : '', reason: q.reasonPick ? '' : 'El motivo es obligatorio: sin motivo no hay resultados.' };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setTried(true); if (errs.plate || errs.reason) return;
    setBusy(true); setSel(null); setFocusPlate(null); c.setPin(null);
    const rows = await searchPlates({ plate: q.plate, from: fromLocalInput(q.from), to: fromLocalInput(q.to), zoneId: q.zoneId || null, reason }, user);
    setRes({ rows, label: q.plate.toUpperCase(), reason }); setBusy(false);
  };
  const plates = useMemo(() => {
    const m = new Map<string, PlateRead[]>();
    for (const r of res?.rows ?? []) (m.get(r.plate) ?? m.set(r.plate, []).get(r.plate)!).push(r);
    return [...m.entries()].sort((a, b) => Number(!!plateWatch(b[0])) - Number(!!plateWatch(a[0])) || b[1].length - a[1].length);
  }, [res]);
  const focus = focusPlate ?? (plates.length === 1 ? plates[0][0] : null);
  const rows = useMemo(() => (res?.rows ?? []).filter((r) => !focus || r.plate === focus).sort((a, b) => a.at - b.at), [res, focus]);
  const route: RouteStop[] | undefined = focus ? rows.map((r, i) => ({ lat: r.lat, lon: r.lon, label: String(i + 1), title: `${hhmm(r.at)} · ${r.cameraId}` })) : undefined;
  const watch = focus ? plateWatch(focus) : null;
  useOverlay({ route, routeLabel: focus ?? undefined, fit: route?.length ? { points: route.map((s) => [s.lon, s.lat]), key: `ruta-${focus}-${rows.length}` } : undefined }, [focus, rows]);

  const doExport = () => {
    if (!res) return;
    download(`placas-${normalizePlate(focus ?? res.label).replace(/[*?]/g, '_')}.csv`, exportPlates(rows, focus ?? res.label, res.reason, user));
    toast('Ficha exportada y registrada en la bitácora');
  };

  return (
    <div className="pb">
      <form onSubmit={submit} noValidate className="grid" style={{ gap: 10 }}>
        <div className="field">
          <label htmlFor="pl">Placa completa o parcial</label>
          <input id="pl" className="fld mono" style={{ height: 42, fontSize: 17 }} value={q.plate} onChange={(e) => setQ({ ...q, plate: e.target.value })} placeholder="P 512-884 · P*884" autoComplete="off" aria-invalid={tried && !!errs.plate} />
          {tried && errs.plate && <span className="err"><Icon name="error" />{errs.plate}</span>}
        </div>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="pf">Desde</label><input id="pf" type="datetime-local" className="fld sm" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="pt">Hasta</label><input id="pt" type="datetime-local" className="fld sm" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></div>
        </div>
        <select className="fld sm" value={q.zoneId} onChange={(e) => setQ({ ...q, zoneId: e.target.value })} aria-label="Zona">
          <option value="">Todo el sector</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <div className="field">
          <select ref={reasonRef} className="fld sm" value={q.reasonPick} onChange={(e) => setQ({ ...q, reasonPick: e.target.value })} aria-invalid={tried && !!errs.reason} aria-label="Motivo de la consulta">
            <option value="">Motivo de la consulta…</option>{SEARCH_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input className="fld sm" value={q.reasonText} onChange={(e) => setQ({ ...q, reasonText: e.target.value })} placeholder="Número de caso (opcional)" aria-label="Número de caso" />
          {tried && errs.reason && <span className="err"><Icon name="error" />{errs.reason}</span>}
        </div>
        <button className="btn solid sm" type="submit" disabled={busy}><Icon name="search" />{busy ? 'Buscando…' : 'Buscar lecturas'}</button>
      </form>

      {res && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontWeight: 500 }}>{res.rows.length} lecturas</b><span className="dim" style={{ fontSize: 12 }}>· {plates.length} {plates.length === 1 ? 'placa' : 'placas'}</span>
          <button className="btn secondary xs" style={{ marginLeft: 'auto' }} onClick={doExport} disabled={!rows.length}><Icon name="download" />Exportar</button>
        </div>
        {plates.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`lchip ${!focusPlate ? 'on' : ''}`} onClick={() => setFocusPlate(null)}>Todas</button>
            {plates.slice(0, 10).map(([p, l]) => <button key={p} className={`lchip ${focusPlate === p ? 'on' : ''}`} onClick={() => setFocusPlate(p)}>{plateWatch(p) && <span className="sev critica" />}<span className="plate">{p}</span><b>{l.length}</b></button>)}
          </div>
        )}
        {watch && <div className="callout danger"><Icon name="warning" /><span className="grow"><b>{focus} en lista de robados.</b> {watch.vehicle.type} {watch.vehicle.make} {watch.vehicle.color.toLowerCase()} · caso <span className="mono">{watch.case}</span></span></div>}
        {focus && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dim grow" style={{ fontSize: 12 }}>El recorrido está dibujado en el mapa, numerado en orden.</span>
          <button className="btn secondary xs" onClick={() => { grantVehicle(focus, res.reason, user); c.open({ k: 'vehiculo', id: focus }); }}><Icon name="directions_car" />Ficha del vehículo</button>
        </div>}
        <ol className="list box">
          {res.rows.length === 0 && <li className="empty">Sin lecturas en el periodo.</li>}
          {(focus ? rows : res.rows).slice(0, 80).map((r, i) => (
            <li key={r.id}>
              <button className={`item ${sel === r.id ? 'sel' : ''}`} style={{ gridTemplateColumns: focus ? '20px 52px 1fr auto' : '52px 1fr auto', borderTop: i ? undefined : 0 }}
                onClick={() => { setSel(r.id); c.setPin({ lat: r.lat, lon: r.lon, label: `${r.plate} · ${hhmm(r.at)}` }); c.focus([[r.lon - 0.0015, r.lat - 0.001], [r.lon + 0.0015, r.lat + 0.001]], 'lectura'); }}>
                {focus && <span className="mono dim">{i + 1}</span>}
                <Evidence ev={r.evidence} small />
                <div><div className="t"><span className="plate">{r.plate}</span>{r.listed && <span className="chip critica" style={{ height: 18, fontSize: 10 }}>En lista</span>}{!r.normalized && <span className="chip" style={{ height: 18, fontSize: 10 }}>Sin normalizar</span>}</div><div className="s">{r.cameraId} · {r.street}</div></div>
                <div className="r"><span className="mono">{dateTime(r.at)}</span><span style={{ color: r.confidence < 0.85 ? 'var(--status-alert)' : undefined }}>{pct(r.confidence)}</span></div>
              </button>
            </li>
          ))}
        </ol>
      </>}
    </div>
  );
}

function AlertHistory() {
  const { user } = useSession();
  const c = useConsole();
  const toast = useToast();
  const alerts = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const [f, setF] = useState({ kind: '' as AlertKind | '', zone: '', review: '' as ReviewStatus | '', from: toLocalInput(Date.now() - 24 * 3600e3), to: toLocalInput(Date.now() + 3600e3) });
  const rows = alerts.filter(forOperator).filter((a) => (!f.kind || a.kind === f.kind) && (!f.zone || a.zoneId === f.zone) && (!f.review || a.review === f.review)
    && a.createdAt >= fromLocalInput(f.from) && a.createdAt <= fromLocalInput(f.to)).sort((a, b) => b.createdAt - a.createdAt);
  const byKind = (Object.keys(KIND_LABEL) as AlertKind[]).map((k) => [k, rows.filter((a) => a.kind === k).length] as const).filter(([, n]) => n);
  const discarded = rows.filter((a) => a.review === 'descartada').length;
  useOverlay({ highlightZones: f.zone ? [f.zone] : undefined }, [f.zone]);
  const exportCsv = () => {
    const csv = ['id,creada,tipo,severidad,zona,camara,medido,revision,maic,motivo_descarte', ...rows.map((a) => [a.id, new Date(a.createdAt).toISOString(), KIND_LABEL[a.kind], a.severity, zones.find((z) => z.id === a.zoneId)?.name ?? '', a.cameraId, `"${a.rule.measured}"`, a.review, a.maic ?? '', a.discardReason ?? ''].join(','))].join('\n');
    download('alertas.csv', csv); audit(user, 'Exportar alertas', 'Alertas', `${rows.length} alertas`); toast('Informe exportado y registrado en la bitácora');
  };
  return (
    <div className="pb">
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <select className="fld sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AlertKind | '' })} aria-label="Tipo"><option value="">Todos los tipos</option>{(['aglomeracion', 'brecha_presencia', 'placa_en_lista'] as AlertKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        <select className="fld sm" value={f.review} onChange={(e) => setF({ ...f, review: e.target.value as ReviewStatus | '' })} aria-label="Revisión"><option value="">Toda revisión</option>{(['por_revisar', 'confirmada', 'descartada'] as ReviewStatus[]).map((k) => <option key={k} value={k}>{REVIEW_LABEL[k]}</option>)}</select>
        <select className="fld sm" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} aria-label="Zona" style={{ gridColumn: '1 / -1' }}><option value="">Todas las zonas</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <input type="datetime-local" className="fld sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Desde" />
        <input type="datetime-local" className="fld sm" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Hasta" />
      </div>
      <div className="kpis" style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">Alertas en el periodo</div><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{byKind.map(([k, n]) => <span key={k} className="chip" style={{ height: 20, fontSize: 11 }}>{KIND_LABEL[k]} <b className="mono">{n}</b></span>)}</div></div>
        <div className="kpi"><div className="v">{rows.length ? pct(discarded / rows.length) : '—'}</div><div className="l">Descartadas</div><div className="x">{discarded} falsas o duplicadas</div></div>
      </div>
      <div style={{ display: 'flex' }}><button className="btn secondary xs" style={{ marginLeft: 'auto' }} onClick={exportCsv} disabled={!rows.length}><Icon name="download" />Exportar informe</button></div>
      <ul className="list box">
        {rows.length === 0 && <li className="empty">Sin alertas con estos filtros.</li>}
        {rows.map((a, i) => (
          <li key={a.id}>
            <button className={`item ${c.sheet?.k === 'alerta' && c.sheet.id === a.id ? 'sel' : ''}`} style={{ borderTop: i ? undefined : 0 }} onClick={() => c.open({ k: 'alerta', id: a.id })}>
              <KindIcon alert={a} />
              <div><div className="t">{KIND_PHRASE[a.kind]}{a.plate && <span className="plate">{a.plate.listed}</span>}</div><div className="s">{zones.find((z) => z.id === a.zoneId)?.name ?? a.cameraId} · {dateTime(a.createdAt)}</div></div>
              <div className="r"><StatusChip alert={a} /></div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ZoneHistory() {
  const c = useConsole();
  const zones = useApi((s) => s.zones);
  const status = useApi((s) => s.zoneStatus);
  const alerts = useApi((s) => s.alerts);
  return (
    <div className="pb">
      <p className="dim" style={{ margin: 0, fontSize: 12 }}>Personas en la última hora por zona, con su pico y las alertas del día. Abre una zona para ver el detalle.</p>
      {zones.map((z) => {
        const s = status[z.id]; const vals = s?.trend ?? []; const nums = vals.filter((v): v is number => v != null);
        const peak = nums.length ? Math.max(...nums) : null;
        const n = alerts.filter((a) => a.zoneId === z.id && forOperator(a)).length;
        return (
          <button key={z.id} className={`box ${c.sheet?.k === 'zona' && c.sheet.id === z.id ? 'sel' : ''}`} style={{ textAlign: 'left', padding: '10px 12px', display: 'grid', gap: 4 }} onClick={() => c.open({ k: 'zona', id: z.id })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontWeight: 500 }}>{z.name}</b><span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{n} alertas</span></div>
            <Sparkline values={vals} height={44} />
            <div className="dim" style={{ fontSize: 11 }}>{peak == null ? 'Sin cobertura en el periodo' : `Pico ${fmtCrowd(peak)} · ahora ${fmtCrowd(s!.count!)}`}</div>
          </button>
        );
      })}
    </div>
  );
}
