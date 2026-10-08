import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Button, Card } from '../../components/ui';
import { downloadMyData, importIntoAccount, readExport, type ImportPreview } from '../../lib/accountData';
import { inDemo } from '../../lib/demoSession';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Download everything in your account as a zip, or replace the account with one (moving across, or restoring). */
export function DataSettings() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const demo = inDemo();

  const run = async (fn: () => Promise<string>) => {
    setNote(null);
    setBusy('Working…');
    try {
      setNote({ tone: 'ok', text: await fn() });
    } catch (err) {
      setNote({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const download = () =>
    run(async () => {
      const { files, missing } = await downloadMyData(setBusy);
      return `Downloaded, with ${plural(files, 'file')}.${missing ? ` ${plural(missing, 'file')} couldn’t be fetched and ${missing === 1 ? 'is' : 'are'} listed in manifest.json.` : ''}`;
    });

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setNote(null);
    try {
      setPreview(await readExport(file));
    } catch (err) {
      setNote({ tone: 'error', text: (err as Error).message });
    }
  };

  const confirmImport = (p: ImportPreview) =>
    run(async () => {
      setPreview(null);
      await importIntoAccount(p, setBusy);
      qc.clear();
      await qc.invalidateQueries();
      return 'Imported. Everything in your account now comes from the export.';
    });

  return (
    <Card title="Your data" description="Download everything in your account (records, screenshots and receipts) as a zip, or bring an export into this account.">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!!busy} onClick={() => void download()}>
          <Download size={16} aria-hidden /> Download my data
        </Button>
        {!demo && (
          <Button disabled={!!busy} onClick={() => input.current?.click()}>
            <Upload size={16} aria-hidden /> Import an export…
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {busy && <span className="text-sm text-muted">{busy}</span>}
      </div>

      {preview && (
        <div role="alertdialog" aria-labelledby="import-title" className="mt-4 rounded-md border border-warning/40 bg-inset p-4 text-sm">
          <p id="import-title" className="font-medium">
            Replace everything in this account?
          </p>
          <p className="mt-1 text-muted">
            The export from {DateTime.fromISO(preview.data.exportedAt).toFormat('d LLL yyyy, HH:mm')} has {plural(preview.counts.trades, 'trade')},{' '}
            {plural(preview.counts.sessions, 'session')}, {plural(preview.counts.expenses, 'expense')} and {plural(preview.counts.files, 'file')}. Importing
            deletes what’s in this account now and puts the export in its place, including its settings and lists. Download your data first if you might
            want it back.
          </p>
          {preview.missingFiles > 0 && <p className="mt-2 text-warning">{plural(preview.missingFiles, 'file')} in the export’s records aren’t in the zip and will show as missing.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void confirmImport(preview)}>
              Replace with the export
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {note && <p className={`mt-3 text-sm ${note.tone === 'error' ? 'text-loss' : 'text-muted'}`}>{note.text}</p>}
      {demo && <p className="mt-3 text-xs text-muted">Importing is switched off in the demo.</p>}
    </Card>
  );
}
