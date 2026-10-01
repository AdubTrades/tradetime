import { useQuery } from '@tanstack/react-query';
import { formatLocal } from '@tc/domain';
import { api, type AuditEntry } from '../lib/api';
import { Dialog } from './Dialog';

interface Props {
  /** e.g. `/sessions/<id>/history`; null closes the dialog. */
  url: string | null;
  onClose: () => void;
  fieldLabels: Record<string, string>;
  formatValue?: (field: string, value: unknown) => string | undefined;
  describeCreate?: (snapshot: unknown) => string;
}

/** Edit history of any audited record, oldest first. */
export function HistoryDialog({ url, onClose, fieldLabels, formatValue, describeCreate }: Props) {
  const { data: history = [], isLoading } = useQuery({ queryKey: ['history', url], queryFn: () => api.get<AuditEntry[]>(url!), enabled: !!url });

  const value = (field: string | null, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    return (field && formatValue?.(field, v)) ?? String(v);
  };
  const describe = (h: AuditEntry) => {
    switch (h.action) {
      case 'create':
        return describeCreate?.(h.newValue) ?? 'Created';
      case 'delete':
        return 'Deleted';
      case 'restore':
        return 'Restored';
      case 'update':
        return `${fieldLabels[h.field ?? ''] ?? h.field}: ${value(h.field, h.oldValue)} → ${value(h.field, h.newValue)}`;
    }
  };

  return (
    <Dialog open={!!url} onClose={onClose} title="Edit history">
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ol className="space-y-3">
          {history
            .filter((h) => h.action !== 'update' || (h.field ?? '') in fieldLabels)
            .map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
                <div className="text-xs text-muted">{formatLocal(h.at, 'ccc d LLL yyyy, HH:mm:ss')}</div>
                <div>{describe(h)}</div>
                {h.reason && <div className="text-muted">Reason: {h.reason}</div>}
              </li>
            ))}
        </ol>
      )}
    </Dialog>
  );
}
