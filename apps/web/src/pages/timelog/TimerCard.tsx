import { AlertTriangle, MessageCircleQuestion, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { durationMinutes, formatDuration, formatLocal } from '@tc/domain';
import { Button, Input, Select } from '../../components/ui';
import { api, type Session, type SessionType } from '../../lib/api';
import { latestInstantAt } from '../../lib/localTime';
import { useNow, useRunningSession, useSessionMutation } from '../../lib/sessions';
import { CheckInDialog } from '../checkins/CheckInDialog';
import { SessionStartDialog } from '../checkins/SessionStartDialog';

const LAST_TYPE_KEY = 'tc-last-session-type';

function readLastType(): string | null {
  try {
    return localStorage.getItem(LAST_TYPE_KEY);
  } catch {
    return null;
  }
}

/** hh:mm:ss from a start instant, recalculated from the stored start (never a running counter). */
function elapsedClock(start: string, now: Date): string {
  const secs = Math.max(0, Math.floor((now.getTime() - Date.parse(start)) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function TimerCard({ types, longSessionHours }: { types: SessionType[]; longSessionHours: number }) {
  const { data: running, isLoading } = useRunningSession();
  const active = types.filter((t) => !t.archived);
  const [typeId, setTypeId] = useState(() => readLastType() ?? 'st_trading');
  const selectedType = active.find((t) => t.id === typeId) ?? active[0];

  const start = useSessionMutation((id: string) => api.post<Session>('/sessions/start', { typeId: id }));
  const [checklistFor, setChecklistFor] = useState<SessionType | null>(null);
  // Trading sessions open the session-start checklist; other types start straight away.
  const begin = (type: SessionType) => (type.isTrading ? setChecklistFor(type) : start.mutate(type.id));

  if (isLoading) return <div className="h-28 panel" />;
  if (running) return <RunningTimer session={running} type={types.find((t) => t.id === running.typeId)} longSessionHours={longSessionHours} />;

  return (
    <div className="flex flex-wrap items-center gap-3 panel p-5">
      <div className="mr-auto">
        <div className="text-sm text-muted">No session running</div>
        <div className="tabular font-display text-[40px] leading-none text-muted">00:00:00</div>
      </div>
      <Select
        aria-label="Session type"
        className="w-48"
        value={selectedType?.id}
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
      <Button variant="primary" className="px-5 py-2" disabled={!selectedType || start.isPending} onClick={() => selectedType && begin(selectedType)}>
        <Play size={16} aria-hidden /> Start
      </Button>
      {start.error && <p className="w-full text-sm text-loss">{start.error.message}</p>}
      <SessionStartDialog type={checklistFor} open={!!checklistFor} onClose={() => setChecklistFor(null)} />
    </div>
  );
}

function RunningTimer({ session, type, longSessionHours }: { session: Session; type?: SessionType; longSessionHours: number }) {
  const now = useNow();
  const [stopAt, setStopAt] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const stop = useSessionMutation((end?: string) => api.post<Session>(`/sessions/${session.id}/stop`, end ? { end } : {}));
  const longRunning = durationMinutes(session, now) >= longSessionHours * 60;
  const stopAtInstant = stopAt ? latestInstantAt(stopAt, session.start, now) : null;

  return (
    <div className="panel space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ember" />
            </span>
            {type?.name ?? 'Session'} · started {formatLocal(session.start, 'ccc HH:mm')}
          </div>
          <div className="tabular font-display text-[40px] leading-none">{elapsedClock(session.start, now)}</div>
        </div>
        {type?.isTrading && (
          <Button onClick={() => setCheckingIn(true)}>
            <MessageCircleQuestion size={16} aria-hidden /> Check in
          </Button>
        )}
        <Button variant="danger" className="px-5 py-2" disabled={stop.isPending} onClick={() => stop.mutate(undefined)}>
          <Square size={16} aria-hidden /> Stop
        </Button>
      </div>

      {longRunning && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
          <AlertTriangle size={18} className="text-warn" aria-hidden />
          <span className="mr-auto">
            <strong>Still going?</strong> This session has run for {formatDuration(durationMinutes(session, now))}. If you finished earlier, stop it at
            the right time.
          </span>
          <Input type="time" aria-label="Finished at" className="w-32" value={stopAt} onChange={(e) => setStopAt(e.target.value)} />
          <Button disabled={!stopAtInstant || stop.isPending} onClick={() => stopAtInstant && stop.mutate(stopAtInstant)}>
            Stop at {stopAt || '…'}
          </Button>
        </div>
      )}
      {stopAt && !stopAtInstant && <p className="text-sm text-loss">That time is before the session started.</p>}
      {stop.error && <p className="text-sm text-loss">{stop.error.message}</p>}
      <CheckInDialog sessionId={checkingIn ? session.id : null} elapsedMinutes={Math.floor(durationMinutes(session, now))} onClose={() => setCheckingIn(false)} />
    </div>
  );
}
