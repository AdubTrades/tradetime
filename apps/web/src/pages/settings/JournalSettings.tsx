import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatMoney } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { MoneyInput } from '../../components/MoneyInput';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { api, type AccountGroup, type Contract } from '../../lib/api';
import { useAccounts } from '../../lib/expenses';
import { useAccountGroups, useContracts } from '../../lib/journal';
import { ListEditor } from './ExpenseSettings';

export function JournalSettings() {
  return (
    <Card title="Journal">
      <div className="space-y-8">
        <ContractsEditor />
        <AccountGroupsEditor />
        <div className="grid gap-6 lg:grid-cols-2">
          <ListEditor kind="mood" title="Moods / emotional states" singular="mood" />
          <ListEditor kind="mistake" title="Mistake tags" singular="mistake" />
        </div>
      </div>
    </Card>
  );
}

function ContractsEditor() {
  const qc = useQueryClient();
  const { data: contracts = [] } = useContracts();
  const [editing, setEditing] = useState<Contract | 'new' | null>(null);
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Contracts</div>
      <p className="mb-2 text-xs text-muted">P&L is calculated from point value. Fee per side prefills trade fees (commission + exchange fees per contract, each way).</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1 font-medium">Symbol</th>
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 text-right font-medium">Tick</th>
            <th className="py-1 text-right font-medium">$ / point</th>
            <th className="py-1 text-right font-medium">$ / tick</th>
            <th className="py-1 text-right font-medium">Fee / side</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {contracts.map((c) => (
            <tr key={c.id} className={c.archived ? 'opacity-50' : ''}>
              <td className="py-1.5 font-medium">{c.symbol}</td>
              <td className="py-1.5 text-muted">{c.name}</td>
              <td className="tabular py-1.5 text-right">{c.tickSize}</td>
              <td className="tabular py-1.5 text-right">{formatMoney(c.pointValueCents, 'USD')}</td>
              <td className="tabular py-1.5 text-right">{formatMoney(Math.round(c.pointValueCents * c.tickSize), 'USD')}</td>
              <td className="tabular py-1.5 text-right">{formatMoney(c.feePerSideCents, 'USD')}</td>
              <td className="py-1.5 text-right">
                <Button variant="ghost" className="px-2" aria-label={`Edit ${c.symbol}`} onClick={() => setEditing(c)}>
                  <Pencil size={14} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button className="mt-2" onClick={() => setEditing('new')}>
        <Plus size={16} aria-hidden /> Add contract
      </Button>
      <ContractDialog contract={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['contracts'] })} />
    </div>
  );
}

function ContractDialog({ contract, open, onClose, onSaved }: { contract: Contract | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ symbol: '', name: '', tickSize: '0.25', pointValueCents: null as number | null, feePerSideCents: 0 as number | null, archived: false });
  useEffect(() => {
    if (open)
      setForm(
        contract
          ? { symbol: contract.symbol, name: contract.name, tickSize: String(contract.tickSize), pointValueCents: contract.pointValueCents, feePerSideCents: contract.feePerSideCents, archived: contract.archived }
          : { symbol: '', name: '', tickSize: '0.25', pointValueCents: null, feePerSideCents: 0, archived: false },
      );
  }, [open, contract]);
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, tickSize: Number(form.tickSize), feePerSideCents: form.feePerSideCents ?? 0 };
      return contract ? api.patch(`/contracts/${contract.id}`, payload) : api.post('/contracts', payload);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const valid = form.symbol.trim() && form.name.trim() && Number(form.tickSize) > 0 && form.pointValueCents;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={contract ? `Edit ${contract.symbol}` : 'Add contract'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Symbol">
          <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="RTY" />
        </Field>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="E-mini Russell 2000" />
        </Field>
        <Field label="Tick size (points)">
          <Input inputMode="decimal" value={form.tickSize} onChange={(e) => setForm({ ...form, tickSize: e.target.value })} />
        </Field>
        <Field label="Value of 1 point (USD)">
          <MoneyInput value={form.pointValueCents} onChange={(v) => setForm({ ...form, pointValueCents: v })} prefix="US$" className="pl-10" />
        </Field>
        <Field label="Fee per contract per side (USD)" hint="Commission + exchange/clearing fees">
          <MoneyInput value={form.feePerSideCents} onChange={(v) => setForm({ ...form, feePerSideCents: v })} prefix="US$" className="pl-10" />
        </Field>
        {contract && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} /> Archived
          </label>
        )}
      </div>
      {contract && <p className="mt-3 text-xs text-muted">Changes apply to new and edited trades. Saved trades keep the spec they were logged with.</p>}
      {save.error && <p className="mt-2 text-sm text-loss">{save.error.message}</p>}
    </Dialog>
  );
}

function AccountGroupsEditor() {
  const { data: groups = [] } = useAccountGroups();
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<AccountGroup | 'new' | null>(null);
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Account groups (copy trading)</div>
      <p className="mb-2 text-xs text-muted">Accounts you trade together. Pick a group when logging and each account gets the trade at its size multiplier.</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {groups.length === 0 && <li className="px-3 py-2 text-sm text-muted">No groups yet.</li>}
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="font-medium">{g.name}</span>
            <span className="text-muted">{g.members.map((m) => `${name(m.accountId)} ×${m.multiplier}`).join(', ')}</span>
            <Button variant="ghost" className="ml-auto px-2" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
              <Pencil size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-2" disabled={accounts.length === 0} onClick={() => setEditing('new')}>
        <Plus size={16} aria-hidden /> Add group
      </Button>
      <GroupDialog group={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  );
}

function GroupDialog({ group, open, onClose }: { group: AccountGroup | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<{ accountId: string; multiplier: number }[]>([]);
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setMembers(group?.members ?? []);
  }, [open, group]);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['account-groups'] });
    onClose();
  };
  const save = useMutation({ mutationFn: () => (group ? api.put(`/account-groups/${group.id}`, { name, members }) : api.post('/account-groups', { name, members })), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.delete(`/account-groups/${group!.id}`), onSuccess: done });
  const unused = accounts.filter((a) => !members.some((m) => m.accountId === a.id));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={group ? 'Edit account group' : 'Add account group'}
      footer={
        <>
          {group && (
            <Button variant="ghost" className="mr-auto text-loss" onClick={() => window.confirm('Delete this group? Trades are not affected.') && remove.mutate()}>
              <Trash2 size={16} aria-hidden /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || members.length === 0 || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Group name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucid funded ×3" />
        </Field>
        <div className="space-y-2">
          {members.map((m, i) => (
            <div key={m.accountId} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{accounts.find((a) => a.id === m.accountId)?.name}</span>
              <Select
                aria-label="Size multiplier"
                className="w-24"
                value={m.multiplier}
                onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, multiplier: Number(e.target.value) } : x)))}
              >
                {[1, 2, 3, 4, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    ×{n}
                  </option>
                ))}
              </Select>
              <Button variant="ghost" className="px-2" aria-label="Remove" onClick={() => setMembers(members.filter((_, j) => j !== i))}>
                <X size={14} />
              </Button>
            </div>
          ))}
          {unused.length > 0 && (
            <Select value="" onChange={(e) => e.target.value && setMembers([...members, { accountId: e.target.value, multiplier: 1 }])}>
              <option value="">+ Add account…</option>
              {unused.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        {(save.error || remove.error) && <p className="text-sm text-loss">{(save.error ?? remove.error)?.message}</p>}
      </div>
    </Dialog>
  );
}
