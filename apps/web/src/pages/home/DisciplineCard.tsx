import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { formatLocal } from '@tc/domain';
import { CardHeader, ViewLink } from '../../components/ui';
import { api, type ReadingAnswer, type TradeRow } from '../../lib/api';
import { decisionLabels, useDayReadings } from '../../lib/checkins';

/** "Focused · Focus 4 · Energy 3" from a reading's non-text answers. */
const summary = (answers: ReadingAnswer[]) =>
  answers
    .filter((a) => a.value !== null && a.kind !== 'text' && a.kind !== 'yesPartlyNo')
    .map((a) => (a.kind === 'mood' ? a.label : `${a.prompt} ${a.value}`))
    .join(' · ');

export function DisciplineCard({ trades, today }: { trades: TradeRow[]; today: string }) {
  const { data: readings = [] } = useDayReadings(today);
  const latest = readings.at(-1);
  const recent = useMemo(() => [...trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 20), [trades]);
  const answered = recent.filter((t) => t.followedPlan);
  const followed = answered.filter((t) => t.followedPlan === 'yes').length;
  const pct = answered.length ? Math.round((followed / answered.length) * 100) : null;
  const outside = recent.filter((t) => t.outsidePlan).length;
  const mistakes = recent.filter((t) => t.mistakeIds.length > 0).length;
  const imports = trades.filter((t) => t.needsReview).length;

  // The last earlier trading day with trades, and whether it has a written review.
  const lastDay = useMemo(() => [...new Set(trades.map((t) => t.tradingDay))].filter((d) => d < today).sort().at(-1), [trades, today]);
  const { data: reviewDays = [] } = useQuery({
    queryKey: ['daily-reviews', lastDay],
    queryFn: () => api.get<string[]>(`/daily-reviews?from=${lastDay}&to=${lastDay}`),
    enabled: !!lastDay,
  });
  const needsReview = !!lastDay && !reviewDays.includes(lastDay);

  return (
    <section aria-labelledby="disc-h" className="card flex min-w-0 flex-[1_1_280px] flex-col gap-[18px] p-6">
      <CardHeader id="disc-h" title="Discipline" description="How closely you traded your plan" action={<ViewLink to="/journal">Journal</ViewLink>} />
      <div className="-mt-5">
        <div className="mt-1 text-[48px] leading-[1.1] font-medium tracking-[-0.035em]">{pct === null ? '—' : `${pct}%`}</div>
        <div className="mt-1 text-sm text-muted">
          followed plan · {followed} of {answered.length}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-[4px] bg-border-subtle" aria-hidden>
        <div className="h-2 bg-text" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1 rounded-lg bg-page px-4 py-3.5">
          <div className="text-[13px] text-muted">Outside plan</div>
          <div className="mt-0.5 text-2xl font-medium">{outside}</div>
        </div>
        <div className="flex-1 rounded-lg bg-page px-4 py-3.5">
          <div className="text-[13px] text-muted">With mistakes</div>
          <div className="mt-0.5 text-2xl font-medium">{mistakes}</div>
        </div>
      </div>
      <div className="mt-auto space-y-1.5 border-t border-border-subtle pt-3.5 text-[13px] text-muted">
        <p>
          {latest
            ? `${latest.kind === 'start' ? 'Session start' : 'Last check-in'} ${formatLocal(latest.at, 'HH:mm')}${summary(latest.answers) ? ` · ${summary(latest.answers)}` : ''}${
                latest.decision ? ` · ${decisionLabels[latest.decision]}` : ''
              }`
            : 'No check-in yet today'}
        </p>
        {imports > 0 && (
          <a href="/journal?review=1" className="link-ember block text-text">
            {imports} imported trade{imports === 1 ? '' : 's'} to review
          </a>
        )}
        {needsReview && (
          <Link to="/journal/day/$day" params={{ day: lastDay! }} className="link-ember inline-block text-text">
            Write your review for {DateTime.fromISO(lastDay!).toFormat('cccc d LLL')}
          </Link>
        )}
      </div>
    </section>
  );
}
