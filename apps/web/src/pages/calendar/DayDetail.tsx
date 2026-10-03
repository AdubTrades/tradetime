import { Link } from '@tanstack/react-router';
import { swatch } from '../../lib/theme';
import { CheckSquare, ExternalLink, Play, Plus, Square } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { blockMinutes, durationMinutes, formatDuration, formatLocal, formatMoney, tradingDay } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { GradeBadge, Pnl } from '../../components/GradeBadge';
import { ReadingChips } from '../../components/ReadingSummary';
import { Button, cn } from '../../components/ui';
import { api, type CalendarRangeData, type OccurrenceView, type Session, type SessionType } from '../../lib/api';
import { useCalendarMutation, useEventTypes } from '../../lib/calendar';
import { useDayReadings } from '../../lib/checkins';
import { useExpenses } from '../../lib/expenses';
import { usePlays, useTrades } from '../../lib/journal';
import { useRunningSession, useSessionMutation, useSessions, useSessionTypes } from '../../lib/sessions';
import { useSettings } from '../../lib/settings';
import { SessionStartDialog } from '../checkins/SessionStartDialog';
import { TradeForm } from '../journal/TradeForm';
import { SessionDialog } from '../timelog/SessionDialog';

interface Props {
  day: string | null;
  data: CalendarRangeData | undefined;
  onClose: () => void;
  onEditEvent: (o: OccurrenceView) => void;
  onNewEvent: (day: string) => void;
}

/** Everything for one date: trades, sessions vs plan, check-ins, events, expenses — with actions. */
export function DayDetail(props: Props) {
  // Only mount (and fetch) once a day is open.
  return props.day ? <OpenDayDetail {...props} day={props.day} /> : null;
}

