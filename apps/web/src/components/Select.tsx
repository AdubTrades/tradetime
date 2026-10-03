import { Check, ChevronDown } from 'lucide-react';
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

interface OptionItem {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

/** Read <option> children (including nested fragments and arrays) into a list. */
function readOptions(children: ReactNode): OptionItem[] {
  const out: OptionItem[] = [];
  const walk = (nodes: ReactNode) =>
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
      if (el.type === 'option') {
        const text = textOf(el.props.children);
        out.push({ value: String(el.props.value ?? text), label: el.props.children, text, disabled: !!el.props.disabled });
      } else if (el.props.children) walk(el.props.children);
    });
  walk(children);
  return out;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

export interface SelectProps {
  value?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  /** Dark trigger for use on the dark hero panel (the menu stays white). */
  dark?: boolean;
  /** Filter selects: show the "active" style when a non-default option is chosen. */
  highlightActive?: boolean;
  /** Smaller trigger for dense rows. */
  size?: 'md' | 'sm';
}

/**
 * Custom dropdown replacing native <select> (shadcn-style). Keeps the native API — `value`,
 * `onChange(e)` with `e.target.value`, and <option> children — so call sites don't change.
 */
export function Select({ value, onChange, children, className, disabled, id, dark = false, highlightActive = false, size = 'md', ...rest }: SelectProps) {
  const options = readOptions(children);
  const current = options.find((o) => o.value === String(value ?? '')) ?? options[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const listId = useId();
  const typeahead = useRef({ text: '', at: 0 });

  const isActiveFilter = highlightActive && current && options[0] && current.value !== options[0].value;

  const choose = (opt: OptionItem | undefined) => {
    if (!opt || opt.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (opt.value !== String(value ?? '')) onChange?.({ target: { value: opt.value }, currentTarget: { value: opt.value } } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  // Position the menu under the trigger. Inside a modal <dialog> it must render in the dialog to stay on top.
  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const maxHeight = Math.min(320, Math.max(160, below > 220 ? below - 12 : r.top - 12));
    const up = below < 220 && r.top > below;
    setMenuStyle({
      position: 'fixed',
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8),
      minWidth: Math.max(r.width, 180),
      maxHeight,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    setPortalTarget(triggerRef.current?.closest('dialog') ?? document.body);
    place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openMenu = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === current?.value)));
    setOpen(true);
  };

  const move = (delta: number) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i]!.disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't close an enclosing dialog
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1) {
      // Type-ahead: jump to the first option starting with the typed letters.
      const now = Date.now();
      typeahead.current = { text: (now - typeahead.current.at < 700 ? typeahead.current.text : '') + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => o.text.toLowerCase().startsWith(typeahead.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest['aria-label']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border pr-3 pl-3 text-left text-sm shadow-card transition disabled:opacity-50',
          size === 'md' ? 'h-10' : 'h-8 text-[13px]',
          dark
            ? 'border-dark-border bg-dark text-dark-text hover:border-dark-muted'
            : isActiveFilter
              ? 'border-border-strong bg-hover text-text'
              : 'border-border bg-card text-text hover:bg-hover',
        )}
      >
        <span className="min-w-0 truncate">{current?.label ?? ''}</span>
        <ChevronDown size={16} className={cn('shrink-0 opacity-55 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open &&
        portalTarget &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={rest['aria-label']}
            style={menuStyle}
            className="z-[100] overflow-y-auto rounded-lg border border-border bg-card p-1 text-text shadow-menu"
            onKeyDown={onKeyDown}
          >
            {options.map((o, i) => {
              const selected = o.value === current?.value;
              return (
                <button
                  key={`${o.value}-${i}`}
                  type="button"
                  role="option"
                  data-index={i}
                  aria-selected={selected}
                  disabled={o.disabled}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    'flex h-9 w-full items-center justify-between gap-3 rounded-sm px-2.5 text-left text-sm whitespace-nowrap disabled:opacity-40',
                    i === active && 'bg-hover',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {selected && <Check size={15} className="shrink-0" aria-hidden />}
                </button>
              );
            })}
          </div>,
          portalTarget,
        )}
    </div>
  );
}
