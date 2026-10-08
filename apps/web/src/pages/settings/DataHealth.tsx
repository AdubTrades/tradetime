import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import { api } from '../../lib/api';

interface Health {
  checks: { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }[];
  dbBytes?: number;
}

const icon = { ok: <CheckCircle2 size={16} className="text-text" />, warn: <AlertTriangle size={16} className="text-warning" />, fail: <XCircle size={16} className="text-loss" /> };

export function DataHealth() {
  const { data, refetch, isFetching } = useQuery({ queryKey: ['data-health'], queryFn: () => api.get<Health>('/health/data') });
  return (
    <Card title="Data health" description="A quick check that your records, links and files are all intact.">
      <ul className="space-y-2 text-sm">
        {data?.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <span className="mt-0.5">{icon[c.status]}</span>
            <span>
              <span className="font-medium">{c.label}</span> <span className="text-muted">— {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{data?.dbBytes != null && `Database size ${(data.dbBytes / 1024 / 1024).toFixed(1)} MB`}</span>
        <Button variant="ghost" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw size={14} aria-hidden className={isFetching ? 'animate-spin' : ''} /> Check again
        </Button>
      </div>
    </Card>
  );
}
