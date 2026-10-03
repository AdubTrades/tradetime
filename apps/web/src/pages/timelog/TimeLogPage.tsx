import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Download, Plus, Printer } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { durationMinutes, financialYear, financialYearOf, formatDuration, formatLocal, summarise, tradingDay, weekStart } from '@tc/domain';
import { MenuButton } from '../../components/Menu';
import { SessionTimer } from '../../components/SessionTimer';
import { Button, buttonClass, cn, PageHeader, Select, StatusPill, SummaryStrip } from '../../components/ui';
import { api, type Session, type SessionType } from '../../lib/api';
import { useNow, useSessionMutation, useSessions, useSessionTypes } from '../../lib/sessions';
import { useSettings } from '../../lib/settings';
import { swatch } from '../../lib/theme';
import { HistoryDialog } from './HistoryDialog';
import { SessionDialog } from './SessionDialog';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function TimeLogPage() {
  const { data: settings } = useSettings();
  const { data: types = [] } = useSessionTypes();
  const now = useNow(30_000);
  const today = tradingDay(now, settings?.rolloverTime);
  const fy = financialYearOf(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dialog, setDialog] = useState<{ session: Session | null } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  if (!settings) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Time log"
        description="Track trading and business hours for your records."
        actions={
          <Button onClick={() => setDialog({ session: null })}>
            <Plus size={14} aria-hidden /> Add manually
          </Button>
        }
      />
      <section aria-label="Session timer" className="-mt-6 rounded-xl bg-dark px-7 py-6 text-dark-text">
        <SessionTimer types={types} longSessionHours={settings.longSessionHours} clock={56} layout="row" />
      </section>
      <Totals today={today} fyStartYear={fy.startYear} now={now} />
      <MonthSessions
        month={month}
        currentMonth={today.slice(0, 7)}
        onMonthChange={setMonth}
        types={types}
        now={now}
        onEdit={(session) => setDialog({ session })}
        onHistory={setHistoryFor}
      />
      <Records currentFy={fy.startYear} />
      <SessionDialog open={!!dialog} onClose={() => setDialog(null)} types={types} session={dialog?.session} />
      <HistoryDialog sessionId={historyFor} onClose={() => setHistoryFor(null)} types={types} />
    </div>
  );
}

function Totals({ today, fyStartYear, now }: { today: string; fyStartYear: number; now: Date }) {
  const fy = financialYear(fyStartYear);
  const { data: sessions = [] } = useSessions(fy.start, fy.end);
  const items = useMemo(() => {
    const sum = (filter: (s: Session) => boolean) => summarise(sessions.filter(filter), 'fy', now)[0]?.minutes ?? 0;
    const week = weekStart(today);
    return [
      { label: 'Today', value: formatDuration(sum((s) => s.tradingDay === today)) },
      { label: 'This week', value: formatDuration(sum((s) => s.tradingDay >= week && s.tradingDay <= today)) },
      { label: 'This month', value: formatDuration(sum((s) => s.tradingDay.startsWith(today.slice(0, 7)))) },
      { label: `FY ${fy.label}`, value: formatDuration(sum(() => true)) },
    ];
  }, [sessions, today, now, fy.label]);
  return <SummaryStrip items={items} />;
}

interface MonthProps {
  month: string;
  currentMonth: string;
  onMonthChange: (month: string) => void;
  types: SessionType[];
  now: Date;
  onEdit: (s: Session) => void;
  onHistory: (id: string) => void;
}

