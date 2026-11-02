import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_RECT_LABEL,
  DEFAULT_RECT_STYLE,
  riskDollars,
  type BacktestInstrument,
  type RectTemplate,
  type FibDrawing,
  type LineDash,
  type RectDrawing,
  type RiskRewardDrawing,
  type Shape,
  type SimSpec,
  type Timeframe,
} from '@tc/domain';
import { Select } from '../../components/Select';
import { Button, cn, SegmentedTabs } from '../../components/ui';
import { ColorPicker, TemplateMenu } from './LineSettings';
import { formatR, riskRewardSize } from './ShapeLayer';

type Tab = 'style' | 'text' | 'inputs' | 'visibility';

/** Settings for a rectangle or a long/short tool. Changes show at once; Cancel puts it back. */
export function ShapeSettings({
  shape,
  inst,
  specs,
  balance,
  timeframes,
  onChange,
  onOk,
  onCancel,
  onPlaceOrder,
  rectTemplates = [],
  onSaveRectTemplate,
  onDeleteRectTemplate,
}: {
  shape: Shape;
  inst: BacktestInstrument;
  specs: Record<string, SimSpec>;
  balance: number;
  timeframes: Timeframe[];
  onChange: (s: Shape) => void;
  onOk: () => void;
  onCancel: () => void;
  onPlaceOrder?: () => void;
  /** Rectangle templates, and saving / removing one (rectangles only). */
  rectTemplates?: RectTemplate[];
  onSaveRectTemplate?: (name: string) => void;
  onDeleteRectTemplate?: (id: string) => void;
}) {
  const rect = shape.kind === 'rect';
  const fib = shape.kind === 'fib';
  const [tab, setTab] = useState<Tab>(rect || fib ? 'style' : 'inputs');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

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

  const tabs: { value: Tab; label: string }[] = fib
    ? [
        { value: 'style', label: 'Style' },
        { value: 'inputs', label: 'Coordinates' },
        { value: 'visibility', label: 'Visibility' },
      ]
    : rect
      ? [
          { value: 'style', label: 'Style' },
          { value: 'text', label: 'Text' },
          { value: 'inputs', label: 'Coordinates' },
          { value: 'visibility', label: 'Visibility' },
        ]
      : [
          { value: 'inputs', label: 'Inputs' },
          { value: 'visibility', label: 'Visibility' },
        ];

  // Floats over the whole page (on screen, not inside the chart frame), so nothing can cover or clip it. In full
  // screen, only the full-screen element is visible, so it goes in there.
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Drawing settings"
      className="fixed z-50 flex w-[380px] flex-col rounded-lg border border-border bg-card text-text shadow-menu"
      style={{ left: pos ? pos.x : 'calc(50% - 190px)', top: pos ? pos.y : 96, maxHeight: `calc(100vh - ${(pos ? pos.y : 96) + 12}px)` }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="flex cursor-move items-center justify-between border-b border-border px-4 py-3 select-none" onPointerDown={startDrag}>
        <h2 className="text-[15px] font-semibold">{rect ? 'Rectangle' : fib ? 'Fib retracement' : shape.kind === 'long' ? 'Long position' : 'Short position'}</h2>
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
      <div className="px-4 pt-3">
        <SegmentedTabs label="Drawing settings" value={tab} onChange={setTab} options={tabs} />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px]">
        {shape.kind === 'fib' ? (
          <FibFields shape={shape} tab={tab} tick={inst.tickSize} onChange={onChange} />
        ) : shape.kind === 'rect' ? (
          <RectFields shape={shape} tab={tab} tick={inst.tickSize} onChange={onChange} />
        ) : (
          tab === 'inputs' && <RiskRewardFields shape={shape} inst={inst} specs={specs} balance={balance} onChange={onChange} />
        )}
        {tab === 'visibility' && (
          <div className="grid grid-cols-3 gap-2">
            {timeframes.map((tf) => (
              <Check key={tf} checked={!shape.hiddenOn.includes(tf)} onChange={(on) => onChange({ ...shape, hiddenOn: on ? shape.hiddenOn.filter((t) => t !== tf) : [...shape.hiddenOn, tf] })}>
                <span className="font-mono">{tf}</span>
              </Check>
            ))}
          </div>
        )}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div>
          {shape.kind === 'rect' && onSaveRectTemplate && onDeleteRectTemplate && (
            <TemplateMenu
              templates={rectTemplates}
              swatch={(t) => t.style.border}
              onApply={(t) => onChange({ ...shape, style: t.style, label: t.label })}
              onDefaults={() => onChange({ ...shape, style: DEFAULT_RECT_STYLE, label: DEFAULT_RECT_LABEL })}
              onSave={onSaveRectTemplate}
              onDelete={onDeleteRectTemplate}
            />
          )}
          {onPlaceOrder && (
            <Button size="sm" onClick={onPlaceOrder} title="A limit or stop order at the entry, with this stop and target">
              Place order
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onOk}>
            Ok
          </Button>
        </div>
      </footer>
    </div>,
    document.fullscreenElement ?? document.body,
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      {children}
    </div>
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

function PriceInput({ value, tick, label, onChange }: { value: number; tick: number; label: string; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      aria-label={label}
      step={tick}
      value={value}
      onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && onChange(Number(e.target.value))}
      className="h-8 w-36 rounded-md border border-border bg-card px-2 font-mono text-[13px]"
    />
  );
}

function RectFields({ shape, tab, tick, onChange }: { shape: RectDrawing; tab: Tab; tick: number; onChange: (s: Shape) => void }) {
  const style = (patch: Partial<RectDrawing['style']>) => onChange({ ...shape, style: { ...shape.style, ...patch } });
  const label = (patch: Partial<RectDrawing['label']>) => onChange({ ...shape, label: { ...shape.label, ...patch } });
  if (tab === 'style')
    return (
      <>
        <Row label="Border">
          <ColorPicker value={shape.style.border} onChange={(border) => style({ border })} />
        </Row>
        <Row label="Thickness">
          <div className="flex gap-1">
            {([1, 2, 3, 4] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-label={`${w}px`}
                aria-pressed={shape.style.borderWidth === w}
                onClick={() => style({ borderWidth: w })}
                className={cn('flex h-8 w-10 items-center justify-center rounded-md border', shape.style.borderWidth === w ? 'border-text' : 'border-border hover:bg-hover')}
              >
                <span className="w-5 rounded-full bg-text" style={{ height: w }} />
              </button>
            ))}
          </div>
        </Row>
        <Row label="Fill">
          <ColorPicker value={shape.style.fill} onChange={(fill) => style({ fill })} />
        </Row>
        <Row label="Opacity">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(shape.style.fillOpacity * 100)}
            onChange={(e) => style({ fillOpacity: Number(e.target.value) / 100 })}
            className="flex-1"
            aria-label="Fill opacity"
          />
          <span className="w-10 text-right font-mono text-[12px]">{Math.round(shape.style.fillOpacity * 100)}%</span>
        </Row>
        <Row label="Middle line">
          <Check checked={shape.style.midline} onChange={(midline) => style({ midline })}>
            Show
          </Check>
          {shape.style.midline && (
            <Select size="sm" aria-label="Middle line style" value={shape.style.midDash} onChange={(e) => style({ midDash: e.target.value as LineDash })} className="w-28">
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </Select>
          )}
        </Row>
        <Check checked={shape.style.extendRight} onChange={(extendRight) => style({ extendRight })}>
          Extend right
        </Check>
      </>
    );
  if (tab === 'text')
    return (
      <>
        <textarea
          aria-label="Label text"
          autoFocus
          value={shape.label.text}
          onChange={(e) => label({ text: e.target.value })}
          placeholder="Add a label, e.g. H1 FVG"
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[13px]"
        />
        <Row label="Colour">
          <div className="flex items-center gap-2">
            <Check checked={shape.label.color === null} onChange={(same) => label({ color: same ? null : shape.style.border })}>
              Same as border
            </Check>
            {shape.label.color !== null && <ColorPicker value={shape.label.color} onChange={(color) => label({ color })} />}
          </div>
        </Row>
        <Row label="Size">
          <Select size="sm" aria-label="Text size" value={String(shape.label.size)} onChange={(e) => label({ size: Number(e.target.value) })} className="w-20">
            {[10, 11, 12, 14, 16, 20, 24].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <button
            type="button"
            aria-pressed={shape.label.bold}
            onClick={() => label({ bold: !shape.label.bold })}
            className={cn('h-8 w-8 rounded-md border font-bold', shape.label.bold ? 'border-text bg-hover' : 'border-border hover:bg-hover')}
          >
            B
          </button>
        </Row>
        <Row label="Position">
          <div className="flex gap-2">
            <Select size="sm" aria-label="Label position across" value={shape.label.align} onChange={(e) => label({ align: e.target.value as RectDrawing['label']['align'] })} className="w-24">
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </Select>
            <Select size="sm" aria-label="Label position up and down" value={shape.label.place} onChange={(e) => label({ place: e.target.value as RectDrawing['label']['place'] })} className="w-24">
              <option value="above">Top</option>
              <option value="middle">Middle</option>
              <option value="below">Bottom</option>
            </Select>
          </div>
        </Row>
      </>
    );
  if (tab === 'inputs')
    return (
      <>
        <Row label="Top">
          <PriceInput label="Top price" tick={tick} value={Math.max(shape.p1, shape.p2)} onChange={(v) => onChange(shape.p1 >= shape.p2 ? { ...shape, p1: v } : { ...shape, p2: v })} />
        </Row>
        <Row label="Bottom">
          <PriceInput label="Bottom price" tick={tick} value={Math.min(shape.p1, shape.p2)} onChange={(v) => onChange(shape.p1 < shape.p2 ? { ...shape, p1: v } : { ...shape, p2: v })} />
        </Row>
        <p className="text-[12px] text-muted">Middle: {((shape.p1 + shape.p2) / 2).toFixed(Math.max(0, (String(tick).split('.')[1] ?? '').length))}</p>
      </>
    );
  return null;
}

