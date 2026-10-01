import { useQueryClient } from '@tanstack/react-query';
import { History, Repeat, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { claimable, formatMoney, incGst, newId } from '@tc/domain';
import { AttachmentDropzone } from '../../components/AttachmentDropzone';
import { Dialog } from '../../components/Dialog';
import { ListSelect } from '../../components/ListSelect';
import { MoneyInput } from '../../components/MoneyInput';
import { Button, Field, Input, Select } from '../../components/ui';
import { api, type Attachment, type AttachmentLink, type Expense } from '../../lib/api';
import { useAccounts, useMoneyMutation } from '../../lib/expenses';
import { todayLocal } from '../../lib/localTime';
import { useSettings } from '../../lib/settings';

interface Form {
  name: string;
  vendor: string;
  date: string;
  description: string;
  categoryId: string | null;
  typeId: string | null;
  paymentMethodId: string | null;
  accountId: string | null;
  exGstCents: number | null;
  gstCents: number | null;
  businessUsePct: number;
  reason: string;
}

const fromExpense = (e: Expense | null): Form =>
  e
    ? {
        name: e.name,
        vendor: e.vendor ?? '',
        date: e.date,
        description: e.description ?? '',
        categoryId: e.categoryId,
        typeId: e.typeId,
        paymentMethodId: e.paymentMethodId,
        accountId: e.accountId,
        exGstCents: e.exGstCents,
        gstCents: e.gstCents,
        businessUsePct: e.businessUsePct,
        reason: '',
      }
    : {
        name: '',
        vendor: '',
        date: todayLocal(),
        description: '',
        categoryId: null,
        typeId: null,
        paymentMethodId: null,
        accountId: null,
        exGstCents: null,
        gstCents: 0,
        businessUsePct: 100,
        reason: '',
      };

interface Props {
  open: boolean;
  expense: Expense | null;
  onClose: () => void;
  onHistory: (id: string) => void;
  onMakeRecurring: (expense: Expense) => void;
}

export function ExpenseDialog({ open, expense, onClose, onHistory, onMakeRecurring }: Props) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: accounts = [] } = useAccounts();
  const [form, setForm] = useState<Form>(() => fromExpense(expense));
  // New expenses get their id up front so receipts can be attached before saving.
  // Re-run on `open` so each new-expense dialog gets a fresh id.
  const draftId = useMemo(() => (open ? (expense?.id ?? newId()) : ''), [expense, open]);
  useEffect(() => {
    if (open) setForm(fromExpense(expense));
  }, [open, expense]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMoneyMutation(() => {
    const payload = {
      name: form.name,
      vendor: form.vendor || null,
      date: form.date,
      description: form.description || null,
      categoryId: form.categoryId,
      typeId: form.typeId,
      paymentMethodId: form.paymentMethodId,
      accountId: form.accountId,
      exGstCents: form.exGstCents!,
      gstCents: form.gstCents ?? 0,
      businessUsePct: form.businessUsePct,
    };
    return expense
      ? api.patch<Expense>(`/expenses/${expense.id}`, { ...payload, reason: form.reason || null })
      : api.post<Expense>('/expenses', { ...payload, id: draftId });
  });
  const remove = useMoneyMutation(() => api.delete(`/expenses/${expense!.id}`));

  /** Cancelling a new expense detaches any receipts uploaded for it. */
  const cancel = async () => {
    if (!expense) {
      const links = await api.get<{ link: AttachmentLink; attachment: Attachment }[]>(`/attachments/for/expense/${draftId}`).catch(() => []);
      await Promise.all(links.map(({ link }) => api.delete(`/attachments/links/${link.id}`)));
      void qc.invalidateQueries({ queryKey: ['attachments', 'expense', draftId] });
    }
    onClose();
  };

  const valid = form.name.trim() && form.date && form.exGstCents !== null && form.gstCents !== null;
  const inc = incGst(form.exGstCents ?? 0, form.gstCents ?? 0);
  const claim = claimable({ exGstCents: form.exGstCents ?? 0, gstCents: form.gstCents ?? 0, businessUsePct: form.businessUsePct }, !!settings?.gstRegistered);

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={expense ? 'Edit expense' : 'Add expense'}
      width="max-w-2xl"
      footer={
        <>
          {expense && (
            <>
              <Button variant="ghost" onClick={() => onHistory(expense.id)}>
                <History size={16} aria-hidden /> History
              </Button>
              {!expense.recurringId && (
                <Button variant="ghost" onClick={() => onMakeRecurring(expense)}>
                  <Repeat size={16} aria-hidden /> Make recurring
                </Button>
              )}
              <Button
                variant="ghost"
                className="mr-auto text-loss"
                onClick={() => window.confirm('Delete this expense? It stays in the edit history.') && remove.mutate(undefined, { onSuccess: onClose })}
              >
                <Trash2 size={16} aria-hidden /> Delete
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="TradingView — Premium subscription" autoFocus />
          </Field>
          <Field label="Vendor">
            <Input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Category">
            <ListSelect kind="expense_category" value={form.categoryId} onChange={(v) => set('categoryId', v)} />
          </Field>
          <Field label="Type">
            <ListSelect kind="expense_type" value={form.typeId} onChange={(v) => set('typeId', v)} />
          </Field>
          <Field label="Payment method">
            <ListSelect kind="payment_method" value={form.paymentMethodId} onChange={(v) => set('paymentMethodId', v)} />
          </Field>
        </div>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="grid gap-4 rounded-md bg-surface-2 p-4 sm:grid-cols-4">
          <Field label="Amount ex GST">
            <MoneyInput value={form.exGstCents} onChange={(v) => set('exGstCents', v)} />
          </Field>
          <Field label="GST" hint="As shown on the invoice">
            <MoneyInput value={form.gstCents} onChange={(v) => set('gstCents', v)} />
          </Field>
          <Field label="Amount inc GST" hint="Calculated">
            <div className="tabular rounded-md border border-transparent px-2.5 py-1.5 text-right text-sm font-semibold">{formatMoney(inc)}</div>
          </Field>
          <Field label="Business use">
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.businessUsePct}
                onChange={(e) => set('businessUsePct', Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="tabular pr-7 text-right"
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">%</span>
            </div>
          </Field>
          <p className="text-sm text-muted sm:col-span-4">
            Claimable: <span className="tabular font-medium text-text">{formatMoney(claim.deductibleCents)}</span>
            {settings?.gstRegistered && (
              <>
                {' '}
                + GST credit <span className="tabular font-medium text-text">{formatMoney(claim.gstCreditCents)}</span>
              </>
            )}
          </p>
        </div>

        {accounts.length > 0 && (
          <Field label="Trading account" hint="Optional — e.g. which evaluation a fee was for">
            <Select value={form.accountId ?? ''} onChange={(e) => set('accountId', e.target.value || null)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div>
          <div className="mb-1 text-sm font-medium">Receipt / invoice</div>
          <AttachmentDropzone ownerType="expense" ownerId={draftId} role="receipt" />
        </div>

        {expense && (
          <Field label="Reason for edit" hint="Optional, kept in the edit history">
            <Input value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
        {(save.error || remove.error) && <p className="text-sm text-loss">{(save.error ?? remove.error)?.message}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
