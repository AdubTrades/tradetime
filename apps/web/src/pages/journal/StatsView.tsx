import { DateTime } from 'luxon';
import { useCallback, useMemo, type ReactNode } from 'react';
import { GRADES, stats } from '@tc/domain';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { LineChart } from '../../components/LineChart';
import type { TradeRow } from '../../lib/api';
import { useAccounts, useList } from '../../lib/expenses';
import { useContracts, usePlays } from '../../lib/journal';

const usd = (c: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(c / 100);
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const fixed = (x: number | null, dp = 2) => (x === null ? '—' : x.toFixed(dp));

const stateAnswer = (t: TradeRow, kind: 'mood' | 'scale', prompt?: string) =>
  t.state?.answers.find((a) => a.kind === kind && (!prompt || a.prompt === prompt) && a.value !== null);

/** Small samples are flagged: with 3–4 trades a session, results take a while to mean much. */
function N({ n }: { n: number }) {
  return <span className={`tabular text-xs ${n < 20 ? 'text-warn' : 'text-muted'}`}>n={n}</span>;
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

  if (trades.length === 0) return <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">No trades match.</p>;

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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Tile label="Net P&L" value={<Pnl cents={all.netCents} />} n={all.n} />
        <Tile label="Win rate" value={pct(all.winRate)} n={all.n} />
        <Tile label="Avg win" value={all.avgWinCents === null ? '—' : <Pnl cents={all.avgWinCents} />} n={all.wins} />
        <Tile label="Avg loss" value={all.avgLossCents === null ? '—' : <Pnl cents={all.avgLossCents} />} n={all.losses} />
        <Tile label="Profit factor" value={fixed(all.profitFactor)} n={all.n} />
        <Tile label="Expectancy" value={all.expectancyCents === null ? '—' : <Pnl cents={all.expectancyCents} />} n={all.n} />
        <Tile label="Avg R" value={all.avgR === null ? '—' : `${all.avgR}R`} n={all.nR} />
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Equity curve</h2>
          <span className="text-xs text-muted">
            Max drawdown <span className="tabular text-text">{usd(stats.maxDrawdown(curve))}</span> · <N n={curve.length} />
          </span>
        </div>
        <LineChart points={equityPoints} colorVar="--accent" yFormat={yFormat} ariaLabel="Equity curve: cumulative P&L by trade" />
        <h3 className="mt-4 mb-1 text-sm font-medium text-muted">Drawdown from peak</h3>
        <LineChart points={ddPoints} colorVar="--loss" area height={120} yFormat={yFormat} ariaLabel="Drawdown from running peak by trade" />
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
        <Breakdown title="By time of day (entry, Perth)" rows={stats.summariseBy([...trades].sort((a, b) => stats.hourBucket(a.openedAt).localeCompare(stats.hourBucket(b.openedAt))), (t) => stats.hourBucket(t.openedAt))} />
        <Breakdown title="By day of week" rows={stats.summariseBy(trades, (t) => stats.weekdayOf(t.tradingDay), stats.WEEKDAYS)} />
      </div>

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
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted">
        <span>{label}</span> <N n={n} />
      </div>
      <div className="tabular mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Breakdown({ title, rows, note }: { title: string; rows: { key: string; summary: stats.Summary }[]; note?: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">No data.</p>
      ) : (
        <SummaryTable rows={rows.map((r) => ({ label: r.key, summary: r.summary }))} />
      )}
      {note && <p className="border-t border-border px-4 py-2 text-xs text-muted">{note}</p>}
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
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="px-4 py-1.5">
              {r.label}
              {r.extra}
            </td>
            <td className={`tabular px-2 py-1.5 text-right ${r.summary.n < 20 ? 'text-warn' : 'text-muted'}`}>{r.summary.n}</td>
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
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">By grade within each Play</h2>
      <div className="divide-y divide-border">
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
      <p className="border-t border-border px-4 py-2 text-xs text-muted">Your risk rules are shown for reference; the app never sizes trades for you.</p>
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
