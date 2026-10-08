import { Link } from '@tanstack/react-router';
import { ArrowUpRight, FileUp, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { financialYear, financialYearOf, formatLocal, GRADES, stats, tradingDay } from '@tc/domain';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { Button, cn, PageHeader, SegmentedTabs, Select, StatusPill, SummaryStrip } from '../../components/ui';
import type { TradeRow } from '../../lib/api';
import { useAccounts } from '../../lib/expenses';
import { useContracts, usePlays, useReviewCount, useTrades } from '../../lib/journal';
import { useSettings } from '../../lib/settings';
import { StatsView } from './StatsView';
import { ImportTradesDialog } from './ImportTradesDialog';
import { TradeForm } from './TradeForm';

type Range = 'last30' | 'last7' | 'month' | 'fy' | 'all';
const DEFAULT_RANGE: Range = 'last30';
const DAYS_PER_PAGE = 10;

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

/** "Lucid 50K · Funded #1, #2" from names that share leading words; otherwise a plain list. */
export function shortenAccounts(names: string[]): string {
  if (names.length < 2) return names[0] ?? '';
  const words = names.map((n) => n.split(/\s+/));
  let common = 0;
  while (words.every((w) => w.length > common + 1 && w[common] === words[0]![common])) common++;
  if (common === 0) return names.join(', ');
  return `${words[0]!.slice(0, common).join(' ')} · ${words.map((w) => w.slice(common).join(' ')).join(', ')}`;
}

export function JournalPage() {
  const { data: settings } = useSettings();
  const today = tradingDay(new Date(), settings?.rolloverTime);
  const [tab, setTab] = useState<'trades' | 'stats'>('trades');
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  // Home links here with ?review=1 to show imported trades that still need a Play and checklist.
  const [filters, setFilters] = useState<TradeFilters>(() => ({ ...noFilters, review: new URLSearchParams(window.location.search).get('review') === '1' }));
  const [logging, setLogging] = useState(false);
  const [importing, setImporting] = useState(false);

  const { from, to } = useMemo(() => {
    const d = DateTime.fromISO(today);
    switch (range) {
      case 'last7':
        return { from: d.minus({ days: 6 }).toISODate()!, to: today };
      case 'last30':
        return { from: d.minus({ days: 29 }).toISODate()!, to: today };
      case 'month':
        return { from: d.startOf('month').toISODate()!, to: d.endOf('month').toISODate()! };
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
  const active = range !== DEFAULT_RANGE || Object.values(filters).some(Boolean);
  const clear = () => {
    setRange(DEFAULT_RANGE);
    setFilters(noFilters);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Journal"
        description="P&L in USD, after fees, summed across copied accounts."
        actions={
          <>
            <Button onClick={() => setImporting(true)}>
              <FileUp size={15} aria-hidden /> Import
            </Button>
            <Button variant="primary" onClick={() => setLogging(true)}>
              <Plus size={14} aria-hidden /> Log trades
            </Button>
          </>
        }
      />
      <SegmentedTabs
        label="Journal view"
        className="-mt-6 self-start"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'trades', label: 'Trades' },
          { value: 'stats', label: 'Stats' },
        ]}
      />
      <FilterBar range={range} onRange={setRange} filters={filters} onFilters={setFilters} active={active} onClear={clear} />
      {tab === 'trades' ? (
        <>
          <Summary trades={filtered} />
          <TradeList trades={filtered} loading={isLoading} filtered={active} onClear={clear} />
        </>
      ) : (
        <StatsView trades={filtered} />
      )}
      <TradeForm open={logging} onClose={() => setLogging(false)} />
      <ImportTradesDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

interface FilterBarProps {
  range: Range;
  onRange: (r: Range) => void;
  filters: TradeFilters;
  onFilters: (f: TradeFilters) => void;
  active: boolean;
  onClear: () => void;
}

function FilterBar({ range, onRange, filters, onFilters, active, onClear }: FilterBarProps) {
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const { data: accounts = [] } = useAccounts();
  const set = <K extends keyof TradeFilters>(k: K, v: TradeFilters[K]) => onFilters({ ...filters, [k]: v });
  const { data: reviewCount = 0 } = useReviewCount();
  const common = { highlightActive: true, size: 'sm' as const, className: 'h-[38px] min-w-[130px] w-auto' };
  // Phones show the date range and a Filters button; the rest open below it.
  const [open, setOpen] = useState(false);
  const chosen = [filters.playId, filters.grade, filters.contractId, filters.accountId, filters.result].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Date range" {...common} className={cn(common.className, 'min-w-[150px]')} value={range} onChange={(e) => onRange(e.target.value as Range)}>
        <option value="last30">Last 30 days</option>
        <option value="last7">Last 7 days</option>
        <option value="month">This month</option>
        <option value="fy">This financial year</option>
        <option value="all">All time</option>
      </Select>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-[38px] items-center rounded-md border px-3.5 text-[13px] font-medium sm:hidden', chosen ? 'border-text bg-text text-card' : 'border-border bg-card text-text')}
      >
        Filters{chosen ? ` (${chosen})` : ''}
      </button>
      <div className={cn('contents', !open && 'max-sm:hidden')}>
      <Select aria-label="Play" {...common} value={filters.playId} onChange={(e) => set('playId', e.target.value)}>
        <option value="">All plays</option>
        {plays.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
        <option value="none">No Play</option>
      </Select>
      <Select aria-label="Grade" {...common} className={cn(common.className, 'min-w-[120px]')} value={filters.grade} onChange={(e) => set('grade', e.target.value)}>
        <option value="">All grades</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
        <option value="outside">Outside plan</option>
      </Select>
      <Select aria-label="Contract" {...common} value={filters.contractId} onChange={(e) => set('contractId', e.target.value)}>
        <option value="">All contracts</option>
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.symbol}
          </option>
        ))}
      </Select>
      <Select aria-label="Account" {...common} value={filters.accountId} onChange={(e) => set('accountId', e.target.value)}>
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Outcome" {...common} value={filters.result} onChange={(e) => set('result', e.target.value as TradeFilters['result'])}>
        <option value="">Wins & losses</option>
        <option value="win">Wins only</option>
        <option value="loss">Losses only</option>
      </Select>
      </div>
      {(reviewCount > 0 || filters.review) && (
        <button
          type="button"
          aria-pressed={filters.review}
          onClick={() => set('review', !filters.review)}
          className={cn(
            'flex h-[38px] items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors',
            filters.review ? 'border-text bg-text text-card' : 'border-ember/50 bg-card text-warning hover:bg-hover',
          )}
        >
          Needs review{reviewCount ? ` (${reviewCount})` : ''}
        </button>
      )}
      {active && (
        <button type="button" onClick={onClear} className="h-[38px] rounded-sm px-2.5 text-[13px] font-medium text-secondary underline underline-offset-[3px] hover:text-text">
          Clear filters
        </button>
      )}
    </div>
  );
}

