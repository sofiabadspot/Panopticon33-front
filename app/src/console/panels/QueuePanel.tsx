/* Bandeja de alertas — operador 911 (y lectura para mando y analista).
   La más nueva arriba y la más vieja abajo. Abrir una alerta abre su ficha a la derecha
   y mueve el mapa hacia ella; la bandeja sigue a la vista. */
import { useEffect, useMemo, useState } from 'react';
import { forOperator, inScope, isListStale, useApi } from '../../api';
import { ago } from '../../api/format';
import { KIND_LABEL, KIND_PHRASE, REVIEW_LABEL, SEVERITY_TARGET_MIN } from '../../api/labels';
import type { Alert, ReviewStatus } from '../../api/types';
import { useSession } from '../../shell/session';
import { EmptyState, Evidence, Icon, StatusChip, useNow } from '../../ui/kit';
import { AlertGlyph, fmtLate, overdueMin, SeverityBars } from '../../map/icons';
import { waitingSince } from '../../views/shared';
import { useConsole } from '../ctx';

type Tab = ReviewStatus | 'todas';

/** Misma placa en lista = mismo vehículo. Sin placa, cada alerta va sola. */
const groupKey = (a: Alert) => (a.plate ? `placa:${a.plate.listed}` : a.id);

export function QueuePanel() {
  const { role, user } = useSession();
  const c = useConsole();
  const now = useNow(2000);
  const all = useApi((s) => s.alerts);
  const zones = useApi((s) => s.zones);
  const cameras = useApi((s) => s.cameras);
  const lists = useApi((s) => s.lists);
  const units = useApi((s) => s.units);
  const [tab, setTab] = useState<Tab>('por_revisar');
  const [q, setQ] = useState('');
  const roleConfigs = useApi((s) => s.roleConfigs);
  /* Solo las alertas del alcance del usuario: su territorio y la criticidad mínima de su rol
     (Configuración → Roles y Usuarios). */
  const alerts = useMemo(() => all.filter((a) => forOperator(a) && inScope(a, user)), [all, user, zones, roleConfigs]); // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = roleConfigs.find((r) => r.role === role);
  const scoped = !!cfg && cfg.alertScope === 'territorio' && user.territory !== 'Nacional';
  const hidden = all.filter(forOperator).length - alerts.length;
  /* Buscador: número de alerta, placa, zona, calle o cámara y tipo. Sin mayúsculas ni tildes;
     en placas tampoco cuentan espacios ni guiones ("p512884" encuentra "P 512-884"). */
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tight = (t: string) => norm(t).replace(/[\s-]/g, '');
  const matches = (a: Alert) => {
    const n = norm(q.trim()); if (!n) return true;
    const cam = cameras.find((x) => x.id === a.cameraId);
    const text = norm([a.id, zones.find((z) => z.id === a.zoneId)?.name, cam?.street, a.cameraId, KIND_LABEL[a.kind], KIND_PHRASE[a.kind]].filter(Boolean).join(' · '));
    const plates = a.plate ? [a.plate.listed, a.plate.read].map(tight) : [];
    return n.split(/\s+/).every((w) => text.includes(w)) || plates.some((p) => p.includes(tight(n)));
  };
  const count = (t: Tab) => alerts.filter((a) => t === 'todas' || a.review === t).length;
  /* Las alertas de un mismo vehículo (misma placa en lista, leído en distintos lugares) van juntas,
     unidas por una línea: el grupo se ubica según su alerta más urgente (o más reciente) y adentro
     conserva ese orden. Las demás alertas no se agrupan. */
  /* "Nueva" mientras nadie la abrió Y todavía está en tiempo. Una vez que se pasa del objetivo ya no es
     nueva sino atrasada: pierde el cartel y pasa al bloque de las atrasadas (que también va arriba). */
  const isFresh = (a: Alert) => c.fresh.includes(a.id) && a.review === 'por_revisar' && !overdueMin(a.severity, waitingSince(a), now);
  const shown = useMemo(() => {
    const sorted = alerts.filter((a) => (tab === 'todas' || a.review === tab) && matches(a))
      // Siempre la más nueva arriba y la más vieja abajo. Por revisar: según su última novedad (una placa o
      // una persona que vuelve a pasar sube); en las demás pestañas, según su último cambio.
      .sort(tab === 'por_revisar' ? (a, b) => waitingSince(b) - waitingSince(a) : (a, b) => b.updatedAt - a.updatedAt);
    const groups = new Map<string, typeof sorted>();
    for (const a of sorted) { const key = groupKey(a); groups.set(key, [...(groups.get(key) ?? []), a]); }
    return [...groups.values()].flat();
  }, [alerts, tab, q, zones, cameras, c.fresh, Math.floor(now / 15000)]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <input type="search" className="fld sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar alerta, placa, zona o calle" aria-label="Buscar en las alertas" />
      </div>
      {scoped && hidden > 0 && <div className="notice" style={{ background: 'var(--glass-hi)' }}><Icon name="layers" /><span>Alertas de <b>{user.territory}</b>{hidden > 0 && ` · ${hidden} de otros territorios no se muestran`}.</span></div>}
      {role !== 'operator_911' && <div className="notice" style={{ background: 'var(--glass-hi)' }}><Icon name="lock" /><span>Solo lectura: confirma o descarta el operador 911.</span></div>}
      <ul className="list pb flush">
        {shown.length === 0 && <li><QueueEmpty tab={tab} query={q.trim()} alerts={alerts} cameras={cameras.length} going={units.filter((u) => u.enRoute).length} onTab={setTab} onClearQuery={() => setQ('')} /></li>}
        {shown.map((a, i) => (
          <li key={a.id}>
            <button className={`item ${groupPos(i)} ${a.review === 'por_revisar' ? 'g-open' : ''} ${a.id === openId ? 'sel' : ''} ${a.review === 'descartada' ? 'done' : ''} ${c.hoverAlert === a.id ? 'hov' : ''} ${isFresh(a) ? 'is-new' : ''}`} style={{ gridTemplateColumns: '104px 1fr auto', borderTop: i ? undefined : 0 }}
              onClick={() => c.open({ k: 'alerta', id: a.id })} aria-current={a.id === openId}
              onMouseEnter={() => c.setHoverAlert(a.id)} onMouseLeave={() => c.setHoverAlert(null)}>
              {/* El mismo ícono que en el mapa: rojo si espera decisión, gris si ya se resolvió */}
              {/* La imagen manda; el tipo va chiquito en la esquina, como sello */}
              <span className="q-shot"><Evidence ev={a.evidence} small /><span className={`q-glyph sev-${a.severity} ${a.review !== 'por_revisar' ? 'muted' : ''}`} aria-hidden><AlertGlyph kind={a.kind} /></span>{a.review !== 'por_revisar' && <span className={`q-done ${a.review === 'confirmada' ? 'ok' : ''}`} aria-label="Resuelta" />}</span>
              <div style={{ minWidth: 0 }}>
                {/* Qué pasó, dicho una sola vez y en palabras simples (sin el nombre técnico del tipo) */}
                <div className="t">{KIND_PHRASE[a.kind]} <SeverityBars severity={a.severity} muted={a.review !== 'por_revisar'} />{a.plate && <span className="plate">{a.plate.listed}</span>}</div>
                <div className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where(a.zoneId, a.cameraId)}</div>
                <div className="s ago">{ago(Math.min(now, waitingSince(a)), now)}</div>
              </div>
              <div className="r">{isFresh(a) && <span className="new-tag">Nueva</span>}{a.review === 'por_revisar' ? <WaitTime alert={a} now={now} /> : <StatusChip alert={a} />}</div>
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

/* Bandeja vacía: no es lo mismo "no pasó nada" que "ya se gestionó todo".
   · Sin ninguna alerta: el sistema sigue mirando; se dice cuántas cámaras.
   · Todas gestionadas: cuántas se resolvieron y si queda alguna unidad en camino.
   · Con filtros: se ofrece quitarlos. */
function QueueEmpty({ tab, query, alerts, cameras, going, onTab, onClearQuery }: {
  tab: Tab; query?: string; alerts: Alert[]; cameras: number; going: number; onTab: (t: Tab) => void; onClearQuery: () => void;
}) {
  if (query) return <EmptyState icon="search_off" title={`Nada para “${query}”`} action={<button className="btn secondary sm" onClick={onClearQuery}>Borrar búsqueda</button>}>No hay alertas {tab === 'todas' ? '' : 'en esta pestaña '}que coincidan.</EmptyState>;
  if (!alerts.length) return <EmptyState icon="visibility" title="Sin alertas">Panopticon sigue mirando {cameras} cámaras. Cuando una regla se cumpla, la alerta aparece acá y suena un aviso.</EmptyState>;
  if (tab !== 'por_revisar') return <EmptyState icon="history" title={tab === 'confirmada' ? 'Ninguna confirmada todavía' : tab === 'descartada' ? 'Ninguna descartada todavía' : 'Sin alertas'} />;
  const conf = alerts.filter((a) => a.review === 'confirmada').length, desc = alerts.filter((a) => a.review === 'descartada').length;
  return (
    <EmptyState icon="done_all" tone="ok" title="Todo gestionado" action={<button className="btn secondary sm" onClick={() => onTab('confirmada')}>Ver confirmadas</button>}>
      {conf} {conf === 1 ? 'confirmada' : 'confirmadas'} y {desc} {desc === 1 ? 'descartada' : 'descartadas'} en el turno.{going > 0 && ` ${going} ${going === 1 ? 'unidad sigue' : 'unidades siguen'} en camino.`} Las nuevas aparecen acá.
    </EmptyState>
  );
}

/* Cuánto lleva esperando, contra el tiempo objetivo de su criticidad ("3 min / de 5").
   Pasado el objetivo, solo los minutos de atraso en un recuadro del color de la criticidad ("+2 min"). */
function WaitTime({ alert: a, now }: { alert: Alert; now: number }) {
  const since = waitingSince(a), over = overdueMin(a.severity, since, now), target = SEVERITY_TARGET_MIN[a.severity];
  if (over) return <span className={`q-wait late sev-${a.severity}`} title={`Lleva ${over} min más que el objetivo (${target} min)`}>{fmtLate(over, true)}</span>;
  return <span className="q-wait" title={`Tiempo esperando decisión. Objetivo: ${target} min`}><b>{Math.max(0, Math.floor((now - since) / 60000))} min</b><small>de {target}</small></span>;
}
