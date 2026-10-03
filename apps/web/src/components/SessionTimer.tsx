import { Link } from '@tanstack/react-router';
import { MessageCircleQuestion, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { durationMinutes, formatDuration } from '@tc/domain';
import { api, type Session, type SessionType } from '../lib/api';
import { latestInstantAt } from '../lib/localTime';
import { useNow, useRunningSession, useSessionMutation } from '../lib/sessions';
import { CheckInDialog } from '../pages/checkins/CheckInDialog';
import { SessionStartDialog } from '../pages/checkins/SessionStartDialog';
import { cn, Select } from './ui';

const LAST_TYPE_KEY = 'tc-last-session-type';

function readLastType(): string | null {
  try {
    return localStorage.getItem(LAST_TYPE_KEY);
  } catch {
    return null;
  }
}

/** hh:mm:ss from the stored start instant (never a running counter, so closing the app doesn't lose time). */
function elapsedClock(start: string, now: Date): string {
  const secs = Math.max(0, Math.floor((now.getTime() - Date.parse(start)) / 1000));
  return [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * Session timer for the dark panels (dashboard and time log): status, a mono clock, the activity select and
 * Start (orange) or Stop (light). Trading sessions open the session-start checklist first.
 */
export function SessionTimer({
  types,
  longSessionHours,
  clock = 48,
  timeLogLink = false,
}: {
  types: SessionType[];
  longSessionHours: number;
  clock?: 48 | 56;
  timeLogLink?: boolean;
}) {
  const now = useNow();
  const { data: running } = useRunningSession();
  const active = types.filter((t) => !t.archived);
  const [typeId, setTypeId] = useState(() => readLastType() ?? 'st_trading');
  const selected = active.find((t) => t.id === typeId) ?? active[0];
  const runningType = running ? types.find((t) => t.id === running.typeId) : undefined;
  const [checklistFor, setChecklistFor] = useState<SessionType | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [stopAt, setStopAt] = useState('');

  const start = useSessionMutation((id: string) => api.post<Session>('/sessions/start', { typeId: id }));
  const stop = useSessionMutation((end?: string) => api.post<Session>(`/sessions/${running!.id}/stop`, end ? { end } : {}));
  const begin = (t: SessionType) => (t.isTrading ? setChecklistFor(t) : start.mutate(t.id));

  const minutes = running ? durationMinutes(running, now) : 0;
  const longRunning = running && minutes >= longSessionHours * 60;
  const stopAtInstant = running && stopAt ? latestInstantAt(stopAt, running.start, now) : null;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-dark-muted">
        <span className={cn('inline-block h-[7px] w-[7px] rounded-full', running ? 'bg-profit-dark' : 'bg-[#5c5b57]')} aria-hidden />
        {running ? `Running · ${runningType?.name ?? 'Session'}` : 'No session running'}
      </div>
      <div className={cn('font-mono leading-none tracking-[-0.04em] text-dark-text', clock === 56 ? 'text-[56px]' : 'text-[48px]')} aria-live="off">
        {running ? elapsedClock(running.start, now) : '00:00:00'}
      </div>
      <div className="flex gap-2">
        {running ? (
          <>
            {runningType?.isTrading && (
              <button
                type="button"
                onClick={() => setCheckingIn(true)}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-dark-border bg-dark px-4 text-sm font-medium text-dark-text hover:border-dark-muted"
              >
                <MessageCircleQuestion size={16} aria-hidden /> Check in
              </button>
            )}
            <button
              type="button"
              disabled={stop.isPending}
              onClick={() => stop.mutate(undefined)}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-md bg-dark-text px-5 text-sm font-semibold text-dark hover:opacity-90 disabled:opacity-50',
                !runningType?.isTrading && 'flex-1',
              )}
            >
              <Square size={15} aria-hidden /> Stop
            </button>
          </>
        ) : (
          <>
            <Select
              dark
              aria-label="Activity"
              className="flex-1"
              value={selected?.id}
              onChange={(e) => {
                setTypeId(e.target.value);
                try {
                  localStorage.setItem(LAST_TYPE_KEY, e.target.value);
                } catch {
                  // Not critical.
                }
              }}
            >
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <button
              type="button"
              disabled={!selected || start.isPending}
              onClick={() => selected && begin(selected)}
              className="flex min-h-11 items-center gap-2 rounded-md bg-ember px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Play size={15} fill="currentColor" aria-hidden /> Start
            </button>
          </>
        )}
      </div>

      {longRunning && (
        <div className="space-y-2 rounded-md border border-dark-border p-3 text-[13px] text-dark-muted">
          <p>
            <span className="font-medium text-dark-text">Still going?</span> Running for {formatDuration(minutes)}. If you finished earlier, stop it at the right
            time.
          </p>
          <div className="flex gap-2">
            <input
              type="time"
              aria-label="Finished at"
              value={stopAt}
              onChange={(e) => setStopAt(e.target.value)}
              className="h-9 rounded-sm border border-dark-border bg-dark px-2 text-dark-text"
            />
            <button
              type="button"
              disabled={!stopAtInstant || stop.isPending}
              onClick={() => stopAtInstant && stop.mutate(stopAtInstant)}
              className="h-9 rounded-sm border border-dark-border px-3 text-dark-text disabled:opacity-40"
            >
              Stop at {stopAt || '…'}
            </button>
          </div>
          {stopAt && !stopAtInstant && <p className="text-warning-dark">That time is before the session started.</p>}
        </div>
      )}
      {(start.error || stop.error) && <p className="text-[13px] text-warning-dark">{(start.error ?? stop.error)?.message}</p>}
      {timeLogLink && (
        <Link to="/time-log" className="self-start rounded-sm py-1 text-[13px] text-[#d6d5d1] hover:text-dark-text">
          Time log →
        </Link>
      )}
      <SessionStartDialog type={checklistFor} open={!!checklistFor} onClose={() => setChecklistFor(null)} />
      {running && <CheckInDialog sessionId={checkingIn ? running.id : null} elapsedMinutes={Math.floor(minutes)} onClose={() => setCheckingIn(false)} />}
    </div>
  );
}