function Summary({ trades }: { trades: TradeRow[] }) {
  const s = stats.summarise(trades);
  return (
    <SummaryStrip
      items={[
        { label: 'Net P&L', value: <Pnl cents={s.netCents} /> },
        { label: 'Trades', value: s.n },
        { label: 'Win rate', value: s.winRate === null ? '—' : `${Math.round(s.winRate * 100)}%` },
        { label: 'Avg R', value: s.avgR === null ? '—' : `${s.avgR}R` },
      ]}
    />
  );
}

function TradeList({ trades, loading, filtered, onClear }: { trades: TradeRow[]; loading: boolean; filtered: boolean; onClear: () => void }) {
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const { data: accounts = [] } = useAccounts();
  const [shownDays, setShownDays] = useState(DAYS_PER_PAGE);
  const playName = (id: string | null) => plays.find((p) => p.id === id)?.title ?? 'No Play';
  const symbol = (id: string) => contracts.find((c) => c.id === id)?.symbol ?? '?';
  const accountNames = (t: TradeRow) => shortenAccounts(t.accounts.map((a) => accounts.find((x) => x.id === a.accountId)?.name ?? '?'));

  const days = useMemo(() => {
    const map = new Map<string, TradeRow[]>();
    for (const t of trades) map.set(t.tradingDay, [...(map.get(t.tradingDay) ?? []), t]);
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [trades]);
  // A new set of trades (filters or range changed) starts from the first page again.
  useEffect(() => setShownDays(DAYS_PER_PAGE), [trades]);

  if (loading) return null;
  if (trades.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border-strong/60 bg-card px-6 py-10 text-center">
        <p className="text-[15px] font-medium">{filtered ? 'No trades match these filters' : 'No trades in this range'}</p>
        {filtered ? (
          <Button size="sm" className="mt-3.5" onClick={onClear}>
            Clear filters
          </Button>
        ) : (
          <p className="mt-1 text-sm text-muted">Use “Log trades” or import from NinjaTrader to add some.</p>
        )}
      </section>
    );
  }

  return (
    <>
      {days.slice(0, shownDays).map(([day, list]) => {
        const net = list.reduce((s, t) => s + t.netCents, 0);
        const label = DateTime.fromISO(day).toFormat('cccc d LLLL');
        return (
          <section key={day} aria-label={label} className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                  <Link to="/journal/day/$day" params={{ day }} className="rounded-sm hover:underline">
                    {label}
                  </Link>
                </h2>
                <span className="text-[13px] text-muted">
                  {list.length} trade{list.length === 1 ? '' : 's'}
                </span>
              </div>
              <Pnl cents={net} className="text-[15px] font-medium" />
            </div>
            {/* Phones: two-line rows. Wider: the full row of columns. */}
            <div className="divide-y divide-border-subtle sm:hidden">
              {[...list].reverse().map((t) => (
                <Link key={t.id} to="/journal/trades/$tradeId" params={{ tradeId: t.id }} className="flex flex-col gap-1 px-4 py-3 hover:bg-hover active:bg-hover">
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className="font-mono text-[13px] text-muted">{formatLocal(t.openedAt, 'HH:mm')}</span>
                    <span className="font-medium">{symbol(t.contractId)}</span>
                    <span className="flex items-center gap-1 text-[13px] text-secondary capitalize">
                      <ArrowUpRight size={12} strokeWidth={2.2} className={t.direction === 'short' ? 'rotate-90' : ''} aria-hidden />
                      {t.direction}
                    </span>
                    <Pnl cents={t.netCents} className="ml-auto font-medium" />
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span className="min-w-0 truncate text-secondary">{playName(t.playId)}</span>
                    <span className="shrink-0">{t.needsReview ? <StatusPill className="border-ember/50 text-warning">Needs review</StatusPill> : <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />}</span>
                    <span className="ml-auto shrink-0 text-secondary">{t.r === null ? '' : `${t.r}R`}</span>
                  </span>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <div className="min-w-[720px] px-2 py-1">
                {[...list].reverse().map((t) => (
                  <Link
                    key={t.id}
                    to="/journal/trades/$tradeId"
                    params={{ tradeId: t.id }}
                    className="grid min-h-[50px] grid-cols-[52px_52px_64px_minmax(0,1fr)_auto_190px_64px_96px] items-center gap-3 rounded-sm px-3 text-sm hover:bg-hover"
                  >
                    <span className="font-mono text-[13px] text-muted">{formatLocal(t.openedAt, 'HH:mm')}</span>
                    <span className="font-medium">{symbol(t.contractId)}</span>
                    <span className="flex items-center gap-1 text-[13px] text-secondary capitalize">
                      <ArrowUpRight size={12} strokeWidth={2.2} className={t.direction === 'short' ? 'rotate-90' : ''} aria-hidden />
                      {t.direction}
                    </span>
                    <span className="truncate">{playName(t.playId)}</span>
                    <span className="justify-self-start">{t.needsReview ? <StatusPill className="border-ember/50 text-warning">Needs review</StatusPill> : <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />}</span>
                    <span className="truncate text-xs text-muted">{accountNames(t)}</span>
                    <span className="text-right text-[13px] text-secondary">{t.r === null ? '' : `${t.r}R`}</span>
                    <Pnl cents={t.netCents} className="text-right font-medium" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        );
      })}
      <p className="text-center text-[13px] text-muted">
        {days.length > shownDays ? (
          <>
            Showing the {shownDays} most recent trading days.{' '}
            <button type="button" onClick={() => setShownDays((n) => n + DAYS_PER_PAGE)} className="rounded-sm font-medium text-text underline underline-offset-[3px]">
              Load more
            </button>
          </>
        ) : (
          `${days.length} trading day${days.length === 1 ? '' : 's'} in this range.`
        )}
      </p>
    </>
  );
}
