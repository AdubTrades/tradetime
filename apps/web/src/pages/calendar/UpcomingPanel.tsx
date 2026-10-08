import { Link } from '@tanstack/react-router';
import { ExternalLink, Receipt, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { formatLocal, formatMoney, zoneLabel } from '@tc/domain';
import { cn } from '../../components/ui';
import { api, type EventRecurrence, type MarketEvent, type OccurrenceView, type Renewal } from '../../lib/api';
import { useCalendarMutation, useUpcoming } from '../../lib/calendar';
import { ImpactMarker } from '../../components/ImpactMarker';

type Item =
  | { kind: 'market'; day: string; sort: string; m: MarketEvent }
  | { kind: 'mine'; day: string; sort: string; o: OccurrenceView; overdue: boolean }
  | { kind: 'renewal'; day: string; sort: string; r: Renewal };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "every weekday", "every Tue, Thu", "every 2 weeks". */
export function describeRecurrence(r: EventRecurrence, date: string): string {
  const days = [...(r.byWeekday ?? [])].sort();
  if (r.freq === 'daily') return r.interval === 1 ? 'every day' : `every ${r.interval} days`;
  if (r.freq === 'monthly') return r.interval === 1 ? 'monthly' : `every ${r.interval} months`;
  const on = JSON.stringify(days) === '[1,2,3,4,5]' ? 'weekday' : days.length ? days.map((d) => WEEKDAYS[d - 1]).join(', ') : DateTime.fromISO(date).toFormat('cccc');
  return r.interval === 1 ? `every ${on}` : `every ${r.interval} weeks on ${on}`;
}

/** A recurring event that shows up this often in the week is listed once, not on every day. */
const FREQUENT = 3;

/** Next 7 days of market events and your own events and to-dos, in the user's time zone. Open to-dos stay until done. */
export function UpcomingPanel({ onOpen }: { onOpen: (o: OccurrenceView) => void }) {
  const { data } = useUpcoming(7);
  const toggleDone = useCalendarMutation((o: OccurrenceView) =>
    o.recurring ? api.put(`/calendar/events/${o.eventId}/occurrences/${o.occurrenceDate}`, { done: !o.done }) : api.post(`/calendar/events/${o.eventId}/done`, { done: !o.done }),
  );
  if (!data) return <aside className="min-w-0 flex-[1_1_280px] rounded-xl bg-dark p-6 md:max-w-[380px]" aria-busy />;

  // Frequent recurring events (a weekday session, say) collapse to one note, keeping today's occurrence.
  const counts = new Map<string, number>();
  for (const o of data.occurrences) if (o.recurring && !o.isTask) counts.set(o.eventId, (counts.get(o.eventId) ?? 0) + 1);
  const frequent = new Set([...counts].filter(([, n]) => n >= FREQUENT).map(([id]) => id));
  const notes = [...frequent].map((id) => data.occurrences.find((o) => o.eventId === id)!);

  const items: Item[] = [
    ...data.market.map((m) => ({ kind: 'market' as const, day: m.tradingDay, sort: m.at, m })),
    ...data.occurrences
      .filter((o) => !(o.isTask && o.done))
      .filter((o) => !frequent.has(o.eventId) || o.date === data.today)
      .map((o) => ({ kind: 'mine' as const, day: o.date < data.today ? data.today : o.date, sort: o.startAt ?? `${o.date}T00:00`, o, overdue: o.date < data.today })),
    // Subscription renewals sit at the start of their day, like an all-day item.
    ...(data.renewals ?? []).map((r) => ({ kind: 'renewal' as const, day: r.nextDate, sort: `${r.nextDate}T00:00`, r })),
  ].sort((a, b) => a.day.localeCompare(b.day) || Number(b.kind === 'mine' && b.o.isTask) - Number(a.kind === 'mine' && a.o.isTask) || a.sort.localeCompare(b.sort));
  const days = [...new Set(items.map((i) => i.day))];

  return (
    <aside aria-labelledby="up-h" className="flex min-w-0 flex-[1_1_280px] flex-col gap-5 rounded-xl bg-dark p-6 text-dark-text md:max-w-[380px]">
      <div className="flex items-baseline justify-between">
        <h2 id="up-h" className="text-base font-medium">
          Next 7 days
        </h2>
        <span className="text-xs text-dark-faint">{zoneLabel()} time</span>
      </div>
      {items.length === 0 && <p className="text-sm text-dark-muted">Nothing scheduled.</p>}
      {days.map((day, i) => (
        <section key={day} className={cn('flex flex-col gap-1.5', i > 0 && 'border-t border-dark-divider pt-4')}>
          <h3 className={cn('text-xs font-medium', day === data.today ? 'text-warning-dark' : 'text-dark-muted')}>
            {day === data.today ? 'Today · ' : ''}
            {DateTime.fromISO(day).toFormat('ccc d LLL')}
          </h3>
          {items
            .filter((i) => i.day === day)
            .map((i) =>
              i.kind === 'renewal' ? (
                <Row key={`renewal-${i.r.id}`} time="Renews" marker={<Receipt size={12} strokeWidth={1.8} className="text-dark-muted" aria-hidden />}>
                  <Link to="/expenses" className="min-w-0 truncate rounded-sm hover:underline" title={`Recurring expense${i.r.vendor ? ` · ${i.r.vendor}` : ''}`}>
                    {i.r.name}
                  </Link>
                  <span className="ml-auto shrink-0 text-[13px] text-dark-muted">{formatMoney(i.r.incGstCents)}</span>
                </Row>
              ) : i.kind === 'market' ? (
                <Row key={i.m.id} time={formatLocal(i.m.at, 'HH:mm')} marker={<ImpactMarker impact={i.m.impact} onDark size={12} />}>
                  <span className="truncate">{i.m.title}</span>
                </Row>
              ) : i.o.isTask ? (
                <div key={i.o.key} className="flex min-h-10 items-center gap-2.5 rounded-md bg-dark-divider px-3">
                  <input
                    type="checkbox"
                    checked={i.o.done}
                    onChange={() => toggleDone.mutate(i.o)}
                    aria-label={`Mark “${i.o.title}” done`}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                  />
                  <button type="button" onClick={() => onOpen(i.o)} className="min-w-0 flex-1 truncate rounded-sm text-left text-sm hover:underline">
                    {i.o.title}
                  </button>
                  {i.overdue && <span className="text-[11px] font-medium text-warning-dark">Overdue</span>}
                </div>
              ) : (
                <Row
                  key={i.o.key}
                  time={i.o.allDay || !i.o.startTime ? 'All day' : i.o.startTime}
                  dot={frequent.has(i.o.eventId) ? '#5c5b57' : '#d6d5d1'}
                  muted={frequent.has(i.o.eventId)}
                >
                  <button type="button" onClick={() => onOpen(i.o)} className="min-w-0 truncate rounded-sm text-left hover:underline">
                    {i.o.title}
                  </button>
                  {i.o.link && (
                    <a href={i.o.link} target="_blank" rel="noreferrer" className="shrink-0 rounded-sm text-dark-muted hover:text-dark-text" aria-label={`Open link for ${i.o.title}`}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </Row>
              ),
            )}
        </section>
      ))}
      {notes.map((o) => (
        <button
          key={o.eventId}
          type="button"
          onClick={() => onOpen(o)}
          className="flex items-center gap-3 rounded-sm border-t border-dark-divider pt-4 text-left text-[13px] text-dark-muted hover:text-dark-text"
        >
          <Repeat size={14} strokeWidth={1.8} className="shrink-0" aria-hidden />
          <span>
            {o.title}
            {o.startTime && !o.allDay ? `, ${o.startTime}` : ''} {describeRecurrence(o.recurrence!, o.occurrenceDate)}
          </span>
        </button>
      ))}
      <p className="mt-auto text-[11px] leading-normal text-dark-faint">
        Economic events from FRED®. This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
      </p>
    </aside>
  );
}

function Row({ time, dot, marker, muted = false, children }: { time: string; dot?: string; marker?: ReactNode; muted?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex min-h-9 items-center gap-3 text-sm', muted && 'text-dark-muted')}>
      <span className={cn('w-10 shrink-0 font-mono text-dark-muted', time.length > 5 ? 'text-[10px]' : 'text-xs')}>{time}</span>
      <span className="flex w-3 shrink-0 justify-center">{marker ?? <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} aria-hidden />}</span>
      {children}
    </div>
  );
}
