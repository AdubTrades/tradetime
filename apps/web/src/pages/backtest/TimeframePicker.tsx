import { ChevronDown, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Timeframe } from '@tc/domain';
import { cn } from '../../components/ui';

const LABELS: Record<Timeframe, string> = {
  '30s': '30 seconds',
  '1m': '1 minute',
  '2m': '2 minutes',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '12h': '12 hours',
  '1D': '1 day',
  '1W': '1 week',
  '1M': '1 month',
};

/** Starting favourites before any are chosen. */
export const DEFAULT_TF_FAVOURITES: Timeframe[] = ['30s', '1m', '5m', '15m', '1h'];

/**
 * Favourite timeframes as quick buttons, and the full list in a menu where a star adds or removes a favourite
 * (TradingView's layout). A timeframe that isn't a favourite shows beside the menu button while it's in use.
 */
export function TimeframePicker({
  timeframes,
  value,
  onChange,
  favourites,
  onFavouritesChange,
}: {
  timeframes: Timeframe[];
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  favourites: Timeframe[];
  onFavouritesChange: (favourites: Timeframe[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = timeframes.filter((t) => favourites.includes(t));
  const current = shown.includes(value) ? null : value;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tab = (t: Timeframe) => (
    <button
      key={t}
      type="button"
      role="tab"
      aria-selected={t === value}
      title={LABELS[t]}
      onClick={() => onChange(t)}
      className={cn('h-8 rounded-[7px] px-2.5 font-mono text-[12px] font-medium', t === value ? 'bg-card text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-muted hover:text-text')}
    >
      {t}
    </button>
  );

  return (
    <div ref={box} className="relative inline-flex items-center rounded-md bg-tabs-track p-[3px]">
      <div role="tablist" aria-label="Favourite timeframes" className="inline-flex">
        {shown.map(tab)}
        {current && tab(current)}
      </div>
      <button
        type="button"
        aria-label="All timeframes"
        aria-expanded={open}
        title="All timeframes (star your favourites)"
        onClick={() => setOpen((o) => !o)}
        className="ml-0.5 flex h-8 w-7 items-center justify-center rounded-[7px] text-muted hover:bg-card hover:text-text"
      >
        <ChevronDown size={14} className={cn('transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-40 mt-1.5 w-52 rounded-md border border-border bg-card py-1 text-[13px] shadow-menu">
          {timeframes.map((t) => {
            const fav = favourites.includes(t);
            return (
              <div key={t} className={cn('group flex items-center hover:bg-hover', t === value && 'font-semibold')}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={t === value}
                  onClick={() => {
                    onChange(t);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5 text-left"
                >
                  <span className="w-8 font-mono text-[12px] text-muted">{t}</span>
                  {LABELS[t]}
                </button>
                <button
                  type="button"
                  aria-label={fav ? `Remove ${LABELS[t]} from favourites` : `Add ${LABELS[t]} to favourites`}
                  aria-pressed={fav}
                  onClick={() => onFavouritesChange(fav ? favourites.filter((f) => f !== t) : [...favourites, t])}
                  className={cn('mr-1.5 flex h-7 w-7 items-center justify-center rounded', fav ? 'text-ember' : 'text-faint opacity-0 group-hover:opacity-100 hover:text-text')}
                >
                  <Star size={14} fill={fav ? 'currentColor' : 'none'} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
