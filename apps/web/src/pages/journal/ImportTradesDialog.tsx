import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatLocal } from '@tc/domain';
import { Dialog } from '../../components/Dialog';
import { Pnl } from '../../components/GradeBadge';
import { Button, Field, Input, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useAccounts } from '../../lib/expenses';
import { useJournalMutation } from '../../lib/journal';

type Format = 'ninjatrader-executions' | 'tradovate-performance' | 'generic';
type ColumnKey = 'time' | 'date' | 'side' | 'qty' | 'price' | 'symbol' | 'account' | 'id' | 'commission';

interface Preview {
  headers: string[];
  format: Format;
  mapping: Partial<Record<ColumnKey, string>>;
  zone: string;
  dateOrder: 'dmy' | 'mdy';
  detectedOrder: 'dmy' | 'mdy' | null;
  missing: string[];
  accountsInFile: { name: string; accountId: string | null; saved: boolean }[];
  trades: {
    key: string;
    tradingDay: string;
    symbol: string;
    direction: string;
    openedAt: string;
    accounts: { name: string; accountId: string | null; maxQty: number; fills: number; netCents: number | null }[];
    netCents: number | null;
    status: 'new' | 'attach' | 'error';
    issues: string[];
  }[];
  counts: { rows: number; executions: number; duplicates: number; open: number; issues: number };
  rowIssues: { line: number; message: string }[];
}

interface Result {
  created: number;
  attached: number;
  skipped: number;
  failed: { when: string; message: string }[];
  duplicates: number;
  open: number;
}

