import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Download, History, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { durationMinutes, financialYear, financialYearOf, formatDuration, formatLocal, summarise, tradingDay, weekStart } from '@tc/domain';
import { Button, PageHeader, Select } from '../../components/ui';
import { api, type Session, type SessionType } from '../../lib/api';
import { useNow, useSessionMutation, useSessions, useSessionTypes } from '../../lib/sessions';
import { useSettings } from '../../lib/settings';
import { HistoryDialog } from './HistoryDialog';
import { SessionDialog } from './SessionDialog';
import { TimerCard } from './TimerCard';

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
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Time log"
        actions={
          <Button onClick={() => setDialog({ session: null })}>
            <Plus size={16} aria-hidden /> Add manually
          </Button>
        }
      />
      <TimerCard types={types} longSessionHours={settings.longSessionHours} />
      <SummaryTiles today={today} fyStartYear={fy.startYear} now={now} />
      <MonthSessions
        month={month}
        onMonthChange={setMonth}
        types={types}
        now={now}
        onEdit={(session) => setDialog({ session })}
        onHistory={setHistoryFor}
      />
      <ExportBar currentFy={fy.startYear} />
      <SessionDialog open={!!dialog} onClose={() => setDialog(null)} types={types} session={dialog?.session} />
      <HistoryDialog sessionId={historyFor} onClose={() => setHistoryFor(null)} types={types} />
    </div>
  );
}

function SummaryTiles({ today, fyStartYear, now }: { today: string; fyStartYear: number; now: Date }) {
  const fy = financialYear(fyStartYear);
  const { data: sessions = [] } = useSessions(fy.start, fy.end);
  const totals = useMemo(() => {
    const sum = (filter: (s: Session) => boolean) => summarise(sessions.filter(filter), 'fy', now)[0]?.minutes ?? 0;
    const week = weekStart(today);
    return [
      { label: 'Today', minutes: sum((s) => s.tradingDay === today) },
      { label: 'This week', minutes: sum((s) => s.tradingDay >= week && s.tradingDay <= today) },
      { label: 'This month', minutes: sum((s) => s.tradingDay.startsWith(today.slice(0, 7))) },
      { label: `FY ${fy.label}`, minutes: sum(() => true) },
    ];
  }, [sessions, today, now, fy.label]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {totals.map((t) => (
        <div key={t.label} className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">{t.label}</div>
          <div className="tabular mt-1 text-xl font-semibold">{formatDuration(t.minutes)}</div>
        </div>
      ))}
    </div>
  );
}

interface MonthProps {
  month: string;
  onMonthChange: (month: string) => void;
  types: SessionType[];
  now: Date;
  onEdit: (s: Session) => void;
  onHistory: (id: string) => void;
}

function MonthSessions({ month, onMonthChange, types, now, onEdit, onHistory }: MonthProps) {
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

  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button variant="ghost" aria-label="Previous month" onClick={() => onMonthChange(dt.minus({ months: 1 }).toFormat('yyyy-MM'))}>
          <ChevronLeft size={16} />
        </Button>
        <h2 className="w-36 text-center font-semibold">{dt.toFormat('LLLL yyyy')}</h2>
        <Button variant="ghost" aria-label="Next month" onClick={() => onMonthChange(dt.plus({ months: 1 }).toFormat('yyyy-MM'))}>
          <ChevronRight size={16} />
        </Button>
        <span className="tabular ml-auto text-sm text-muted">
          {sessions.length} sessions · {formatDuration(monthMinutes)}
        </span>
      </header>
      {isLoading ? null : days.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No sessions this month.</p>
      ) : (
        <div className="divide-y divide-border">
          {days.map(([day, list]) => (
            <div key={day} className="px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-medium">{DateTime.fromISO(day).toFormat('cccc d LLLL')}</span>
                <span className="tabular text-muted">{formatDuration(list.reduce((sum, s) => sum + durationMinutes(s, now), 0))}</span>
              </div>
              <ul className="space-y-1">
                {[...list].reverse().map((s) => {
                  const type = typeById.get(s.typeId);
                  return (
                    <li key={s.id} className="group flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: type?.color }} aria-hidden />
                      <span className="w-32 truncate">{type?.name ?? 'Unknown'}</span>
                      <span className="tabular w-32 text-muted">
                        {formatLocal(s.start, 'HH:mm')} – {s.end ? formatLocal(s.end, 'HH:mm') : 'running'}
                      </span>
                      <span className="tabular w-16">{formatDuration(durationMinutes(s, now))}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted group-hover:bg-surface">
                        {s.source === 'timer' ? 'Timer' : 'Manual'}
                      </span>
                      {s.editedAt && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-xs text-warn">Edited</span>}
                      {s.notes && <span className="min-w-0 flex-1 truncate text-muted">{s.notes}</span>}
                      <span className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <Button variant="ghost" className="px-2" aria-label="Edit session" onClick={() => onEdit(s)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" className="px-2" aria-label="Edit history" onClick={() => onHistory(s.id)}>
                          <History size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2"
                          aria-label="Delete session"
                          onClick={() => window.confirm('Delete this session? It stays in the edit history.') && remove.mutate(s.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ExportBar({ currentFy }: { currentFy: number }) {
  const [fy, setFy] = useState(currentFy);
  const years = Array.from({ length: 5 }, (_, i) => currentFy - i);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <span className="mr-auto font-medium">Records for your accountant</span>
      <Select aria-label="Financial year" className="w-36" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            FY {financialYear(y).label}
          </option>
        ))}
      </Select>
      <a
        href={`/api/sessions/export.csv?fy=${fy}`}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-medium hover:bg-border/60"
      >
        <Download size={16} aria-hidden /> CSV
      </a>
      <Link
        to="/time-log/report"
        search={{ fy }}
        target="_blank"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-medium hover:bg-border/60"
      >
        <Printer size={16} aria-hidden /> Printable report (PDF)
      </Link>
    </div>
  );
}
