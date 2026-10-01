import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatMoney, type ExpenseImportField, type ExpenseImportMapping, type ParsedExpenseRow } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { Button, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useMoneyMutation } from '../../lib/expenses';

type PreviewRow =
  | { line: number; status: 'ok' | 'duplicate'; value: ParsedExpenseRow; warnings: string[] }
  | { line: number; status: 'error'; errors: string[]; warnings: string[] };

interface Preview {
  headers: string[];
  mapping: ExpenseImportMapping;
  rows: PreviewRow[];
  counts: { ok: number; duplicate: number; error: number; blank: number };
}

interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  skippedErrors: number;
  newCategories: number;
  newTypes: number;
  newPaymentMethods: number;
}

const fields: { key: ExpenseImportField; label: string; required?: boolean; note?: string }[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'exGst', label: 'Amount ex GST', required: true },
  { key: 'gst', label: 'GST', note: 'Blank = $0.00' },
  { key: 'incGst', label: 'Amount inc GST', note: 'Only used to cross-check' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'type', label: 'Type' },
  { key: 'paymentMethod', label: 'Payment method' },
  { key: 'businessUsePct', label: 'Business use %', note: 'Blank = 100%' },
];

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<ExpenseImportMapping | undefined>();
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const preview = useMutation({
    mutationFn: (vars: { csv: string; mapping?: ExpenseImportMapping }) => api.post<Preview>('/expenses/import/preview', vars),
    onSuccess: (p) => setMapping(p.mapping),
  });
  const commit = useMoneyMutation(() => api.post<ImportResult>('/expenses/import', { csv, mapping, includeDuplicates }));

  const reset = () => {
    setCsv(null);
    setFileName('');
    setMapping(undefined);
    setResult(null);
    setIncludeDuplicates(false);
    preview.reset();
    commit.reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    preview.mutate({ csv: text });
  };

  const updateMapping = (key: ExpenseImportField, header: string) => {
    const next = { ...mapping, [key]: header || undefined };
    setMapping(next);
    if (csv) preview.mutate({ csv, mapping: next });
  };

  const p = preview.data;
  const importCount = p ? p.counts.ok + (includeDuplicates ? p.counts.duplicate : 0) : 0;
  const missingRequired = fields.filter((f) => f.required && f.key !== 'name' && !mapping?.[f.key]);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import expenses from CSV"
      width="max-w-4xl"
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!p || importCount === 0 || missingRequired.length > 0 || commit.isPending || preview.isPending}
              onClick={() => commit.mutate(undefined, { onSuccess: setResult })}
            >
              Import {importCount} expense{importCount === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 text-base font-medium">
            <CheckCircle2 className="text-profit" size={20} aria-hidden /> Imported {result.imported} expenses
          </p>
          {result.skippedDuplicates > 0 && <p className="text-muted">Skipped {result.skippedDuplicates} duplicates.</p>}
          {result.skippedErrors > 0 && <p className="text-muted">Skipped {result.skippedErrors} rows with errors.</p>}
          {result.newCategories + result.newTypes + result.newPaymentMethods > 0 && (
            <p className="text-muted">
              Added {result.newCategories} categories, {result.newTypes} types and {result.newPaymentMethods} payment methods from the file. You can
              rename or archive them in Settings.
            </p>
          )}
          <p className="text-muted">Receipts can be attached by opening each expense.</p>
        </div>
      ) : !csv ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Export your existing expenses as CSV (in Notion: ••• → Export → Markdown & CSV) and choose the file. Columns are matched automatically and you
            can adjust them before anything is imported. Amounts inc GST are recalculated as ex GST + GST.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-10 text-muted hover:border-muted"
          >
            <FileUp size={24} aria-hidden />
            Choose a CSV file
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <p className="text-muted">
            {fileName} · {p ? `${p.rows.length} rows` : 'reading…'}
            {p && p.counts.blank > 0 && ` (${p.counts.blank} blank rows ignored)`}
          </p>
          {preview.error && <p className="text-loss">{preview.error.message}</p>}
          {p && (
            <>
              <section>
                <h3 className="mb-2 font-medium">Columns</h3>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {fields.map((f) => (
                    <label key={f.key} className="flex items-center gap-3">
                      <span className="w-36 shrink-0">
                        {f.label}
                        {f.required && <span className="text-loss"> *</span>}
                      </span>
                      <Select value={mapping?.[f.key] ?? ''} onChange={(e) => updateMapping(f.key, e.target.value)}>
                        <option value="">{f.note ? `— (${f.note})` : '—'}</option>
                        {p.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
                {missingRequired.length > 0 && <p className="mt-2 text-loss">Choose a column for: {missingRequired.map((f) => f.label).join(', ')}</p>}
              </section>

              <section>
                <h3 className="mb-2 font-medium">
                  Preview · <span className="text-profit">{p.counts.ok} ready</span>
                  {p.counts.duplicate > 0 && <span className="text-warn"> · {p.counts.duplicate} already imported</span>}
                  {p.counts.error > 0 && <span className="text-loss"> · {p.counts.error} with errors</span>}
                </h3>
                {p.counts.duplicate > 0 && (
                  <label className="mb-2 flex items-center gap-2 text-muted">
                    <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
                    Import duplicates too (same date, name and amount as an existing expense)
                  </label>
                )}
                <div className="max-h-80 overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-surface-2">
                      <tr>
                        {['Row', 'Date', 'Name', 'Category', 'ex GST', 'GST', 'inc GST', ''].map((h) => (
                          <th key={h} className="px-2 py-1.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {p.rows.map((r) =>
                        r.status === 'error' ? (
                          <tr key={r.line} className="bg-loss/5">
                            <td className="px-2 py-1.5 text-muted">{r.line}</td>
                            <td colSpan={7} className="px-2 py-1.5 text-loss">
                              {r.errors.join(' · ')}
                            </td>
                          </tr>
                        ) : (
                          <tr key={r.line} className={r.status === 'duplicate' ? 'opacity-60' : ''}>
                            <td className="px-2 py-1.5 text-muted">{r.line}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{r.value.date}</td>
                            <td className="px-2 py-1.5">{r.value.name}</td>
                            <td className="px-2 py-1.5">{r.value.category}</td>
                            <td className="tabular px-2 py-1.5 text-right">{formatMoney(r.value.exGstCents)}</td>
                            <td className="tabular px-2 py-1.5 text-right">{formatMoney(r.value.gstCents)}</td>
                            <td className="tabular px-2 py-1.5 text-right">{formatMoney(r.value.incGstCents)}</td>
                            <td className="px-2 py-1.5">
                              {r.status === 'duplicate' && <span className="text-warn">Duplicate</span>}
                              {r.warnings.length > 0 && (
                                <span className="inline-flex items-center gap-1 text-warn" title={r.warnings.join('\n')}>
                                  <AlertTriangle size={12} aria-hidden /> {r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings`}
                                </span>
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {commit.error && <p className="text-loss">{commit.error.message}</p>}
          <Button variant="ghost" onClick={reset}>
            Choose a different file
          </Button>
        </div>
      )}
    </Dialog>
  );
}
