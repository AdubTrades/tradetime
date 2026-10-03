import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { formatLocal, formatMoney, monthWeeks, tradingDay } from '@tc/domain';
import { Pnl } from '../../components/GradeBadge';
import { Button, cn, PageHeader, SummaryStrip } from '../../components/ui';
import type { DayFigures, MarketEvent, OccurrenceView } from '../../lib/api';
import { hoursLabel, LAYERS, useCalendarRange, useEventTypes, useLayers, type LayerId } from '../../lib/calendar';
import { useSettings } from '../../lib/settings';
import { swatch } from '../../lib/theme';
import { DayDetail } from './DayDetail';
import { EventDialog } from './EventDialog';
import { UpcomingPanel } from './UpcomingPanel';

const emptyDay: DayFigures = { netCents: 0, trades: 0, wins: 0, tradingMinutes: 0, otherMinutes: 0, expensesCents: 0, hasReview: false };

/** Dot colour on each layer pill while it's on. */
const LAYER_DOT: Record<LayerId, string> = {
  pnl: 'var(--positive)',
  screen: 'var(--dark-text-faint)',
  events: 'var(--accent)',
  journal: 'var(--text-secondary)',
  mine: 'currentColor',
  expenses: 'var(--medium-impact)',
};

const NO_TRADE_HATCH = 'bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,var(--border)_6px,var(--border)_7px)]';

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

  const navButton = 'h-10 w-10 px-0';

  return (
    <div>
      <PageHeader
        title="Calendar"
        actions={
          <Button variant="primary" className="h-11 px-[18px]" onClick={() => setEventDialog({ date: today })}>
            + New event
          </Button>
        }
      />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[3_1_640px] flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button className={navButton} aria-label="Previous month" onClick={() => setMonth(dt.minus({ months: 1 }).toFormat('yyyy-MM'))}>
                <ChevronLeft size={16} />
              </Button>
              <h2 className="mx-3 min-w-[150px] text-center text-xl font-medium tracking-[-0.02em]" aria-live="polite">
                {dt.toFormat('LLLL yyyy')}
              </h2>
              <Button className={navButton} aria-label="Next month" onClick={() => setMonth(dt.plus({ months: 1 }).toFormat('yyyy-MM'))}>
                <ChevronRight size={16} />
              </Button>
              <Button className="ml-2 h-10 text-[13px]" onClick={() => setMonth(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>
                Today
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show on calendar">
              {LAYERS.map((l) => {
                const on = layers.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleLayer(l.id)}
                    className={cn(
                      'flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                      on ? 'border-text bg-text text-card' : 'border-border bg-card text-secondary hover:bg-hover',
                    )}
                  >
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: on ? LAYER_DOT[l.id] : 'var(--grade-b-border)' }} aria-hidden />
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          <SummaryStrip
            items={[
              { label: 'Net P&L · USD', value: <Pnl cents={totals.net} /> },
              {
                label: 'Days traded',
                value: (
                  <>
                    {totals.traded} <span className="text-[13px] font-normal tracking-normal text-muted">of {available}</span>
                  </>
                ),
                sub: noTradeDays > 0 ? `${noTradeDays} no-trade day${noTradeDays === 1 ? '' : 's'} excluded` : undefined,
              },
              { label: 'Trading hours', value: hoursLabel(totals.trading) },
              { label: 'Other business hours', value: hoursLabel(totals.other) },
            ]}
          />

          <section aria-label="Month grid" className="card p-4">
            <div className="overflow-x-auto">
              <div className="flex min-w-[680px] flex-col gap-1.5">
                <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-1.5 px-1 pb-1 text-xs text-muted">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                {weeks.map((week) => {
                  const w = week.reduce(
                    (t, d) => {
                      const f = fig(d);
                      return { net: t.net + f.netCents, traded: t.traded + (f.trades > 0 ? 1 : 0), minutes: t.minutes + f.tradingMinutes + f.otherMinutes };
                    },
                    { net: 0, traded: 0, minutes: 0 },
                  );
                  return (
                    <div key={week[0]} className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-1.5">
                      {week.map((d) => (
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
                      ))}
                      <div className="flex min-h-32 flex-col justify-center gap-[3px] rounded-md bg-page px-3 py-2.5">
                        {layers.has('pnl') && w.traded > 0 && <Pnl cents={w.net} className="text-base font-medium tracking-[-0.02em]" />}
                        <span className="text-[11px] text-muted">{w.traded ? `${w.traded} day${w.traded === 1 ? '' : 's'} traded` : 'No trades'}</span>
                        {layers.has('screen') && w.minutes > 0 && <span className="font-mono text-[11px] text-faint">{hoursLabel(w.minutes)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 px-1 pt-3.5 pb-0.5 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-ember" aria-hidden />
                High-impact release
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-medium" aria-hidden />
                Medium
              </span>
              <span className="flex items-center gap-1.5">
                <NotebookPen size={12} className="text-faint" aria-hidden />
                Journal entry
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[11px] w-[11px] rounded-[3px] border border-border-subtle bg-profit-tint" aria-hidden />
                <span className="h-[11px] w-[11px] rounded-[3px] border border-border-subtle bg-loss-tint" aria-hidden />
                Winning / losing day
              </span>
              {noTradeDays > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className={cn('h-[11px] w-[11px] rounded-[3px] border border-border-subtle', NO_TRADE_HATCH)} aria-hidden />
                  No-trade day
                </span>
              )}
            </div>
          </section>
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

const MAX_TAGS = 3;

function DayCell({ date, inMonth, isToday, figures: f, market, occurrences, noTrade, layers, colorOf, onOpen }: CellProps) {
  const day = DateTime.fromISO(date);
  const showPnl = layers.has('pnl') && f.trades > 0;
  const weekend = day.weekday >= 6;
  const tone = showPnl ? (f.netCents >= 0 ? 'bg-profit-tint' : 'bg-loss-tint') : weekend ? 'bg-sidebar' : 'bg-card';
  const screen = f.tradingMinutes + f.otherMinutes;
  const tags = layers.has('mine') ? [...occurrences].sort((a, b) => Number(a.isTask) - Number(b.isTask) || (a.startTime ?? '').localeCompare(b.startTime ?? '')) : [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={day.toFormat('cccc d LLLL')}
      aria-current={isToday ? 'date' : undefined}
      className={cn(
        'flex min-h-32 min-w-0 cursor-pointer flex-col gap-[3px] rounded-md px-[9px] py-2 transition-colors hover:border-border-strong',
        tone,
        isToday ? 'border-[1.5px] border-ember' : 'border border-border-subtle',
        !inMonth && !isToday && 'opacity-50',
        noTrade && NO_TRADE_HATCH,
      )}
    >
      <span className="flex h-[22px] items-center gap-[5px]">
        <span className={cn('flex h-[22px] min-w-[22px] items-center justify-center rounded-full text-xs font-medium', isToday && 'bg-ember text-white')}>{day.day}</span>
        {layers.has('events') && market.length > 0 && <MarketDot events={market} />}
        <span className="flex-1" />
        {layers.has('journal') && f.hasReview && <NotebookPen size={13} className="text-faint" aria-label="Journal entry" />}
      </span>
      {showPnl && (
        <>
          <Pnl cents={f.netCents} className="text-[15px] font-medium tracking-[-0.02em]" />
          <span className="text-[11px] text-muted">
            {f.trades} trade{f.trades === 1 ? '' : 's'} · {Math.round((f.wins / f.trades) * 100)}%
          </span>
        </>
      )}
      {layers.has('screen') && screen > 0 && <span className="font-mono text-[11px] text-faint">{hoursLabel(screen)}</span>}
      {layers.has('expenses') && f.expensesCents > 0 && <span className="text-[11px] text-secondary">Expense {formatMoney(f.expensesCents)}</span>}
      {noTrade && <span className="text-[10px] font-medium tracking-wide text-muted uppercase">No-trade day</span>}
      <span className="flex-1" />
      {tags.slice(0, MAX_TAGS).map((o) =>
        o.isTask ? (
          <span
            key={o.key}
            className={cn('truncate rounded-[5px] border border-ember/45 px-[5px] py-px text-[11px] leading-[1.3] text-warning', o.done && 'line-through opacity-60')}
          >
            {o.title}
          </span>
        ) : (
          <span
            key={o.key}
            className="truncate rounded-[5px] border-l-2 bg-nav-active px-[5px] py-0.5 text-[11px] leading-[1.3] text-secondary"
            style={{ borderLeftColor: swatch(colorOf(o.typeId)) }}
          >
            {o.startTime && !o.allDay ? `${o.startTime} ` : ''}
            {o.title}
          </span>
        ),
      )}
      {tags.length > MAX_TAGS && <span className="text-[11px] text-muted">+{tags.length - MAX_TAGS} more</span>}
    </div>
  );
}

/** Orange dot for high-impact releases (amber if only medium); hovering lists them. */
function MarketDot({ events }: { events: MarketEvent[] }) {
  const high = events.some((e) => e.impact === 'high');
  const label = events.map((e) => `${formatLocal(e.at, 'HH:mm')} ${e.title} (${e.impact})`).join('\n');
  return (
    <span className="group relative" onClick={(e) => e.stopPropagation()}>
      <span className={cn('block h-[7px] w-[7px] rounded-full', high ? 'bg-ember' : 'bg-medium')} aria-label={label} title={label} />
      <span className="pointer-events-none absolute top-3 left-0 z-20 hidden w-60 rounded-lg border border-border bg-card p-2 text-xs shadow-menu group-hover:block">
        {events.map((e) => (
          <span key={e.id} className="flex gap-2 py-0.5">
            <span className="font-mono text-muted">{formatLocal(e.at, 'HH:mm')}</span>
            <span className="flex-1">{e.title}</span>
            <span className={e.impact === 'high' ? 'text-ember' : 'text-medium'}>{e.impact}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
