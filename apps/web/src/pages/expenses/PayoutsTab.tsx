import { History, Plus } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { formatMoney, newId } from '@tc/domain';
import { AttachmentDropzone } from '../../components/AttachmentDropzone';
import { Dialog } from '../../components/Dialog';
import { HistoryDialog } from '../../components/HistoryDialog';
import { MoneyInput } from '../../components/MoneyInput';
import { Button, Field, Input, Select } from '../../components/ui';
import { api, type Payout } from '../../lib/api';
import { useAccounts, useMoneyMutation, usePayouts } from '../../lib/expenses';
import { todayLocal } from '../../lib/localTime';

export function PayoutsTab({ fy }: { fy: number }) {
  const { data: payouts = [] } = usePayouts(fy);
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<Payout | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—';
  const totalAud = payouts.reduce((s, p) => s + p.audReceivedCents, 0);
  const totalUsd = payouts.reduce((s, p) => s + (p.grossUsdCents ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Money received from prop firms, recorded in AUD as it landed in your bank.</p>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden /> Add payout
        </Button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-border-subtle text-left text-xs text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Received</th>
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Gross (USD)</th>
              <th className="px-5 py-3 text-right font-medium">Received (AUD)</th>
              <th className="px-5 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {payouts.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-hover" onClick={() => setEditing(p)}>
                <td className="px-5 py-3">{DateTime.fromISO(p.receivedDate).toFormat('d LLL yyyy')}</td>
                <td className="px-5 py-3">{accountName(p.accountId)}</td>
                <td className="tabular px-5 py-3 text-right">{p.grossUsdCents == null ? '—' : formatMoney(p.grossUsdCents, 'USD')}</td>
                <td className="tabular px-5 py-3 text-right font-medium">{formatMoney(p.audReceivedCents)}</td>
                <td className="px-5 py-3 text-muted">{p.notes}</td>
              </tr>
            ))}
          </tbody>
          {payouts.length > 0 && (
            <tfoot className="border-t border-border font-medium">
              <tr>
                <td className="px-5 py-3" colSpan={2}>
                  Total ({payouts.length})
                </td>
                <td className="tabular px-5 py-3 text-right">{formatMoney(totalUsd, 'USD')}</td>
                <td className="tabular px-5 py-3 text-right">{formatMoney(totalAud)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        {payouts.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">No payouts in this financial year yet.</p>}
      </div>
      <PayoutDialog payout={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onHistory={setHistoryFor} />
      <HistoryDialog
        url={historyFor ? `/payouts/${historyFor}/history` : null}
        onClose={() => setHistoryFor(null)}
        fieldLabels={{ receivedDate: 'Received', requestedDate: 'Requested', audReceivedCents: 'Received (AUD)', grossUsdCents: 'Gross (USD)', accountId: 'Account', notes: 'Notes' }}
        formatValue={(field, v) => (field.endsWith('Cents') && typeof v === 'number' ? (v / 100).toFixed(2) : field === 'accountId' ? accountName(v as string) : undefined)}
      />
    </div>
  );
}

interface Form {
  accountId: string | null;
  requestedDate: string;
  receivedDate: string;
  grossUsdCents: number | null;
  audReceivedCents: number | null;
  notes: string;
}

const toForm = (p: Payout | null): Form => ({
  accountId: p?.accountId ?? null,
  requestedDate: p?.requestedDate ?? '',
  receivedDate: p?.receivedDate ?? todayLocal(),
  grossUsdCents: p?.grossUsdCents ?? null,
  audReceivedCents: p?.audReceivedCents ?? null,
  notes: p?.notes ?? '',
});

function PayoutDialog({ payout, open, onClose, onHistory }: { payout: Payout | null; open: boolean; onClose: () => void; onHistory: (id: string) => void }) {
  const { data: accounts = [] } = useAccounts();
  const [form, setForm] = useState<Form>(() => toForm(payout));
  const draftId = useMemo(() => (open ? (payout?.id ?? newId()) : ''), [payout, open]);
  useEffect(() => {
    if (open) setForm(toForm(payout));
  }, [open, payout]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMoneyMutation(() => {
    const payload = { ...form, requestedDate: form.requestedDate || null, notes: form.notes || null };
    return payout ? api.patch(`/payouts/${payout.id}`, payload) : api.post('/payouts', { ...payload, id: draftId });
  });
  const remove = useMoneyMutation(() => api.delete(`/payouts/${payout!.id}`));
  const valid = form.receivedDate && form.audReceivedCents !== null && form.audReceivedCents > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={payout ? 'Edit payout' : 'Add payout'}
      footer={
        <>
          {payout && (
            <>
              <Button variant="ghost" onClick={() => onHistory(payout.id)}>
                <History size={16} aria-hidden /> History
              </Button>
              <Button
                variant="ghost"
                className="mr-auto text-loss"
                onClick={() => window.confirm('Delete this payout?') && remove.mutate(undefined, { onSuccess: onClose })}
              >
                Delete
              </Button>
            </>
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
        <Field label="Account" hint={accounts.length ? undefined : 'Add your prop firm accounts in Settings to link payouts to them.'}>
          <Select value={form.accountId ?? ''} onChange={(e) => set('accountId', e.target.value || null)}>
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received in bank">
            <Input type="date" value={form.receivedDate} onChange={(e) => set('receivedDate', e.target.value)} />
          </Field>
          <Field label="Requested" hint="Optional">
            <Input type="date" value={form.requestedDate} onChange={(e) => set('requestedDate', e.target.value)} />
          </Field>
          <Field label="Amount received (AUD)" hint="What arrived in your bank">
            <MoneyInput value={form.audReceivedCents} onChange={(v) => set('audReceivedCents', v)} />
          </Field>
          <Field label="Gross payout (USD)" hint="Optional, before conversion">
            <MoneyInput value={form.grossUsdCents} onChange={(v) => set('grossUsdCents', v)} prefix="US$" className="pl-10" />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div>
          <div className="mb-1 text-sm font-medium">Statement / remittance</div>
          {open && <AttachmentDropzone ownerType="payout" ownerId={draftId} role="statement" />}
        </div>
        {(save.error || remove.error) && <p className="text-sm text-loss">{(save.error ?? remove.error)?.message}</p>}
      </div>
    </Dialog>
  );
}
