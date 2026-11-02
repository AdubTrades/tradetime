import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { cn } from '../../components/ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export interface DateTimeValue {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
}

/**
 * A date and time field that opens a calendar with hour and minute columns (TradeZella's layout, TradeTime's
 * colours; no seconds). `isEnabled` greys out days that can't be picked, e.g. days without price data.
 */
export function DateTimePicker({
  value,
  onChange,
  isEnabled,
  min,
  max,
  disabled,
  placeholder = 'Pick a date and time',
  openUp = false,
  label,
  className,
}: {
  value: DateTimeValue | null;
  onChange: (v: DateTimeValue) => void;
  isEnabled?: (date: string) => boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Open above the field (for fields near the bottom of the screen). */
  openUp?: boolean;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});

  // Float the calendar over everything (inside a modal <dialog> it has to live in the dialog to stay on top), below the
  // field, or above it when there isn't room below.
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const height = 390;
    const up = openUp ? r.top > height || r.top > window.innerHeight - r.bottom : window.innerHeight - r.bottom < height && r.top > window.innerHeight - r.bottom;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 470));
    setPlace(up ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  }, [open, openUp]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = value ? DateTime.fromISO(`${value.date}T${value.time}`) : null;
  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-[13px] transition hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
      >
        <CalendarDays size={14} className="shrink-0 text-muted" />
        <span className={cn('truncate font-mono', !shown && 'font-sans text-muted')}>{shown ? shown.toFormat('ccc d LLL yyyy · HH:mm') : placeholder}</span>
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="fixed z-[60]" style={place}>
            <Panel
              initial={value}
              isEnabled={isEnabled}
              min={min}
              max={max}
              onDone={(v) => {
                onChange(v);
                setOpen(false);
              }}
            />
          </div>,
          box.current?.closest('dialog') ?? document.fullscreenElement ?? document.body,
        )}
    </div>
  );
}

function Panel({ initial, isEnabled, min, max, onDone }: { initial: DateTimeValue | null; isEnabled?: (d: string) => boolean; min?: string; max?: string; onDone: (v: DateTimeValue) => void }) {
  const start = initial ? DateTime.fromISO(initial.date) : DateTime.fromISO(max ?? DateTime.now().toISODate()!);
  const [date, setDate] = useState(initial?.date ?? null);
  const [month, setMonth] = useState(start.startOf('month'));
  const [picking, setPicking] = useState<'days' | 'months'>('days');
  const [h, m] = (initial?.time ?? '09:30').split(':').map(Number) as [number, number];
  const [hour, setHour] = useState(h);
  const [minute, setMinute] = useState(m);
  const today = DateTime.now().toISODate();

  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max) && (!isEnabled || isEnabled(d));
  // Sunday-first grid for the month.
  const first = month.startOf('month');
  const lead = first.weekday % 7;
  const days = Array.from({ length: first.daysInMonth! }, (_, i) => first.plus({ days: i }).toISODate()!);

  return (
    <div role="dialog" aria-label="Choose a date and time" className="flex overflow-hidden rounded-lg border border-border bg-card text-text shadow-menu">
      <div className="flex w-[300px] flex-col">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <button
            type="button"
            onClick={() => setPicking((p) => (p === 'days' ? 'months' : 'days'))}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[15px] font-semibold hover:bg-hover"
          >
            {picking === 'days' ? month.toFormat('LLLL yyyy') : month.toFormat('yyyy')}
            <ChevronDown size={15} className={cn('transition', picking === 'months' && 'rotate-180')} />
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={picking === 'days' ? 'Previous month' : 'Previous year'}
              onClick={() => setMonth((d) => d.minus(picking === 'days' ? { months: 1 } : { years: 1 }))}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label={picking === 'days' ? 'Next month' : 'Next year'}
              onClick={() => setMonth((d) => d.plus(picking === 'days' ? { months: 1 } : { years: 1 }))}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {picking === 'months' ? (
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {MONTHS.map((name, i) => {
              const selected = month.month === i + 1;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setMonth((d) => d.set({ month: i + 1 }));
                    setPicking('days');
                  }}
                  className={cn('h-10 rounded-md text-[13px] font-medium', selected ? 'bg-text text-card' : 'hover:bg-hover')}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3 pb-3">
            <div className="grid grid-cols-7 pb-1 text-center text-[12px] text-muted">
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="py-1">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {days.map((d) => {
                const ok = allowed(d);
                const selected = d === date;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!ok}
                    onClick={() => setDate(d)}
                    className={cn(
                      'mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[13px] transition',
                      selected ? 'bg-text font-semibold text-card' : ok ? 'hover:bg-hover' : 'cursor-not-allowed text-faint',
                      !selected && d === today && 'font-semibold text-ember',
                    )}
                  >
                    {Number(d.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="font-mono text-[12px] text-muted">{date ? `${DateTime.fromISO(date).toFormat('d LLL yyyy')} · ${pad(hour)}:${pad(minute)}` : 'Choose a day'}</span>
          <button
            type="button"
            disabled={!date}
            onClick={() => date && onDone({ date, time: `${pad(hour)}:${pad(minute)}` })}
            className="h-8 rounded-md bg-text px-4 text-[13px] font-semibold text-card transition hover:opacity-90 disabled:opacity-40"
          >
            OK
          </button>
        </div>
      </div>
      <div className="flex border-l border-border">
        <Column label="Hour" count={24} value={hour} onChange={setHour} />
        <Column label="Minute" count={60} value={minute} onChange={setMinute} />
      </div>
    </div>
  );
}

/** A scrolling column of numbers (hours 00–23 or minutes 00–59), the chosen one highlighted and scrolled to the top. */
function Column({ label, count, value, onChange }: { label: string; count: number; value: number; onChange: (n: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-n="${value}"]`);
    if (el && list.current) list.current.scrollTop = el.offsetTop - 4;
    // Only when opened: scrolling while choosing would jump the list under the mouse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={list} role="listbox" aria-label={label} className="h-[320px] w-14 overflow-y-auto border-r border-border p-1 last:border-r-0 [scrollbar-width:none]">
      {Array.from({ length: count }, (_, n) => (
        <button
          key={n}
          type="button"
          role="option"
          aria-selected={n === value}
          data-n={n}
          onClick={() => onChange(n)}
          className={cn('mb-0.5 flex h-9 w-full items-center justify-center rounded-md font-mono text-[13px] transition', n === value ? 'bg-text font-semibold text-card' : 'hover:bg-hover')}
        >
          {pad(n)}
        </button>
      ))}
    </div>
  );
}
