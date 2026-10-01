import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Input } from '../../components/ui';
import { api, type ListItem, type ListKind, type Settings } from '../../lib/api';
import { useList } from '../../lib/expenses';
import { useUpdateSettings } from '../../lib/settings';

export function ExpenseSettings({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  return (
    <Card title="Expenses and tax">
      <div className="space-y-6">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={settings.gstRegistered} onChange={(e) => update.mutate({ gstRegistered: e.target.checked })} />
          <span>
            <span className="font-medium">Registered for GST</span>
            <span className="block text-muted">
              When on, claimable amounts are ex GST and GST is shown as a credit. When off, the full inc-GST amount is claimable. Check with your
              accountant.
            </span>
          </span>
        </label>
        <div className="grid gap-6 lg:grid-cols-3">
          <ListEditor kind="expense_category" title="Categories" singular="category" />
          <ListEditor kind="expense_type" title="Types" singular="type" />
          <ListEditor kind="payment_method" title="Payment methods" singular="payment method" />
        </div>
      </div>
    </Card>
  );
}

function ListEditor({ kind, title, singular }: { kind: ListKind; title: string; singular: string }) {
  const qc = useQueryClient();
  const { data: items = [] } = useList(kind);
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['lists', kind] });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: Partial<ListItem> & { id: string }) => api.patch(`/lists/item/${id}`, body),
    onSettled: refresh,
  });
  const create = useMutation({
    mutationFn: (n: string) => api.post(`/lists/${kind}`, { name: n }),
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });

  return (
    <div>
      <div className="mb-2 text-sm font-medium">{title}</div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.length === 0 && <li className="px-3 py-2 text-sm text-muted">None yet — importing a CSV adds them.</li>}
        {items.map((i) => (
          <li key={i.id} className={`flex items-center gap-2 px-2 py-1.5 text-sm ${i.archived ? 'opacity-50' : ''}`}>
            <Input
              key={i.name}
              defaultValue={i.name}
              aria-label="Name"
              className="border-transparent bg-transparent"
              onBlur={(e) => e.target.value.trim() && e.target.value !== i.name && patch.mutate({ id: i.id, name: e.target.value })}
            />
            <Button variant="ghost" className="shrink-0 px-2 text-xs" onClick={() => patch.mutate({ id: i.id, archived: !i.archived })}>
              {i.archived ? 'Restore' : 'Archive'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${singular}`} />
        <Button type="submit" aria-label={`Add ${singular}`} disabled={!name.trim()}>
          <Plus size={16} />
        </Button>
      </form>
      {(patch.error || create.error) && <p className="mt-1 text-xs text-loss">{(patch.error ?? create.error)?.message}</p>}
    </div>
  );
}
