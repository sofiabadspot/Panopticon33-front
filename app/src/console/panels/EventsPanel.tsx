/* Estado de un evento masivo. Los eventos se ven en el panel Estado (ya no tienen pestaña propia);
   abrir uno lo muestra en su ficha y encuadra sus zonas en el mapa. */
export const EVENT_STATUS = { programado: 'Programado', en_curso: 'En curso', finalizado: 'Finalizado' } as const;
/** cancelled: el evento se canceló (su estado calculado es "finalizado", pero se dice "Cancelado"). */
export const EventTag = ({ s, cancelled }: { s: keyof typeof EVENT_STATUS; cancelled?: boolean }) =>
  cancelled ? <span className="chip">Cancelado</span>
    : <span className={`chip ${s === 'en_curso' ? 'ok' : 'outline'}`}>{s === 'en_curso' && <span className="dot" aria-hidden />}{EVENT_STATUS[s]}</span>;
