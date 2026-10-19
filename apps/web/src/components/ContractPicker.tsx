import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { searchFutures, type FuturesSpec } from '@tc/domain';
import { api, type Contract } from '../lib/api';
import { useContracts } from '../lib/journal';
import { cn } from './ui';

type Item = { kind: 'mine'; contract: Contract } | { kind: 'catalogue'; spec: FuturesSpec };

/**
 * Type-to-search contract picker. Your own contracts come first; below them, matching CME Group futures and FOREX.com
 * pairs from the built-in list (packages/domain/src/futures.ts). Choosing one of those adds it to your contracts, then selects it.
 */
export function ContractPicker({
  value,
  onChange,
  disabled,
  'aria-label': label = 'Contract',
  placeholder = 'Choose…',
  className,
}: {
  value: string;
  onChange: (contractId: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
  /** Trigger text when nothing is chosen (e.g. "Add from the futures list…" in Settings). */
  placeholder?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const { data: contracts = [] } = useContracts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const listId = useId();

  const current = contracts.find((c) => c.id === value);

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const live = contracts.filter((c) => !c.archived || c.id === value);
    const mine = live.filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    const have = new Set(contracts.filter((c) => !c.archived).map((c) => c.symbol));
    const catalogue = searchFutures(query).filter((s) => !have.has(s.symbol));
    return [...mine.map((contract) => ({ kind: 'mine' as const, contract })), ...catalogue.map((spec) => ({ kind: 'catalogue' as const, spec }))];
  }, [contracts, query, value]);
  const firstCatalogue = items.findIndex((i) => i.kind === 'catalogue');

  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 300 && r.top > below;
    const width = Math.max(r.width, 360);
    setPanelStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width: Math.min(width, window.innerWidth - 16),
      maxHeight: Math.min(400, (up ? r.top : below) - 12),
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
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
    };
  }, [open, portalTarget]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openPanel = () => {
    if (disabled) return;
    setQuery('');
    setError(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = async (item: Item | undefined) => {
    if (!item || adding) return;
    if (item.kind === 'mine') {
      close();
      if (item.contract.id !== value) onChange(item.contract.id);
      return;
    }
    setAdding(item.spec.symbol);
    setError(null);
    try {
      const row = await api.post<Contract>('/contracts/catalogue', { symbol: item.spec.symbol });
      qc.setQueryData<Contract[]>(['contracts'], (old = []) => [...old.filter((c) => c.id !== row.id), row]);
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      close();
      onChange(row.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void choose(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${current ? current.symbol : 'none'}`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || (e.key.length === 1 && /\w/.test(e.key))) {
            e.preventDefault();
            openPanel();
            if (e.key.length === 1) setQuery(e.key);
          }
        }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-left text-sm shadow-card transition hover:bg-hover disabled:opacity-50 pointer-coarse:h-11"
      >
        <span className="min-w-0 truncate">{current ? current.symbol : <span className="text-muted">{placeholder}</span>}</span>
        <ChevronDown size={16} className={cn('shrink-0 opacity-55 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open &&
        portalTarget &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Choose ${label.toLowerCase()}`}
            style={panelStyle}
            className="z-[100] flex flex-col overflow-hidden rounded-lg border border-border bg-card text-text shadow-menu"
          >
            {/* The search box is focused whenever the panel is open, so it shows no focus ring of its own
                (inline, because the global :focus-visible rule in styles.css outranks utility classes). */}
            <div className="flex items-center gap-2 border-b border-border-subtle px-3">
              <Search size={15} className="shrink-0 text-muted" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search: NQ, gold, crude, EUR/USD…"
                aria-label="Search contracts"
                aria-controls={listId}
                aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-faint"
                style={{ boxShadow: 'none' }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div id={listId} role="listbox" aria-label={label} className="overflow-y-auto p-1">
              {items.length === 0 && <p className="px-2.5 py-3 text-sm text-muted">Nothing matches “{query}”. You can add your own in Settings → Journal → Contracts.</p>}
              {items.map((item, i) => {
                const heading =
                  i === 0 && item.kind === 'mine' ? 'Your contracts' : i === firstCatalogue ? 'Add from futures and forex' : null;
                const symbol = item.kind === 'mine' ? item.contract.symbol : item.spec.symbol;
                const name = item.kind === 'mine' ? item.contract.name : item.spec.name;
                const selected = item.kind === 'mine' && item.contract.id === value;
                return (
                  <div key={`${item.kind}-${symbol}`}>
                    {heading && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{heading}</div>}
                    <button
                      id={`${listId}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-index={i}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => void choose(item)}
                      className={cn('flex h-10 w-full items-center gap-3 rounded-sm px-2.5 text-left text-sm pointer-coarse:h-11', i === active && 'bg-hover')}
                    >
                      <span className="w-16 shrink-0 font-medium">{symbol}</span>
                      <span className="min-w-0 flex-1 truncate text-secondary">{name}</span>
                      {item.kind === 'catalogue' ? (
                        adding === symbol ? (
                          <span className="shrink-0 text-xs text-muted">Adding…</span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                            <Plus size={12} aria-hidden /> {item.spec.exchange}
                          </span>
                        )
                      ) : (
                        selected && <Check size={15} className="shrink-0" aria-hidden />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            {error && <p className="border-t border-border-subtle px-3 py-2 text-xs text-loss">{error}</p>}
          </div>,
          portalTarget,
        )}
    </div>
  );
}
