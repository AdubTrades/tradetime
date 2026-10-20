import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { currentZone, durationMinutes, formatLocal } from '@tc/domain';
import type { OccurrenceView, SessionType } from '../../lib/api';
import { useEventTypes, useUpcoming } from '../../lib/calendar';
import { useSessions } from '../../lib/sessions';
import { ImpactMarker } from '../../components/ImpactMarker';

interface AgendaItem {
  key: string;
  at: number;
  time: string;
  title: string;
  sub: string;
  bar: string;
  impact?: string;
  muted?: boolean;
}

/** "in 48 min", "in 1 h 33 min". */
function countdown(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `in ${h} h ${r} min` : `in ${h} h`;
}

/** Median trading-session length over the last 30 days, for "usual window to about 23:45". */
function useUsualSessionMinutes(types: SessionType[], today: string): number | null {
  const from = DateTime.fromISO(today).minus({ days: 30 }).toISODate()!;
  const { data: sessions = [] } = useSessions(from, today);
  return useMemo(() => {
    const trading = new Set(types.filter((t) => t.isTrading).map((t) => t.id));
    const lengths = sessions
      .filter((s) => s.end && trading.has(s.typeId))
      .map((s) => durationMinutes(s))
      .sort((a, b) => a - b);
    if (lengths.length < 3) return null;
    return lengths[Math.floor(lengths.length / 2)]!;
  }, [sessions, types]);
}

/** The day's agenda beside Performance. The session timer lives in the page header; the last session's result is on the Recent trades card. */
export function TonightCard({ now, today, types, onAdd }: { now: Date; today: string; types: SessionType[]; onAdd: () => void }) {
  return (
    <section aria-labelledby="tonight-h" className="flex min-w-0 flex-[1_1_340px] flex-col rounded-xl bg-dark text-dark-text">
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] px-6 py-[22px]">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tonight-h" className="text-base font-semibold">
            Tonight
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAdd}
              aria-label="Add a calendar event"
              className="inline-flex h-9 items-center gap-1 rounded-sm border border-dark-border px-2.5 text-[13px] text-dark-text hover:bg-dark-divider pointer-coarse:h-11"
            >
              <Plus size={14} aria-hidden /> Add
            </button>
            <Link to="/calendar" className="rounded-sm px-2 py-3 text-[13px] text-[#d6d5d1] hover:text-dark-text">
              Calendar →
            </Link>
          </div>
        </div>
        <Agenda now={now} today={today} types={types} />
      </div>
    </section>
  );
}

function Agenda({ now, today, types }: { now: Date; today: string; types: SessionType[] }) {
  // Same events source as the calendar, so releases that are on today always show here.
  const { data } = useUpcoming(7);
  const { data: eventTypes = [] } = useEventTypes();
  const usual = useUsualSessionMinutes(types, today);
  const tradingSessionTypes = new Set(types.filter((t) => t.isTrading).map((t) => t.id));

  const { tonight, next, overdue } = useMemo(() => {
    const nowMs = now.getTime();
    const items: AgendaItem[] = [];
    for (const m of data?.market ?? []) {
      if (m.tradingDay !== today) continue;
      const at = Date.parse(m.at);
      if (at < nowMs) continue;
      items.push({
        key: m.id,
        at,
        time: formatLocal(m.at, 'HH:mm'),
        title: m.title,
        sub: `${m.impact === 'high' ? 'High' : 'Medium'} impact · ${countdown(at - nowMs)}`,
        bar: m.impact === 'high' ? 'var(--impact-high-on-dark)' : 'var(--medium-impact)',
        impact: m.impact,
      });
    }
    const timed = (data?.occurrences ?? []).filter((o) => !o.isTask && o.startAt);
    for (const o of timed) {
      if (o.date !== today) continue;
      const at = Date.parse(o.startAt!);
      if (at < nowMs) continue;
      const type = eventTypes.find((t) => t.id === o.typeId);
      const isSession = !!type?.sessionTypeId && tradingSessionTypes.has(type.sessionTypeId);
      const until = isSession && usual ? `Usual window to about ${formatLocal(new Date(at + usual * 60_000).toISOString(), 'HH:mm')}` : o.endTime ? `Until ${o.endTime}` : (type?.name ?? 'Event');
      items.push({ key: o.key, at, time: o.startTime!, title: o.title, sub: `${until} · ${countdown(at - nowMs)}`, bar: '#d6d5d1' });
    }
    items.sort((a, b) => a.at - b.at);

    // The next thing after tonight, shown muted.
    const after = (data?.occurrences ?? [])
      .filter((o) => !o.isTask && o.date > today && (o.startAt ? Date.parse(o.startAt) > nowMs : o.date > DateTime.fromJSDate(now).setZone(currentZone()).toISODate()!))
      .sort((a, b) => (a.startAt ?? a.date).localeCompare(b.startAt ?? b.date))[0];
    const nextItem: AgendaItem | null = after
      ? {
          key: after.key,
          at: 0,
          time: DateTime.fromISO(after.date).toFormat('ccc'),
          title: after.title,
          sub: `${DateTime.fromISO(after.date).toFormat('ccc d LLL')}${after.startTime && !after.allDay ? `, ${after.startTime}` : ''}`,
          bar: 'var(--dark-border)',
          muted: true,
        }
      : null;

    const overdueTasks = (data?.occurrences ?? []).filter((o: OccurrenceView) => o.isTask && !o.done && o.date < today);
    return { tonight: items, next: nextItem, overdue: overdueTasks };
  }, [data, eventTypes, now, today, usual, tradingSessionTypes]);

  const nowLabel = DateTime.fromJSDate(now).setZone(currentZone()).toFormat('HH:mm');

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-[48px_1fr] items-center gap-3">
          <span className="rounded-[5px] bg-dark-text py-px text-center font-mono text-xs font-medium text-dark">{nowLabel}</span>
          <span className="h-px bg-dark-text opacity-60" aria-hidden />
        </div>
        {tonight.length === 0 && <p className="pl-[60px] text-[13px] text-dark-faint">Nothing else scheduled tonight.</p>}
        {[...tonight, ...(next ? [next] : [])].map((it) => (
          <div key={it.key} className="grid min-h-11 grid-cols-[48px_3px_1fr] items-stretch gap-3">
            <span className={`pt-0.5 font-mono text-[13px] ${it.muted ? 'text-dark-faint' : 'text-dark-muted'}`}>{it.time}</span>
            <span className="rounded-[2px]" style={{ background: it.bar }} aria-hidden />
            <span className="flex flex-col gap-0.5 pt-px pb-1">
              <span className={`flex items-center gap-1.5 text-sm font-medium ${it.muted ? 'text-dark-muted' : 'text-dark-text'}`}>
                {it.impact === 'high' && <ImpactMarker impact="high" onDark size={13} />}
                {it.title}
              </span>
              <span className="text-xs text-dark-faint">{it.sub}</span>
            </span>
          </div>
        ))}
      </div>
      {overdue.length > 0 && (
        <a href="#todo-h" className="flex items-center gap-2 rounded-sm border-t border-dark-divider pt-3.5 text-[13px] text-[#d6d5d1] hover:text-dark-text">
          <span className="h-[7px] w-[7px] rounded-full bg-warning-dark" aria-hidden />
          {overdue.length} overdue to-do{overdue.length === 1 ? '' : 's'}: {overdue[0]!.title}
          <span className="ml-auto text-dark-muted">View →</span>
        </a>
      )}
    </>
  );
}
