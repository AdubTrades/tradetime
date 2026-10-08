import { ArrowDown, ArrowUp, Paperclip, Repeat, Search } from 'lucide-react';
import { DateTime } from 'luxon';
import { Fragment, useMemo, useState } from 'react';
import { claimable, formatMoney } from '@tc/domain';
import { CategoryPill, cn, Select, SummaryStrip } from '../../components/ui';
import type { Expense, Frequency } from '../../lib/api';
import { useExpenseLookups, useExpenses, useRecurring } from '../../lib/expenses';
import { useSettings } from '../../lib/settings';

const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const COLUMNS = 'grid-cols-[64px_minmax(0,1fr)_190px_96px_88px_64px_88px_64px_96px]';

export function ExpensesTab({ fy, onEdit }: { fy: number; onEdit: (e: Expense) => void }) {
  const { data: expenses = [], isLoading } = useExpenses(fy);
  const { data: recurring = [] } = useRecurring();
  const { data: settings } = useSettings();
  const lookups = useExpenseLookups();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const gstRegistered = !!settings?.gstRegistered;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses
      .filter(
        (e) =>
          (!category || (category === 'none' ? !e.categoryId : e.categoryId === category)) &&
          (!q || [e.name, e.vendor, e.description].some((v) => v?.toLowerCase().includes(q))),
      )
      .sort((a, b) => (newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.name.localeCompare(b.name));
  }, [expenses, search, category, newestFirst]);

  const months = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of filtered) map.set(e.date.slice(0, 7), [...(map.get(e.date.slice(0, 7)) ?? []), e]);
    return [...map.entries()];
  }, [filtered]);

  const totals = filtered.reduce(
    (t, e) => ({ inc: t.inc + e.incGstCents, gst: t.gst + e.gstCents, claim: t.claim + claimable(e, gstRegistered).deductibleCents }),
    { inc: 0, gst: 0, claim: 0 },
  );
  const frequencyOf = (id: string | null) => {
    const r = id ? recurring.find((x) => x.id === id) : undefined;
    return r ? (r.interval > 1 ? `Every ${r.interval}` : FREQUENCY_LABEL[r.frequency]) : 'Recurring';
  };
  const hasFilter = !!search.trim() || !!category;
  const clear = () => {
    setSearch('');
    setCategory('');
  };

  return (
    <div className="flex flex-col gap-5">
      <SummaryStrip
        items={[
          { label: 'Total inc GST', value: formatMoney(totals.inc) },
          { label: 'Claimable', value: <span className="text-profit">{formatMoney(totals.claim)}</span> },
          { label: 'GST paid', value: formatMoney(totals.gst) },
          { label: 'Expenses', value: filtered.length },
        ]}
      />

      <div className="flex flex-col gap-4">
        <h2 className="sr-only">Expense list</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-[0_1_300px]">
            <span className="sr-only">Search expenses</span>
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or vendor"
              className="h-10 w-full rounded-md border border-border bg-card pr-3 pl-[34px] text-sm shadow-card placeholder:text-faint"
            />
          </label>
          <Select aria-label="Category" highlightActive className="w-auto min-w-[180px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                <CategoryPill name={c.name} />
              </option>
            ))}
            <option value="none">Uncategorised</option>
          </Select>
          {hasFilter && (
            <button type="button" onClick={clear} className="h-10 rounded-sm px-2 text-[13px] font-medium text-secondary underline underline-offset-[3px] hover:text-text">
              Clear
            </button>
          )}
        </div>

        {!isLoading && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong/60 bg-card px-5 py-8 text-center text-sm text-muted">
            {expenses.length ? (
              <>
                No expenses match.{' '}
                <button type="button" onClick={clear} className="rounded-sm font-medium text-text underline">
                  Clear filters
                </button>
              </>
            ) : (
              'No expenses in this financial year yet. Add one or import a CSV.'
            )}
          </div>
        ) : (
          <div className="sm:overflow-x-auto">
            <div className="flex flex-col gap-4 sm:min-w-[960px]">
              <div className={cn('hidden gap-3 px-5 text-xs text-muted sm:grid', COLUMNS)}>
                <button
                  type="button"
                  onClick={() => setNewestFirst((v) => !v)}
                  className="flex items-center gap-0.5 rounded-sm text-left hover:text-text"
                  aria-label={newestFirst ? 'Date, newest first. Show oldest first' : 'Date, oldest first. Show newest first'}
                >
                  Date {newestFirst ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />}
                </button>
                <span aria-hidden>Expense</span>
                <span aria-hidden>Category</span>
                <span aria-hidden>Paid with</span>
                <span className="text-right" aria-hidden>
                  ex GST
                </span>
                <span className="text-right" aria-hidden>
                  GST
                </span>
                <span className="text-right" aria-hidden>
                  inc GST
                </span>
                <span className="text-right" aria-hidden>
                  Business
                </span>
                <span className="text-right" aria-hidden>
                  Claimable
                </span>
              </div>
              {months.map(([month, list]) => {
                const name = DateTime.fromISO(`${month}-01`).toFormat('LLLL yyyy');
                return (
                  <section key={month} aria-label={name} className="card overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
                      <div className="flex items-baseline gap-2.5">
                        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{name}</h3>
                        <span className="text-[13px] text-muted">
                          {list.length} expense{list.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <span className="text-[15px] font-medium">{formatMoney(list.reduce((s, e) => s + e.incGstCents, 0))}</span>
                    </div>
                    <div className="px-2 py-1">
                      {list.map((e) => {
                        const cat = lookups.name(e.categoryId);
                        const label = `Edit ${e.name}, ${DateTime.fromISO(e.date).toFormat('d LLLL')}, ${formatMoney(e.incGstCents)}`;
                        return (
                          <Fragment key={e.id}>
                          {/* Phones: a compact two-line row. */}
                          <button
                            type="button"
                            onClick={() => onEdit(e)}
                            aria-label={label}
                            className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-hover active:bg-hover sm:hidden"
                          >
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 truncate font-medium">{e.name}</span>
                              {e.recurringId && <Repeat size={12} strokeWidth={2.2} className="shrink-0 text-muted" aria-label="Recurring" />}
                              <span className="ml-auto shrink-0 font-medium">{formatMoney(e.incGstCents)}</span>
                            </span>
                            <span className="flex items-center gap-2 text-xs text-muted">
                              <span className="shrink-0">{DateTime.fromISO(e.date).toFormat('d LLL')}</span>
                              <span className="min-w-0 truncate">{cat || 'Uncategorised'}</span>
                              <span className="ml-auto shrink-0">
                                {e.businessUsePct < 100 ? `${e.businessUsePct}% · ` : ''}claim {formatMoney(claimable(e, gstRegistered).deductibleCents)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(e)}
                            aria-label={label}
                            className={cn('hidden min-h-14 w-full items-center gap-3 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-hover sm:grid', COLUMNS)}
                          >
                            <span className="whitespace-nowrap text-secondary">{DateTime.fromISO(e.date).toFormat('d LLL')}</span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 font-medium">
                                <span className="truncate">{e.name}</span>
                                {e.recurringId && (
                                  <span title="Recurring" className="inline-flex flex-none items-center gap-[3px] rounded-full border border-border px-[7px] text-[11px] font-medium text-muted">
                                    <Repeat size={10} strokeWidth={2.2} aria-hidden />
                                    {frequencyOf(e.recurringId)}
                                  </span>
                                )}
                              </span>
                              {e.vendor && <span className="block truncate text-xs text-muted">{e.vendor}</span>}
                            </span>
                            <span className="min-w-0">{cat ? <CategoryPill name={cat} className="px-2.5 py-[3px]" /> : <span className="text-xs text-faint">Uncategorised</span>}</span>
                            <span className="truncate text-[13px] whitespace-nowrap text-secondary">{lookups.name(e.paymentMethodId) || '–'}</span>
                            <span className="text-right text-secondary">{formatMoney(e.exGstCents)}</span>
                            <span className="text-right text-secondary">{e.gstCents ? formatMoney(e.gstCents) : '–'}</span>
                            <span className="text-right font-medium">{formatMoney(e.incGstCents)}</span>
                            <span className="text-right text-secondary">{e.businessUsePct}%</span>
                            <span className="text-right font-medium">{formatMoney(claimable(e, gstRegistered).deductibleCents)}</span>
                          </button>
                          </Fragment>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
        <p className="flex items-center gap-1 text-xs text-muted">
          <Paperclip size={12} aria-hidden /> Tap or click an expense to edit it or attach a receipt.
        </p>
      </div>
    </div>
  );
}
