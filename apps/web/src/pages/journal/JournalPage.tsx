import { Link, useNavigate } from '@tanstack/react-router';
import { FileUp, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { financialYear, financialYearOf, formatLocal, GRADES, tradingDay } from '@tc/domain';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { Button, cn, PageHeader, Select } from '../../components/ui';
import type { TradeRow } from '../../lib/api';
import { useAccounts } from '../../lib/expenses';
import { useContracts, usePlays, useReviewCount, useTrades } from '../../lib/journal';
import { useSettings } from '../../lib/settings';
import { StatsView } from './StatsView';
import { ImportTradesDialog } from './ImportTradesDialog';
import { TradeForm } from './TradeForm';

type Range = 'month' | 'last30' | 'fy' | 'all';

export interface TradeFilters {
  playId: string;
  grade: string;
  contractId: string;
  accountId: string;
  result: '' | 'win' | 'loss';
  review: boolean;
}
const noFilters: TradeFilters = { playId: '', grade: '', contractId: '', accountId: '', result: '', review: false };

/** Apply filters. When filtering by account, results are recomputed for that account only. */
export function applyFilters(trades: TradeRow[], f: TradeFilters): TradeRow[] {
  return trades
    .map((t) => {
      if (!f.accountId) return t;
      const a = t.accounts.find((x) => x.accountId === f.accountId);
      if (!a) return null;
      return { ...t, accounts: [a], netCents: a.netCents, grossCents: a.grossCents, feesCents: a.feesCents, r: a.plannedRiskCents ? Math.round((a.netCents / a.plannedRiskCents) * 100) / 100 : null };
    })
    .filter((t): t is TradeRow => !!t)
    .filter(
      (t) =>
        (!f.playId || (f.playId === 'none' ? !t.playId : t.playId === f.playId)) &&
        (!f.grade || (f.grade === 'outside' ? t.outsidePlan : t.grade === f.grade)) &&
        (!f.contractId || t.contractId === f.contractId) &&
        (!f.result || (f.result === 'win' ? t.netCents > 0 : t.netCents < 0)) &&
        (!f.review || t.needsReview),
    );
}

export function JournalPage() {
  const { data: settings } = useSettings();
  const today = tradingDay(new Date(), settings?.rolloverTime);
  const [tab, setTab] = useState<'trades' | 'stats'>('trades');
  const [range, setRange] = useState<Range>('last30');
  // Home links here with ?review=1 to show imported trades that still need a Play and checklist.
  const [filters, setFilters] = useState<TradeFilters>(() => ({ ...noFilters, review: new URLSearchParams(window.location.search).get('review') === '1' }));
  const [logging, setLogging] = useState(false);
  const [importing, setImporting] = useState(false);

  const { from, to } = useMemo(() => {
    const d = DateTime.fromISO(today);
    switch (range) {
      case 'month':
        return { from: d.startOf('month').toISODate()!, to: d.endOf('month').toISODate()! };
      case 'last30':
        return { from: d.minus({ days: 29 }).toISODate()!, to: today };
      case 'fy': {
        const fy = financialYear(financialYearOf(today).startYear);
        return { from: fy.start, to: fy.end };
      }
      case 'all':
        return { from: '2000-01-01', to: '2100-12-31' };
    }
  }, [range, today]);

  const { data: trades = [], isLoading } = useTrades(from, to);
  const filtered = useMemo(() => applyFilters(trades, filters), [trades, filters]);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Journal"
        actions={
          <>
            <Button onClick={() => setImporting(true)}>
              <FileUp size={16} aria-hidden /> Import
            </Button>
            <Button variant="primary" onClick={() => setLogging(true)}>
              <Plus size={16} aria-hidden /> Log trades
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border">
        {(['trades', 'stats'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('font-display -mb-px border-b-2 px-3 py-2 text-[15px] capitalize', tab === t ? 'border-ember text-text' : 'border-transparent text-muted hover:text-text')}
          >
            {t}
          </button>
        ))}
      </div>
      <FilterBar range={range} onRange={setRange} filters={filters} onFilters={setFilters} />
      {tab === 'trades' ? <TradeList trades={filtered} loading={isLoading} /> : <StatsView trades={filtered} />}
      <TradeForm open={logging} onClose={() => setLogging(false)} />
      <ImportTradesDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function FilterBar({ range, onRange, filters, onFilters }: { range: Range; onRange: (r: Range) => void; filters: TradeFilters; onFilters: (f: TradeFilters) => void }) {
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const { data: accounts = [] } = useAccounts();
  const set = <K extends keyof TradeFilters>(k: K, v: TradeFilters[K]) => onFilters({ ...filters, [k]: v });
  const active = Object.values(filters).some(Boolean);
  const { data: reviewCount = 0 } = useReviewCount();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select aria-label="Date range" className="w-40" value={range} onChange={(e) => onRange(e.target.value as Range)}>
        <option value="last30">Last 30 days</option>
        <option value="month">This month</option>
        <option value="fy">This financial year</option>
        <option value="all">All time</option>
      </Select>
      <Select aria-label="Play" className="w-48" value={filters.playId} onChange={(e) => set('playId', e.target.value)}>
        <option value="">All Plays</option>
        {plays.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
        <option value="none">No Play</option>
      </Select>
      <Select aria-label="Grade" className="w-36" value={filters.grade} onChange={(e) => set('grade', e.target.value)}>
        <option value="">All grades</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
        <option value="outside">Outside plan</option>
      </Select>
      <Select aria-label="Contract" className="w-32" value={filters.contractId} onChange={(e) => set('contractId', e.target.value)}>
        <option value="">All contracts</option>
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.symbol}
          </option>
        ))}
      </Select>
      <Select aria-label="Account" className="w-44" value={filters.accountId} onChange={(e) => set('accountId', e.target.value)}>
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Result" className="w-32" value={filters.result} onChange={(e) => set('result', e.target.value as TradeFilters['result'])}>
        <option value="">Wins & losses</option>
        <option value="win">Wins</option>
        <option value="loss">Losses</option>
      </Select>
      {(reviewCount > 0 || filters.review) && (
        <button
          type="button"
          aria-pressed={filters.review}
          onClick={() => set('review', !filters.review)}
          className={cn('rounded-full border px-3 py-1 text-xs', filters.review ? 'border-accent bg-accent text-accent-text' : 'border-ember text-ember')}
        >
          Needs review{reviewCount ? ` (${reviewCount})` : ''}
        </button>
      )}
      {active && (
        <Button variant="ghost" onClick={() => onFilters(noFilters)}>
          Clear
        </Button>
      )}
    </div>
  );
}

