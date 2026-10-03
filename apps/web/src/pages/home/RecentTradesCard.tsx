import { Link } from '@tanstack/react-router';
import { DateTime } from 'luxon';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { CardHeader, StatusPill, ViewLink } from '../../components/ui';
import type { TradeRow } from '../../lib/api';
import { useContracts, usePlays } from '../../lib/journal';

export function RecentTradesCard({ trades, revealed }: { trades: TradeRow[]; revealed: boolean }) {
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const last = [...trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 5);
  return (
    <section aria-labelledby="tr-h" className="card min-w-0 flex-[2_1_520px] p-6">
      <CardHeader id="tr-h" title="Recent trades" description="Last 5 across all accounts" action={<ViewLink to="/journal">All trades</ViewLink>} />
      {last.length === 0 ? (
        <p className="text-sm text-muted">No trades this financial year yet. Use “Log trades” or import from NinjaTrader.</p>
      ) : (
        <div className="-mt-1">
          <div>
            {last.map((t) => (
              <Link
                key={t.id}
                to="/journal/trades/$tradeId"
                params={{ tradeId: t.id }}
                className="grid min-h-[52px] grid-cols-[84px_minmax(0,1fr)_auto_minmax(72px,auto)] items-center gap-3 border-t border-border-subtle text-sm hover:bg-hover"
              >
                <span className="text-[13px] text-faint">{DateTime.fromISO(t.tradingDay).toFormat('ccc d LLL')}</span>
                <span className="truncate">
                  {plays.find((p) => p.id === t.playId)?.title ?? 'No Play'}{' '}
                  <span className="text-faint">
                    · {contracts.find((c) => c.id === t.contractId)?.symbol} {t.direction}
                  </span>
                </span>
                <span className="justify-self-start">{t.needsReview ? <StatusPill>Review</StatusPill> : <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />}</span>
                <span className="text-right">{revealed ? <Pnl cents={t.netCents} /> : <span className="tracking-widest text-faint">••••</span>}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
