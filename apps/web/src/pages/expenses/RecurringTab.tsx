import { Pause, Pencil, Play, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { formatMoney, incGst } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { ListSelect } from '../../components/ListSelect';
import { MoneyInput } from '../../components/MoneyInput';
import { Button, Field, Input, Select, StatusPill } from '../../components/ui';
import { api, type Frequency, type RecurringExpense } from '../../lib/api';
import { useExpenseLookups, useMoneyMutation, useRecurring } from '../../lib/expenses';
import { todayLocal } from '../../lib/localTime';

const frequencyLabel: Record<Frequency, [string, string]> = {
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  quarterly: ['quarter', 'quarters'],
  yearly: ['year', 'years'],
};
const describeSchedule = (r: Pick<RecurringExpense, 'frequency' | 'interval'>) =>
  r.interval === 1 ? `Every ${frequencyLabel[r.frequency][0]}` : `Every ${r.interval} ${frequencyLabel[r.frequency][1]}`;

export function RecurringTab() {
  const { data: items = [] } = useRecurring();
  const lookups = useExpenseLookups();
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  const toggle = useMoneyMutation((r: RecurringExpense) => api.patch(`/recurring-expenses/${r.id}`, { active: !r.active }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Subscriptions and fees entered once. Each occurrence becomes a normal expense on its date, which you can edit.</p>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden /> Add recurring
        </Button>
      </div>
      <div className="card divide-y divide-border-subtle">
        {items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">No recurring expenses yet.</p>}
        {items.map((r) => (
          <div key={r.id} className={`flex flex-wrap items-center gap-4 px-5 py-3.5 text-sm ${r.active ? '' : 'opacity-60'}`}>
            <div className="min-w-48 flex-1">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted">
                {[r.vendor, lookups.name(r.categoryId)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="tabular w-24 text-right font-medium">{formatMoney(incGst(r.exGstCents, r.gstCents))}</div>
            <div className="w-32">
              <StatusPill>{describeSchedule(r)}</StatusPill>
            </div>
            <div className="w-40 text-muted">
              {r.active ? (r.nextDate ? `Next: ${DateTime.fromISO(r.nextDate).toFormat('d LLL yyyy')}` : 'Ended') : 'Paused'}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" className="px-2" aria-label={r.active ? 'Pause' : 'Resume'} onClick={() => toggle.mutate(r)}>
                {r.active ? <Pause size={14} /> : <Play size={14} />}
              </Button>
              <Button variant="ghost" className="px-2" aria-label="Edit" onClick={() => setEditing(r)}>
                <Pencil size={14} />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <RecurringDialog item={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  );
}

interface Form {
  name: string;
  vendor: string;
  description: string;
  categoryId: string | null;
  typeId: string | null;
  paymentMethodId: string | null;
  exGstCents: number | null;
  gstCents: number | null;
  businessUsePct: number;
  frequency: Frequency;
  interval: number;
  startDate: string;
  endDate: string;
}

const toForm = (r: RecurringExpense | RecurringDraft | null): Form => ({
  name: r?.name ?? '',
  vendor: r?.vendor ?? '',
  description: r?.description ?? '',
  categoryId: r?.categoryId ?? null,
  typeId: r?.typeId ?? null,
  paymentMethodId: r?.paymentMethodId ?? null,
  exGstCents: r?.exGstCents ?? null,
  gstCents: r?.gstCents ?? 0,
  businessUsePct: r?.businessUsePct ?? 100,
  frequency: r && 'frequency' in r ? r.frequency : 'monthly',
  interval: r && 'interval' in r ? r.interval : 1,
  startDate: r?.startDate ?? todayLocal(),
  endDate: r && 'endDate' in r ? (r.endDate ?? '') : '',
});

/** Prefill for a new recurring expense, e.g. from an existing expense ("Make recurring"). */
export type RecurringDraft = Pick<
  RecurringExpense,
  'name' | 'vendor' | 'description' | 'categoryId' | 'typeId' | 'paymentMethodId' | 'exGstCents' | 'gstCents' | 'businessUsePct' | 'startDate'
>;

export function RecurringDialog({
  item,
  draft,
  open,
  onClose,
}: {
  item: RecurringExpense | null;
  draft?: RecurringDraft | null;
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(item ?? draft ?? null));
  useEffect(() => {
    if (open) setForm(toForm(item ?? draft ?? null));
  }, [open, item, draft]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMoneyMutation(() => {
    const payload = { ...form, vendor: form.vendor || null, description: form.description || null, endDate: form.endDate || null, gstCents: form.gstCents ?? 0 };
    return item ? api.patch(`/recurring-expenses/${item.id}`, payload) : api.post('/recurring-expenses', payload);
  });
  const remove = useMoneyMutation(() => api.delete(`/recurring-expenses/${item!.id}`));
  const valid = form.name.trim() && form.exGstCents !== null && form.gstCents !== null && form.startDate;
  const pastStart = !item && form.startDate < todayLocal();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? 'Edit recurring expense' : 'Add recurring expense'}
      width="max-w-2xl"
      footer={
        <>
          {item && (
            <Button
              variant="ghost"
              className="mr-auto text-loss"
              onClick={() =>
                window.confirm('Stop and remove this recurring expense? Expenses already created are kept.') && remove.mutate(undefined, { onSuccess: onClose })
              }
            >
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="TradingView — Premium subscription" />
          </Field>
          <Field label="Vendor">
            <Input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} />
          </Field>
          <Field label="Category">
            <ListSelect kind="expense_category" value={form.categoryId} onChange={(v) => set('categoryId', v)} />
          </Field>
          <Field label="Payment method">
            <ListSelect kind="payment_method" value={form.paymentMethodId} onChange={(v) => set('paymentMethodId', v)} />
          </Field>
          <Field label="Type">
            <ListSelect kind="expense_type" value={form.typeId} onChange={(v) => set('typeId', v)} />
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 rounded-md bg-inset p-4 sm:grid-cols-4">
          <Field label="Amount ex GST">
            <MoneyInput value={form.exGstCents} onChange={(v) => set('exGstCents', v)} />
          </Field>
          <Field label="GST">
            <MoneyInput value={form.gstCents} onChange={(v) => set('gstCents', v)} />
          </Field>
          <Field label="Amount inc GST" hint="Calculated">
            <div className="tabular px-2.5 py-1.5 text-right text-sm font-semibold">{formatMoney(incGst(form.exGstCents ?? 0, form.gstCents ?? 0))}</div>
          </Field>
          <Field label="Business use %">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.businessUsePct}
              onChange={(e) => set('businessUsePct', Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="tabular text-right"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Every">
            <Input type="number" min={1} max={52} value={form.interval} onChange={(e) => set('interval', Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Period">
            <Select value={form.frequency} onChange={(e) => set('frequency', e.target.value as Frequency)}>
              <option value="weekly">Week(s)</option>
              <option value="monthly">Month(s)</option>
              <option value="quarterly">Quarter(s)</option>
              <option value="yearly">Year(s)</option>
            </Select>
          </Field>
          <Field label="First charge">
            <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="Ends" hint="Optional">
            <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
        </div>
        {pastStart && (
          <p className="text-sm text-warning">
            The first charge is in the past, so expenses will be created for each occurrence up to today, except where an expense with the same name,
            date and amount already exists (e.g. ones you imported).
          </p>
        )}
        {item && <p className="text-sm text-muted">Changes apply to future occurrences. Expenses already created aren't changed.</p>}
        {(save.error || remove.error) && <p className="text-sm text-loss">{(save.error ?? remove.error)?.message}</p>}
      </div>
    </Dialog>
  );
}
