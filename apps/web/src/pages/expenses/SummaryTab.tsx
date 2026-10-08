import { Link } from '@tanstack/react-router';
import { Download, Printer } from 'lucide-react';
import { formatMoney } from '@tc/domain';
import { buttonClass, CategoryPill, SummaryStrip } from '../../components/ui';
import { useFySummary } from '../../lib/expenses';

export function SummaryTab({ fy }: { fy: number }) {
  const { data: s } = useFySummary(fy);
  if (!s) return null;
  const t = s.expenses.total;

  return (
    <div className="flex flex-col gap-5">
      <SummaryStrip
        items={[
          { label: 'Expenses inc GST', value: formatMoney(t.incGstCents), sub: `${t.count} expense${t.count === 1 ? '' : 's'}` },
          { label: 'Claimable', value: <span className="text-profit">{formatMoney(t.deductibleCents)}</span>, sub: s.gstRegistered ? 'ex GST × business use' : 'inc GST × business use' },
          s.gstRegistered ? { label: 'GST credits', value: formatMoney(t.gstCreditCents) } : { label: 'GST paid', value: formatMoney(t.gstCents) },
          { label: 'Payouts received', value: formatMoney(s.payouts.audReceivedCents), sub: `${s.payouts.count} payout${s.payouts.count === 1 ? '' : 's'}` },
        ]}
      />

      <section className="card overflow-x-auto">
        <h2 className="border-b border-border-subtle px-5 py-3.5 text-base font-semibold">By category</h2>
        <table className="w-full text-sm sm:min-w-[560px]">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-5 py-2.5 font-medium">Category</th>
              <th className="px-5 py-2.5 text-right font-medium">Count</th>
              <th className="hidden px-5 py-2.5 text-right font-medium sm:table-cell">ex GST</th>
              <th className="hidden px-5 py-2.5 text-right font-medium sm:table-cell">GST</th>
              <th className="px-5 py-2.5 text-right font-medium">inc GST</th>
              <th className="px-5 py-2.5 text-right font-medium">Claimable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {s.expenses.byCategory.map((c) => (
              <tr key={c.categoryId ?? 'none'}>
                <td className="px-5 py-2.5">{c.categoryId ? <CategoryPill name={c.name} /> : <span className="text-muted">{c.name}</span>}</td>
                <td className="tabular px-5 py-2.5 text-right">{c.count}</td>
                <td className="tabular hidden px-5 py-2.5 text-right sm:table-cell">{formatMoney(c.exGstCents)}</td>
                <td className="tabular hidden px-5 py-2.5 text-right sm:table-cell">{formatMoney(c.gstCents)}</td>
                <td className="tabular px-5 py-2.5 text-right">{formatMoney(c.incGstCents)}</td>
                <td className="tabular px-5 py-2.5 text-right font-medium">{formatMoney(c.deductibleCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border font-semibold">
            <tr>
              <td className="px-5 py-2.5">Total</td>
              <td className="tabular px-5 py-2.5 text-right">{t.count}</td>
              <td className="tabular hidden px-5 py-2.5 text-right sm:table-cell">{formatMoney(t.exGstCents)}</td>
              <td className="tabular hidden px-5 py-2.5 text-right sm:table-cell">{formatMoney(t.gstCents)}</td>
              <td className="tabular px-5 py-2.5 text-right">{formatMoney(t.incGstCents)}</td>
              <td className="tabular px-5 py-2.5 text-right">{formatMoney(t.deductibleCents)}</td>
            </tr>
          </tfoot>
        </table>
        {s.expenses.byCategory.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No expenses in FY {s.fy.label}.</p>}
      </section>

      <section aria-labelledby="exp-acc-h" className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 id="exp-acc-h" className="text-base font-semibold tracking-[-0.015em]">
            Records for your accountant
          </h2>
          <p className="mt-1 text-[13px] text-muted">Expenses and payouts for FY {s.fy.label}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/expenses/export.csv?fy=${fy}`} className={buttonClass('secondary')}>
            <Download size={15} aria-hidden /> Expenses CSV
          </a>
          <a href={`/api/payouts/export.csv?fy=${fy}`} className={buttonClass('secondary')}>
            <Download size={15} aria-hidden /> Payouts CSV
          </a>
          <Link to="/expenses/report" search={{ fy }} target="_blank" className={buttonClass('primary')}>
            <Printer size={15} aria-hidden /> PDF report
          </Link>
        </div>
      </section>
      <p className="text-xs text-muted">
        Claimable amounts follow the GST setting in Settings and each expense's business-use %. Confirm what you can claim with your accountant.
      </p>
    </div>
  );
}
