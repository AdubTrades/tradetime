import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button, cn, Field, Input, Select } from '../../components/ui';
import { api, type EventRecurrence, type OccurrenceView } from '../../lib/api';
import { useCalendarMutation, useEventTypes } from '../../lib/calendar';
import { todayLocal } from '../../lib/localTime';

type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Form {
  typeId: string;
  title: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  repeat: Repeat;
  interval: number;
  byWeekday: number[];
  until: string;
  reminder: string;
  link: string;
  notes: string;
  isTask: boolean;
}

function repeatOf(r: EventRecurrence | null): Pick<Form, 'repeat' | 'interval' | 'byWeekday' | 'until'> {
  if (!r) return { repeat: 'none', interval: 1, byWeekday: [], until: '' };
  const weekdays = r.freq === 'weekly' && r.interval === 1 && JSON.stringify([...(r.byWeekday ?? [])].sort()) === '[1,2,3,4,5]';
  return { repeat: weekdays ? 'weekdays' : r.freq, interval: r.interval, byWeekday: r.byWeekday ?? [], until: r.until ?? '' };
}

function toRecurrence(f: Form): EventRecurrence | null {
  const until = f.until || null;
  switch (f.repeat) {
    case 'none':
      return null;
    case 'weekdays':
      return { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5], until };
    case 'weekly':
      return { freq: 'weekly', interval: f.interval, byWeekday: f.byWeekday.length ? f.byWeekday : undefined, until };
    default:
      return { freq: f.repeat, interval: f.interval, until };
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Edit this occurrence (and optionally its whole series); omit to create. */
  occurrence?: OccurrenceView | null;
  defaultDate?: string;
  defaultTypeId?: string;
  /** Start a new entry as an all-day to-do. */
  defaultTask?: boolean;
}

