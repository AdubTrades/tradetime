import { ChevronLeft, ChevronRight, NotebookPen, Plus, Receipt } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { formatLocal, formatMoney, monthWeeks, tradingDay } from '@tc/domain';
import { Pnl } from '../../components/GradeBadge';
import { Button, cn, PageHeader } from '../../components/ui';
import type { DayFigures, MarketEvent, OccurrenceView } from '../../lib/api';
import { hoursLabel, LAYERS, useCalendarRange, useEventTypes, useLayers } from '../../lib/calendar';
import { useSettings } from '../../lib/settings';
import { DayDetail } from './DayDetail';
import { EventDialog } from './EventDialog';
import { UpcomingPanel } from './UpcomingPanel';

const emptyDay: DayFigures = { netCents: 0, trades: 0, wins: 0, tradingMinutes: 0, otherMinutes: 0, expensesCents: 0, hasReview: false };

export function CalendarPage() {
  const { data: settings } = useSettings();
  const today = tradingDay(new Date(), settings?.rolloverTime);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [layers, toggleLayer] = useLayers();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [eventDialog, setEventDialog] = useState<{ occurrence?: OccurrenceView; date?: string } | null>(null);
  const { data: types = [] } = useEventTypes();

  const weeks = useMemo(() => monthWeeks(month), [month]);
  const from = weeks[0]![0]!;
  const to = weeks.at(-1)!.at(-1)!;
  const { data } = useCalendarRange(from, to);
  const dt = DateTime.fromISO(`${month}-01`);

  const fig = (d: string) => data?.days[d] ?? emptyDay;
  const occOn = (d: string) => data?.occurrences.filter((o) => o.date === d) ?? [];
  const marketOn = (d: string) => data?.market.filter((m) => m.tradingDay === d) ?? [];
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const isNoTrade = (d: string) => occOn(d).some((o) => typeOf(o.typeId)?.isNoTrade);

  // Monthly stats (days in this month only).
  const monthDays = weeks.flat().filter((d) => d.startsWith(month));
  const totals = monthDays.reduce(
    (t, d) => {
      const f = fig(d);
      t.net += f.netCents;
      t.traded += f.trades > 0 ? 1 : 0;
      t.trading += f.tradingMinutes;
      t.other += f.otherMinutes;
      return t;
    },
    { net: 0, traded: 0, trading: 0, other: 0 },
  );
  // Weekdays you could have traded so far: excludes weekends, no-trade days and future days.
  const available = monthDays.filter((d) => DateTime.fromISO(d).weekday <= 5 && !isNoTrade(d) && d <= today).length;
  const noTradeDays = monthDays.filter(isNoTrade).length;

  return (
    <div className="max-w-[90rem]">
      <PageHeader
        title="Calendar"
        actions={
          <Button variant="primary" onClick={() => setEventDialog({ date: today })}>
            <Plus size={16} aria-hidden /> New event
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" aria-label="Previous month" onClick={() => setMonth(dt.minus({ months: 1 }).toFormat('yyyy-MM'))}>
              <ChevronLeft size={16} />
            </Button>
            <h2 className="w-40 text-center text-lg font-semibold">{dt.toFormat('LLLL yyyy')}</h2>
            <Button variant="ghost" aria-label="Next month" onClick={() => setMonth(dt.plus({ months: 1 }).toFormat('yyyy-MM'))}>
              <ChevronRight size={16} />
            </Button>
            <Button onClick={() => setMonth(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>
              This month
            </Button>
            <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Layers">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={layers.has(l.id)}
                  onClick={() => toggleLayer(l.id)}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs', layers.has(l.id) ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted')}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted">Net P&L (USD)</div>
              <Pnl cents={totals.net} className="text-lg font-semibold" />
            </div>
            <div>
              <div className="text-xs text-muted">Days traded</div>
              <div className="text-lg font-semibold">
                {totals.traded}
                <span className="text-sm font-normal text-muted"> of {available} available</span>
              </div>
              {noTradeDays > 0 && <div className="text-xs text-muted">{noTradeDays} no-trade days excluded</div>}
            </div>
            <div>
              <div className="text-xs text-muted">Trading hours</div>
              <div className="tabular text-lg font-semibold">{hoursLabel(totals.trading)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Other business hours</div>
              <div className="tabular text-lg font-semibold">{hoursLabel(totals.other)}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[52rem] grid-cols-[repeat(7,minmax(0,1fr))_7.5rem] gap-1 text-xs">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map((d) => (
                <div key={d} className="px-1 pb-1 font-medium text-muted">
                  {d}
                </div>
              ))}
              {weeks.map((week) => {
                const w = week.reduce(
                  (t, d) => {
                    const f = fig(d);
                    return { net: t.net + f.netCents, traded: t.traded + (f.trades > 0 ? 1 : 0), minutes: t.minutes + f.tradingMinutes + f.otherMinutes };
                  },
                  { net: 0, traded: 0, minutes: 0 },
                );
                return [
                  ...week.map((d) => (
                    <DayCell
                      key={d}
                      date={d}
                      inMonth={d.startsWith(month)}
                      isToday={d === today}
                      figures={fig(d)}
                      market={marketOn(d)}
                      occurrences={occOn(d)}
                      noTrade={isNoTrade(d)}
                      layers={layers}
                      colorOf={(id) => typeOf(id)?.color ?? '#64748b'}
                      onOpen={() => setOpenDay(d)}
                    />
                  )),
                  <div key={`${week[0]}-sum`} className="flex flex-col justify-center gap-0.5 rounded-md bg-surface-2 p-2">
                    {layers.has('pnl') && <Pnl cents={w.net} className="text-sm font-semibold" />}
                    <span className="text-muted">{w.traded} days traded</span>
                    {layers.has('screen') && <span className="tabular text-muted">{hoursLabel(w.minutes)}</span>}
                  </div>,
                ];
              })}
            </div>
          </div>
        </div>
        <UpcomingPanel onOpen={(o) => setEventDialog({ occurrence: o })} />
      </div>

      <DayDetail
        day={openDay}
        data={data}
        onClose={() => setOpenDay(null)}
        onEditEvent={(o) => setEventDialog({ occurrence: o })}
        onNewEvent={(d) => setEventDialog({ date: d })}
      />
      <EventDialog open={!!eventDialog} onClose={() => setEventDialog(null)} occurrence={eventDialog?.occurrence} defaultDate={eventDialog?.date} />
    </div>
  );
}

