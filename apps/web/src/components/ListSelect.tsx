import { useQueryClient } from '@tanstack/react-query';
import { api, type ListItem, type ListKind } from '../lib/api';
import { useList } from '../lib/expenses';
import { Select } from './ui';

const NEW = '__new__';
const labels: Record<ListKind, string> = { expense_category: 'category', expense_type: 'type', payment_method: 'payment method' };

/** Select from an editable pick-list, with "Add new…" to create an item inline. */
export function ListSelect({ kind, value, onChange, id }: { kind: ListKind; value: string | null; onChange: (id: string | null) => void; id?: string }) {
  const qc = useQueryClient();
  const { data: items = [] } = useList(kind);
  const visible = items.filter((i) => !i.archived || i.id === value);

  return (
    <Select
      id={id}
      value={value ?? ''}
      onChange={async (e) => {
        if (e.target.value !== NEW) return onChange(e.target.value || null);
        const name = window.prompt(`New ${labels[kind]}`)?.trim();
        if (!name) return;
        const created = await api.post<ListItem>(`/lists/${kind}`, { name });
        await qc.invalidateQueries({ queryKey: ['lists', kind] });
        onChange(created.id);
      }}
    >
      <option value="">—</option>
      {visible.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
      <option value={NEW}>Add new {labels[kind]}…</option>
    </Select>
  );
}