export function EventDialog({ open, onClose, occurrence, defaultDate, defaultTypeId, defaultTask = false }: Props) {
  const { data: types = [] } = useEventTypes();
  const [form, setForm] = useState<Form | null>(null);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  useEffect(() => {
    if (!open) return;
    setScope(occurrence?.recurring ? 'one' : 'all');
    setForm(
      occurrence
        ? {
            typeId: occurrence.typeId,
            title: occurrence.title,
            date: occurrence.date,
            allDay: occurrence.allDay,
            startTime: occurrence.startTime ?? '',
            endTime: occurrence.endTime ?? '',
            ...repeatOf(occurrence.recurrence),
            reminder: occurrence.reminderMinutes?.toString() ?? '',
            link: occurrence.link ?? '',
            notes: occurrence.notes ?? '',
            isTask: occurrence.isTask,
          }
        : {
            typeId: defaultTypeId ?? (defaultTask ? 'cet_admin' : undefined) ?? types.find((t) => !t.archived)?.id ?? 'cet_general',
            title: '',
            date: defaultDate ?? todayLocal(),
            allDay: defaultTask,
            startTime: '',
            endTime: '',
            repeat: 'none',
            interval: 1,
            byWeekday: [],
            until: '',
            reminder: '',
            link: '',
            notes: '',
            isTask: defaultTask,
          },
    );
  }, [open, occurrence]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCalendarMutation(async () => {
    const f = form!;
    const times = f.allDay ? { startTime: null, endTime: null } : { startTime: f.startTime || null, endTime: f.endTime || null };
    if (occurrence?.recurring && scope === 'one') {
      return api.put(`/calendar/events/${occurrence.eventId}/occurrences/${occurrence.occurrenceDate}`, {
        override: { title: f.title, date: f.date, ...times, notes: f.notes || null },
      });
    }
    const payload = {
      typeId: f.typeId,
      title: f.title,
      // Editing a whole series keeps its original first date unless this is a one-off.
      date: occurrence?.recurring ? undefined : f.date,
      allDay: f.allDay,
      ...times,
      recurrence: toRecurrence(f),
      reminderMinutes: f.reminder ? Number(f.reminder) : null,
      link: f.link || null,
      notes: f.notes || null,
      isTask: f.isTask,
    };
    return occurrence ? api.patch(`/calendar/events/${occurrence.eventId}`, payload) : api.post('/calendar/events', { ...payload, date: f.date });
  });
  const removeOne = useCalendarMutation(() => api.put(`/calendar/events/${occurrence!.eventId}/occurrences/${occurrence!.occurrenceDate}`, { skipped: true }));
  const removeAll = useCalendarMutation(() => api.delete(`/calendar/events/${occurrence!.eventId}`));

  if (!form) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const seriesFieldsLocked = occurrence?.recurring && scope === 'one';
  const valid = form.title.trim() && form.date && (form.allDay || !form.endTime || form.startTime);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={occurrence ? (occurrence.isTask ? 'Edit to-do' : 'Edit event') : defaultTask ? 'New to-do' : 'New event'}
      footer={
        <>
          {occurrence && (
            <Button
              variant="ghost"
              className="mr-auto text-loss"
              onClick={() => {
                if (occurrence.recurring && scope === 'one') return window.confirm('Skip this occurrence?') && removeOne.mutate(undefined, { onSuccess: onClose });
                return window.confirm(occurrence.recurring ? 'Delete every occurrence of this event?' : 'Delete this event?') && removeAll.mutate(undefined, { onSuccess: onClose });
              }}
            >
              {occurrence.recurring && scope === 'one' ? 'Skip this one' : 'Delete'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {occurrence?.recurring && (
          <div className="flex overflow-hidden rounded-full border border-border text-sm">
            {(['one', 'all'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} className={cn('flex-1 px-3 py-1.5', scope === s ? 'bg-text text-card' : 'text-muted')}>
                {s === 'one' ? 'This occurrence' : 'All occurrences'}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <Field label="Title">
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus placeholder="NY open session" />
          </Field>
          <Field label="Type">
            <Select value={form.typeId} disabled={seriesFieldsLocked} onChange={(e) => set('typeId', e.target.value)}>
              {types
                .filter((t) => !t.archived || t.id === form.typeId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={occurrence?.recurring && scope === 'all' ? 'First date' : 'Date'}>
            <Input type="date" value={form.date} disabled={occurrence?.recurring && scope === 'all'} onChange={(e) => set('date', e.target.value)} />
          </Field>
          {!form.allDay && (
            <>
              <Field label="Start" hint="Perth time">
                <Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
              </Field>
              <Field label="End" hint={form.endTime && form.startTime && form.endTime <= form.startTime ? 'Next day' : undefined}>
                <Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
              </Field>
            </>
          )}
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={form.allDay} onChange={(e) => set('allDay', e.target.checked)} /> All day
          </label>
        </div>

        {!seriesFieldsLocked && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Repeat">
                <Select value={form.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
                  <option value="none">Doesn't repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Every weekday (Mon–Fri)</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </Field>
              {(form.repeat === 'daily' || form.repeat === 'weekly' || form.repeat === 'monthly') && (
                <Field label="Every">
                  <Input type="number" min={1} max={52} value={form.interval} onChange={(e) => set('interval', Math.max(1, Number(e.target.value) || 1))} />
                </Field>
              )}
              {form.repeat !== 'none' && (
                <Field label="Until" hint="Optional">
                  <Input type="date" value={form.until} onChange={(e) => set('until', e.target.value)} />
                </Field>
              )}
            </div>
            {form.repeat === 'weekly' && (
              <div className="flex gap-1">
                {WEEKDAYS.map((d, i) => {
                  const on = form.byWeekday.includes(i + 1);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('byWeekday', on ? form.byWeekday.filter((x) => x !== i + 1) : [...form.byWeekday, i + 1])}
                      className={cn('rounded-md border px-2.5 py-1 text-xs', on ? 'border-text bg-text text-card' : 'border-border text-muted')}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Reminder">
                <Select value={form.reminder} onChange={(e) => set('reminder', e.target.value)}>
                  <option value="">None</option>
                  <option value="0">At start</option>
                  <option value="5">5 minutes before</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </Select>
              </Field>
              <Field label="Link" hint="e.g. live stream URL">
                <Input value={form.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={form.isTask} onChange={(e) => set('isTask', e.target.checked)} /> Task (tick off when done)
              </label>
            </div>
          </>
        )}
        <Field label="Notes">
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-card"
          />
        </Field>
        {seriesFieldsLocked && <p className="text-xs text-muted">Changes apply to this occurrence only. Switch to “All occurrences” to change the repeat, type or reminder.</p>}
        {(save.error || removeOne.error || removeAll.error) && <p className="text-sm text-loss">{(save.error ?? removeOne.error ?? removeAll.error)?.message}</p>}
      </div>
    </Dialog>
  );
}
