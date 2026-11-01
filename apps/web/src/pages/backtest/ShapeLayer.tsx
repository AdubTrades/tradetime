import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  DEFAULT_LINE_LABEL,
  DEFAULT_RECT_STYLE,
  newId,
  sizeForRisk,
  timeframesFor,
  type Bar,
  type BacktestInstrument,
  type LineTools,
  type RiskRewardDrawing,
  type Shape,
  type SimSpec,
  type Timeframe,
} from '@tc/domain';
import { chartCoords } from './chartCoords';
import type { DrawTool } from './LineLayer';
import { ShapesPrimitive, type RiskRewardText, type ShapePart } from './shapesPrimitive';
import { ShapeSettings } from './ShapeSettings';

const MAGNET_PX = 30;
const decimals = (tick: number) => Math.max(0, (String(tick).split('.')[1] ?? '').length);
const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Marks an event a drawing layer has used, so the next layer leaves it alone. */
export const claim = (e: Event) => ((e as Event & { tcClaimed?: boolean }).tcClaimed = true);
export const claimed = (e: Event) => !!(e as Event & { tcClaimed?: boolean }).tcClaimed;

/** Size for a long/short tool: whole contracts, or coins for spot crypto. */
export function riskRewardSize(rr: RiskRewardDrawing, spec: SimSpec | undefined, crypto: boolean): number {
  return spec ? sizeForRisk(rr.riskUsd, rr.entry, rr.stop, spec.pointValue, crypto ? 0.0001 : 1) : 0;
}

/**
 * Rectangles and long/short tools on the replay chart. Rectangle: drag (or click two corners) to draw; drag the body to
 * move, a corner to resize. Long/short: click to place; drag the entry, stop and target handles, the right-hand handle
 * for its width, or the body to move it. Double-click for settings, right-click for the menu, Delete to remove.
 */
