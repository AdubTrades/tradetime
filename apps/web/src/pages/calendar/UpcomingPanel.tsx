import { CheckSquare, ExternalLink, Square } from 'lucide-react';
import { DateTime } from 'luxon';
import { formatLocal } from '@tc/domain';
import { cn } from '../../components/ui';
import { api, type MarketEvent, type OccurrenceView } from '../../lib/api';
import { useCalendarMutation, useEventTypes, useUpcoming } from '../../lib/calendar';

type Item = { kind: 'market'; day: string; sort: string; m: MarketEvent } | { kind: 'mine'; day: string; sort: string; o: OccurrenceView; overdue: boolean };

/** Next 7 days of market events and your own events/tasks, in Perth time. Open tasks stay until done. */
export function UpcomingPanel({ onOpen }: { onOpen: (o: OccurrenceView) => void }) {
  const { data } = useUpcoming(7);
  const { data: types = [] } = useEventTypes();
  const toggleDone = useCalendarMutation((o: OccurrenceView) =>
    o.recurring ? api.put(`/calendar/events/${o.eventId}/occurrences/${o.occurrenceDate}`, { done: !o.done }) : api.post(`/calendar/events/${o.eventId}/done`, { done: !o.done }),
  );
  if (!data) return null;

  const items: Item[] = [
    ...data.market.map((m) => ({ kind: 'market' as const, day: m.tradingDay, sort: m.at, m })),
    ...data.occurrences
      .filter((o) => !(o.isTask && o.done))
      .map((o) => ({ kind: 'mine' as const, day: o.date < data.today ? data.today : o.date, sort: o.startAt ?? `${o.date}T00:00`, o, overdue: o.date < data.today })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.sort.localeCompare(b.sort));
  const days = [...new Set(items.map((i) => i.day))];
  const color = (id: string) => types.find((t) => t.id === id)?.color ?? '#64748b';

  return (
    <aside className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Upcoming · next 7 days</h2>
      {items.length === 0 && <p className="px-4 py-6 text-sm text-muted">Nothing scheduled.</p>}
      <div className="divide-y divide-border">
        {days.map((day) => (
          <section key={day} className={cn('px-4 py-3', day === data.today && 'bg-accent/5')}>
            <h3 className={cn('mb-2 text-xs font-semibold', day === data.today ? 'text-accent' : 'text-muted')}>
              {day === data.today ? 'Today · ' : ''}
              {DateTime.fromISO(day).toFormat('ccc d LLL')}
            </h3>
            <ul className="space-y-1.5 text-sm">
              {items
                .filter((i) => i.day === day)
                .map((i) =>
                  i.kind === 'market' ? (
                    <li key={i.m.id} className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', i.m.impact === 'high' ? 'bg-loss' : 'bg-warn')} aria-label={`${i.m.impact} impact`} />
                      <span className="tabular w-11 text-xs text-muted">{formatLocal(i.m.at, 'HH:mm')}</span>
                      <span className="truncate">{i.m.title}</span>
                    </li>
                  ) : (
                    <li key={i.o.key} className="flex items-center gap-2">
                      {i.o.isTask ? (
                        <button type="button" aria-label={i.o.done ? 'Mark not done' : 'Mark done'} onClick={() => toggleDone.mutate(i.o)} className="shrink-0 text-muted hover:text-text">
                          {i.o.done ? <CheckSquare size={14} /> : <Square size={14} />}
                        </button>
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color(i.o.typeId) }} aria-hidden />
                      )}
                      <span className="tabular w-11 text-xs text-muted">{i.o.allDay || !i.o.startTime ? (i.overdue ? 'Due' : 'All day') : i.o.startTime}</span>
                      <button type="button" onClick={() => onOpen(i.o)} className={cn('truncate text-left hover:underline', i.overdue && 'text-loss')}>
                        {i.o.title}
                        {i.overdue && <span className="text-xs"> (overdue {DateTime.fromISO(i.o.date).toFormat('d LLL')})</span>}
                      </button>
                      {i.o.link && (
                        <a href={i.o.link} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-accent" aria-label="Open link">
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </li>
                  ),
                )}
            </ul>
          </section>
        ))}
      </div>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted">Times in Perth. Economic events from FRED®; this product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.</p>
    </aside>
  );
}
