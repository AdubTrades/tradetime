import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatMoney } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { MoneyInput } from '../../components/MoneyInput';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { api, type Account, type AccountStatus, type AccountType, type Firm } from '../../lib/api';
import { useAccounts, useFirms } from '../../lib/expenses';

const typeLabels: Record<AccountType, string> = { evaluation: 'Evaluation', funded: 'Funded', live: 'Live', sim: 'Sim' };
const statusLabels: Record<AccountStatus, string> = { active: 'Active', passed: 'Passed', failed: 'Failed', closed: 'Closed' };

export function AccountSettings() {
  const { data: accounts = [] } = useAccounts();
  const { data: firms = [] } = useFirms();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const firmName = (id: string | null) => firms.find((f) => f.id === id)?.name;

  return (
    <Card title="Trading accounts" description="Prop firm and broker accounts. Trades, payouts and fees are recorded against them.">
      <ul className="divide-y divide-border rounded-md border border-border">
        {accounts.length === 0 && <li className="px-3 py-3 text-sm text-muted">No accounts yet.</li>}
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="font-medium">{a.name}</span>
            <span className="text-muted">{[firmName(a.firmId), typeLabels[a.type]].filter(Boolean).join(' · ')}</span>
            {a.startingBalanceCents != null && <span className="tabular text-muted">{formatMoney(a.startingBalanceCents, 'USD')}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'active' ? 'bg-text text-card' : 'bg-card text-muted ring-1 ring-inset ring-border'}`}>
              {statusLabels[a.status]}
            </span>
            <Button variant="ghost" className="ml-auto px-2" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
              <Pencil size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-3" onClick={() => setEditing('new')}>
        <Plus size={16} aria-hidden /> Add account
      </Button>
      <AccountDialog account={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} firms={firms} />
    </Card>
  );
}

interface Form {
  name: string;
  firmId: string | null;
  type: AccountType;
  status: AccountStatus;
  startDate: string;
  endDate: string;
  startingBalanceCents: number | null;
  notes: string;
}

const toForm = (a: Account | null, firms: Firm[]): Form => ({
  name: a?.name ?? '',
  firmId: a?.firmId ?? firms[0]?.id ?? null,
  type: a?.type ?? 'evaluation',
  status: a?.status ?? 'active',
  startDate: a?.startDate ?? '',
  endDate: a?.endDate ?? '',
  startingBalanceCents: a?.startingBalanceCents ?? null,
  notes: a?.notes ?? '',
});

function AccountDialog({ account, open, onClose, firms }: { account: Account | null; open: boolean; onClose: () => void; firms: Firm[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(account, firms));
  // Reset only when the dialog opens: adding a firm mid-edit must not wipe what's been typed.
  useEffect(() => {
    if (open) setForm(toForm(account, firms));
  }, [open, account]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, startDate: form.startDate || null, endDate: form.endDate || null, notes: form.notes || null };
      return account ? api.patch(`/accounts/${account.id}`, payload) : api.post('/accounts', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
  });

  const addFirm = async () => {
    const name = window.prompt('Firm name (e.g. Lucid Trading)')?.trim();
    if (!name) return;
    const firm = await api.post<Firm>('/firms', { name });
    await qc.invalidateQueries({ queryKey: ['firms'] });
    set('firmId', firm.id);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? 'Edit account' : 'Add account'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Lucid 50K Flex #1" autoFocus />
          </Field>
          <Field label="Firm">
            <div className="flex gap-2">
              <Select value={form.firmId ?? ''} onChange={(e) => set('firmId', e.target.value || null)}>
                <option value="">—</option>
                {firms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Button aria-label="Add firm" onClick={addFirm}>
                <Plus size={16} />
              </Button>
            </div>
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => set('type', e.target.value as AccountType)}>
              {Object.entries(typeLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value as AccountStatus)}>
              {Object.entries(statusLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
          <Field label="Starting balance (USD)">
            <MoneyInput value={form.startingBalanceCents} onChange={(v) => set('startingBalanceCents', v)} prefix="US$" className="pl-10" />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {save.error && <p className="text-sm text-loss">{save.error.message}</p>}
      </div>
    </Dialog>
  );
}
