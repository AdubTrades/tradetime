import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, CheckSquare, Eye, EyeOff, Plus, Square } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState, type ReactNode } from 'react';
import {
  durationMinutes,
  financialYear,
  financialYearOf,
  formatDuration,
  formatLocal,
  formatMoney,
  stats,
  tradingDay,
  weekStart,
} from '@tc/domain';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { ReadingChips } from '../../components/ReadingSummary';
import { Button, cn } from '../../components/ui';
import { api, type OccurrenceView, type TradeRow } from '../../lib/api';
import { useCalendarMutation, useEventTypes, useUpcoming } from '../../lib/calendar';
import { decisionLabels, useDayReadings } from '../../lib/checkins';
import { useFySummary, useRecurring } from '../../lib/expenses';
import { useContracts, usePlays, useTrades } from '../../lib/journal';
import { useNow, useSessions, useSessionTypes } from '../../lib/sessions';
import { useHealth } from '../../lib/demo';
import { useSettings } from '../../lib/settings';
import { swatch } from '../../lib/theme';
import { EventDialog } from '../calendar/EventDialog';
import { ExpenseDialog } from '../expenses/ExpenseDialog';
import { TradeForm } from '../journal/TradeForm';
import { TimerCard } from '../timelog/TimerCard';
import { Sparkline } from './Sparkline';
import { usePnlReveal } from './usePnlReveal';

