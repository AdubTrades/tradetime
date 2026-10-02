/** Tiny equity line for a tile: one series, no axes, zero baseline shown when the line crosses it. */
export function Sparkline({ values, label, height = 48 }: { values: number[]; label: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} className="flex items-center text-xs text-muted">Not enough trades yet</div>;
  const w = 240;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label}>
      <title>{label}</title>
      {min < 0 && max > 0 && <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <polyline points={points} fill="none" stroke="var(--ember)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} fill="var(--ember)" />
    </svg>
  );
}