const formatLabels: Record<Format, string> = {
  'ninjatrader-executions': 'NinjaTrader 8 — Executions',
  'tradovate-performance': 'Tradovate — Performance report',
  generic: 'Other (choose the columns)',
};
const fieldLabels: { key: ColumnKey; label: string; required?: boolean }[] = [
  { key: 'time', label: 'Time (or date and time)', required: true },
  { key: 'date', label: 'Date, if separate' },
  { key: 'side', label: 'Buy/sell', required: true },
  { key: 'qty', label: 'Quantity', required: true },
  { key: 'price', label: 'Price', required: true },
  { key: 'symbol', label: 'Contract', required: true },
  { key: 'account', label: 'Account' },
  { key: 'id', label: 'Fill/execution id' },
  { key: 'commission', label: 'Commission' },
];
const zones = [
  { id: 'Australia/Perth', label: 'Perth (AWST)' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Chicago', label: 'Chicago (exchange time)' },
  { id: 'UTC', label: 'UTC' },
];

/** Import fills from a NinjaTrader (or Tradovate) export, preview the trades they make, and save them. */
export function ImportTradesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: accounts = [] } = useAccounts();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [opts, setOpts] = useState<{
    format?: Format;
    mapping?: Partial<Record<ColumnKey, string>>;
    zone: string;
    dateOrder?: 'dmy' | 'mdy';
    defaultAccount?: string;
    accountMap: Record<string, string>;
    attachToLogged: boolean;
  }>({ zone: 'Australia/Perth', accountMap: {}, attachToLogged: true });
  const [result, setResult] = useState<Result | null>(null);

  const preview = useMutation({
    mutationFn: (vars: { csv: string; o: typeof opts }) => api.post<Preview>('/trade-import/preview', { csv: vars.csv, ...vars.o }),
    onSuccess: (p) =>
      setOpts((o) => ({
        ...o,
        format: o.format ?? p.format,
        dateOrder: o.dateOrder ?? p.dateOrder,
        // Keep saved/guessed account matches as the starting point.
        accountMap: { ...Object.fromEntries(p.accountsInFile.filter((a) => a.accountId).map((a) => [a.name, a.accountId!])), ...o.accountMap },
      })),
  });
  const commit = useJournalMutation(() => api.post<Result>('/trade-import/commit', { csv, ...opts }));

  const refresh = (next: Partial<typeof opts>) => {
    const o = { ...opts, ...next };
    setOpts(o);
    if (csv) preview.mutate({ csv, o });
  };
  const reset = () => {
    setCsv(null);
    setFileName('');
    setOpts({ zone: 'Australia/Perth', accountMap: {}, attachToLogged: true });
    setResult(null);
    preview.reset();
    commit.reset();
  };
  const close = () => {
    reset();
    onClose();
  };
  const load = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    preview.mutate({ csv: text, o: opts });
  };

  const p = preview.data;
  const ready = p?.trades.filter((t) => t.status !== 'error') ?? [];
  const noAccountColumn = p && p.accountsInFile.length === 1 && p.accountsInFile[0]!.name === '' ;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import trades"
      width="max-w-5xl"
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
            <Button variant="primary" disabled={!p || ready.length === 0 || commit.isPending || preview.isPending} onClick={() => commit.mutate(undefined, { onSuccess: setResult })}>
              Import {ready.length} trade{ready.length === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 text-base">
            <CheckCircle2 className="text-ember" size={20} aria-hidden /> Imported {result.created} new trade{result.created === 1 ? '' : 's'}
            {result.attached > 0 && `, and added broker fills to ${result.attached} trade${result.attached === 1 ? '' : 's'} you logged live`}
          </p>
          {result.created > 0 && <p className="text-muted">New trades are marked “Needs review”: add the Play, checklist and notes from the Journal.</p>}
          {result.duplicates > 0 && <p className="text-muted">{result.duplicates} fills were already imported and were skipped.</p>}
          {result.open > 0 && <p className="text-muted">{result.open} fills belong to a trade still open at the end of the file; they'll come in with your next export.</p>}
          {result.failed.map((f) => (
            <p key={f.when} className="text-loss">
              {formatLocal(f.when, 'd LLL HH:mm')}: {f.message}
            </p>
          ))}
        </div>
      ) : !csv ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border-subtle bg-inset p-4">
            <p className="font-medium">From NinjaTrader 8</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted">
              <li>Control Center → New → Trade Performance.</li>
              <li>Choose your Lucid accounts and the date range, then Generate.</li>
              <li>Open the Executions tab, right-click the grid → Export → save as CSV.</li>
            </ol>
            <p className="mt-2 text-muted">Exports that overlap are fine: fills already imported are skipped.</p>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed border-border-strong/60 bg-card px-4 py-10 text-muted hover:border-border-strong"
          >
            <FileUp size={24} aria-hidden /> Choose the exported CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => load(e.target.files?.[0])} />
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <p className="text-muted">
            {fileName}
            {p && ` · ${p.counts.rows} rows · ${p.counts.executions} fills`}
            {p && p.counts.duplicates > 0 && ` · ${p.counts.duplicates} already imported`}
          </p>
          {preview.error && <p className="text-loss">{preview.error.message}</p>}
          {p && (
            <>
              <section className="grid gap-4 sm:grid-cols-3">
                <Field label="Format">
                  <Select value={opts.format ?? p.format} onChange={(e) => refresh({ format: e.target.value as Format })}>
                    {Object.entries(formatLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Times in the file are" hint="NinjaTrader uses your computer's time zone">
                  <Select value={opts.zone} onChange={(e) => refresh({ zone: e.target.value })}>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Dates are written" hint={p.detectedOrder ? 'Detected from the file' : "Couldn't tell from the file — please check"}>
                  <Select value={opts.dateOrder ?? p.dateOrder} onChange={(e) => refresh({ dateOrder: e.target.value as 'dmy' | 'mdy' })}>
                    <option value="dmy">Day/month (30/09/2026)</option>
                    <option value="mdy">Month/day (09/30/2026)</option>
                  </Select>
                </Field>
              </section>

              {(opts.format ?? p.format) === 'generic' && (
                <section>
                  <h3 className="mb-2 text-[13px] font-semibold text-text">Columns</h3>
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                    {fieldLabels.map((f) => (
                      <label key={f.key} className="flex items-center gap-2">
                        <span className="w-32 shrink-0">
                          {f.label}
                          {f.required && <span className="text-loss"> *</span>}
                        </span>
                        <Select value={(opts.mapping ?? p.mapping)[f.key] ?? ''} onChange={(e) => refresh({ mapping: { ...(opts.mapping ?? p.mapping), [f.key]: e.target.value || undefined } })}>
                          <option value="">—</option>
                          {p.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ))}
                  </div>
                  {p.missing.length > 0 && <p className="mt-2 text-loss">Choose a column for: {p.missing.join(', ')}</p>}
                </section>
              )}

              {noAccountColumn && (
                <Field label="This file has no account column — which account is it for?">
                  <Input value={opts.defaultAccount ?? ''} onChange={(e) => refresh({ defaultAccount: e.target.value })} placeholder="e.g. your account id" />
                </Field>
              )}

              {p.accountsInFile.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[13px] font-semibold text-text">Accounts</h3>
                  {accounts.length === 0 && <p className="mb-2 text-loss">Add your trading accounts in Settings first.</p>}
                  <div className="space-y-2">
                    {p.accountsInFile.map((a) => (
                      <div key={a.name} className="flex flex-wrap items-center gap-3">
                        <span className="tabular w-40 truncate font-medium">{a.name || '(no account)'}</span>
                        <span className="text-muted">→</span>
                        <Select
                          className="w-64"
                          value={opts.accountMap[a.name] ?? ''}
                          onChange={(e) => refresh({ accountMap: { ...opts.accountMap, [a.name]: e.target.value } })}
                        >
                          <option value="">Choose a TradeTime account…</option>
                          {accounts.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                          <option value="skip">Don't import this account</option>
                        </Select>
                        {a.saved && <span className="text-xs text-muted">remembered</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[13px] font-semibold text-text">
                    Trades found · {ready.length} ready
                    {p.trades.length - ready.length > 0 && <span className="text-loss"> · {p.trades.length - ready.length} need attention</span>}
                  </h3>
                  <label className="flex items-center gap-2 text-muted">
                    <input type="checkbox" checked={opts.attachToLogged} onChange={(e) => refresh({ attachToLogged: e.target.checked })} />
                    Add fills to trades I already logged at the same time
                  </label>
                </div>
                <div className="max-h-80 overflow-auto border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-inset">
                      <tr>
                        {['Entry', 'Contract', 'Side', 'Accounts', 'Net', ''].map((h) => (
                          <th key={h} className="px-2 py-1.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {p.trades.map((t) => (
                        <tr key={t.key} className={t.status === 'error' ? 'bg-loss/5' : ''}>
                          <td className="tabular px-2 py-1.5 whitespace-nowrap">{formatLocal(t.openedAt, 'ccc d LLL HH:mm:ss')}</td>
                          <td className="px-2 py-1.5">{t.symbol}</td>
                          <td className="px-2 py-1.5 capitalize">{t.direction}</td>
                          <td className="px-2 py-1.5">{t.accounts.map((a) => `${a.name || '—'} (${a.maxQty})`).join(', ')}</td>
                          <td className="px-2 py-1.5 text-right">{t.netCents === null ? '—' : <Pnl cents={t.netCents} />}</td>
                          <td className="px-2 py-1.5">
                            {t.status === 'attach' && <span className="text-ember">Adds to your logged trade</span>}
                            {t.status === 'error' && (
                              <span className="inline-flex items-center gap-1 text-loss">
                                <AlertTriangle size={12} aria-hidden /> {t.issues[0]}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {p.trades.length === 0 && <p className="p-4 text-center text-muted">{p.counts.duplicates ? 'Everything in this file has already been imported.' : 'No complete trades found.'}</p>}
                </div>
                {p.counts.open > 0 && <p className="mt-2 text-xs text-muted">{p.counts.open} fills belong to a trade that's still open at the end of the file; they'll import with your next export.</p>}
                {p.rowIssues.length > 0 && (
                  <details className="mt-2 text-xs text-muted">
                    <summary>{p.counts.issues} rows couldn't be read</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {p.rowIssues.map((r) => (
                        <li key={r.line}>
                          Row {r.line}: {r.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
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
