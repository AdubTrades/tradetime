import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  barStart,
  DEFAULT_LINE_LABEL,
  DEFAULT_LINE_STYLE,
  newId,
  sortTemplates,
  timeframesFor,
  type Bar,
  type BacktestInstrument,
  type HorizontalLine,
  type LineTools,
  type Timeframe,
} from '@tc/domain';
import { LinesPrimitive } from './linesPrimitive';
import { LineSettings } from './LineSettings';

export type DrawTool = 'cursor' | 'hray' | 'hline';

const MAGNET_PX = 30;
const decimals = (tick: number) => Math.max(0, (String(tick).split('.')[1] ?? '').length);

/**
 * Horizontal lines on the replay chart: click to draw with the ray or line tool, click a line to select it, drag to
 * move it (drag the round handle to move its start), double-click for settings, right-click for templates, Delete to
 * remove. The look of each new line follows the last one set.
 */
export function LineLayer({
  chart,
  series,
  host,
  bars,
  tf,
  inst,
  lines,
  onLinesChange,
  tools,
  onToolsChange,
  tool,
  setTool,
  magnet,
  background,
}: {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  host: HTMLDivElement;
  bars: Bar[];
  tf: Timeframe;
  inst: BacktestInstrument;
  lines: HorizontalLine[];
  onLinesChange: (lines: HorizontalLine[]) => void;
  tools: LineTools;
  onToolsChange: (tools: LineTools) => void;
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  magnet: boolean;
  background: string;
}) {
  const [prim] = useState(() => new LinesPrimitive());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<HorizontalLine | null>(null); // the line as it was when settings opened
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // The latest props for the native event handlers below.
  const st = useRef({ lines, onLinesChange, tools, onToolsChange, tool, setTool, magnet, bars, tf, inst, selected, editing });
  st.current = { lines, onLinesChange, tools, onToolsChange, tool, setTool, magnet, bars, tf, inst, selected, editing };

  useEffect(() => {
    series.attachPrimitive(prim);
    return () => series.detachPrimitive(prim);
  }, [series, prim]);

  useEffect(() => {
    prim.lines = lines;
    prim.bars = bars;
    prim.tf = tf;
    prim.kind = inst.kind;
    prim.selected = selected;
    prim.background = background;
    prim.update();
  }, [prim, lines, bars, tf, inst, selected, background]);

  // A different instrument has different lines.
  useEffect(() => {
    setSelected(null);
    setEditing(null);
    setMenu(null);
  }, [inst.id]);

  useEffect(() => {
    const roundPrice = (p: number) => Number((Math.round(p / inst.tickSize) * inst.tickSize).toFixed(decimals(inst.tickSize)));
    const local = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const inPane = (x: number) => x >= 0 && x <= chart.timeScale().width();
    const barAt = (x: number) => {
      const { bars } = st.current;
      const logical = chart.timeScale().coordinateToLogical(x);
      const idx = Math.min(bars.length - 1, Math.max(0, Math.round(logical ?? bars.length - 1)));
      return bars[idx];
    };
    /** Price under the mouse: snapped to the bar's open, high, low or close with the magnet on, else to the tick. */
    const priceAt = (x: number, y: number) => {
      const raw = series.coordinateToPrice(y);
      if (raw === null) return null;
      const bar = barAt(x);
      if (st.current.magnet && bar) {
        let best: { p: number; d: number } | null = null;
        for (const p of [bar.o, bar.h, bar.l, bar.c]) {
          const py = series.priceToCoordinate(p);
          if (py === null) continue;
          const d = Math.abs(py - y);
          if (d <= MAGNET_PX && (!best || d < best.d)) best = { p, d };
        }
        if (best) return best.p;
      }
      return roundPrice(raw);
    };
    const timeOf = (bar: Bar) => barStart(bar.t, st.current.tf, st.current.inst.kind);

    let swallowMouse = false;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      swallowMouse = true;
    };

    const onPointerDown = (e: PointerEvent) => {
      setMenu(null);
      if (e.button !== 0) return;
      const { x, y } = local(e);
      if (!inPane(x)) return;
      const s = st.current;
      if (s.tool !== 'cursor') {
        const price = priceAt(x, y);
        const bar = barAt(x);
        if (price === null || !bar) return;
        stop(e);
        const look = s.tools.last ?? { style: DEFAULT_LINE_STYLE, label: DEFAULT_LINE_LABEL };
        const line: HorizontalLine = { id: newId(), kind: s.tool, price, time: timeOf(bar), style: look.style, label: { ...look.label, text: '' }, hiddenOn: [] };
        s.onLinesChange([...s.lines, line]);
        setSelected(line.id);
        s.setTool('cursor');
        return;
      }
      const hit = prim.lineAt(x, y);
      if (!hit) {
        setSelected(null);
        return;
      }
      stop(e);
      setSelected(hit.line.id);
      // Drag: the body moves the price (and the start by as many bars); the handle moves the start to the mouse.
      const start = hit.line;
      const startBar = barAt(x);
      const startPrice = series.coordinateToPrice(y) ?? start.price;
      const startIdx = prim.barIndex(start.time);
      let moved: HorizontalLine | null = null;
      chart.applyOptions({ handleScroll: false, handleScale: false });
      const move = (ev: PointerEvent) => {
        const p = local(ev);
        const bar = barAt(p.x);
        if (!bar || !startBar) return;
        let next: HorizontalLine;
        if (hit.handle) {
          next = { ...start, price: priceAt(p.x, p.y) ?? start.price, time: timeOf(bar) };
        } else {
          const { bars } = st.current;
          const delta = bars.indexOf(bar) - bars.indexOf(startBar);
          const target = bars[Math.min(bars.length - 1, Math.max(0, startIdx + delta))];
          const now = series.coordinateToPrice(p.y);
          const price = st.current.magnet ? (priceAt(p.x, p.y) ?? start.price) : roundPrice(start.price + ((now ?? startPrice) - startPrice));
          next = { ...start, price, time: start.kind === 'hray' && target && startIdx < bars.length ? timeOf(target) : start.time };
        }
        moved = next;
        prim.lines = st.current.lines.map((l) => (l.id === start.id ? next : l));
        prim.update();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        chart.applyOptions({ handleScroll: true, handleScale: true });
        const m = moved as HorizontalLine | null;
        if (m) st.current.onLinesChange(st.current.lines.map((l) => (l.id === m.id ? m : l)));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    // The chart listens to mouse events; keep the ones that belong to a line (or a new drawing) away from it.
    const onMouseDown = (e: MouseEvent) => {
      if (swallowMouse) {
        e.stopPropagation();
        swallowMouse = false;
      }
    };

    const onHover = (e: PointerEvent) => {
      if (e.buttons) return;
      const { x, y } = local(e);
      // A trade level under the mouse (stop, target, order) takes priority: the chart handles that drag.
      const hit = st.current.tool === 'cursor' && inPane(x) && !host.parentElement?.dataset.level ? prim.lineAt(x, y) : null;
      const id = hit?.line.id ?? null;
      if (id !== prim.hovered) {
        prim.hovered = id;
        prim.update();
      }
      host.dataset.cursor = st.current.tool !== 'cursor' ? 'crosshair' : hit ? 'pointer' : '';
    };

    const onDblClick = (e: MouseEvent) => {
      const { x, y } = local(e);
      const hit = prim.lineAt(x, y);
      if (!hit) return;
      e.stopPropagation();
      setSelected(hit.line.id);
      setEditing(hit.line);
    };

    const onContextMenu = (e: MouseEvent) => {
      const { x, y } = local(e);
      const hit = prim.lineAt(x, y);
      if (!hit) return;
      e.preventDefault();
      setSelected(hit.line.id);
      setMenu({ x, y, id: hit.line.id });
    };

    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('mousedown', onMouseDown, true);
    host.addEventListener('pointermove', onHover);
    host.addEventListener('dblclick', onDblClick, true);
    host.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('mousedown', onMouseDown, true);
      host.removeEventListener('pointermove', onHover);
      host.removeEventListener('dblclick', onDblClick, true);
      host.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [chart, series, host, prim, inst]);

  // Keyboard: Delete removes the selected line, Escape puts the pen down, Alt+H / Alt+J pick the line / ray.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = st.current;
      if (e.altKey && (e.code === 'KeyH' || e.code === 'KeyJ')) {
        e.preventDefault();
        s.setTool(e.code === 'KeyH' ? 'hline' : 'hray');
      } else if (e.key === 'Escape' && !s.editing) {
        s.setTool('cursor');
        setSelected(null);
        setMenu(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected && !s.editing) {
        e.preventDefault();
        s.onLinesChange(s.lines.filter((l) => l.id !== s.selected));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (line: HorizontalLine) => onLinesChange(lines.map((l) => (l.id === line.id ? line : l)));
  const remember = (line: HorizontalLine) => onToolsChange({ ...tools, last: { style: line.style, label: { ...line.label, text: '' } } });
  const current = editing ? lines.find((l) => l.id === editing.id) : null;
  const menuLine = menu ? lines.find((l) => l.id === menu.id) : null;

  return (
    <>
      {menu && menuLine && (
        <div
          role="menu"
          className="absolute z-30 max-h-[70%] w-56 overflow-y-auto rounded-md border border-border bg-card py-1 text-[13px] shadow-menu"
          style={{ left: Math.min(menu.x, host.clientWidth - 230), top: Math.min(menu.y, host.clientHeight - 200) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {sortTemplates(tools.templates).map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              onClick={() => {
                const next = { ...menuLine, style: t.style, label: t.label };
                update(next);
                remember(next);
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
            >
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: t.style.color }} />
              <span className="truncate">{t.name}</span>
            </button>
          ))}
          {tools.templates.length > 0 && <div className="my-1 border-t border-border" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setEditing(menuLine);
              setMenu(null);
            }}
            className="flex w-full px-3 py-1.5 text-left hover:bg-hover"
          >
            Settings…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onLinesChange(lines.filter((l) => l.id !== menuLine.id));
              setSelected(null);
              setMenu(null);
            }}
            className="flex w-full px-3 py-1.5 text-left text-loss hover:bg-hover"
          >
            Delete
          </button>
        </div>
      )}
      {editing && current && (
        <LineSettings
          line={current}
          timeframes={timeframesFor(inst)}
          templates={tools.templates}
          tickSize={inst.tickSize}
          onChange={update}
          onOk={() => {
            remember(current);
            setEditing(null);
          }}
          onCancel={() => {
            update(editing);
            setEditing(null);
          }}
          onSaveTemplate={(name) => {
            // Saving under an existing name replaces that template.
            const others = tools.templates.filter((t) => t.name.toLowerCase() !== name.toLowerCase());
            onToolsChange({ ...tools, templates: [...others, { id: newId(), name, style: current.style, label: current.label }] });
          }}
          onDeleteTemplate={(id) => onToolsChange({ ...tools, templates: tools.templates.filter((t) => t.id !== id) })}
        />
      )}
    </>
  );
}
