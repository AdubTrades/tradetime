import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Paperclip, Repeat, Search } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { claimable, formatMoney } from '@tc/domain';
import { Input, Select } from '../../components/ui';
import type { Expense } from '../../lib/api';
import { useExpenseLookups, useExpenses } from '../../lib/expenses';
import { useSettings } from '../../lib/settings';

const col = createColumnHelper<Expense>();

export function ExpensesTab({ fy, onEdit }: { fy: number; onEdit: (e: Expense) => void }) {
  const { data: expenses = [], isLoading } = useExpenses(fy);
  const { data: settings } = useSettings();
  const lookups = useExpenseLookups();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter(
      (e) =>
        (!category || (category === 'none' ? !e.categoryId : e.categoryId === category)) &&
        (!q || [e.name, e.vendor, e.description].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [expenses, search, category]);

  const columns = useMemo(
    () => [
      col.accessor('date', { header: 'Date', cell: (c) => DateTime.fromISO(c.getValue()).toFormat('d LLL yyyy') }),
      col.accessor('name', {
        header: 'Name',
        cell: (c) => (
          <span className="flex items-center gap-1.5">
            {c.getValue()}
            {c.row.original.recurringId && <Repeat size={12} className="text-muted" aria-label="Recurring" />}
          </span>
        ),
      }),
      col.accessor('vendor', { header: 'Vendor' }),
      col.accessor((e) => lookups.name(e.categoryId), { id: 'category', header: 'Category' }),
      col.accessor((e) => lookups.name(e.paymentMethodId), { id: 'payment', header: 'Payment' }),
      col.accessor('exGstCents', { header: 'ex GST', cell: (c) => formatMoney(c.getValue()), meta: { numeric: true } }),
      col.accessor('gstCents', { header: 'GST', cell: (c) => formatMoney(c.getValue()), meta: { numeric: true } }),
      col.accessor('incGstCents', { header: 'inc GST', cell: (c) => <strong>{formatMoney(c.getValue())}</strong>, meta: { numeric: true } }),
      col.accessor('businessUsePct', { header: 'Bus. %', cell: (c) => `${c.getValue()}%`, meta: { numeric: true } }),
      col.accessor((e) => claimable(e, !!settings?.gstRegistered).deductibleCents, {
        id: 'claimable',
        header: 'Claimable',
        cell: (c) => formatMoney(c.getValue()),
        meta: { numeric: true },
      }),
    ],
    [lookups, settings?.gstRegistered],
  );

  const table = useReactTable({ data: filtered, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const total = filtered.reduce((s, e) => s + e.incGstCents, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, vendor, description" className="pl-8" />
        </div>
        <Select aria-label="Filter by category" className="w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {lookups.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Uncategorised</option>
        </Select>
        <span className="tabular ml-auto text-sm text-muted">
          {filtered.length} expenses · {formatMoney(total)} inc GST
        </span>
      </div>

      <div className="overflow-x-auto panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left text-xs text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const numeric = (h.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} className={`px-3 py-2 font-medium ${numeric ? 'text-right' : ''}`}>
                      <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === 'asc' ? <ArrowUp size={12} /> : sorted === 'desc' ? <ArrowDown size={12} /> : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="cursor-pointer hover:bg-surface-2" onClick={() => onEdit(row.original)}>
                {row.getVisibleCells().map((cell) => {
                  const numeric = (cell.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                  return (
                    <td key={cell.id} className={`px-3 py-2 ${numeric ? 'tabular text-right' : ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {expenses.length ? 'No expenses match the filters.' : 'No expenses in this financial year yet. Add one or import a CSV.'}
          </p>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted">
        <Paperclip size={12} aria-hidden /> Click an expense to edit it or attach a receipt.
      </p>
    </div>
  );
}