function OpenDayDetail({ day, data, onClose, onEditEvent, onNewEvent }: Props & { day: string }) {
  const { data: settings } = useSettings();
  const d = day;
  const { data: trades = [] } = useTrades(d, d);
  const { data: sessions = [] } = useSessions(d, d);
  const { data: readings = [] } = useDayReadings(d);
  const { data: sessionTypes = [] } = useSessionTypes();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: plays = [] } = usePlays();
  const fy = DateTime.fromISO(d).month >= 7 ? DateTime.fromISO(d).year : DateTime.fromISO(d).year - 1;
  const { data: expenses = [] } = useExpenses(fy);
  const { data: running } = useRunningSession();
  const [logging, setLogging] = useState(false);
  const [addingSession, setAddingSession] = useState(false);
  const [checklistFor, setChecklistFor] = useState<SessionType | null>(null);
  const start = useSessionMutation((typeId: string) => api.post<Session>('/sessions/start', { typeId }));
  const toggleDone = useCalendarMutation((o: OccurrenceView) =>
    o.recurring ? api.put(`/calendar/events/${o.eventId}/occurrences/${o.occurrenceDate}`, { done: !o.done }) : api.post(`/calendar/events/${o.eventId}/done`, { done: !o.done }),
  );

  const today = tradingDay(new Date(), settings?.rolloverTime);
  const occurrences = data?.occurrences.filter((o) => o.date === day) ?? [];
  const market = data?.market.filter((m) => m.tradingDay === day) ?? [];
  const dayExpenses = expenses.filter((e) => e.date === day);
  const type = (id: string) => eventTypes.find((t) => t.id === id);
  const sType = (id: string | null) => sessionTypes.find((t) => t.id === id);

  // Schedule vs actual, per session type.
  const planned = new Map<string, number>();
  for (const o of occurrences) {
    const st = type(o.typeId)?.sessionTypeId;
    if (st && !o.allDay) planned.set(st, (planned.get(st) ?? 0) + blockMinutes(o.startTime, o.endTime));
  }
  const actual = new Map<string, number>();
  for (const s of sessions) actual.set(s.typeId, (actual.get(s.typeId) ?? 0) + durationMinutes(s));
  const compareTypes = [...new Set([...planned.keys(), ...actual.keys()])];

  const startFrom = (o: OccurrenceView) => {
    const st = sType(type(o.typeId)?.sessionTypeId ?? null);
    if (!st) return;
    if (st.isTrading) setChecklistFor(st);
    else start.mutate(st.id);
  };

  const section = 'space-y-2';
  const h = 'text-[13px] font-semibold text-text';

  return (
    <Dialog
      open={!!day}
      onClose={onClose}
      title={DateTime.fromISO(day).toFormat('cccc d LLLL yyyy')}
      width="max-w-3xl"
      footer={
        <>
          <Link to="/journal/day/$day" params={{ day }} className="mr-auto self-center text-sm text-ember hover:underline">
            Open daily review →
          </Link>
          <Button onClick={() => onNewEvent(day)}>
            <Plus size={16} aria-hidden /> Event
          </Button>
          <Button onClick={() => setAddingSession(true)}>
            <Plus size={16} aria-hidden /> Session
          </Button>
          <Button variant="primary" onClick={() => setLogging(true)}>
            <Plus size={16} aria-hidden /> Log trades
          </Button>
        </>
      }
    >
      <div className="space-y-6 text-sm">
        {(market.length > 0 || occurrences.length > 0) && (
          <section className={section}>
            <h3 className={h}>Events</h3>
            <ul className="space-y-1.5">
              {market.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', m.impact === 'high' ? 'bg-ember' : 'bg-medium')} />
                  <span className="tabular w-12 text-muted">{formatLocal(m.at, 'HH:mm')}</span>
                  <span>{m.title}</span>
                  <span className="text-xs text-muted">· {m.impact} impact · {m.currency}</span>
                </li>
              ))}
              {occurrences.map((o) => {
                const t = type(o.typeId);
                const canStart = day === today && !running && !!t?.sessionTypeId && !o.isTask;
                return (
                  <li key={o.key} className="flex items-center gap-2">
                    {o.isTask ? (
                      <button type="button" aria-label="Toggle done" onClick={() => toggleDone.mutate(o)} className="text-muted hover:text-text">
                        {o.done ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    ) : (
                      <span className="h-2 w-2 rounded-sm" style={{ background: swatch(t?.color) }} />
                    )}
                    <span className="tabular w-12 text-muted">{o.allDay || !o.startTime ? 'All day' : o.startTime}</span>
                    <button type="button" className={cn('text-left hover:underline', o.done && 'text-muted line-through')} onClick={() => onEditEvent(o)}>
                      {o.title}
                    </button>
                    <span className="text-xs text-muted">· {t?.name}</span>
                    {o.link && (
                      <a href={o.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ember hover:underline">
                        <ExternalLink size={12} /> Join
                      </a>
                    )}
                    {canStart && (
                      <Button variant="ghost" className="ml-auto px-2 text-xs" onClick={() => startFrom(o)}>
                        <Play size={12} aria-hidden /> Start {sType(t!.sessionTypeId)?.name.toLowerCase()}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className={section}>
          <h3 className={h}>Trades</h3>
          {trades.length === 0 ? (
            <p className="text-muted">No trades.</p>
          ) : (
            <ul className="space-y-1">
              {[...trades].reverse().map((t) => (
                <li key={t.id}>
                  <Link to="/journal/trades/$tradeId" params={{ tradeId: t.id }} className="flex items-center gap-2 rounded-sm px-1 hover:bg-hover">
                    <span className="tabular w-12 text-muted">{formatLocal(t.openedAt, 'HH:mm')}</span>
                    <span className={'w-12 capitalize text-muted'}>{t.direction}</span>
                    <span>{plays.find((p) => p.id === t.playId)?.title ?? 'No Play'}</span>
                    <GradeBadge grade={t.grade} outsidePlan={t.outsidePlan} />
                    <Pnl cents={t.netCents} className="ml-auto" />
                  </Link>
                </li>
              ))}
              <li className="flex justify-end border-t border-border pt-1 font-semibold">
                <Pnl cents={trades.reduce((s, t) => s + t.netCents, 0)} />
              </li>
            </ul>
          )}
        </section>

        <section className={section}>
          <h3 className={h}>Sessions</h3>
          {sessions.length === 0 ? (
            <p className="text-muted">No sessions logged.</p>
          ) : (
            <ul className="space-y-1">
              {[...sessions].reverse().map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: swatch(sType(s.typeId)?.color) }} />
                  <span className="w-28">{sType(s.typeId)?.name}</span>
                  <span className="tabular text-muted">
                    {formatLocal(s.start, 'HH:mm')} – {s.end ? formatLocal(s.end, 'HH:mm') : 'running'}
                  </span>
                  <span className="tabular ml-auto">{formatDuration(durationMinutes(s))}</span>
                </li>
              ))}
            </ul>
          )}
          {compareTypes.length > 0 && planned.size > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-medium">Schedule vs actual</th>
                  <th className="py-1 text-right font-medium">Planned</th>
                  <th className="py-1 text-right font-medium">Logged</th>
                </tr>
              </thead>
              <tbody>
                {compareTypes.map((id) => (
                  <tr key={id}>
                    <td className="py-0.5">{sType(id)?.name}</td>
                    <td className="tabular py-0.5 text-right">{formatDuration(planned.get(id) ?? 0)}</td>
                    <td className="tabular py-0.5 text-right">{formatDuration(actual.get(id) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {readings.length > 0 && (
          <section className={section}>
            <h3 className={h}>Session start and check-ins</h3>
            <ul className="space-y-1">
              {readings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="tabular w-12 text-muted">{formatLocal(r.at, 'HH:mm')}</span>
                  <span className="text-xs font-medium">{r.kind === 'start' ? 'Start' : 'Check-in'}</span>
                  <ReadingChips answers={r.answers} decision={r.decision} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {dayExpenses.length > 0 && (
          <section className={section}>
            <h3 className={h}>Expenses</h3>
            <ul className="space-y-1">
              {dayExpenses.map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span>{e.name}</span>
                  <span className="tabular">{formatMoney(e.incGstCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <TradeForm open={logging} onClose={() => setLogging(false)} defaults={{ tradingDay: day }} />
      <SessionDialog open={addingSession} onClose={() => setAddingSession(false)} types={sessionTypes} defaultDate={day} />
      <SessionStartDialog type={checklistFor} open={!!checklistFor} onClose={() => setChecklistFor(null)} />
    </Dialog>
  );
}
