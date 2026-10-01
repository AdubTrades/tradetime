import { formatLocal } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import type { AuditEntry, SessionType } from '../../lib/api';
import { useSessionHistory } from '../../lib/sessions';

const fieldLabels: Record<string, string> = { typeId: 'Type', start: 'Start', end: 'End', notes: 'Notes' };

function describeValue(field: string | null, value: unknown, types: SessionType[]): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'typeId') return types.find((t) => t.id === value)?.name ?? String(value);
  if ((field === 'start' || field === 'end') && typeof value === 'string') return formatLocal(value, 'ccc d LLL yyyy, HH:mm');
  return String(value);
}

function describe(entry: AuditEntry, types: SessionType[]): string {
  switch (entry.action) {
    case 'create': {
      const v = entry.newValue as { source?: string } | null;
      return v?.source === 'manual' ? 'Entered manually' : 'Recorded by timer';
    }
    case 'delete':
      return 'Deleted';
    case 'restore':
      return 'Restored';
    case 'update':
      return `${fieldLabels[entry.field ?? ''] ?? entry.field}: ${describeValue(entry.field, entry.oldValue, types)} → ${describeValue(entry.field, entry.newValue, types)}`;
  }
}

export function HistoryDialog({ sessionId, onClose, types }: { sessionId: string | null; onClose: () => void; types: SessionType[] }) {
  const { data: history = [], isLoading } = useSessionHistory(sessionId);
  return (
    <Dialog open={!!sessionId} onClose={onClose} title="Edit history">
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ol className="space-y-3">
          {history.map((h) => (
            <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
              <div className="text-xs text-muted">{formatLocal(h.at, 'ccc d LLL yyyy, HH:mm:ss')}</div>
              <div>{describe(h, types)}</div>
              {h.reason && <div className="text-muted">Reason: {h.reason}</div>}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
