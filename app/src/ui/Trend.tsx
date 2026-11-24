/* Serie en el tiempo (personas por zona), con Recharts.
   · Una sola serie: no lleva leyenda; el título de la caja la nombra.
   · El umbral es una línea roja punteada con su rótulo: es un estado, no una serie.
   · Los huecos (null = sin dato) cortan la línea; nunca se dibujan como cero.
   · Al pasar el mouse: línea vertical y el valor de ese momento.
   · Compacta (altura < 60): sin ejes, solo la línea y el detalle al pasar el mouse. */
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtCrowd } from '../api/format';

type Row = { i: number; v: number | null };

function Tip({ active, payload, stepMin, last }: { active?: boolean; payload?: { payload: Row }[]; stepMin: number; last: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload; const min = (last - r.i) * stepMin;
  return (
    <div className="trend-tip">
      <span>{min === 0 ? 'Ahora' : `Hace ${min} min`}</span>
      <b>{r.v == null ? 'Sin dato' : `${fmtCrowd(r.v)} personas`}</b>
    </div>
  );
}

export function Trend({ values, threshold, height = 120, stepMin = 2 }: { values: (number | null)[]; threshold?: number | null; height?: number; stepMin?: number }) {
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return <div className="kpi nodata" style={{ height }}><div className="v">Sin datos en el periodo</div></div>;
  const data: Row[] = values.map((v, i) => ({ i, v }));
  const last = values.length - 1;
  const compact = height < 60;
  const max = Math.max(...nums, threshold ?? 0) * 1.1;
  const gid = `tg-${Math.round(max)}-${values.length}-${height}`;
  return (
    <div className={`trend ${compact ? 'compact' : ''}`} style={{ height }} role="img" aria-label={`Personas en la última hora: ahora ${fmtCrowd(nums[nums.length - 1])}${threshold ? `, umbral ${fmtCrowd(threshold)}` : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={compact ? { top: 4, right: 2, bottom: 2, left: 2 } : { top: 14, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {!compact && <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />}
          <XAxis dataKey="i" type="number" domain={[0, last]} hide={compact} ticks={[0, Math.round(last / 2), last]}
            tickFormatter={(i: number) => (i === last ? 'ahora' : `−${(last - i) * stepMin} min`)}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 10, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={{ stroke: 'var(--border-strong)' }} />
          <YAxis hide={compact} domain={[0, max]} width={44} tickCount={4} tickFormatter={(v: number) => fmtCrowd(v)}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 10, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip stepMin={stepMin} last={last} />} cursor={{ stroke: 'var(--ink-muted)', strokeWidth: 1 }} isAnimationActive={false} />
          {threshold != null && (
            <ReferenceLine y={threshold} stroke="var(--status-negative)" strokeDasharray="4 3" strokeWidth={1}
              label={compact ? undefined : { value: `Umbral ${fmtCrowd(threshold)}`, position: 'insideTopRight', fill: 'var(--status-negative-text)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
          )}
          <Area type="monotone" dataKey="v" stroke="var(--ink)" strokeWidth={compact ? 1.5 : 2} fill={`url(#${gid})`} connectNulls={false}
            activeDot={{ r: 4, fill: 'var(--ink)', stroke: 'var(--surface-panel)', strokeWidth: 2 }} isAnimationActive={!compact} animationDuration={500} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
