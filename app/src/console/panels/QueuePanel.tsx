/* Bandeja de alertas — operador 911 (y lectura para mando y analista).
   Ordenada por severidad y antigüedad. Abrir una alerta abre su ficha a la derecha
   y mueve el mapa hacia ella; la bandeja sigue a la vista. */
import { useEffect, useMemo, useState } from 'react';
import { forOperator, isListStale, useApi } from '../../api';
import { ago } from '../../api/format';
import { KIND_PHRASE, REVIEW_LABEL } from '../../api/labels';
import type { Alert, ReviewStatus } from '../../api/types';
import { useSession } from '../../shell/session';
import { Evidence, Icon, StatusChip, useNow } from '../../ui/kit';
import { AlertTile } from '../../map/icons';
import { Unattended } from '../../ui/Unattended';
import { byUrgency } from '../../views/shared';
import { useConsole } from '../ctx';

type Tab = ReviewStatus | 'todas';

/** Misma placa en lista = mismo vehículo. Sin placa, cada alerta va sola. */
const groupKey = (a: Alert) => (a.plate ? `placa:${a.plate.listed}` : a.id);

export function QueuePanel() {
  const { role } = useSession();
  const c = useConsole();
  const now = useNow(5000);
  const all = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const cameras = useApi((s) => s.cameras);
  const lists = useApi((s) => s.lists);
  const [tab, setTab] = useState<Tab>('por_revisar');
  const [zone, setZone] = useState('');
  const alerts = useMemo(() => all.filter(forOperator), [all]);
  const count = (t: Tab) => alerts.filter((a) => t === 'todas' || a.review === t).length;
  /* Las alertas de un mismo vehículo (misma placa en lista, leído en distintos lugares) van juntas,
     unidas por una línea: el grupo se ubica según su alerta más urgente (o más reciente) y adentro
     conserva ese orden. Las demás alertas no se agrupan. */
  const shown = useMemo(() => {
    const sorted = alerts.filter((a) => (tab === 'todas' || a.review === tab) && (!zone || a.zoneId === zone))
      .sort(tab === 'por_revisar' ? byUrgency : (a, b) => b.updatedAt - a.updatedAt);
    const groups = new Map<string, typeof sorted>();
    for (const a of sorted) { const key = groupKey(a); groups.set(key, [...(groups.get(key) ?? []), a]); }
    return [...groups.values()].flat();
  }, [alerts, tab, zone]);
  /** Lugar de cada alerta en su grupo: sola, primera, del medio o última. */
  const groupPos = (i: number) => {
    const same = (j: number) => !!shown[j] && !!shown[i].plate && groupKey(shown[j]) === groupKey(shown[i]);
    const prev = same(i - 1), nxt = same(i + 1);
    return !prev && !nxt ? '' : !prev ? 'g-first' : !nxt ? 'g-last' : 'g-mid';
  };
  const openId = c.sheet?.k === 'alerta' ? c.sheet.id : null;
  const stale = lists.filter((l) => isListStale(l, now));
  const where = (zoneId: string | null, camId: string) => zones.find((z) => z.id === zoneId)?.name ?? cameras.find((x) => x.id === camId)?.street ?? camId;

  // ↑ ↓ recorren la bandeja sin salir del mapa
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const i = shown.findIndex((a) => a.id === openId);
      const n = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) c.open({ k: 'alerta', id: n.id });
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [shown, openId, c]);

  return (
    <>
      {stale.map((l) => (
        <div key={l.id} className="notice" role="status"><Icon name="warning" /><span><b>Lista desactualizada:</b> {l.name.toLowerCase()}, sincronizada {ago(l.lastSyncAt, now)} (plazo {l.maxAgeMin} min).</span></div>
      ))}
      <div className="fbar" role="group" aria-label="Filtros">
        {(['por_revisar', 'confirmada', 'descartada', 'todas'] as Tab[]).map((t) => (
          <button key={t} aria-pressed={tab === t} className={`fchip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'todas' ? 'Todas' : t === 'confirmada' ? 'Confirmadas' : t === 'descartada' ? 'Descartadas' : REVIEW_LABEL[t]}<b>{count(t)}</b>
          </button>
        ))}
        <select className={`fchip ${zone ? 'on' : ''}`} value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zona">
          <option value="">Zona</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </div>
      {role !== 'operator_911' && <div className="notice" style={{ background: 'var(--glass-hi)' }}><Icon name="lock" /><span>Solo lectura: confirma o descarta el operador 911.</span></div>}
      <ul className="list pb flush">
        {shown.length === 0 && <li className="empty">{tab === 'por_revisar' ? 'No hay alertas por revisar.' : 'Sin alertas con estos filtros.'}</li>}
        {shown.map((a, i) => (
          <li key={a.id}>
            <button className={`item ${groupPos(i)} ${a.review === 'por_revisar' ? 'g-open' : ''} ${a.id === openId ? 'sel' : ''} ${a.review === 'descartada' ? 'done' : ''} ${c.hoverAlert === a.id ? 'hov' : ''} ${c.fresh.includes(a.id) ? 'is-new' : ''}`} style={{ gridTemplateColumns: '104px 1fr auto', borderTop: i ? undefined : 0 }}
              onClick={() => c.open({ k: 'alerta', id: a.id })} aria-current={a.id === openId}
              onMouseEnter={() => c.setHoverAlert(a.id)} onMouseLeave={() => c.setHoverAlert(null)}>
              {/* El mismo ícono que en el mapa: rojo si espera decisión, gris si ya se resolvió */}
              {/* La imagen manda; el tipo va chiquito en la esquina, como sello */}
              <span className="q-shot"><Evidence ev={a.evidence} small /><AlertTile kind={a.kind} size={20} muted={a.review !== 'por_revisar'} /></span>
              <div style={{ minWidth: 0 }}>
                {/* Qué pasó, dicho una sola vez y en palabras simples (sin el nombre técnico del tipo) */}
                <div className="t">{KIND_PHRASE[a.kind]}{a.plate && <span className="plate">{a.plate.listed}</span>}</div>
                <div className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where(a.zoneId, a.cameraId)}</div>
                <div className="s ago">{ago(a.createdAt, now)}</div>
              </div>
              <div className="r">{c.fresh.includes(a.id) && <span className="new-tag">Nueva</span>}{a.review === 'por_revisar' ? <Unattended since={a.createdAt} compact /> : <StatusChip alert={a} />}</div>
            </button>
          </li>
        ))}
      </ul>
      {role === 'operator_911' && (
        <div className="lfoot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> recorrer</span><span><span className="kbd">C</span> confirmar</span><span><span className="kbd">D</span> descartar</span>
        </div>
      )}
    </>
  );
}