function TradeList({ trades, loading }: { trades: TradeRow[]; loading: boolean }) {
  const navigate = useNavigate();
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const { data: accounts = [] } = useAccounts();
  const playName = (id: string | null) => plays.find((p) => p.id === id)?.title ?? '—';
  const symbol = (id: string) => contracts.find((c) => c.id === id)?.symbol ?? '?';
  const accountNames = (t: TradeRow) => t.accounts.map((a) => accounts.find((x) => x.id === a.accountId)?.name ?? '?').join(', ');

  const days = useMemo(() => {
    const map = new Map<string, TradeRow[]>();
    for (const t of trades) map.set(t.tradingDay, [...(map.get(t.tradingDay) ?? []), t]);
    return [...map.entries()];
  }, [trades]);

  if (!loading && trades.length === 0) {
    return <p className="panel p-10 text-center text-sm text-muted">No trades in this range. Use “Log trades” to add some.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">P&L in USD, after fees, summed across copied accounts.</p>
      {days.map(([day, list]) => {
        const net = list.reduce((s, t) => s + t.netCents, 0);
        return (
          <section key={day} className="overflow-hidden panel">
            <header className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm">
              <Link to="/journal/day/$day" params={{ day }} className="font-medium hover:underline">
                {DateTime.fromISO(day).toFormat('cccc d LLLL yyyy')}
              </Link>
              <span className="text-muted">
                {list.length} trade{list.length === 1 ? '' : 's'}
              </span>
              <Pnl cents={net} className="ml-auto font-semibold" />
            </header>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {[...list].reverse().map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-surface-2" onClick={() => navigate({ to: '/journal/trades/$tradeId', params: { tradeId: t.id } })}>
                    <td className="tabular w-20 px-4 py-2 text-muted">{formatLocal(t.openedAt, 'HH:mm')}</td>
                    <td className="w-16 py-2 font-medium">{symbol(t.contractId)}</td>
                    <td className={'w-16 py-2 capitalize text-muted'}>{t.direction}</td>
                    <td className="py-2">{playName(t.playId)}</td>
                    <td className="w-28 py-2">
                      {t.needsReview ? (
                        <span className="rounded-full px-2 py-0.5 text-xs text-ember ring-1 ring-inset ring-ember">Needs review</span>
                      ) : (
                        <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />
                      )}
                    </td>
                    <td className="hidden max-w-48 truncate py-2 text-muted lg:table-cell">{accountNames(t)}</td>
                    <td className="tabular w-16 py-2 text-right text-muted">{t.r === null ? '' : `${t.r}R`}</td>
                    <td className="w-28 px-4 py-2 text-right font-medium">
                      <Pnl cents={t.netCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
