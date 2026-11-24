/* Cuánto lleva una alerta sin gestionar (desde que llegó hasta que alguien la confirma o la descarta).
   Cuenta en vivo, de a un segundo. A partir de 5 min se marca en el color de la alerta. */
import { useEffect, useState } from 'react';

export function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function Unattended({ since, compact = false }: { since: number; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = now - since;
  return (
    <span className={`unatt ${ms > 5 * 60000 ? 'late' : ''}`} title="Tiempo que lleva sin que nadie la confirme o la descarte">
      <i aria-hidden />{compact ? '' : 'Sin gestionar '}<b>{fmtElapsed(ms)}</b>
    </span>
  );
}