export function ShapeLayer({
  chart,
  series,
  host,
  bars,
  tf,
  inst,
  shapes,
  onShapesChange,
  tools,
  onToolsChange,
  tool,
  setTool,
  magnet,
  selected,
  setSelected,
  specs,
  colours,
  onPlaceOrder,
}: {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  host: HTMLDivElement;
  bars: Bar[];
  tf: Timeframe;
  inst: BacktestInstrument;
  shapes: Shape[];
  onShapesChange: (shapes: Shape[]) => void;
  tools: LineTools;
  onToolsChange: (tools: LineTools) => void;
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  magnet: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  specs: Record<string, SimSpec>;
  colours: ShapesPrimitive['colours'];
  onPlaceOrder?: (rr: RiskRewardDrawing) => void;
}) {
  const [prim] = useState(() => new ShapesPrimitive());
  const [editing, setEditing] = useState<Shape | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const dp = decimals(inst.tickSize);

  const describe = (rr: RiskRewardDrawing): RiskRewardText => {
    const spec = specs[rr.symbol];
    const qty = riskRewardSize(rr, spec, inst.kind === 'crypto');
    const pv = spec?.pointValue ?? 0;
    const dir = rr.kind === 'long' ? 1 : -1;
    const tPts = (rr.target - rr.entry) * dir;
    const sPts = (rr.entry - rr.stop) * dir;
    const pct = (p: number) => `${((p / rr.entry) * 100).toFixed(2)}%`;
    // Has the replay reached the stop or target since the tool's start bar?
    let outcome: RiskRewardText['outcome'] = null;
    const c = chartCoords(bars, tf, inst.kind);
    const from = Math.max(0, Math.ceil(c.logicalOf(rr.t1)) + 1);
    const to = Math.min(bars.length - 1, Math.floor(c.logicalOf(rr.t2)));
    for (let i = from; i <= to && !outcome; i++) {
      const b = bars[i]!;
      const hitStop = rr.kind === 'long' ? b.l <= rr.stop : b.h >= rr.stop;
      const hitTarget = rr.kind === 'long' ? b.h >= rr.target : b.l <= rr.target;
      if (hitStop) outcome = 'stop';
      else if (hitTarget) outcome = 'target';
    }
    const rrRatio = sPts > 0 ? (tPts / sPts).toFixed(2) : '–';
    return {
      target: `Target ${rr.target.toFixed(dp)} · ${tPts.toFixed(dp)} pts (${pct(tPts)}) · ${money(tPts * qty * pv)}`,
      stop: `Stop ${rr.stop.toFixed(dp)} · ${sPts.toFixed(dp)} pts (${pct(sPts)}) · ${money(-sPts * qty * pv)}`,
      middle: `${rr.kind === 'long' ? 'Long' : 'Short'} ${qty} ${rr.symbol} · R:R ${rrRatio}${outcome === 'target' ? ' · Target hit' : outcome === 'stop' ? ' · Stop hit' : ''}`,
      outcome,
    };
  };

  const st = useRef({ shapes, onShapesChange, tools, onToolsChange, tool, setTool, magnet, bars, tf, inst, selected, setSelected, editing });
  st.current = { shapes, onShapesChange, tools, onToolsChange, tool, setTool, magnet, bars, tf, inst, selected, setSelected, editing };

  useEffect(() => {
    series.attachPrimitive(prim);
    return () => series.detachPrimitive(prim);
  }, [series, prim]);

  useEffect(() => {
    prim.shapes = shapes;
    prim.bars = bars;
    prim.tf = tf;
    prim.kind = inst.kind;
    prim.selected = selected;
    prim.colours = colours;
    prim.describe = describe;
    prim.update();
  });

  useEffect(() => {
    setEditing(null);
    setMenu(null);
  }, [inst.id]);

  useEffect(() => {
    const tick = inst.tickSize;
    const round = (p: number) => Number((Math.round(p / tick) * tick).toFixed(decimals(tick)));
    const local = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const inPane = (x: number) => x >= 0 && x <= chart.timeScale().width();
    const logicalAt = (x: number) => chart.timeScale().coordinateToLogical(x) ?? 0;
    const priceAt = (x: number, y: number) => {
      const raw = series.coordinateToPrice(y);
      if (raw === null) return null;
      if (st.current.magnet) {
        const { bars } = st.current;
        const bar = bars[Math.min(bars.length - 1, Math.max(0, Math.round(logicalAt(x))))];
        let best: { p: number; d: number } | null = null;
        for (const p of bar ? [bar.o, bar.h, bar.l, bar.c] : []) {
          const py = series.priceToCoordinate(p);
          if (py !== null && Math.abs(py - y) <= MAGNET_PX && (!best || Math.abs(py - y) < best.d)) best = { p, d: Math.abs(py - y) };
        }
        if (best) return best.p;
      }
      return round(raw);
    };
    const coords = () => chartCoords(st.current.bars, st.current.tf, st.current.inst.kind);
    let swallowMouse = false;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      claim(e);
      swallowMouse = true;
    };
    const commit = (shape: Shape) => {
      const list = st.current.shapes;
      st.current.onShapesChange(list.some((s) => s.id === shape.id) ? list.map((s) => (s.id === shape.id ? shape : s)) : [...list, shape]);
    };
    // A rectangle being drawn by clicking two corners.
    let pending: { id: string; t1: number; p1: number } | null = null;

    const follow = (onMove: (x: number, y: number) => Shape | null) => {
      let latest: Shape | null = null;
      chart.applyOptions({ handleScroll: false, handleScale: false });
      const move = (ev: PointerEvent) => {
        const p = local(ev);
        const next = onMove(p.x, p.y);
        if (!next) return;
        latest = next;
        prim.shapes = [...st.current.shapes.filter((s) => s.id !== next.id), next];
        prim.update();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        chart.applyOptions({ handleScroll: true, handleScale: true });
        if (latest) commit(latest);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || claimed(e)) return;
      setMenu(null);
      const { x, y } = local(e);
      if (!inPane(x)) return;
      const s = st.current;
      const c = coords();

      if (s.tool === 'rect' || pending) {
        const price = priceAt(x, y);
        if (price === null) return;
        stop(e);
        const time = c.timeAt(logicalAt(x));
        if (pending) {
          commit({
            id: pending.id,
            kind: 'rect',
            t1: pending.t1,
            p1: pending.p1,
            t2: time,
            p2: price,
            style: s.tools.rectLast ?? DEFAULT_RECT_STYLE,
            label: { ...DEFAULT_LINE_LABEL, align: 'left', place: 'above' },
            hiddenOn: [],
          });
          s.setSelected(pending.id);
          pending = null;
          s.setTool('cursor');
          return;
        }
        const id = newId();
        const base = {
          id,
          kind: 'rect' as const,
          t1: time,
          p1: price,
          style: s.tools.rectLast ?? DEFAULT_RECT_STYLE,
          label: { ...DEFAULT_LINE_LABEL, align: 'left' as const, place: 'above' as const },
          hiddenOn: [] as Timeframe[],
        };
        let moved = false;
        const startX = x;
        const startY = y;
        chart.applyOptions({ handleScroll: false, handleScale: false });
        const move = (ev: PointerEvent) => {
          const p = local(ev);
          if (Math.hypot(p.x - startX, p.y - startY) > 4) moved = true;
          const p2 = priceAt(p.x, p.y);
          if (p2 === null) return;
          prim.shapes = [...st.current.shapes, { ...base, t2: coords().timeAt(logicalAt(p.x)), p2 }];
          prim.update();
        };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          chart.applyOptions({ handleScroll: true, handleScale: true });
          const p = local(ev);
          const p2 = priceAt(p.x, p.y);
          if (moved && p2 !== null) {
            commit({ ...base, t2: coords().timeAt(logicalAt(p.x)), p2 });
            st.current.setSelected(id);
            st.current.setTool('cursor');
          } else {
            // A click without dragging: the next click places the opposite corner.
            pending = { id, t1: base.t1, p1: base.p1 };
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return;
      }

      if (s.tool === 'long' || s.tool === 'short') {
        const entry = priceAt(x, y);
        if (entry === null) return;
        stop(e);
        const dist = Math.abs((series.coordinateToPrice(y + 40) ?? entry) - entry) || inst.tickSize * 20;
        const d = round(dist);
        const dir = s.tool === 'long' ? 1 : -1;
        const l = logicalAt(x);
        const rr: RiskRewardDrawing = {
          id: newId(),
          kind: s.tool,
          t1: c.timeAt(l),
          t2: c.timeAt(l + 25),
          entry,
          stop: round(entry - dir * d),
          target: round(entry + dir * d * 2),
          symbol: inst.trades.at(-1)!,
          riskUsd: s.tools.riskUsd ?? 200,
          hiddenOn: [],
        };
        commit(rr);
        s.setSelected(rr.id);
        s.setTool('cursor');
        return;
      }

      if (s.tool !== 'cursor') return;
      const hit = prim.shapeAt(x, y);
      if (!hit) {
        if (s.selected && s.shapes.some((sh) => sh.id === s.selected)) s.setSelected(null);
        return;
      }
      stop(e);
      s.setSelected(hit.shape.id);
      const start = hit.shape;
      const l0 = logicalAt(x);
      const p0 = series.coordinateToPrice(y) ?? 0;
      const lt1 = c.logicalOf(start.t1);
      const lt2 = c.logicalOf(start.t2);
      follow((mx, my) => drag(start, hit.part, logicalAt(mx) - l0, (series.coordinateToPrice(my) ?? p0) - p0, mx, my, lt1, lt2));
    };

    /** A shape moved by a drag of `part`: `dl` bars and `dp` price from where it started. */
    const drag = (s0: Shape, part: ShapePart, dl: number, dpx: number, mx: number, my: number, lt1: number, lt2: number): Shape | null => {
      const c = coords();
      const at = priceAt(mx, my);
      const shift = (p: number) => round(p + dpx);
      const t = (l: number) => c.timeAt(l);
      if (s0.kind === 'rect') {
        if (part === 'body') return { ...s0, t1: t(lt1 + dl), t2: t(lt2 + dl), p1: shift(s0.p1), p2: shift(s0.p2) };
        if (at === null) return null;
        const tm = t(logicalAt(mx));
        if (part === 'a') return { ...s0, t1: tm, p1: at };
        if (part === 'b') return { ...s0, t2: tm, p2: at };
        if (part === 'c') return { ...s0, t1: tm, p2: at };
        return { ...s0, t2: tm, p1: at };
      }
      if (part === 'body') return { ...s0, t1: t(lt1 + dl), t2: t(lt2 + dl), entry: shift(s0.entry), stop: shift(s0.stop), target: shift(s0.target) };
      if (part === 'end') return { ...s0, t2: t(Math.max(lt1 + 1, logicalAt(mx))) };
      if (at === null) return null;
      const long = s0.kind === 'long';
      if (part === 'entry') return { ...s0, entry: at, t1: t(Math.min(lt2 - 1, logicalAt(mx))) };
      if (part === 'stop') return (long ? at < s0.entry : at > s0.entry) ? { ...s0, stop: at } : null;
      return (long ? at > s0.entry : at < s0.entry) ? { ...s0, target: at } : null;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (swallowMouse) {
        e.stopPropagation();
        swallowMouse = false;
      }
    };

    const onHover = (e: PointerEvent) => {
      if (e.buttons) return;
      const { x, y } = local(e);
      if (pending) {
        const p2 = priceAt(x, y);
        if (p2 !== null) {
          const s = st.current;
          prim.shapes = [
            ...s.shapes,
            {
              id: pending.id,
              kind: 'rect',
              t1: pending.t1,
              p1: pending.p1,
              t2: coords().timeAt(logicalAt(x)),
              p2,
              style: s.tools.rectLast ?? DEFAULT_RECT_STYLE,
              label: DEFAULT_LINE_LABEL,
              hiddenOn: [],
            },
          ];
          prim.update();
        }
        return;
      }
      const hit = st.current.tool === 'cursor' && inPane(x) && !host.parentElement?.dataset.level ? prim.shapeAt(x, y) : null;
      const id = hit?.shape.id ?? null;
      if (id !== prim.hovered) {
        prim.hovered = id;
        prim.update();
      }
      if (hit && !host.dataset.cursor) host.dataset.cursor = hit.part === 'body' ? 'pointer' : 'move';
    };

    const onDblClick = (e: MouseEvent) => {
      if (claimed(e)) return;
      const { x, y } = local(e);
      const hit = prim.shapeAt(x, y);
      if (!hit) return;
      e.stopPropagation();
      claim(e);
      st.current.setSelected(hit.shape.id);
      setEditing(hit.shape);
    };

    const onContextMenu = (e: MouseEvent) => {
      if (claimed(e)) return;
      const { x, y } = local(e);
      const hit = prim.shapeAt(x, y);
      if (!hit) return;
      e.preventDefault();
      claim(e);
      st.current.setSelected(hit.shape.id);
      setMenu({ x, y, id: hit.shape.id });
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

  // Delete removes the selected shape; Alt+Shift+R picks the rectangle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = st.current;
      if (e.altKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        s.setTool('rect');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected && !s.editing && s.shapes.some((sh) => sh.id === s.selected)) {
        e.preventDefault();
        s.onShapesChange(s.shapes.filter((sh) => sh.id !== s.selected));
        s.setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (shape: Shape) => onShapesChange(shapes.map((s) => (s.id === shape.id ? shape : s)));
  const current = editing ? shapes.find((s) => s.id === editing.id) : null;
  const menuShape = menu ? shapes.find((s) => s.id === menu.id) : null;
  const item = 'flex w-full px-3 py-1.5 text-left hover:bg-hover';

  return (
    <>
      {menu && menuShape && (
        <div
          role="menu"
          className="absolute z-30 w-52 rounded-md border border-border bg-card py-1 text-[13px] shadow-menu"
          style={{ left: Math.min(menu.x, host.clientWidth - 220), top: Math.min(menu.y, host.clientHeight - 140) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {menuShape.kind !== 'rect' && onPlaceOrder && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                onPlaceOrder(menuShape);
                setMenu(null);
              }}
            >
              Place order from this
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setEditing(menuShape);
              setMenu(null);
            }}
          >
            Settings…
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${item} text-loss`}
            onClick={() => {
              onShapesChange(shapes.filter((s) => s.id !== menuShape.id));
              setSelected(null);
              setMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {editing && current && (
        <ShapeSettings
          shape={current}
          inst={inst}
          specs={specs}
          timeframes={timeframesFor(inst)}
          onChange={update}
          onOk={() => {
            if (current.kind === 'rect') onToolsChange({ ...tools, rectLast: current.style });
            else onToolsChange({ ...tools, riskUsd: current.riskUsd });
            setEditing(null);
          }}
          onCancel={() => {
            update(editing);
            setEditing(null);
          }}
          onPlaceOrder={current.kind !== 'rect' && onPlaceOrder ? () => onPlaceOrder(current) : undefined}
        />
      )}
    </>
  );
}