interface CellProps {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  figures: DayFigures;
  market: MarketEvent[];
  occurrences: OccurrenceView[];
  noTrade: boolean;
  layers: Set<string>;
  colorOf: (typeId: string) => string;
  onOpen: () => void;
}

function DayCell({ date, inMonth, isToday, figures: f, market, occurrences, noTrade, layers, colorOf, onOpen }: CellProps) {
  const showPnl = layers.has('pnl') && f.trades > 0;
  const tone = showPnl ? (f.netCents > 0 ? 'bg-profit/12 border-profit/30' : f.netCents < 0 ? 'bg-loss/12 border-loss/30' : 'bg-surface-2') : 'bg-surface';
  const high = market.filter((m) => m.impact === 'high');
  const screen = f.tradingMinutes + f.otherMinutes;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      aria-label={DateTime.fromISO(date).toFormat('cccc d LLLL')}
      className={cn(
        'relative flex min-h-28 cursor-pointer flex-col gap-0.5 rounded-md border p-1.5 transition hover:border-accent/60 focus:outline-2 focus:outline-accent',
        tone,
        !showPnl && 'border-border',
        !inMonth && 'opacity-45',
        isToday && 'ring-2 ring-accent',
        noTrade && 'bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,var(--border)_6px,var(--border)_7px)]',
      )}
    >
      <div className="flex items-center gap-1">
        <span className={cn('font-medium', isToday && 'text-accent')}>{DateTime.fromISO(date).day}</span>
        {layers.has('events') && market.length > 0 && <MarketDots events={market} highCount={high.length} />}
        <span className="ml-auto flex items-center gap-1 text-muted">
          {layers.has('journal') && f.hasReview && <NotebookPen size={12} aria-label="Daily review written" />}
          {layers.has('expenses') && f.expensesCents > 0 && (
            <span className="flex items-center gap-0.5" title={`Expenses ${formatMoney(f.expensesCents)}`}>
              <Receipt size={11} aria-hidden /> {formatMoney(f.expensesCents).replace('.00', '')}
            </span>
          )}
        </span>
      </div>
      {showPnl && (
        <div>
          <Pnl cents={f.netCents} className="text-sm font-semibold" />
          <div className="text-muted">
            {f.trades} trade{f.trades === 1 ? '' : 's'} · {Math.round((f.wins / f.trades) * 100)}%
          </div>
        </div>
      )}
      {layers.has('screen') && screen > 0 && <div className="tabular text-muted">⏱ {hoursLabel(screen)}</div>}
      {noTrade && <div className="text-[10px] font-medium text-muted uppercase">No-trade day</div>}
      {layers.has('mine') &&
        occurrences.slice(0, 3).map((o) => (
          <div key={o.key} className={cn('truncate rounded px-1 text-[11px] text-white', o.done && 'line-through opacity-60')} style={{ background: colorOf(o.typeId) }}>
            {o.startTime && !o.allDay ? `${o.startTime} ` : ''}
            {o.title}
          </div>
        ))}
      {layers.has('mine') && occurrences.length > 3 && <div className="text-[11px] text-muted">+{occurrences.length - 3} more</div>}
    </div>
  );
}

/** Red dot for high-impact releases (amber if only medium); hovering lists them. */
function MarketDots({ events, highCount }: { events: MarketEvent[]; highCount: number }) {
  const label = events.map((e) => `${formatLocal(e.at, 'HH:mm')} ${e.title} (${e.impact})`).join('\n');
  return (
    <span className="group relative" onClick={(e) => e.stopPropagation()}>
      <span className={cn('block h-2 w-2 rounded-full', highCount ? 'bg-loss' : 'bg-warn')} aria-label={label} title={label} />
      <span className="pointer-events-none absolute top-3 left-0 z-20 hidden w-56 rounded-md border border-border bg-surface p-2 text-xs shadow-lg group-hover:block">
        {events.map((e) => (
          <span key={e.id} className="flex gap-2">
            <span className="tabular text-muted">{formatLocal(e.at, 'HH:mm')}</span>
            <span className="flex-1">{e.title}</span>
            <span className={e.impact === 'high' ? 'text-loss' : 'text-warn'}>{e.impact}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
