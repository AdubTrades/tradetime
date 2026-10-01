import { Link } from '@tanstack/react-router';
import { Download, Printer } from 'lucide-react';
import { formatMoney } from '@tc/domain';
import { useFySummary } from '../../lib/expenses';

const linkClass = 'inline-flex items-center gap-2 font-display rounded-none border border-text/80 px-3.5 py-1.5 text-sm hover:bg-surface';

export function SummaryTab({ fy }: { fy: number }) {
  const { data: s } = useFySummary(fy);
  if (!s) return null;
  const t = s.expenses.total;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Expenses inc GST" value={formatMoney(t.incGstCents)} sub={`${t.count} expenses`} />
        <Tile label="Claimable" value={formatMoney(t.deductibleCents)} sub={s.gstRegistered ? 'ex GST × business use' : 'inc GST × business use'} />
        {s.gstRegistered ? <Tile label="GST credits" value={formatMoney(t.gstCreditCents)} /> : <Tile label="GST paid" value={formatMoney(t.gstCents)} />}
        <Tile label="Payouts received" value={formatMoney(s.payouts.audReceivedCents)} sub={`${s.payouts.count} payouts`} />
      </div>

      <section className="panel">
        <h2 className="border-b border-border px-4 py-3">By category</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Count</th>
              <th className="px-4 py-2 text-right font-medium">ex GST</th>
              <th className="px-4 py-2 text-right font-medium">GST</th>
              <th className="px-4 py-2 text-right font-medium">inc GST</th>
              <th className="px-4 py-2 text-right font-medium">Claimable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {s.expenses.byCategory.map((c) => (
              <tr key={c.categoryId ?? 'none'}>
                <td className="px-4 py-2">{c.name}</td>
                <td className="tabular px-4 py-2 text-right">{c.count}</td>
                <td className="tabular px-4 py-2 text-right">{formatMoney(c.exGstCents)}</td>
                <td className="tabular px-4 py-2 text-right">{formatMoney(c.gstCents)}</td>
                <td className="tabular px-4 py-2 text-right">{formatMoney(c.incGstCents)}</td>
                <td className="tabular px-4 py-2 text-right font-medium">{formatMoney(c.deductibleCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border font-semibold">
            <tr>
              <td className="px-4 py-2">Total</td>
              <td className="tabular px-4 py-2 text-right">{t.count}</td>
              <td className="tabular px-4 py-2 text-right">{formatMoney(t.exGstCents)}</td>
              <td className="tabular px-4 py-2 text-right">{formatMoney(t.gstCents)}</td>
              <td className="tabular px-4 py-2 text-right">{formatMoney(t.incGstCents)}</td>
              <td className="tabular px-4 py-2 text-right">{formatMoney(t.deductibleCents)}</td>
            </tr>
          </tfoot>
        </table>
        {s.expenses.byCategory.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No expenses in FY {s.fy.label}.</p>}
      </section>

      <div className="flex flex-wrap items-center gap-2 panel p-4 text-sm">
        <span className="mr-auto font-medium">Records for your accountant · FY {s.fy.label}</span>
        <a href={`/api/expenses/export.csv?fy=${fy}`} className={linkClass}>
          <Download size={16} aria-hidden /> Expenses CSV
        </a>
        <a href={`/api/payouts/export.csv?fy=${fy}`} className={linkClass}>
          <Download size={16} aria-hidden /> Payouts CSV
        </a>
        <Link to="/expenses/report" search={{ fy }} target="_blank" className={linkClass}>
          <Printer size={16} aria-hidden /> Printable report (PDF)
        </Link>
      </div>
      <p className="text-xs text-muted">
        Claimable amounts follow the GST setting in Settings and each expense's business-use %. Confirm what you can claim with your accountant.
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular font-display mt-1 text-[28px] leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