/** Landing page: what's happening today, then short summaries that link through to each tab. */
export function HomePage() {
  const { data: settings } = useSettings();
  const now = useNow(30_000);
  const today = tradingDay(now, settings?.rolloverTime);
  const fy = financialYear(financialYearOf(today).startYear);
  const { data: trades = [] } = useTrades(fy.start, fy.end);
  const { data: types = [] } = useSessionTypes();
  const [revealed, setRevealed] = usePnlReveal(settings?.homeHidePnl ?? true, today);
  const [dialog, setDialog] = useState<'trade' | 'expense' | 'event' | null>(null);
  if (!settings) return null;

  const hour = DateTime.now().setZone('Australia/Perth').hour;
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = settings.reportName?.trim().split(/\s+/)[0];

  return (
    <div className="max-w-6xl space-y-6">
      <header className="mb-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.1]">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-muted">
            {DateTime.now().setZone('Australia/Perth').toFormat('cccc d LLLL')}
            {today !== DateTime.now().setZone('Australia/Perth').toISODate() && ` · trading day ${DateTime.fromISO(today).toFormat('ccc d LLL')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('event')}>
            <Plus size={16} aria-hidden /> Event
          </Button>
          <Button onClick={() => setDialog('expense')}>
            <Plus size={16} aria-hidden /> Expense
          </Button>
          <Button variant="primary" onClick={() => setDialog('trade')}>
            <Plus size={16} aria-hidden /> Log trades
          </Button>
        </div>
      </header>

      <Alerts />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <TimerCard types={types} longSessionHours={settings.longSessionHours} />
        <NextRelease now={now} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TodayPanel today={today} />
        <DisciplinePanel today={today} trades={trades} />
      </div>

      <PerformancePanel today={today} trades={trades} revealed={revealed} onReveal={setRevealed} canHide={settings.homeHidePnl} />

      <BusinessPanel fyStartYear={fy.startYear} />

      <TradeForm open={dialog === 'trade'} onClose={() => setDialog(null)} defaults={{ tradingDay: today }} />
      <ExpenseDialog open={dialog === 'expense'} expense={null} onClose={() => setDialog(null)} onHistory={() => undefined} onMakeRecurring={() => undefined} />
      <EventDialog open={dialog === 'event'} onClose={() => setDialog(null)} defaultDate={today} />
    </div>
  );
}

function SectionHead({ title, to, linkLabel, children }: { title: string; to: string; linkLabel: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg">{title}</h2>
      <div className="flex items-center gap-3">
        {children}
        <Link to={to} className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
          {linkLabel} <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

// ---------- Alerts: only when something needs attention ----------

function Alerts() {
  const { data: settings } = useSettings();
  const { data: appHealth } = useHealth();
  const { data: backup } = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => api.get<{ lastSuccessAt: string | null; lastError: string | null }>('/backup/status'),
  });
  const { data: health } = useQuery({
    queryKey: ['data-health'],
    queryFn: () => api.get<{ checks: { id: string; status: string; detail: string }[] }>('/health/data'),
  });
  const items: { text: string; to: string }[] = [];
  if (backup?.lastError) items.push({ text: `The last backup failed: ${backup.lastError}`, to: '/settings' });
  else if (backup && (!backup.lastSuccessAt || Date.now() - Date.parse(backup.lastSuccessAt) > 72 * 3_600_000))
    items.push({ text: 'No backup in the last 3 days', to: '/settings' });
  for (const c of health?.checks ?? []) if (c.status === 'fail' || (c.id === 'timer' && c.status === 'warn')) items.push({ text: c.detail, to: c.id === 'timer' ? '/time-log' : '/settings' });
  if (settings && !settings.fredApiKey) items.push({ text: 'Add your FRED API key to see economic events', to: '/settings' });
  // The demo copy has no backups or FRED key by design, so its alerts would only confuse.
  if (items.length === 0 || appHealth?.demo) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.text}>
          <Link to={i.to} className="flex items-center gap-2 rounded-[6px_0_0_0] bg-ivory px-4 py-2 text-sm hover:bg-ivory/70">
            <AlertTriangle size={15} className="shrink-0 text-brass" aria-hidden />
            <span className="flex-1">{i.text}</span>
            <ArrowRight size={14} className="text-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------- Next high-impact release, with a countdown ----------

function NextRelease({ now }: { now: Date }) {
  const { data } = useUpcoming(7);
  const next = data?.market.filter((m) => m.impact === 'high' && Date.parse(m.at) > now.getTime())[0];
  const mins = next ? (Date.parse(next.at) - now.getTime()) / 60_000 : 0;
  const countdown = mins < 60 ? `${Math.max(1, Math.round(mins))}m` : mins < 48 * 60 ? formatDuration(mins) : `${Math.round(mins / 1440)} days`;
  return (
    <Link to="/calendar" className="tile flex flex-col justify-between gap-3 px-6 py-5 hover:bg-ivory">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="h-2 w-2 rounded-full bg-ember" aria-hidden /> Next high-impact release
      </div>
      {next ? (
        <div>
          <div className="font-display text-2xl leading-tight">{next.title}</div>
          <div className="mt-1 text-sm text-muted">
            {formatLocal(next.at, 'ccc d LLL, HH:mm')} · <span className="text-ember">in {countdown}</span>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted">None in the next 7 days.</div>
      )}
    </Link>
  );
}

// ---------- Today: events, planned sessions, open tasks ----------

function TodayPanel({ today }: { today: string }) {
  const { data } = useUpcoming(2);
  const { data: types = [] } = useEventTypes();
  const [editing, setEditing] = useState<OccurrenceView | null>(null);
  const toggleDone = useCalendarMutation((o: OccurrenceView) =>
    o.recurring ? api.put(`/calendar/events/${o.eventId}/occurrences/${o.occurrenceDate}`, { done: !o.done }) : api.post(`/calendar/events/${o.eventId}/done`, { done: !o.done }),
  );
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
  const day = (d: string) => [
    ...(data?.market.filter((m) => m.tradingDay === d).map((m) => ({ key: m.id, sort: m.at, el: <MarketRow time={formatLocal(m.at, 'HH:mm')} title={m.title} impact={m.impact} /> })) ?? []),
    ...(data?.occurrences
      .filter((o) => (o.date < today ? d === today : o.date === d) && !(o.isTask && o.done))
      .map((o) => ({
        key: o.key,
        sort: o.startAt ?? `${o.date}T00:00`,
        el: (
          <div className="flex items-center gap-2">
            {o.isTask ? (
              <button type="button" aria-label="Mark done" onClick={() => toggleDone.mutate(o)} className="text-muted hover:text-text">
                {o.done ? <CheckSquare size={14} /> : <Square size={14} />}
              </button>
            ) : (
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: swatch(types.find((t) => t.id === o.typeId)?.color) }} aria-hidden />
            )}
            <span className="tabular w-11 text-xs text-muted">{o.allDay || !o.startTime ? (o.date < today ? 'Due' : 'All day') : o.startTime}</span>
            <button type="button" onClick={() => setEditing(o)} className={cn('truncate text-left hover:underline', o.date < today && 'text-ember')}>
              {o.title}
            </button>
          </div>
        ),
      })) ?? []),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  const todayItems = day(today);
  const tomorrowItems = day(tomorrow);
  return (
    <section className="panel p-6">
      <SectionHead title="Today" to="/calendar" linkLabel="Calendar" />
      {todayItems.length === 0 ? <p className="text-sm text-muted">Nothing scheduled today.</p> : <ul className="space-y-2 text-sm">{todayItems.map((i) => <li key={i.key}>{i.el}</li>)}</ul>}
      {tomorrowItems.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 text-[13px] text-brass">Tomorrow</h3>
          <ul className="space-y-2 text-sm">
            {tomorrowItems.map((i) => (
              <li key={i.key}>{i.el}</li>
            ))}
          </ul>
        </>
      )}
      <EventDialog open={!!editing} onClose={() => setEditing(null)} occurrence={editing} />
    </section>
  );
}

function MarketRow({ time, title, impact }: { time: string; title: string; impact: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', impact === 'high' ? 'bg-ember' : 'bg-brass')} aria-label={`${impact} impact`} />
      <span className="tabular w-11 text-xs text-muted">{time}</span>
      <span className="truncate">{title}</span>
    </div>
  );
}

// ---------- Discipline: state, plan adherence, review nudge ----------

function DisciplinePanel({ today, trades }: { today: string; trades: TradeRow[] }) {
  const { data: readings = [] } = useDayReadings(today);
  const latest = readings.at(-1);
  const recent = useMemo(() => [...trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 20), [trades]);
  const answered = recent.filter((t) => t.followedPlan);
  const followed = answered.filter((t) => t.followedPlan === 'yes').length;
  const outside = recent.filter((t) => t.outsidePlan).length;
  const mistakes = recent.filter((t) => t.mistakeIds.length > 0).length;

  // The most recent earlier trading day with trades, and whether it has a review.
  const lastDay = useMemo(() => [...new Set(trades.map((t) => t.tradingDay))].filter((d) => d < today).sort().at(-1), [trades, today]);
  const { data: reviewDays = [] } = useQuery({
    queryKey: ['daily-reviews', lastDay],
    queryFn: () => api.get<string[]>(`/daily-reviews?from=${lastDay}&to=${lastDay}`),
    enabled: !!lastDay,
  });
  const needsReview = !!lastDay && !reviewDays.includes(lastDay);

  return (
    <section className="panel p-6">
      <SectionHead title="Discipline" to="/journal" linkLabel="Journal" />
      <div className="space-y-4 text-sm">
        <div>
          <div className="mb-1 text-xs text-muted">{latest ? `${latest.kind === 'start' ? 'Session start' : 'Last check-in'} · ${formatLocal(latest.at, 'HH:mm')}` : 'State today'}</div>
          {latest ? <ReadingChips answers={latest.answers} decision={latest.decision} /> : <p className="text-muted">No session-start checklist or check-in yet today.</p>}
          {latest?.decision && latest.decision !== 'keep_trading' && (
            <p className="mt-1 text-xs text-ember">You decided to {decisionLabels[latest.decision].toLowerCase()}.</p>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <Metric label="Followed plan" value={answered.length ? `${Math.round((followed / answered.length) * 100)}%` : '—'} n={answered.length} />
          <Metric label="Outside plan" value={String(outside)} n={recent.length} />
          <Metric label="With mistakes" value={String(mistakes)} n={recent.length} />
        </dl>
        <p className="text-xs text-muted">Last {recent.length} trades.</p>
        {needsReview && (
          <Link to="/journal/day/$day" params={{ day: lastDay! }} className="link-ember inline-block text-sm">
            Write your review for {DateTime.fromISO(lastDay!).toFormat('cccc d LLL')}
          </Link>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, n }: { label: string; value: ReactNode; n?: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">
        {label}
        {n !== undefined && <span className={cn('ml-1', n < 20 ? 'text-warn' : '')}>n={n}</span>}
      </dt>
      <dd className="font-display tabular mt-0.5 text-2xl leading-tight">{value}</dd>
    </div>
  );
}

// ---------- Performance (P&L hidden until revealed) ----------

const HIDDEN = <span className="tracking-widest text-muted">••••</span>;

function PerformancePanel({ today, trades, revealed, onReveal, canHide }: { today: string; trades: TradeRow[]; revealed: boolean; onReveal: (r: boolean) => void; canHide: boolean }) {
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const week = weekStart(today);
  const month = today.slice(0, 7);
  const periods = [
    { label: 'This week', rows: trades.filter((t) => t.tradingDay >= week && t.tradingDay <= today) },
    { label: 'This month', rows: trades.filter((t) => t.tradingDay.startsWith(month)) },
    { label: 'Financial year', rows: trades },
  ].map((p) => ({ ...p, s: stats.summarise(p.rows) }));
  const since = DateTime.fromISO(today).minus({ days: 29 }).toISODate()!;
  const curve = stats.equityCurve(trades.filter((t) => t.tradingDay >= since).map((t) => ({ ...t, at: t.openedAt })));
  const streak = stats.streaks(trades.map((t) => ({ ...t, at: t.openedAt })));
  const last = [...trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 5);

  return (
    <section className="panel p-6">
      <SectionHead title="Performance" to="/journal" linkLabel="Stats">
        {canHide && (
          <Button variant="ghost" className="text-xs" onClick={() => onReveal(!revealed)} aria-pressed={revealed}>
            {revealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {revealed ? 'Hide P&L' : 'Reveal P&L'}
          </Button>
        )}
      </SectionHead>
      {!revealed && <p className="-mt-2 mb-4 text-xs text-muted">Results are hidden so they don't colour your next session. Trade counts are shown.</p>}
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_1.3fr]">
        {periods.map((p) => (
          <div key={p.label} className="tile bg-bg px-5 py-4">
            <div className="flex items-baseline justify-between text-xs text-muted">
              <span>{p.label}</span>
              <span className={p.s.n < 20 ? 'text-warn' : ''}>n={p.s.n}</span>
            </div>
            <div className="font-display tabular mt-2 text-[26px] leading-tight">{revealed ? <Pnl cents={p.s.netCents} /> : HIDDEN}</div>
            <div className="mt-1 text-xs text-muted">
              {revealed ? (
                <>
                  {p.s.winRate === null ? '—' : `${Math.round(p.s.winRate * 100)}% win`}
                  {p.s.avgR !== null && ` · ${p.s.avgR}R avg`}
                </>
              ) : (
                `${p.s.n} trade${p.s.n === 1 ? '' : 's'}`
              )}
            </div>
          </div>
        ))}
        <div className="tile bg-bg px-5 py-4">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>Last 30 days</span>
            {revealed && streak.current !== 0 && (
              <span>
                {Math.abs(streak.current)} {streak.current > 0 ? (streak.current === 1 ? 'win' : 'wins') : streak.current === -1 ? 'loss' : 'losses'} in a row
              </span>
            )}
          </div>
          <div className="mt-3">
            {revealed ? (
              <Sparkline values={curve.map((p) => p.equityCents)} label={`Cumulative P&L over the last 30 days: ${curve.at(-1) ? formatMoney(curve.at(-1)!.equityCents, 'USD') : 'no trades'}`} />
            ) : (
              <div className="flex h-12 items-center text-xs text-muted">Equity curve hidden</div>
            )}
          </div>
        </div>
      </div>

      <h3 className="mt-6 mb-2 text-[13px] text-brass">Recent trades</h3>
      {last.length === 0 ? (
        <p className="text-sm text-muted">No trades this financial year yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {last.map((t) => (
            <li key={t.id}>
              <Link to="/journal/trades/$tradeId" params={{ tradeId: t.id }} className="flex items-center gap-3 py-2 hover:bg-surface-2">
                <span className="tabular w-24 text-xs text-muted">{DateTime.fromISO(t.tradingDay).toFormat('ccc d LLL')}</span>
                <span className="w-12">{contracts.find((c) => c.id === t.contractId)?.symbol}</span>
                <span className="w-12 text-muted capitalize">{t.direction}</span>
                <span className="min-w-0 flex-1 truncate">{plays.find((p) => p.id === t.playId)?.title ?? 'No Play'}</span>
                <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />
                <span className="w-24 text-right">{revealed ? <Pnl cents={t.netCents} /> : HIDDEN}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Business: hours, expenses, payouts, next charge ----------

function BusinessPanel({ fyStartYear }: { fyStartYear: number }) {
  const fy = financialYear(fyStartYear);
  const { data: sessions = [] } = useSessions(fy.start, fy.end);
  const { data: summary } = useFySummary(fyStartYear);
  const { data: recurring = [] } = useRecurring();
  const hours = sessions.reduce((s, x) => s + durationMinutes(x), 0);
  const next = recurring.filter((r) => r.active && r.nextDate).sort((a, b) => a.nextDate!.localeCompare(b.nextDate!))[0];

  return (
    <section className="panel p-6">
      <SectionHead title={`Business · FY ${fy.label}`} to="/expenses" linkLabel="Expenses" />
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Link to="/time-log" className="tile bg-bg px-5 py-4 hover:bg-surface-2">
          <dt className="text-xs text-muted">Business hours</dt>
          <dd className="font-display tabular mt-2 text-[26px] leading-tight">{formatDuration(hours)}</dd>
          <dd className="mt-1 text-xs text-muted">{sessions.length} sessions</dd>
        </Link>
        <div className="tile bg-bg px-5 py-4">
          <dt className="text-xs text-muted">Claimable expenses</dt>
          <dd className="font-display tabular mt-2 text-[26px] leading-tight">{summary ? formatMoney(summary.expenses.total.deductibleCents) : '—'}</dd>
          <dd className="mt-1 text-xs text-muted">{summary?.expenses.total.count ?? 0} expenses</dd>
        </div>
        <div className="tile bg-bg px-5 py-4">
          <dt className="text-xs text-muted">Payouts received</dt>
          <dd className="font-display tabular mt-2 text-[26px] leading-tight">{summary ? formatMoney(summary.payouts.audReceivedCents) : '—'}</dd>
          <dd className="mt-1 text-xs text-muted">{summary?.payouts.count ?? 0} payouts</dd>
        </div>
        <div className="tile bg-bg px-5 py-4">
          <dt className="text-xs text-muted">Next recurring charge</dt>
          {next ? (
            <>
              <dd className="font-display mt-2 truncate text-xl leading-tight">{next.name}</dd>
              <dd className="mt-1 text-xs text-muted">
                {DateTime.fromISO(next.nextDate!).toFormat('ccc d LLL')} · {formatMoney(next.exGstCents + next.gstCents)}
              </dd>
            </>
          ) : (
            <dd className="mt-2 text-sm text-muted">None set up</dd>
          )}
        </div>
      </dl>
    </section>
  );
}
