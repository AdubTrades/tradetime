import { GripVertical, LayoutTemplate, Settings2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

const KEY = 'tt.drawingToolbar';
const read = (): { x: number; y: number } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null;
  } catch {
    return null;
  }
};

/**
 * The floating bar shown while a drawing is selected (TradingView's layout, cut down): Templates and Settings. Drag the
 * grip to move it; the spot is remembered on this device. Positions are relative to the chart (`host`).
 */
export function DrawingToolbar({ host, onTemplates, onSettings }: { host: HTMLElement; onTemplates?: (at: { x: number; y: number }) => void; onSettings: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(read);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    if (bar.current) setSize({ w: bar.current.offsetWidth, h: bar.current.offsetHeight });
  }, [!!onTemplates]);

  // Kept inside the chart, whatever its size now; centred near the top until moved.
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(4, Math.min(p.x, host.clientWidth - size.w - 4)),
    y: Math.max(4, Math.min(p.y, host.clientHeight - size.h - 4)),
  });
  const at = clamp(pos ?? { x: (host.clientWidth - size.w) / 2, y: 40 });

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = { x: e.clientX - at.x, y: e.clientY - at.y };
    let last = at;
    const move = (ev: PointerEvent) => {
      last = clamp({ x: ev.clientX - start.x, y: ev.clientY - start.y });
      setPos(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(KEY, JSON.stringify(last));
      } catch {
        // Not remembered; fine.
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const button = 'flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-text';
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Drawing"
      className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-menu"
      style={{ left: at.x, top: at.y, visibility: size.w ? 'visible' : 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span onPointerDown={drag} title="Drag to move" className="flex h-8 w-5 cursor-grab items-center justify-center text-faint active:cursor-grabbing">
        <GripVertical size={14} />
      </span>
      {onTemplates && (
        <button
          type="button"
          title="Templates"
          aria-label="Templates"
          className={button}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const h = host.getBoundingClientRect();
            onTemplates({ x: r.left - h.left, y: r.bottom - h.top + 6 });
          }}
        >
          <LayoutTemplate size={16} strokeWidth={1.75} />
        </button>
      )}
      <button type="button" title="Settings (or double-click the drawing)" aria-label="Settings" className={button} onClick={onSettings}>
        <Settings2 size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
