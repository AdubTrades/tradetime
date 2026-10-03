import { useMutation, useQuery } from '@tanstack/react-query';
import { RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatLocal } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';

interface BackupFile {
  name: string;
  path: string;
  folder: 'backup' | 'local' | 'upload';
  bytes: number;
  modifiedAt: string;
}
interface Inspection {
  path: string;
  createdAt: string | null;
  integrity: string;
  counts: { trades: number; sessions: number; expenses: number; payouts: number; attachments: number };
  latestActivity: string | null;
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const folderLabel = { backup: 'Backup folder', local: 'This Mac', upload: 'Uploaded' };

/** Check a backup's contents and restore it. Restoring saves a safety copy first, then restarts the app. */
export function RestoreBackup() {
  const { data: backups = [] } = useQuery({ queryKey: ['backup-list'], queryFn: () => api.get<BackupFile[]>('/backup/list') });
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'restarting' | 'done' | 'manual'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);

  const inspect = useMutation({ mutationFn: (path: string) => api.post<Inspection>('/backup/inspect', { path }), onSuccess: setInspection });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<Inspection>('/backup/upload', form);
    },
    onSuccess: setInspection,
  });
  const restore = useMutation({
    mutationFn: async () => {
      const before = (await api.get<{ startedAt: string }>('/health')).startedAt;
      await api.post('/backup/restore', { path: inspection!.path, confirm: 'RESTORE' });
      setPhase('restarting');
      // Wait for the app to come back up with the restored data.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const h = await api.get<{ startedAt: string }>('/health').catch(() => null);
        if (h && h.startedAt !== before) {
          setPhase('done');
          setTimeout(() => window.location.reload(), 1500);
          return;
        }
      }
      setPhase('manual');
    },
  });

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Restore from a backup</div>
          <p className="text-xs text-muted">Check what's in a backup first. Restoring replaces all current data; a safety copy of the current data is saved first.</p>
        </div>
        <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          <Upload size={16} aria-hidden /> {upload.isPending ? 'Reading…' : 'Use a file…'}
        </Button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
      </div>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {backups.length === 0 && <li className="px-3 py-3 text-sm text-muted">No backups found yet.</li>}
        {backups.map((b) => (
          <li key={b.path} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="font-medium">{formatLocal(b.modifiedAt, 'ccc d LLL yyyy, HH:mm')}</span>
            <span className="text-xs text-muted">
              {folderLabel[b.folder]} · {size(b.bytes)}
              {b.name.includes('pre-restore') && ' · safety copy before a restore'}
            </span>
            <Button variant="ghost" className="ml-auto text-xs" disabled={inspect.isPending} onClick={() => inspect.mutate(b.path)}>
              <ShieldCheck size={14} aria-hidden /> Check
            </Button>
          </li>
        ))}
      </ul>
      {(inspect.error || upload.error) && <p className="text-sm text-loss">{(inspect.error ?? upload.error)?.message}</p>}

      {inspection && (
        <div className="rounded-lg border border-border-subtle bg-inset p-4 text-sm">
          <p className="font-medium">
            Backup checked: database intact
            {inspection.createdAt && <span className="font-normal text-muted"> · made {formatLocal(inspection.createdAt, 'ccc d LLL yyyy, HH:mm')}</span>}
          </p>
          <p className="mt-1 text-muted">
            {inspection.counts.trades} trades · {inspection.counts.sessions} sessions · {inspection.counts.expenses} expenses · {inspection.counts.payouts} payouts ·{' '}
            {inspection.counts.attachments} attachments
            {inspection.latestActivity && ` · latest entry ${inspection.latestActivity}`}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                setUnderstood(false);
                setConfirming(true);
              }}
            >
              <RotateCcw size={16} aria-hidden /> Restore this backup…
            </Button>
            <Button variant="ghost" onClick={() => setInspection(null)}>
              Close
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={confirming}
        onClose={() => phase === 'idle' && setConfirming(false)}
        title="Restore this backup?"
        footer={
          phase === 'idle' ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!understood || restore.isPending} onClick={() => restore.mutate()}>
                Restore and restart
              </Button>
            </>
          ) : undefined
        }
      >
        {phase === 'idle' && inspection && (
          <div className="space-y-3 text-sm">
            <p>All current trades, sessions, expenses, payouts, settings and journal entries will be replaced by the backup's contents.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>A zipped safety copy of your current data is saved to this Mac first (listed above as "safety copy before a restore").</li>
              <li>Screenshots and receipts are merged, so nothing in your attachments folder is deleted.</li>
              <li>The app restarts to finish. This page reloads automatically.</li>
            </ul>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>I understand my current data will be replaced by this backup.</span>
            </label>
            {restore.error && <p className="text-loss">{restore.error.message}</p>}
          </div>
        )}
        {phase === 'restarting' && <p className="text-sm">Restoring and restarting… this takes a few seconds.</p>}
        {phase === 'done' && <p className="text-sm">Restored. Reloading…</p>}
        {phase === 'manual' && (
          <p className="text-sm">
            The backup is staged. The app didn't restart by itself (it does when installed with the install script). Restart it to finish, then refresh
            this page.
          </p>
        )}
      </Dialog>
    </div>
  );
}
