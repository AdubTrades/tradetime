import { DateTime } from 'luxon';
import { lazy, Suspense, useCallback, useMemo, type ReactNode } from 'react';
import { GRADES, stats, zoneLabel } from '@tc/domain';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import type { TradeRow } from '../../lib/api';
import { useAccounts, useList } from '../../lib/expenses';
import { useContracts, usePlays } from '../../lib/journal';

// ECharts is large; load it only when stats are shown.
const LineChart = lazy(() => import('../../components/LineChart').then((m) => ({ default: m.LineChart })));

const usd = (c: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(c / 100);
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const fixed = (x: number | null, dp = 2) => (x === null ? '—' : x.toFixed(dp));

const stateAnswer = (t: TradeRow, kind: 'mood' | 'scale', prompt?: string) =>
  t.state?.answers.find((a) => a.kind === kind && (!prompt || a.prompt === prompt) && a.value !== null);

/** Small samples are flagged: with 3–4 trades a session, results take a while to mean much. */
function N({ n }: { n: number }) {
  return <span className={`tabular text-xs ${n < 20 ? 'text-warning' : 'text-muted'}`}>n={n}</span>;
}

export function StatsView({ trades }: { trades: TradeRow[] }) {
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const { data: accounts = [] } = useAccounts();
  const { data: mistakes = [] } = useList('mistake');

  const inPlan = trades.filter((t) => !t.outsidePlan);
  const outside = trades.filter((t) => t.outsidePlan);
  const all = stats.summarise(trades);
  const graded = stats.summarise(inPlan);
  const curve = useMemo(() => stats.equityCurve(trades.map((t) => ({ ...t, at: t.openedAt }))), [trades]);
  const yFormat = useCallback((v: number) => usd(v), []);

  if (trades.length === 0) return <p className="rounded-lg border border-dashed border-border-strong/60 bg-card p-10 text-center text-sm text-muted">No trades match.</p>;

  const equityPoints = curve.map((p) => ({
    x: DateTime.fromISO(p.at).toFormat('d LLL'),
    y: p.equityCents,
    tooltip: `Trade ${p.index} · ${DateTime.fromISO(p.at).toFormat('d LLL HH:mm')}<br/>Result ${usd(p.netCents)} · Equity <b>${usd(p.equityCents)}</b>`,
  }));
  const ddPoints = curve.map((p) => ({ x: DateTime.fromISO(p.at).toFormat('d LLL'), y: p.drawdownCents, tooltip: `Trade ${p.index}<br/>Drawdown <b>${usd(p.drawdownCents)}</b>` }));

  // Per-account rows for the account breakdown.
  const accountRows = trades.flatMap((t) =>
    t.accounts.map((a) => ({ netCents: a.netCents, r: a.plannedRiskCents ? a.netCents / a.plannedRiskCents : null, accountId: a.accountId })),
  );

  const followed = stats.summariseBy(
    trades.filter((t) => t.followedPlan),
    (t) => t.followedPlan!,
    ['yes', 'partly', 'no'],
  );
  const mistakeRows = mistakes
    .map((m) => {
      const ts = trades.filter((t) => t.mistakeIds.includes(m.id));
      return { name: m.name, summary: stats.summarise(ts) };
    })
    .filter((m) => m.summary.n > 0)
    .sort((a, b) => a.summary.netCents - b.summary.netCents);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 2xl:grid-cols-7">
        <Tile label="Net P&L" value={<Pnl cents={all.netCents} />} n={all.n} />
        <Tile label="Win rate" value={pct(all.winRate)} n={all.n} />
        <Tile label="Avg win" value={all.avgWinCents === null ? '—' : <Pnl cents={all.avgWinCents} />} n={all.wins} />
        <Tile label="Avg loss" value={all.avgLossCents === null ? '—' : <Pnl cents={all.avgLossCents} />} n={all.losses} />
        <Tile label="Profit factor" value={fixed(all.profitFactor)} n={all.n} />
        <Tile label="Expectancy" value={all.expectancyCents === null ? '—' : <Pnl cents={all.expectancyCents} />} n={all.n} />
        <Tile label="Avg R" value={all.avgR === null ? '—' : `${all.avgR}R`} n={all.nR} />
      </div>

      <section className="card p-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Equity curve</h2>
          <span className="text-xs text-muted">
            Max drawdown <span className="tabular text-text">{usd(stats.maxDrawdown(curve))}</span> · <N n={curve.length} />
          </span>
        </div>
        <Suspense fallback={<div className="h-[352px]" />}>
          <LineChart points={equityPoints} colorVar="--text" yFormat={yFormat} ariaLabel="Equity curve: cumulative P&L by trade" />
          <h3 className="mt-4 mb-1 text-sm font-medium text-muted">Drawdown from peak</h3>
          <LineChart points={ddPoints} colorVar="--negative" area height={120} yFormat={yFormat} ariaLabel="Drawdown from running peak by trade" />
        </Suspense>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Graded vs outside plan" rows={[{ key: 'Within plan', summary: graded }, { key: 'Outside plan', summary: stats.summarise(outside) }].filter((r) => r.summary.n)} />
        <Breakdown
          title="By Play (within plan)"
          rows={stats.summariseBy(inPlan, (t) => t.playId ?? 'none').map((r) => ({ ...r, key: plays.find((p) => p.id === r.key)?.title ?? 'No Play' }))}
        />
      </div>

      <GradeByPlay trades={inPlan} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="By instrument" rows={stats.summariseBy(trades, (t) => contracts.find((c) => c.id === t.contractId)?.symbol ?? '?')} />
        <Breakdown title="By account" rows={stats.summariseBy(accountRows, (r) => r.accountId).map((r) => ({ ...r, key: accounts.find((a) => a.id === r.key)?.name ?? '?' }))} note="Each account's own result." />
        <Breakdown title={`By time of day (entry, ${zoneLabel()} time)`} rows={stats.summariseBy([...trades].sort((a, b) => stats.hourBucket(a.openedAt).localeCompare(stats.hourBucket(b.openedAt))), (t) => stats.hourBucket(t.openedAt))} />
        <Breakdown title="By day of week" rows={stats.summariseBy(trades, (t) => stats.weekdayOf(t.tradingDay), stats.WEEKDAYS)} />
      </div>

      <DisciplinePanels trades={trades} />

      <StateBreakdowns trades={trades} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Followed my plan?" rows={followed.map((r) => ({ ...r, key: r.key[0]!.toUpperCase() + r.key.slice(1) }))} note={`${trades.filter((t) => t.followedPlan).length} of ${trades.length} trades answered.`} />
        <Breakdown title="What mistakes cost" rows={mistakeRows.map((m) => ({ key: m.name, summary: m.summary }))} note="Net result of trades tagged with each mistake." />
      </div>
    </div>
  );
}

