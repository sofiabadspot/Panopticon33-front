/* "¿Quién llega?": unidades para un punto del mapa, de la que llega antes a la que llega después, y
   mandarlas desde acá (la plataforma despacha, no Maic). Viene marcada la disponible que llega antes y se
   suman otras tocando la fila. Las que no se pueden mandar (sin reporte, estado desconocido o ya yendo a
   otro lugar) quedan plegadas para quien manda. Cada una dice qué está haciendo: disponible, ocupada (se está haciendo cargo de
   algo), asignada (ya va a otro lugar), ya en el lugar, sin reporte. Solo el operador 911 y el mando
   mandan; los demás roles miden. */
import { useMemo, useState } from 'react';
import { AVAIL_LABEL, sendUnitsTo, unitOptions, useApi } from '../api';
import type { LngLat } from '../api/types';
import { UnitHex } from '../map/icons';
import { useSession } from '../shell/session';
import { Icon, useToast } from '../ui/kit';
import { usePermissions } from './permissions';

export function WhoArrives({ p, onSent }: { p: LngLat;
  /** Se mandaron unidades: quien muestra la lista sigue el flujo (p. ej. etiquetar el incidente). Sin esto, avisa con un toast. */
  onSent?: (ids: string[]) => void }) {
  const { user } = useSession();
  const perm = usePermissions();
  const toast = useToast();
  const units = useApi((s) => s.units);
  const opts = useMemo(() => unitOptions({ lat: p[1], lon: p[0] }).slice(0, 8), [p, units]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = opts.filter((o) => o.free);
  const canSend = perm.can('despachar');
  // Viene marcada la disponible que llega antes: en el caso común, mandar es un solo clic.
  const [picked, setPicked] = useState<string[]>(() => { const d = free.find((o) => o.avail === 'disponible'); return canSend && d ? [d.unit.id] : []; });
  const [showAll, setShowAll] = useState(false);
  // Solo las que siguen libres (alguien pudo mandar una mientras tanto).
  const ready = picked.filter((id) => free.some((o) => o.unit.id === id));
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const send = () => {
    const ids = ready; if (!ids.length) return;
    sendUnitsTo({ lat: p[1], lon: p[0] }, ids, user);
    if (onSent) onSent(ids); else toast(`${ids.length === 1 ? 'Va' : 'Van'} ${ids.join(', ')} a este punto`);
    setPicked([]);
  };
  // Quien manda ve primero las que pueden ir; las demás quedan plegadas. Quien solo mide las ve todas.
  const blocked = opts.filter((o) => !o.free);
  const shown = !canSend || showAll ? opts : free;
  const dist = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);
  return (
    <>
      {/* Cada fila: quién y, a la derecha y más grande, cuánto tarda. El estado solo se nombra cuando no es
          «disponible» (lo normal no hace falta decirlo). Se elige tocando la fila entera. */}
      <ol className="mc2-list wa-list">
        {shown.map((o) => {
          const on = picked.includes(o.unit.id);
          const Row = canSend ? 'label' : 'div';
          return (
            <li key={o.unit.id}>
              <Row className={`wa-u ${on ? 'on' : ''} ${o.free ? '' : 'off'}`}>
                {canSend && <input type="checkbox" aria-label={`Enviar ${o.unit.id}`} checked={on} disabled={!o.free} onChange={() => toggle(o.unit.id)} />}
                <UnitHex type={o.unit.type} size={20} />
                <span className="wa-id"><b className="mono">{o.unit.id}</b>
                  <small>{o.avail !== 'disponible' && <span className={`wa-av av-${o.avail}`}>{AVAIL_LABEL[o.avail]}{o.detail ? ` · ${o.detail}` : ''} · </span>}{o.unit.type} · {dist(o.dist)}</small></span>
                <span className="wa-eta mono"><b>{o.eta < 1 ? '<1' : Math.round(o.eta)}</b><small>min</small></span>
              </Row>
            </li>
          );
        })}
        {canSend && !free.length && <li className="wa-empty">Ninguna unidad libre llega a este punto.</li>}
      </ol>
      {canSend && blocked.length > 0 && <button className="linklike wa-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ocultar las que no pueden ir' : `Ver ${blocked.length} que no pueden ir`}</button>}
      {/* Fijo abajo de la tarjeta: la lista puede ser larga y el botón tiene que verse siempre. */}
      {canSend && free.length > 0 && <div className="wa-send"><button className="btn positive" style={{ width: '100%' }} disabled={!ready.length} onClick={send}><Icon name="send" />{ready.length ? `Enviar ${ready.length === 1 ? ready[0] : `${ready.length} unidades`}` : 'Marca quién va'}</button></div>}
    </>
  );
}
