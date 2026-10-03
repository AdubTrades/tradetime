import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buttonClass, cn } from './ui';

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * Outline button that opens a small action menu (same look as the Select menu).
 * With `icon`, the trigger is a quiet 32px ⋯ button and `label` becomes its accessible name.
 */
export function MenuButton({ label, items, className, icon = false }: { label: ReactNode; items: MenuItem[]; className?: string; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const pick = (i: number) => {
    setOpen(false);
    triggerRef.current?.focus();
    items[i]?.onSelect();
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={icon && typeof label === 'string' ? label : undefined}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setActive(0);
            setOpen(true);
          } else if (open) {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') setActive((a) => (a + 1) % items.length);
            else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + items.length) % items.length);
            else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pick(active);
              return;
            } else return;
            e.preventDefault();
          }
        }}
        className={icon ? 'flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-text' : cn(buttonClass('secondary'), 'h-11')}
      >
        {icon ? (
          <MoreHorizontal size={16} aria-hidden />
        ) : (
          <>
            {label}
            <ChevronDown size={16} className="opacity-55" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1.5 min-w-[160px] rounded-lg border border-border bg-card p-1 shadow-menu">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={cn('flex h-10 w-full items-center rounded-sm px-2.5 text-left text-sm whitespace-nowrap', i === active && 'bg-hover', it.danger && 'text-loss')}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