function Tile({ label, value, n }: { label: string; value: ReactNode; n: number }) {
  return (
    <div className="tile min-w-0 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted">
        <span>{label}</span> <N n={n} />
      </div>
      <div className="tabular font-display mt-2 truncate text-[26px] leading-tight">{value}</div>
    </div>
  );
}

function Breakdown({ title, rows, note }: { title: string; rows: { key: string; summary: stats.Summary }[]; note?: string }) {
  return (
    <section className="panel">
      <h2 className="border-b border-border-subtle px-5 py-3.5 text-base font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">No data.</p>
      ) : (
        <SummaryTable rows={rows.map((r) => ({ label: r.key, summary: r.summary }))} />
      )}
      {note && <p className="border-t border-border-subtle px-5 py-2 text-xs text-muted">{note}</p>}
    </section>
  );
}

function SummaryTable({ rows }: { rows: { label: ReactNode; summary: stats.Summary; extra?: ReactNode }[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted">
        <tr>
          <th className="px-4 py-1.5 font-medium" />
          <th className="px-2 py-1.5 text-right font-medium">n</th>
          <th className="px-2 py-1.5 text-right font-medium">Win %</th>
          <th className="px-2 py-1.5 text-right font-medium">Avg R</th>
          <th className="px-2 py-1.5 text-right font-medium">PF</th>
          <th className="px-4 py-1.5 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border-subtle">
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="px-4 py-1.5">
              {r.label}
              {r.extra}
            </td>
            <td className={`tabular px-2 py-1.5 text-right ${r.summary.n < 20 ? 'text-warning' : 'text-muted'}`}>{r.summary.n}</td>
            <td className="tabular px-2 py-1.5 text-right">{pct(r.summary.winRate)}</td>
            <td className="tabular px-2 py-1.5 text-right">{r.summary.avgR === null ? '—' : `${r.summary.avgR}R`}</td>
            <td className="tabular px-2 py-1.5 text-right">{fixed(r.summary.profitFactor)}</td>
            <td className="px-4 py-1.5 text-right">
              <Pnl cents={r.summary.netCents} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Win rate and average R by grade within each Play, with your risk rule per grade alongside. */
function GradeByPlay({ trades }: { trades: TradeRow[] }) {
  const { data: plays = [] } = usePlays();
  const withPlay = plays.filter((p) => trades.some((t) => t.playId === p.id));
  if (withPlay.length === 0) return null;
  return (
    <section className="panel">
      <h2 className="border-b border-border-subtle px-5 py-3.5 text-base font-semibold">By grade within each Play</h2>
      <div className="divide-y divide-border-subtle">
        {withPlay.map((p) => {
          const rows = stats.summariseBy(
            trades.filter((t) => t.playId === p.id),
            (t) => t.grade ?? 'C',
            GRADES,
          );
          return (
            <div key={p.id}>
              <h3 className="px-4 pt-3 text-sm font-medium">{p.title}</h3>
              <SummaryTable
                rows={rows.map((r) => ({
                  label: <GradeBadge grade={r.key} />,
                  extra: p.gradeRules.find((g) => g.grade === r.key)?.riskNote ? (
                    <span className="ml-2 text-xs text-muted">rule: {p.gradeRules.find((g) => g.grade === r.key)?.riskNote}</span>
                  ) : null,
                  summary: r.summary,
                }))}
              />
            </div>
          );
        })}
      </div>
      <p className="border-t border-border-subtle px-5 py-2 text-xs text-muted">Your risk rules are shown for reference; the app never sizes trades for you.</p>
    </section>
  );
}

/** Results grouped by the state reading in effect at entry (session start or latest check-in). */
function StateBreakdowns({ trades }: { trades: TradeRow[] }) {
  const withState = trades.filter((t) => t.state);
  if (withState.length === 0) return null;
  const scalePrompts = [...new Set(withState.flatMap((t) => t.state!.answers.filter((a) => a.kind === 'scale').map((a) => a.prompt)))];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Breakdown
        title="By mood at entry"
        rows={stats.summariseBy(withState.filter((t) => stateAnswer(t, 'mood')), (t) => stateAnswer(t, 'mood')?.label ?? '?')}
        note={`${withState.length} of ${trades.length} trades have a session-start or check-in reading.`}
      />
      {scalePrompts.map((p) => (
        <Breakdown
          key={p}
          title={`By ${p.toLowerCase()} at entry`}
          rows={stats.summariseBy(
            withState.filter((t) => stateAnswer(t, 'scale', p)),
            (t) => `${p} ${stateAnswer(t, 'scale', p)?.value}`,
            [1, 2, 3, 4, 5].map((n) => `${p} ${n}`),
          )}
        />
      ))}
    </div>
  );
}

/** Plan vs outcome, streaks, fatigue (time into session) and trades taken against a check-in decision. */
function DisciplinePanels({ trades }: { trades: TradeRow[] }) {
  const plan = stats.planAdherence(trades);
  const streak = stats.streaks(trades.map((t) => ({ ...t, at: t.openedAt })));
  const inSession = trades.filter((t) => t.sessionStart);
  const afterCheckIn = trades.filter((t) => t.state?.kind === 'checkin' && t.state.decision);
  const against = afterCheckIn.filter((t) => t.state!.decision !== 'keep_trading');
  const decisionLabel: Record<string, string> = { keep_trading: 'After “keep trading”', take_break: 'After “take a break”', stop: 'After “stop for the day”' };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-3 text-base font-semibold">Plan vs outcome</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted">Average planned R:R</dt>
            <dd className="tabular">{plan.avgPlannedRR === null ? '—' : `${plan.avgPlannedRR}:1`}</dd>
            <dt className="text-muted">Average actual R (same trades)</dt>
            <dd className="tabular">{plan.avgActualR === null ? '—' : `${plan.avgActualR}R`}</dd>
            <dt className="text-muted">Reached the planned target</dt>
            <dd className="tabular">
              {pct(plan.reachedPlan)} <N n={plan.n} />
            </dd>
            <dt className="text-muted">Losses bigger than planned risk (worse than −1.1R)</dt>
            <dd className="tabular">
              {plan.oversizedLosses} of {plan.losersWithR}
              {plan.oversizedLosses > 0 && (
                <>
                  {' '}
                  · <Pnl cents={plan.oversizedLossCents} />
                </>
              )}
            </dd>
          </dl>
          <p className="mt-3 text-xs text-muted">Only trades with a target and a stop (or risk in points) count towards planned R:R.</p>
        </section>
        <section className="card p-6">
          <h2 className="mb-3 text-base font-semibold">Streaks</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted">Longest winning streak</dt>
            <dd className="tabular">{streak.longestWin}</dd>
            <dt className="text-muted">Longest losing streak</dt>
            <dd className="tabular">{streak.longestLoss}</dd>
            <dt className="text-muted">Current</dt>
            <dd className={`tabular ${streak.current > 0 ? 'text-profit' : streak.current < 0 ? 'text-loss' : ''}`}>
              {streak.current === 0 ? '—' : `${Math.abs(streak.current)} ${streak.current > 0 ? (streak.current === 1 ? 'win' : 'wins') : streak.current === -1 ? 'loss' : 'losses'} in a row`}
            </dd>
          </dl>
          <p className="mt-3 text-xs text-muted">In order of entry across the trades shown. Breakeven trades end a streak.</p>
        </section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          title="By time into the session"
          rows={stats.summariseBy(inSession, (t) => stats.sessionBucket(t.sessionStart!, t.openedAt), stats.SESSION_BUCKETS)}
          note={`Screen time from pressing Start to entry. ${inSession.length} of ${trades.length} trades are linked to a session.`}
        />
        <Breakdown
          title="After a check-in decision"
          rows={stats.summariseBy(afterCheckIn, (t) => decisionLabel[t.state!.decision!] ?? '?', Object.values(decisionLabel))}
          note={
            against.length
              ? `${against.length} trade${against.length === 1 ? '' : 's'} taken after deciding to take a break or stop.`
              : 'Trades whose latest reading was a check-in, grouped by the decision you made.'
          }
        />
      </div>
    </div>
  );
}
