import { DateTime } from 'luxon';
import { useState } from 'react';
import { Button, CardHeader, cn, ViewLink } from '../../components/ui';
import { api, type OccurrenceView } from '../../lib/api';
import { useCalendarMutation, useUpcoming } from '../../lib/calendar';
import { EventDialog } from '../calendar/EventDialog';

const LIMIT = 4;

/** Open to-dos (calendar tasks): overdue first, then by date. Lowest priority card, so it sits last. */
export function TodoCard({ today }: { today: string }) {
  const { data } = useUpcoming(31);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OccurrenceView | null>(null);
  const toggle = useCalendarMutation((o: OccurrenceView) =>
    o.recurring ? api.put(`/calendar/events/${o.eventId}/occurrences/${o.occurrenceDate}`, { done: !o.done }) : api.post(`/calendar/events/${o.eventId}/done`, { done: !o.done }),
  );

  const todos = (data?.occurrences ?? []).filter((o) => o.isTask && !o.done).sort((a, b) => a.date.localeCompare(b.date));
  const overdue = todos.filter((o) => o.date < today).length;
  const shown = expanded ? todos : todos.slice(0, LIMIT);
  const hidden = todos.length - shown.length;

  return (
    <section aria-labelledby="todo-h" className="card scroll-mt-6 p-6">
      <CardHeader
        id="todo-h"
        title="To do"
        description={todos.length ? `${todos.length} open${overdue ? ` · ${overdue} overdue` : ''}` : 'All done'}
        action={
          <>
            <Button size="sm" onClick={() => setAdding(true)}>
              + Add
            </Button>
            <ViewLink to="/calendar">All to-dos</ViewLink>
          </>
        }
      />
      {todos.length === 0 ? (
        <p className="-mt-3 text-sm text-muted">Nothing due. Clear head for the open.</p>
      ) : (
        <div className="-mt-3 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-8">
          {shown.map((t) => {
            const late = t.date < today;
            return (
              <div key={t.key} className="flex min-h-12 items-center gap-3 border-b border-border-subtle">
                <input
                  type="checkbox"
                  aria-label={`Mark “${t.title}” done`}
                  checked={t.done}
                  onChange={() => toggle.mutate(t)}
                  className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[var(--text)]"
                />
                <button type="button" onClick={() => setEditing(t)} className="min-w-0 truncate rounded-sm text-left text-sm hover:underline">
                  {t.title}
                </button>
                <span className={cn('ml-auto pl-2 text-xs whitespace-nowrap', late ? 'font-medium text-warning' : 'text-muted')}>
                  {late ? 'Overdue · ' : ''}
                  {DateTime.fromISO(t.date).toFormat('ccc d LLL')}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-2 min-h-9 rounded-sm text-[13px] font-medium underline underline-offset-[3px]">
          Show {hidden} more
        </button>
      )}
      {expanded && todos.length > LIMIT && (
        <button type="button" onClick={() => setExpanded(false)} className="mt-2 min-h-9 rounded-sm text-[13px] font-medium text-muted underline underline-offset-[3px]">
          Show less
        </button>
      )}
      <EventDialog open={adding} onClose={() => setAdding(false)} defaultDate={today} defaultTask />
      <EventDialog open={!!editing} onClose={() => setEditing(null)} occurrence={editing} />
    </section>
  );
}
