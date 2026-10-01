import { formatLocal } from '@tc/domain';
import { HistoryDialog as EntityHistoryDialog } from '../../components/HistoryDialog';
import type { SessionType } from '../../lib/api';

const fieldLabels: Record<string, string> = { typeId: 'Type', start: 'Start', end: 'End', notes: 'Notes' };

export function HistoryDialog({ sessionId, onClose, types }: { sessionId: string | null; onClose: () => void; types: SessionType[] }) {
  return (
    <EntityHistoryDialog
      url={sessionId ? `/sessions/${sessionId}/history` : null}
      onClose={onClose}
      fieldLabels={fieldLabels}
      formatValue={(field, value) => {
        if (field === 'typeId') return types.find((t) => t.id === value)?.name;
        if ((field === 'start' || field === 'end') && typeof value === 'string') return formatLocal(value, 'ccc d LLL yyyy, HH:mm');
      }}
      describeCreate={(v) => ((v as { source?: string } | null)?.source === 'manual' ? 'Entered manually' : 'Recorded by timer')}
    />
  );
}
