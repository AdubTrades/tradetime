import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { api, type Settings, type SessionType } from '../../lib/api';
import { useSessionTypes } from '../../lib/sessions';
import { useUpdateSettings } from '../../lib/settings';

export function TimeLogSettings({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  return (
    <Card title="Time log">
      <div className="space-y-6">
        <Field label="Ask “still going?” after" hint="You get a notification and a prompt on the timer when a session runs this long.">
          <Select className="w-48" value={settings.longSessionHours} onChange={(e) => update.mutate({ longSessionHours: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6, 8, 10, 12].map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </Select>
        </Field>
        <SessionTypesEditor />
      </div>
    </Card>
  );
}

function SessionTypesEditor() {
  const qc = useQueryClient();
  const { data: types = [] } = useSessionTypes();
  const [newName, setNewName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['session-types'] });

  const patch = useMutation({
    mutationFn: ({ id, ...body }: Partial<SessionType> & { id: string }) => api.patch<SessionType>(`/session-types/${id}`, body),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: (name: string) => api.post<SessionType>('/session-types', { name }),
    onSuccess: () => {
      setNewName('');
      void refresh();
    },
  });

  const move = (index: number, delta: -1 | 1) => {
    const other = types[index + delta];
    const current = types[index];
    if (!other || !current) return;
    patch.mutate({ id: current.id, sortOrder: other.sortOrder });
    patch.mutate({ id: other.id, sortOrder: current.sortOrder });
  };

  return (
    <div>
      <div className="mb-2 text-sm font-medium">Session types</div>
      <p className="mb-3 text-xs text-muted">All types count as business hours. Trading types get the session-start checklist and check-ins.</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {types.map((t, i) => (
          <li key={t.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${t.archived ? 'opacity-50' : ''}`}>
            <input
              type="color"
              aria-label={`Colour for ${t.name}`}
              value={t.color}
              onChange={(e) => patch.mutate({ id: t.id, color: e.target.value })}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <Input
              defaultValue={t.name}
              aria-label="Name"
              className="max-w-56"
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patch.mutate({ id: t.id, name: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={t.isTrading} onChange={(e) => patch.mutate({ id: t.id, isTrading: e.target.checked })} />
              Trading
            </label>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" className="px-2" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </Button>
              <Button variant="ghost" className="px-2" aria-label="Move down" disabled={i === types.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </Button>
              <Button variant="ghost" onClick={() => patch.mutate({ id: t.id, archived: !t.archived })}>
                {t.archived ? 'Restore' : 'Archive'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate(newName.trim());
        }}
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New session type" className="max-w-56" />
        <Button type="submit" disabled={!newName.trim() || create.isPending}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </form>
      {(patch.error || create.error) && <p className="mt-2 text-sm text-loss">{(patch.error ?? create.error)?.message}</p>}
    </div>
  );
}
