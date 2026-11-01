import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { currentZone, DEFAULT_LINE_LABEL, DEFAULT_LINE_STYLE, LINE_COLORS, sortTemplates, type HorizontalLine, type LineTemplate, type Timeframe } from '@tc/domain';
import { Select } from '../../components/Select';
import { Button, cn, SegmentedTabs } from '../../components/ui';

type Tab = 'style' | 'text' | 'coordinates' | 'visibility';

/**
 * The line's settings, like TradingView's: changes show on the chart straight away, Ok keeps them and Cancel puts the
 * line back. The Template menu saves the style and label under a name, applies one, or resets to the defaults.
 */
export function LineSettings({
  line,
  timeframes,
  templates,
  tickSize,
  onChange,
  onOk,
  onCancel,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  line: HorizontalLine;
  timeframes: Timeframe[];
  templates: LineTemplate[];
  tickSize: number;
  onChange: (line: HorizontalLine) => void;
  onOk: () => void;
  onCancel: () => void;
  onSaveTemplate: (name: string) => void;
  onDeleteTemplate: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('style');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<HorizontalLine>) => onChange({ ...line, ...patch });
  const setStyle = (patch: Partial<HorizontalLine['style']>) => set({ style: { ...line.style, ...patch } });
  const setLabel = (patch: Partial<HorizontalLine['label']>) => set({ label: { ...line.label, ...patch } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Drag the window by its title, out of the way of the line.
  const startDrag = (e: React.PointerEvent) => {
    const box = panel.current!.getBoundingClientRect();
    const parent = panel.current!.offsetParent!.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev: PointerEvent) => setPos({ x: ev.clientX - parent.left - dx, y: Math.max(0, ev.clientY - parent.top - dy) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const zone = currentZone();
  const start = DateTime.fromSeconds(line.time, { zone });

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Line settings"
      className="absolute z-30 w-[380px] rounded-lg border border-border bg-card text-text shadow-menu"
      style={pos ? { left: pos.x, top: pos.y } : { left: 'calc(50% - 190px)', top: 48 }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="flex cursor-move items-center justify-between border-b border-border px-4 py-3 select-none" onPointerDown={startDrag}>
        <h2 className="text-[15px] font-semibold">{line.kind === 'hray' ? 'Horizontal ray' : 'Horizontal line'}</h2>
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
        <SegmentedTabs
          label="Line settings"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'style', label: 'Style' },
            { value: 'text', label: 'Text' },
            { value: 'coordinates', label: 'Coordinates' },
            { value: 'visibility', label: 'Visibility' },
          ]}
        />
      </div>
      <div className="min-h-[200px] space-y-4 px-4 py-4 text-[13px]">
        {tab === 'style' && (
          <>
            <Row label="Line">
              <ColorPicker value={line.style.color} onChange={(color) => setStyle({ color })} />
            </Row>
            <Row label="Thickness">
              <div className="flex gap-1">
                {([1, 2, 3, 4] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-label={`${w}px`}
                    aria-pressed={line.style.width === w}
                    onClick={() => setStyle({ width: w })}
                    className={cn('flex h-8 w-10 items-center justify-center rounded-md border', line.style.width === w ? 'border-text' : 'border-border hover:bg-hover')}
                  >
                    <span className="w-5 rounded-full bg-text" style={{ height: w }} />
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Style">
              <Select size="sm" aria-label="Line style" value={line.style.dash} onChange={(e) => setStyle({ dash: e.target.value as HorizontalLine['style']['dash'] })} className="w-32">
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </Select>
            </Row>
            <Row label="Extends">
              <Select size="sm" aria-label="Line type" value={line.kind} onChange={(e) => set({ kind: e.target.value as HorizontalLine['kind'] })} className="w-56">
                <option value="hray">Right, from its bar (ray)</option>
                <option value="hline">Across the chart</option>
              </Select>
            </Row>
            <Checkbox checked={line.style.priceLabel} onChange={(priceLabel) => setStyle({ priceLabel })}>
              Price label
            </Checkbox>
          </>
        )}
        {tab === 'text' && (
          <>
            <textarea
              aria-label="Label text"
              autoFocus
              value={line.label.text}
              onChange={(e) => setLabel({ text: e.target.value })}
              placeholder="Add a label, e.g. Asia High"
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-[13px]"
            />
            <Row label="Colour">
              <div className="flex items-center gap-2">
                <Checkbox checked={line.label.color === null} onChange={(same) => setLabel({ color: same ? null : line.style.color })}>
                  Same as line
                </Checkbox>
                {line.label.color !== null && <ColorPicker value={line.label.color} onChange={(color) => setLabel({ color })} />}
              </div>
            </Row>
            <Row label="Size">
              <div className="flex items-center gap-2">
                <Select size="sm" aria-label="Text size" value={String(line.label.size)} onChange={(e) => setLabel({ size: Number(e.target.value) })} className="w-20">
                  {[10, 11, 12, 14, 16, 20, 24].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  aria-pressed={line.label.bold}
                  onClick={() => setLabel({ bold: !line.label.bold })}
                  className={cn('h-8 w-8 rounded-md border font-bold', line.label.bold ? 'border-text bg-hover' : 'border-border hover:bg-hover')}
                >
                  B
                </button>
              </div>
            </Row>
            <Row label="Position">
              <div className="flex gap-2">
                <Select
                  size="sm"
                  aria-label="Label position across"
                  value={line.label.align}
                  onChange={(e) => setLabel({ align: e.target.value as HorizontalLine['label']['align'] })}
                  className="w-24"
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </Select>
                <Select
                  size="sm"
                  aria-label="Label position up and down"
                  value={line.label.place}
                  onChange={(e) => setLabel({ place: e.target.value as HorizontalLine['label']['place'] })}
                  className="w-24"
                >
                  <option value="above">Above</option>
                  <option value="middle">On line</option>
                  <option value="below">Below</option>
                </Select>
              </div>
            </Row>
          </>
        )}
        {tab === 'coordinates' && (
          <>
            <Row label="Price">
              <input
                type="number"
                aria-label="Price"
                step={tickSize}
                value={line.price}
                onChange={(e) => e.target.value !== '' && set({ price: Number(e.target.value) })}
                className="h-8 w-36 rounded-md border border-border bg-card px-2 font-mono text-[13px]"
              />
            </Row>
            <Row label="Starts">
              <div className="flex gap-1.5">
                <input
                  type="date"
                  aria-label="Start date"
                  value={start.toISODate() ?? ''}
                  onChange={(e) => e.target.value && set({ time: DateTime.fromISO(`${e.target.value}T${start.toFormat('HH:mm')}`, { zone }).toSeconds() })}
                  className="h-8 rounded-md border border-border bg-card px-2 text-[13px]"
                />
                <input
                  type="time"
                  aria-label="Start time"
                  value={start.toFormat('HH:mm')}
                  onChange={(e) => e.target.value && set({ time: DateTime.fromISO(`${start.toISODate()}T${e.target.value}`, { zone }).toSeconds() })}
                  className="h-8 rounded-md border border-border bg-card px-2 font-mono text-[13px]"
                />
              </div>
            </Row>
          </>
        )}
        {tab === 'visibility' && (
          <div className="grid grid-cols-3 gap-2">
            {timeframes.map((tf) => (
              <Checkbox key={tf} checked={!line.hiddenOn.includes(tf)} onChange={(on) => set({ hiddenOn: on ? line.hiddenOn.filter((t) => t !== tf) : [...line.hiddenOn, tf] })}>
                <span className="font-mono">{tf}</span>
              </Checkbox>
            ))}
          </div>
        )}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <TemplateMenu
          templates={templates}
          onApply={(t) => set({ style: t.style, label: t.label })}
          onDefaults={() => set({ style: DEFAULT_LINE_STYLE, label: DEFAULT_LINE_LABEL })}
          onSave={onSaveTemplate}
          onDelete={onDeleteTemplate}
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onOk}>
            Ok
          </Button>
        </div>
      </footer>
    </div>
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

function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--text)]" />
      {children}
    </label>
  );
}

/** TradingView's colour row plus a custom colour. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {LINE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value.toLowerCase() === c}
          onClick={() => onChange(c)}
          className={cn('h-5 w-5 rounded-[5px] border border-border', value.toLowerCase() === c && 'ring-2 ring-text ring-offset-1 ring-offset-card')}
          style={{ background: c }}
        />
      ))}
      <input type="color" aria-label="Custom colour" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
    </div>
  );
}

/** Save as… / Apply defaults / the saved templates (each with a remove button). Opens upwards, like TradingView's. */
export function TemplateMenu({
  templates,
  onApply,
  onDefaults,
  onSave,
  onDelete,
}: {
  templates: LineTemplate[];
  onApply: (t: LineTemplate) => void;
  onDefaults: () => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && (setOpen(false), setNaming(null));
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const save = () => {
    const name = naming?.trim();
    if (!name) return;
    onSave(name);
    setNaming(null);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Template <ChevronDown size={14} className={cn('transition', open && 'rotate-180')} />
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1 max-h-[360px] w-60 overflow-y-auto rounded-md border border-border bg-card py-1 text-[13px] shadow-menu">
          {naming === null ? (
            <button type="button" onClick={() => setNaming('')} className="flex w-full px-3 py-2 text-left hover:bg-hover">
              Save as…
            </button>
          ) : (
            <form
              className="flex gap-1 px-2 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                autoFocus
                aria-label="Template name"
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                placeholder="Name, e.g. Asia High"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2"
              />
              <Button type="submit" size="sm" variant="primary" aria-label="Save template" disabled={!naming.trim()} className="px-2">
                <Check size={14} />
              </Button>
            </form>
          )}
          <button
            type="button"
            onClick={() => {
              onDefaults();
              setOpen(false);
            }}
            className="flex w-full px-3 py-2 text-left hover:bg-hover"
          >
            Apply defaults
          </button>
          {templates.length > 0 && <div className="my-1 border-t border-border" />}
          {sortTemplates(templates).map((t) => (
            <div key={t.id} className="group flex items-center hover:bg-hover">
              <button
                type="button"
                onClick={() => {
                  onApply(t);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
              >
                <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: t.style.color }} />
                <span className="truncate">{t.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove template ${t.name}`}
                onClick={() => onDelete(t.id)}
                className="mr-1 hidden h-7 w-7 items-center justify-center rounded text-muted group-hover:flex hover:text-loss"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