function MonthSessions({ month, currentMonth, onMonthChange, types, now, onEdit, onHistory }: MonthProps) {
  const dt = DateTime.fromISO(`${month}-01`);
  const { data: sessions = [], isLoading } = useSessions(dt.toISODate()!, dt.endOf('month').toISODate()!);
  const remove = useSessionMutation((id: string) => api.delete<void>(`/sessions/${id}`));
  const typeById = new Map(types.map((t) => [t.id, t]));

  const days = useMemo(() => {
    const byDay = new Map<string, Session[]>();
    for (const s of sessions) byDay.set(s.tradingDay, [...(byDay.get(s.tradingDay) ?? []), s]);
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [sessions]);
  const monthMinutes = sessions.reduce((sum, s) => sum + durationMinutes(s, now), 0);
  const isCurrent = month === currentMonth;
  const navButton = cn(buttonClass('secondary', 'sm'), 'h-9 w-9 px-0');

  return (
    <section aria-labelledby="sess-h" className="card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sess-h" className="text-base font-semibold tracking-[-0.015em]">
            Sessions
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {plural(sessions.length, 'session')} · {formatDuration(monthMinutes)} {isCurrent ? 'this month' : `in ${dt.toFormat('LLLL')}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={navButton} aria-label="Previous month" onClick={() => onMonthChange(dt.minus({ months: 1 }).toFormat('yyyy-MM'))}>
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[120px] text-center text-sm font-medium" aria-live="polite">
            {dt.toFormat('LLLL yyyy')}
          </span>
          <button type="button" className={navButton} aria-label="Next month" onClick={() => onMonthChange(dt.plus({ months: 1 }).toFormat('yyyy-MM'))}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {isLoading ? null : days.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
          No sessions in {dt.toFormat('LLLL')}. {isCurrent && 'Start the timer above or add one manually.'}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map(([day, list]) => (
            <div key={day}>
              <div className="flex items-center justify-between rounded-md border border-border-subtle bg-inset px-3 py-2.5 text-[13px]">
                <span className="font-medium">{DateTime.fromISO(day).toFormat('cccc d LLLL')}</span>
                <span className="text-muted">{formatDuration(list.reduce((sum, s) => sum + durationMinutes(s, now), 0))}</span>
              </div>
              {[...list].reverse().map((s) => {
                const type = typeById.get(s.typeId);
                const range = `${formatLocal(s.start, 'HH:mm')} – ${s.end ? formatLocal(s.end, 'HH:mm') : 'running'}`;
                return (
                  <div
                    key={s.id}
                    className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto_32px] items-center gap-3 rounded-sm border-b border-border-subtle px-3 py-1.5 text-sm hover:bg-hover sm:grid-cols-[minmax(0,1fr)_140px_80px_minmax(80px,auto)_32px]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatch(type?.color) }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate">{type?.name ?? 'Unknown'}</span>
                        <span className="block font-mono text-xs text-secondary sm:hidden">{range}</span>
                        {s.notes && <span className="block truncate text-xs text-muted">{s.notes}</span>}
                      </span>
                    </span>
                    <span className="hidden font-mono text-[13px] text-secondary sm:block">{range}</span>
                    <span className="font-medium">{formatDuration(durationMinutes(s, now))}</span>
                    <span className="hidden flex-wrap gap-1 sm:flex">
                      {s.source !== 'timer' && <StatusPill>Manual</StatusPill>}
                      {s.editedAt && <StatusPill>Edited</StatusPill>}
                    </span>
                    <MenuButton
                      icon
                      label={`Options for ${type?.name ?? 'session'} ${range}`}
                      items={[
                        { label: 'Edit', onSelect: () => onEdit(s) },
                        { label: 'Edit history', onSelect: () => onHistory(s.id) },
                        {
                          label: 'Delete',
                          danger: true,
                          onSelect: () => window.confirm('Delete this session? It stays in the edit history.') && remove.mutate(s.id),
                        },
                      ]}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {isCurrent && days.length > 0 && (
        <p className="mt-4 text-[13px] text-muted">That's everything for {dt.toFormat('LLLL')} so far. Sessions you start with the timer show up here automatically.</p>
      )}
    </section>
  );
}

function Records({ currentFy }: { currentFy: number }) {
  const [fy, setFy] = useState(currentFy);
  const { data: years = [currentFy] } = useQuery({ queryKey: ['sessions', 'years'], queryFn: () => api.get<number[]>('/sessions/years') });
  return (
    <section aria-labelledby="acc-h" className="card flex flex-wrap items-center justify-between gap-4 p-6">
      <div>
        <h2 id="acc-h" className="text-base font-semibold tracking-[-0.015em]">
          Records for your accountant
        </h2>
        <p className="mt-1 text-[13px] text-muted">Export every logged session for the financial year.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Financial year" className="w-[150px]" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              FY {financialYear(y).label}
            </option>
          ))}
        </Select>
        <a href={`/api/sessions/export.csv?fy=${fy}`} className={buttonClass('secondary')}>
          <Download size={15} aria-hidden /> CSV
        </a>
        <Link to="/time-log/report" search={{ fy }} target="_blank" className={buttonClass('primary')}>
          <Printer size={15} aria-hidden /> PDF report
        </Link>
      </div>
    </section>
  );
}
