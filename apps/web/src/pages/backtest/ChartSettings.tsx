import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChartStyle } from '@tc/domain';
import { cn, SegmentedTabs } from '../../components/ui';
import { ColorPicker } from './LineSettings';

/** The colours the chart is drawn with: the theme's, with the user's own on top. */
export interface ChartLook {
  bg: string;
  gradientTo: string | null;
  upBody: string;
  upBorder: string;
  upWick: string;
  downBody: string;
  downBorder: string;
  downWick: string;
  borders: boolean;
  wicks: boolean;
  vertGrid: boolean;
  horzGrid: boolean;
  /** Text colours for a background much lighter or darker than the theme's; null: the theme's own. */
  text: { muted: string; strong: string; grid: string } | null;
}

/** Roughly how light a #rrggbb colour is, 0–1. */
const lightness = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return Number.isNaN(n) ? 0.5 : (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

export function chartLook(theme: { bg: string; up: string; down: string }, s: ChartStyle | null | undefined): ChartLook {
  const upBody = s?.upBody ?? theme.up;
  const downBody = s?.downBody ?? theme.down;
  const bg = s?.background ?? theme.bg;
  const dark = (lightness(bg) + lightness(s?.gradientTo ?? bg)) / 2 < 0.5;
  return {
    text: dark === lightness(theme.bg) < 0.5 ? null : dark ? { muted: '#a3a6af', strong: '#e8e8ea', grid: '#ffffff12' } : { muted: '#6a6d75', strong: '#1d1f24', grid: '#0000000f' },
    bg,
    gradientTo: s?.gradientTo ?? null,
    upBody,
    upBorder: s?.upBorder ?? upBody,
    upWick: s?.upWick ?? upBody,
    downBody,
    downBorder: s?.downBorder ?? downBody,
    downWick: s?.downWick ?? downBody,
    borders: s?.borders ?? false,
    wicks: s?.wicks ?? true,
    vertGrid: s?.vertGrid ?? true,
    horzGrid: s?.horzGrid ?? true,
  };
}

/**
 * Chart settings (TradingView's "Symbol" and "Canvas" tabs, cut down): background colour or gradient, candle colours
 * and grid lines. Changes show on the chart straight away; Cancel puts them back.
 */
export function ChartSettings({
  style,
  look,
  onChange,
  onOk,
  onCancel,
}: {
  style: ChartStyle | null;
  look: ChartLook;
  onChange: (style: ChartStyle | null) => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const set = (patch: ChartStyle) => onChange({ ...style, ...patch });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const startDrag = (e: React.PointerEvent) => {
    const box = panel.current!.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev: PointerEvent) => setPos({ x: Math.min(window.innerWidth - 80, Math.max(-300, ev.clientX - dx)), y: Math.min(window.innerHeight - 48, Math.max(0, ev.clientY - dy)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Chart settings"
      className="fixed z-50 flex w-[360px] flex-col rounded-lg border border-border bg-card text-text shadow-menu"
      style={{ left: pos ? pos.x : 'calc(50% - 180px)', top: pos ? pos.y : 96, maxHeight: `calc(100vh - ${(pos ? pos.y : 96) + 12}px)` }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
      }}
    >
      <header className="flex cursor-move items-center justify-between border-b border-border px-4 py-3 select-none" onPointerDown={startDrag}>
        <h2 className="text-[15px] font-semibold">Chart settings</h2>
        <button
          type="button"
          onClick={onCancel}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close"
          className="-mr-1 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
        >
          <X size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-[13px]">
        <section className="space-y-3">
          <h3 className="text-[12px] font-medium tracking-wide text-muted uppercase">Background</h3>
          <div className="flex items-center gap-3">
            <SegmentedTabs
              label="Background type"
              value={look.gradientTo ? 'gradient' : 'solid'}
              onChange={(v) => set({ background: look.bg, gradientTo: v === 'gradient' ? look.bg : null })}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'gradient', label: 'Gradient' },
              ]}
            />
            <Swatch label={look.gradientTo ? 'Top colour' : 'Background colour'} value={look.bg} onChange={(background) => set({ background })} />
            {look.gradientTo && <Swatch label="Bottom colour" value={look.gradientTo} onChange={(gradientTo) => set({ gradientTo })} />}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[12px] font-medium tracking-wide text-muted uppercase">Candles</h3>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2">
            <span />
            <span className="w-8 text-center text-[12px] text-muted">Up</span>
            <span className="w-8 text-center text-[12px] text-muted">Down</span>
            <span className="text-muted">Body</span>
            <Swatch label="Up body" value={look.upBody} onChange={(upBody) => set({ upBody })} />
            <Swatch label="Down body" value={look.downBody} onChange={(downBody) => set({ downBody })} />
            <Check checked={look.borders} onChange={(borders) => set({ borders })}>
              Borders
            </Check>
            <Swatch label="Up border" value={look.upBorder} onChange={(upBorder) => set({ upBorder, borders: true })} faded={!look.borders} />
            <Swatch label="Down border" value={look.downBorder} onChange={(downBorder) => set({ downBorder, borders: true })} faded={!look.borders} />
            <Check checked={look.wicks} onChange={(wicks) => set({ wicks })}>
              Wicks
            </Check>
            <Swatch label="Up wick" value={look.upWick} onChange={(upWick) => set({ upWick, wicks: true })} faded={!look.wicks} />
            <Swatch label="Down wick" value={look.downWick} onChange={(downWick) => set({ downWick, wicks: true })} faded={!look.wicks} />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[12px] font-medium tracking-wide text-muted uppercase">Grid lines</h3>
          <div className="flex gap-5">
            <Check checked={look.vertGrid} onChange={(vertGrid) => set({ vertGrid })}>
              Vertical
            </Check>
            <Check checked={look.horzGrid} onChange={(horzGrid) => set({ horzGrid })}>
              Horizontal
            </Check>
          </div>
        </section>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-4 py-3">
        <button type="button" onClick={() => onChange(null)} className="h-8 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-text" title="Back to the app's light/dark colours">
          Reset to default
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-border bg-card px-3 text-[13px] font-medium hover:bg-hover">
            Cancel
          </button>
          <button type="button" onClick={onOk} className="h-8 rounded-md bg-text px-4 text-[13px] font-semibold text-card hover:opacity-90">
            Ok
          </button>
        </div>
      </footer>
    </div>,
    document.fullscreenElement ?? document.body,
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--text)]" />
      {children}
    </label>
  );
}

/** A colour square that opens the colour row (TradingView's colours plus a custom one) underneath it. */
function Swatch({ value, label, onChange, faded = false }: { value: string; label: string; onChange: (c: string) => void; faded?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('h-8 w-8 rounded-md border border-border', faded && 'opacity-40')}
        style={{ background: value }}
      />
      {open && (
        <div className="absolute top-full right-0 z-10 mt-1.5 w-[188px] rounded-md border border-border bg-card p-2 shadow-menu">
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