function RiskRewardFields({
  shape,
  inst,
  specs,
  balance,
  onChange,
}: {
  shape: RiskRewardDrawing;
  inst: BacktestInstrument;
  specs: Record<string, SimSpec>;
  balance: number;
  onChange: (s: Shape) => void;
}) {
  const qty = riskRewardSize(shape, specs[shape.symbol], inst.kind === 'crypto', balance);
  const mode = shape.riskMode ?? 'usd';
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const risk = Math.abs(shape.entry - shape.stop);
  const reward = Math.abs(shape.target - shape.entry);
  return (
    <>
      <Row label="Entry">
        <PriceInput label="Entry price" tick={inst.tickSize} value={shape.entry} onChange={(entry) => onChange({ ...shape, entry })} />
      </Row>
      <Row label="Stop">
        <PriceInput label="Stop price" tick={inst.tickSize} value={shape.stop} onChange={(stop) => onChange({ ...shape, stop })} />
      </Row>
      <Row label="Target">
        <PriceInput label="Target price" tick={inst.tickSize} value={shape.target} onChange={(target) => onChange({ ...shape, target })} />
      </Row>
      {inst.trades.length > 1 && (
        <Row label="Contract">
          <Select size="sm" aria-label="Contract" value={shape.symbol} onChange={(e) => onChange({ ...shape, symbol: e.target.value })} className="w-36">
            {inst.trades.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row label="Risk">
        <SegmentedTabs
          label="Risk as"
          value={mode}
          onChange={(riskMode) => onChange({ ...shape, riskMode })}
          options={[
            { value: 'usd', label: '$ amount' },
            { value: 'percent', label: '% of account' },
          ]}
        />
      </Row>
      <Row label={mode === 'usd' ? 'Amount ($)' : 'Percent (%)'}>
        <input
          type="number"
          aria-label={mode === 'usd' ? 'Risk in dollars' : 'Risk as a percentage of the account'}
          min={0}
          step={mode === 'usd' ? 10 : 0.25}
          value={mode === 'usd' ? shape.riskUsd : (shape.riskPct ?? 1)}
          onChange={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0);
            onChange(mode === 'usd' ? { ...shape, riskUsd: v } : { ...shape, riskPct: Math.min(100, v) });
          }}
          className="h-8 w-36 rounded-md border border-border bg-card px-2 font-mono text-[13px]"
        />
      </Row>
      <p className="text-[12px] text-muted">
        {mode === 'percent' && `${shape.riskPct ?? 1}% of ${usd(balance)} = ${usd(riskDollars(shape, balance))} · `}
        Size {qty} · {risk > 0 ? formatR(reward / risk) : '–'}
      </p>
    </>
  );
}

/** A small colour swatch that opens the system colour picker. */
function Swatch({ value, label, onChange }: { value: string; label: string; onChange: (c: string) => void }) {
  return (
    <label className="relative inline-flex h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border" style={{ background: value }} title={label}>
      <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}

function FibFields({ shape, tab, tick, onChange }: { shape: FibDrawing; tab: Tab; tick: number; onChange: (s: Shape) => void }) {
  const st = shape.style;
  const style = (patch: Partial<FibDrawing['style']>) => onChange({ ...shape, style: { ...st, ...patch } });
  const level = (i: number, patch: Partial<FibDrawing['levels'][number]>) => onChange({ ...shape, levels: shape.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const input = 'h-8 rounded-md border border-border bg-card px-2 font-mono text-[13px]';
  if (tab === 'inputs')
    return (
      <>
        <Row label="Point 1">
          <PriceInput label="First point price" tick={tick} value={shape.p1} onChange={(p1) => onChange({ ...shape, p1 })} />
        </Row>
        <Row label="Point 2">
          <PriceInput label="Second point price" tick={tick} value={shape.p2} onChange={(p2) => onChange({ ...shape, p2 })} />
        </Row>
        <p className="text-[12px] text-muted">Level 1 is at point 1 and 0 at point 2{st.reverse ? ' (reversed: the other way round)' : ''}.</p>
      </>
    );
  if (tab !== 'style') return null;
  return (
    <>
      <Row label="Trend line">
        <Check checked={st.trendLine} onChange={(trendLine) => style({ trendLine })}>
          {''}
        </Check>
        <Swatch value={st.trendColor} label="Trend line colour" onChange={(trendColor) => style({ trendColor })} />
      </Row>
      <Row label="Levels line">
        <div className="flex gap-1">
          {([1, 2, 3, 4] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`${w}px`}
              aria-pressed={st.lineWidth === w}
              onClick={() => style({ lineWidth: w })}
              className={cn('flex h-8 w-9 items-center justify-center rounded-md border', st.lineWidth === w ? 'border-text' : 'border-border hover:bg-hover')}
            >
              <span className="w-4 rounded-full bg-text" style={{ height: w }} />
            </button>
          ))}
        </div>
        <Select size="sm" aria-label="Level line style" value={st.lineDash} onChange={(e) => style({ lineDash: e.target.value as LineDash })} className="w-24">
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </Select>
      </Row>
      <Row label="Extend">
        <Select size="sm" aria-label="Extend" value={st.extend} onChange={(e) => style({ extend: e.target.value as FibDrawing['style']['extend'] })} className="w-36">
          <option value="none">Don’t extend</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="both">Both</option>
        </Select>
      </Row>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {shape.levels.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input type="checkbox" aria-label={`Show level ${l.value}`} checked={l.on} onChange={(e) => level(i, { on: e.target.checked })} className="h-4 w-4 accent-[var(--text)]" />
            <input
              type="number"
              aria-label="Level value"
              step={0.001}
              value={l.value}
              onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && level(i, { value: Number(e.target.value) })}
              className={cn(input, 'w-20 min-w-0', !l.on && 'text-muted')}
            />
            <Swatch value={l.color} label={`Level ${l.value} colour`} onChange={(color) => level(i, { color })} />
          </div>
        ))}
      </div>
      <Row label="One colour">
        <Check checked={st.oneColor !== null} onChange={(on) => style({ oneColor: on ? (shape.levels.find((l) => l.on)?.color ?? '#2962ff') : null })}>
          {''}
        </Check>
        {st.oneColor !== null && <Swatch value={st.oneColor} label="Colour for every level" onChange={(oneColor) => style({ oneColor })} />}
      </Row>
      <Row label="Background">
        <Check checked={st.background} onChange={(background) => style({ background })}>
          {''}
        </Check>
        {st.background && (
          <input
            type="range"
            min={0}
            max={60}
            value={Math.round(st.bgOpacity * 100)}
            onChange={(e) => style({ bgOpacity: Number(e.target.value) / 100 })}
            aria-label="Background opacity"
            className="flex-1"
          />
        )}
      </Row>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Check checked={st.reverse} onChange={(reverse) => style({ reverse })}>
          Reverse
        </Check>
        <Check checked={st.showPrices} onChange={(showPrices) => style({ showPrices })}>
          Prices
        </Check>
      </div>
      <Row label="Levels">
        <Check checked={st.showLevels !== null} onChange={(on) => style({ showLevels: on ? 'values' : null })}>
          {''}
        </Check>
        <Select
          size="sm"
          aria-label="Show levels as"
          value={st.showLevels ?? 'values'}
          onChange={(e) => style({ showLevels: e.target.value as 'values' | 'percent' })}
          className="w-28"
          disabled={st.showLevels === null}
        >
          <option value="values">Values</option>
          <option value="percent">Percent</option>
        </Select>
      </Row>
      <Row label="Labels">
        <Select size="sm" aria-label="Label side" value={st.labelAlign} onChange={(e) => style({ labelAlign: e.target.value as 'left' | 'right' })} className="w-24">
          <option value="left">Left</option>
          <option value="right">Right</option>
        </Select>
        <Select size="sm" aria-label="Label position" value={st.labelPlace} onChange={(e) => style({ labelPlace: e.target.value as 'top' | 'middle' | 'bottom' })} className="w-24">
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </Select>
      </Row>
      <Row label="Text">
        <input value={shape.text} onChange={(e) => onChange({ ...shape, text: e.target.value })} placeholder="Add text" aria-label="Text" maxLength={200} className={cn(input, 'flex-1 font-sans')} />
      </Row>
      <Row label="Font size">
        <Select size="sm" aria-label="Font size" value={String(st.fontSize)} onChange={(e) => style({ fontSize: Number(e.target.value) })} className="w-20">
          {[10, 11, 12, 14, 16, 20, 24].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Row>
    </>
  );
}
