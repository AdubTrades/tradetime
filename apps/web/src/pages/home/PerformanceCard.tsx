import { DateTime } from 'luxon';
import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { stats, weekStart } from '@tc/domain';
import { Pnl } from '../../components/GradeBadge';
import { Button, CardHeader, SegmentedTabs, ViewLink } from '../../components/ui';
import type { TradeRow } from '../../lib/api';
import { useUsdRates } from '../../lib/journal';

const HIDDEN = <span className="tracking-widest text-faint">••••</span>;

/** 30-day cumulative P&L: a line with a light fill and a dashed zero line. */
function EquityLine({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="flex h-[140px] items-center justify-center text-[13px] text-muted">Not enough trades in the last 30 days yet.</div>;
  const W = 600;
  const H = 120;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 6 - ((v - min) / span) * (H - 12);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[140px] w-full" role="img" aria-label={label}>
      <line x1={0} y1={zero} x2={W} y2={zero} stroke="var(--grade-b-border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,${zero} ${pts} ${W},${zero}`} fill="var(--bg-hover)" />
      <polyline points={pts} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, n, value, sub, last = false }: { label: string; n?: number; value: ReactNode; sub: ReactNode; last?: boolean }) {
  return (
    <div className={`flex-[1_1_150px] pt-[18px] ${last ? '' : 'pr-4'}`}>
      <div className="text-[13px] text-muted">
        {label}
        {n !== undefined && <span className="text-faint"> · n={n}</span>}
      </div>
      <div className="mt-1 text-[22px] font-medium">{value}</div>
      <div className="mt-0.5 text-xs text-faint">{sub}</div>
    </div>
  );
}

const winR = (s: stats.Summary) => [s.winRate === null ? null : `${Math.round(s.winRate * 100)}% win`, s.avgR === null ? null : `${s.avgR}R avg`].filter(Boolean).join(' · ') || '—';

export function PerformanceCard({
  trades,
  today,
  fyLabel,
  revealed,
  onReveal,
  canHide,
  currency,
  onCurrency,
}: {
  trades: TradeRow[];
  today: string;
  fyLabel: string;
  revealed: boolean;
  onReveal: (r: boolean) => void;
  canHide: boolean;
  currency: 'USD' | 'AUD';
  onCurrency: (c: 'USD' | 'AUD') => void;
}) {
  // Trades are stored in USD. For AUD, each trade is converted at its own trading day's rate, so a past total never
  // moves when today's rate does.
  const tradingDays = trades.map((t) => t.tradingDay).sort();
  const rates = useUsdRates('AUD', tradingDays[0], tradingDays[tradingDays.length - 1], currency === 'AUD' && revealed && trades.length > 0);
  const converted = currency === 'AUD' && rates.data ? trades.map((t) => ({ rate: rates.data[t.tradingDay], t })) : null;
  const ready = currency === 'AUD' && (trades.length === 0 || (!!converted && converted.every((c) => !!c.rate)));
  const shown: TradeRow[] = ready && converted ? converted.map(({ t, rate }) => ({ ...t, netCents: Math.round(t.netCents / rate!) })) : trades;
  const shownCurrency = ready ? 'AUD' : 'USD';
  const fx = (cents: number, className?: string) => <Pnl cents={cents} currency={shownCurrency} className={className} />;
  trades = shown;
  const fy = stats.summarise(trades);
  const week = stats.summarise(trades.filter((t) => t.tradingDay >= weekStart(today) && t.tradingDay <= today));
  const monthTrades = trades.filter((t) => t.tradingDay.startsWith(today.slice(0, 7)));
  const month = stats.summarise(monthTrades);
  const since = DateTime.fromISO(today).minus({ days: 29 });
  const curve = stats.equityCurve(trades.filter((t) => t.tradingDay >= since.toISODate()!).map((t) => ({ ...t, at: t.openedAt })));
  const streak = stats.streaks(trades.map((t) => ({ ...t, at: t.openedAt })));
  const last = [...trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
  const total30 = curve.at(-1)?.equityCents ?? 0;

  return (
    <section aria-labelledby="perf-h" className="card flex min-w-0 flex-[2_1_520px] flex-col gap-[18px] p-6">
      <CardHeader
        id="perf-h"
        title="Performance"
        description={`After fees, in ${shownCurrency}`}
        action={
          <>
            {canHide && (
              <Button size="sm" variant="ghost" onClick={() => onReveal(!revealed)} aria-pressed={revealed}>
                {revealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {revealed ? 'Hide P&L' : 'Reveal P&L'}
              </Button>
            )}
            <ViewLink to="/journal">Stats</ViewLink>
          </>
        }
      />
      <div className="-mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] text-muted">Financial year {fyLabel}</div>
          <SegmentedTabs label="Currency" value={currency} onChange={onCurrency} options={[{ value: 'USD', label: 'USD' }, { value: 'AUD', label: 'AUD' }]} />
        </div>
        <div className="mt-1 text-[48px] leading-[1.1] font-medium tracking-[-0.035em]">{revealed ? fx(fy.netCents) : HIDDEN}</div>
        <div className="mt-1 text-sm text-muted">
          {fy.n} trade{fy.n === 1 ? '' : 's'}
          {revealed && fy.n > 0 && ` · ${winR(fy)}`}
          {!revealed && ' · results hidden so they don’t colour your next session'}
        </div>
      </div>
      <div>
        {revealed ? (
          <EquityLine values={curve.map((p) => p.equityCents)} label={`Cumulative P&L over the last 30 days, ending at ${(total30 / 100).toFixed(2)} USD`} />
        ) : (
          <div className="flex h-[140px] items-center justify-center rounded-md bg-inset text-[13px] text-muted">Chart hidden until you reveal P&L</div>
        )}
        <div className="mt-2 flex justify-between text-xs text-faint">
          <span>{since.toFormat('d LLL')}</span>
          <span>
            Last 30 days
            {revealed && (
              <>
                {' · '}
                {fx(total30, "text-faint")}
              </>
            )}
          </span>
          <span>{DateTime.fromISO(today).toFormat('d LLL')}</span>
        </div>
      </div>
      <div className="flex flex-wrap border-t border-border-subtle">
        <Stat label="This week" n={week.n} value={revealed ? fx(week.netCents) : HIDDEN} sub={revealed ? winR(week) : `${week.n} trades`} />
        <Stat
          label={DateTime.fromISO(today).toFormat('LLLL')}
          n={month.n}
          value={revealed ? fx(month.netCents) : HIDDEN}
          sub={revealed ? winR(month) : `${month.n} trades`}
        />
        <Stat
          last
          label="Streak"
          value={revealed ? (streak.current === 0 ? '—' : `${Math.abs(streak.current)} ${streak.current > 0 ? (streak.current === 1 ? 'win' : 'wins') : streak.current === -1 ? 'loss' : 'losses'}`) : HIDDEN}
          sub={revealed && last ? <>Last trade {fx(last.netCents, "text-faint")}</> : last ? 'Last trade hidden' : 'No trades yet'}
        />
      </div>
      {currency === 'AUD' && revealed && trades.length > 0 && (
        <p className="-mt-2 text-xs text-faint" role="status">
          {ready
            ? 'Converted from USD at each trading day’s ECB rate.'
            : rates.isError
              ? 'Couldn’t get the AUD rates, so this is showing USD. Try again shortly.'
              : 'Getting AUD rates…'}
        </p>
      )}
    </section>
  );
}
