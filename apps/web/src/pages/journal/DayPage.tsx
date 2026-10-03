import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { durationMinutes, formatDuration, formatLocal } from '@tc/domain';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { Button, Card, cn, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useContracts, usePlays, useTrades } from '../../lib/journal';
import { useSessions, useSessionTypes } from '../../lib/sessions';
import { useDayReadings } from '../../lib/checkins';
import { ReadingChips, ReadingNotes } from '../../components/ReadingSummary';
import { TradeForm } from './TradeForm';

/** Everything for one trading day: trades, sessions and the end-of-day review. */
export function DayPage({ day }: { day: string }) {
  const navigate = useNavigate();
  const dt = DateTime.fromISO(day);
  const { data: trades = [] } = useTrades(day, day);
  const { data: sessions = [] } = useSessions(day, day);
  const { data: types = [] } = useSessionTypes();
  const { data: readings = [] } = useDayReadings(day);
  const { data: plays = [] } = usePlays();
  const { data: contracts = [] } = useContracts();
  const [logging, setLogging] = useState(false);
  const net = trades.reduce((s, t) => s + t.netCents, 0);
  const screen = sessions.reduce((s, x) => s + durationMinutes(x), 0);
  const go = (d: DateTime) => navigate({ to: '/journal/day/$day', params: { day: d.toISODate()! } });

  return (
    <div className="max-w-4xl space-y-6">
      <Link to="/journal" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} aria-hidden /> Journal
      </Link>
      <PageHeader
        title={dt.toFormat('cccc d LLLL yyyy')}
        actions={
          <>
            <Button variant="ghost" aria-label="Previous day" onClick={() => go(dt.minus({ days: 1 }))}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="ghost" aria-label="Next day" onClick={() => go(dt.plus({ days: 1 }))}>
              <ChevronRight size={16} />
            </Button>
            <Button variant="primary" onClick={() => setLogging(true)}>
              <Plus size={16} aria-hidden /> Log trades
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-3 gap-4">
        <div className="tile px-5 py-4">
          <div className="text-xs text-muted">Net (USD)</div>
          <div className="font-display mt-1 text-2xl leading-tight">
            <Pnl cents={net} />
          </div>
        </div>
        <div className="tile px-5 py-4">
          <div className="text-xs text-muted">Trades</div>
          <div className="font-display mt-1 text-2xl leading-tight">
            {trades.length}
            {trades.length > 0 && <span className="text-sm font-normal text-muted"> · {trades.filter((t) => t.netCents > 0).length} won</span>}
          </div>
        </div>
        <div className="tile px-5 py-4">
          <div className="text-xs text-muted">Screen time</div>
          <div className="tabular font-display mt-1 text-2xl leading-tight">{formatDuration(screen)}</div>
        </div>
      </div>

      <Card title="Timeline">
        {trades.length + sessions.length + readings.length === 0 ? (
          <p className="text-sm text-muted">Nothing logged for this day.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {[
              ...sessions.flatMap((s) => [
                { at: s.start, el: <span className="text-muted">▶ Started {types.find((x) => x.id === s.typeId)?.name ?? 'session'}</span> },
                ...(s.end ? [{ at: s.end, el: <span className="text-muted">■ Stopped · {formatDuration(durationMinutes(s))}</span> }] : []),
              ]),
              ...readings.map((r) => ({
                at: r.at,
                el: (
                  <div className={cn('rounded-md border px-2 py-1.5', r.kind === 'start' ? 'border-ember/30 bg-ember/5' : 'border-medium/30 bg-medium/5')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold">{r.kind === 'start' ? 'Session start' : 'Check-in'}</span>
                      <ReadingChips answers={r.answers} decision={r.decision} />
                    </div>
                    <ReadingNotes answers={r.answers} />
                  </div>
                ),
              })),
              ...trades.map((t) => ({
                at: t.openedAt,
                el: (
                  <Link to="/journal/trades/$tradeId" params={{ tradeId: t.id }} className="flex flex-wrap items-center gap-2 rounded-sm px-1 hover:bg-hover">
                    <span className="font-medium">{contracts.find((c) => c.id === t.contractId)?.symbol}</span>
                    <span className={'capitalize text-muted'}>{t.direction}</span>
                    <span>{plays.find((p) => p.id === t.playId)?.title ?? 'No Play'}</span>
                    <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />
                    {t.state && <span className="text-xs text-muted">state: {t.state.kind === 'start' ? 'start' : `check-in ${formatLocal(t.state.at, 'HH:mm')}`}</span>}
                    <Pnl cents={t.netCents} className="ml-auto" />
                    {t.r !== null && <span className="tabular w-14 text-right text-muted">{t.r}R</span>}
                  </Link>
                ),
              })),
            ]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((item, i) => (
                <li key={i} className="grid grid-cols-[3.5rem_1fr] items-center gap-2">
                  <span className="tabular text-xs text-muted">{formatLocal(item.at, 'HH:mm')}</span>
                  {item.el}
                </li>
              ))}
          </ol>
        )}
      </Card>

      <DailyReviewEditor day={day} />
      <TradeForm open={logging} onClose={() => setLogging(false)} defaults={{ tradingDay: day }} />
    </div>
  );
}

function DailyReviewEditor({ day }: { day: string }) {
  const qc = useQueryClient();
  const { data: review, isLoading } = useQuery({ queryKey: ['daily-review', day], queryFn: () => api.get<{ notes: string } | null>(`/daily-reviews/${day}`) });
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSaved = useRef('');
  useEffect(() => {
    if (isLoading) return;
    setNotes(review?.notes ?? '');
    lastSaved.current = review?.notes ?? '';
  }, [review, isLoading, day]);

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (notes === lastSaved.current) return;
    const id = setTimeout(async () => {
      setStatus('saving');
      try {
        await api.put(`/daily-reviews/${day}`, { notes });
        lastSaved.current = notes;
        setStatus('saved');
        void qc.invalidateQueries({ queryKey: ['daily-reviews'] });
      } catch {
        setStatus('error');
      }
    }, 800);
    return () => clearTimeout(id);
  }, [notes, day, qc]);

  return (
    <Card title="Daily review">
      <textarea
        rows={8}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What went well, what didn't, what to change tomorrow."
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-card"
      />
      <p className="mt-1 text-xs text-muted">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Couldn’t save — check the app is running' : 'Saves automatically'}</p>
    </Card>
  );
}
