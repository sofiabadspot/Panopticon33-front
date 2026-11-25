/* "¿Quién llega?": unidades para un punto del mapa, de la que llega antes a la que llega después, y
   mandarlas desde acá (la plataforma despacha, no Maic). Se pueden elegir a mano o tomar las más
   cercanas. Las que no se pueden mandar (sin reporte, estado desconocido o ya yendo a otro lugar) se
   ven igual, apagadas y con el porqué. Solo el operador 911 y el mando mandan; los demás roles miden. */
import { useMemo, useState } from 'react';
import { sendUnitsTo, unitOptions, useApi } from '../api';
import type { LngLat } from '../api/types';
import { UNIT_LABEL } from '../api/labels';
import { UnitHex } from '../map/icons';
import { useSession } from '../shell/session';
import { Icon, useToast } from '../ui/kit';

export function WhoArrives({ p }: { p: LngLat }) {
  const { user, role } = useSession();
  const toast = useToast();
  const units = useApi((s) => s.units);
  const opts = useMemo(() => unitOptions({ lat: p[1], lon: p[0] }).sort((a, b) => a.eta - b.eta).slice(0, 8), [p, units]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = opts.filter((o) => o.free);
  const [picked, setPicked] = useState<string[]>([]);
  const canSend = role === 'operator_911' || role === 'command';
  // Solo las que siguen libres (alguien pudo mandar una mientras tanto).
  const ready = picked.filter((id) => free.some((o) => o.unit.id === id));
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const nearest = (n: number) => setPicked(free.slice(0, n).map((o) => o.unit.id));
  const send = () => {
    const ids = ready; if (!ids.length) return;
    sendUnitsTo({ lat: p[1], lon: p[0] }, ids, user);
    toast(`${ids.length === 1 ? 'Va' : 'Van'} ${ids.join(', ')} a este punto`); setPicked([]);
  };
  return (
    <>
      {canSend && free.length > 0 && (
        <div className="wa-quick" role="group" aria-label="Elegir las más cercanas">
          <span>Las más cercanas:</span>
          {[1, 2, 3].filter((n) => n <= free.length).map((n) => <button key={n} className="btn secondary xs" aria-label={n === 1 ? 'La más cercana' : `Las ${n} más cercanas`} onClick={() => nearest(n)}>{n}</button>)}
        </div>
      )}
      <ol className="mc2-list">
        {opts.map((o) => (
          <li key={o.unit.id} className={o.free ? '' : 'off'}>
            {canSend && <input type="checkbox" aria-label={`Mandar ${o.unit.id}`} checked={picked.includes(o.unit.id)} disabled={!o.free} onChange={() => toggle(o.unit.id)} />}
            <UnitHex type={o.unit.type} size={20} />
            <span><b>{o.unit.id}</b><small>{o.unit.type} · {o.why ?? UNIT_LABEL[o.unit.status]} · {o.dist < 1000 ? `${Math.round(o.dist)} m` : `${(o.dist / 1000).toFixed(1)} km`}</small></span>
            <span className="mc2-eta">{o.eta < 1 ? '<1' : Math.round(o.eta)} min</span>
          </li>
        ))}
      </ol>
      {canSend && <button className="btn positive sm" style={{ width: '100%' }} disabled={!ready.length} onClick={send}><Icon name="send" />{ready.length ? `Mandar ${ready.length} ${ready.length === 1 ? 'unidad' : 'unidades'} aquí` : 'Elegí unidades para mandar'}</button>}
    </>
  );
}
