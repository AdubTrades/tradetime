import { useEffect, useState } from 'react';
import { durationMinutes, formatDuration, formatLocal } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { Button, Field, Input, Select } from '../../components/ui';
import { api, ApiError, type Session, type SessionType } from '../../lib/api';
import { endInstant, instantToLocalParts, localToInstant, todayLocal } from '../../lib/localTime';
import { useSessionMutation } from '../../lib/sessions';

interface Props {
  open: boolean;
  onClose: () => void;
  types: SessionType[];
  /** Edit this session; omit to add a manual session. */
  session?: Session | null;
  /** Date to prefill when adding (defaults to today). */
  defaultDate?: string;
}

interface Form {
  typeId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
  reason: string;
}

function initialForm(session: Session | null | undefined, types: SessionType[], defaultDate?: string): Form {
  if (!session) {
    return { typeId: types.find((t) => !t.archived)?.id ?? '', date: defaultDate ?? todayLocal(), startTime: '', endTime: '', notes: '', reason: '' };
  }
  const start = instantToLocalParts(session.start);
  return {
    typeId: session.typeId,
    date: start.date,
    startTime: start.time,
    endTime: session.end ? instantToLocalParts(session.end).time : '',
    notes: session.notes ?? '',
    reason: '',
  };
}

export function SessionDialog({ open, onClose, types, session, defaultDate }: Props) {
  const editing = !!session;
  const running = editing && session.end === null;
  const [form, setForm] = useState<Form>(() => initialForm(session, types, defaultDate));
  const [overlaps, setOverlaps] = useState<Session[] | null>(null);
  // Reset only when the dialog opens, so a refetch of session types can't wipe what's being typed.
  useEffect(() => {
    if (open) {
      setForm(initialForm(session, types, defaultDate));
      setOverlaps(null);
    }
  }, [open, session]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setOverlaps(null);
  };

  const save = useSessionMutation((force: boolean) => {
    const start = localToInstant(form.date, form.startTime);
    const end = running ? undefined : endInstant(form.date, form.startTime, form.endTime).instant;
    const payload = { typeId: form.typeId, start, end, notes: form.notes || null, force };
    return editing
      ? api.patch<Session>(`/sessions/${session.id}`, { ...payload, reason: form.reason || null })
      : api.post<Session>('/sessions', payload);
  });

  const submit = (force = false) =>
    save.mutate(force, {
      onSuccess: onClose,
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) setOverlaps((err.detail as { overlaps?: Session[] })?.overlaps ?? []);
      },
    });

  const complete = form.typeId && form.date && form.startTime && (running || form.endTime);
  const preview = complete && !running ? endInstant(form.date, form.startTime, form.endTime) : null;
  const previewMinutes = preview ? durationMinutes({ start: localToInstant(form.date, form.startTime), end: preview.instant }) : null;
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? 'Session';
  const selectable = types.filter((t) => !t.archived || t.id === form.typeId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit session' : 'Add session manually'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {overlaps ? (
            <Button variant="primary" disabled={save.isPending} onClick={() => submit(true)}>
              Save anyway
            </Button>
          ) : (
            <Button variant="primary" disabled={!complete || save.isPending} onClick={() => submit(false)}>
              Save
            </Button>
          )}
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete) submit(!!overlaps);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={form.typeId} onChange={(e) => set('typeId', e.target.value)}>
              {selectable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date (start)" hint="Perth time">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
          </Field>
          {!running && (
            <Field label="End" hint={preview?.nextDay ? 'Next day' : undefined}>
              <Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </Field>
          )}
        </div>
        {previewMinutes !== null && <p className="text-sm text-muted">Duration: {formatDuration(previewMinutes)}</p>}
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </Field>
        {editing && (
          <Field label="Reason for edit" hint="Kept in the edit history with the original values.">
            <Input value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Forgot to stop the timer" />
          </Field>
        )}
        {overlaps && (
          <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
            <p className="font-medium">This overlaps {overlaps.length === 1 ? 'an existing session' : `${overlaps.length} existing sessions`}:</p>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {overlaps.map((o) => (
                <li key={o.id}>
                  {typeName(o.typeId)}: {formatLocal(o.start, 'ccc d LLL HH:mm')} – {o.end ? formatLocal(o.end, 'HH:mm') : 'running'}
                </li>
              ))}
            </ul>
            <p className="mt-1">Check the times, or save anyway if both are correct.</p>
          </div>
        )}
        {save.error && !overlaps && <p className="text-sm text-loss">{save.error.message}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
