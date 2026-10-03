import { Link } from '@tanstack/react-router';
import { Square } from 'lucide-react';
import { api, type Session } from '../lib/api';
import { useNow, useRunningSession, useSessionMutation, useSessionTypes } from '../lib/sessions';
import { useFullTimerVisible } from '../lib/timerVisibility';
import { elapsedClock } from './SessionTimer';

/**
 * Small floating timer in the bottom-right corner while a session is running, on every page. It steps aside
 * while the full timer (Home, Time log) is on screen so there aren't two clocks.
 */
export function MiniTimer() {
  const { data: running } = useRunningSession();
  if (!running) return null;
  return <RunningPill session={running} />;
}

function RunningPill({ session }: { session: Session }) {
  const now = useNow();
  const { data: types = [] } = useSessionTypes();
  const fullVisible = useFullTimerVisible();
  const stop = useSessionMutation(() => api.post<Session>(`/sessions/${session.id}/stop`, {}));
  const name = types.find((t) => t.id === session.typeId)?.name ?? 'Session';
  const clock = elapsedClock(session.start, now);

  return (
    <aside
      aria-label="Running session"
      aria-hidden={fullVisible}
      inert={fullVisible}
      className={`fixed right-4 bottom-4 z-40 flex h-12 items-center gap-1 rounded-full bg-dark py-1.5 pr-1.5 pl-2 text-dark-text shadow-menu transition-all duration-200 sm:right-6 sm:bottom-6 ${
        fullVisible ? 'pointer-events-none translate-y-3 opacity-0' : 'translate-y-0 opacity-100'
      }`}
    >
      <Link to="/time-log" className="flex h-full items-center gap-2.5 rounded-full px-2.5 hover:bg-dark-raised" title="Open the time log">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit-dark opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-profit-dark" />
        </span>
        <span className="max-w-[9rem] truncate text-[13px] text-dark-muted">{name}</span>
        <span className="font-mono text-[15px] tracking-[-0.02em]" aria-label={`Running for ${clock}`}>
          {clock}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        aria-label={`Stop ${name} session`}
        title="Stop"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-text text-dark hover:opacity-90 disabled:opacity-50"
      >
        <Square size={13} fill="currentColor" aria-hidden />
      </button>
    </aside>
  );
}
