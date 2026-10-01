import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { claimable, formatMoney } from '@tc/domain';
import { ReportHeader } from '../../components/ReportHeader';
import { api, type Expense, type Payout } from '../../lib/api';
import { useExpenseLookups, useFySummary } from '../../lib/expenses';

/** Print-friendly FY report of expenses and payouts. "Save as PDF" from the print dialog makes the PDF. */
export function ExpensesReport({ fy }: { fy: number }) {
  const { data: summary } = useFySummary(fy);
  const { data: expenses } = useQuery({ queryKey: ['expenses', fy], queryFn: () => api.get<Expense[]>(`/expenses?fy=${fy}`) });
  const { data: payouts } = useQuery({ queryKey: ['payouts', fy], queryFn: () => api.get<Payout[]>(`/payouts?fy=${fy}`) });
  const lookups = useExpenseLookups();
  if (!summary || !expenses || !payouts) return null;

  const { fy: year, gstRegistered } = summary;
  const t = summary.expenses.total;
  const th = 'border-b border-black/30 py-1 pr-3 text-left font-semibold';
  const td = 'border-b border-black/10 py-1 pr-3 align-top';
  const num = 'text-right tabular-nums';
  const sorted = [...expenses].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="mx-auto max-w-5xl bg-white p-8 text-[12px] text-black print:p-0">
      <ReportHeader
        title={`Business expenses and income — FY ${year.label}`}
        subtitle={`${DateTime.fromISO(year.start).toFormat('d LLLL yyyy')} to ${DateTime.fromISO(year.end).toFormat('d LLLL yyyy')} · amounts in AUD · ${gstRegistered ? 'registered for GST' : 'not registered for GST'}`}
      />
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          ['Payouts received', formatMoney(summary.payouts.audReceivedCents)],
          ['Expenses inc GST', formatMoney(t.incGstCents)],
          ['Claimable expenses', formatMoney(t.deductibleCents)],
          [gstRegistered ? 'GST credits' : 'GST paid', formatMoney(gstRegistered ? t.gstCreditCents : t.gstCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-black/20 p-3">
            <div className="text-black/60">{label}</div>
            <div className="text-lg font-bold">{value}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-1 text-sm font-bold">Expenses by category</h2>
      <table className="mb-6 w-full">
        <thead>
          <tr>
            <th className={th}>Category</th>
            <th className={`${th} ${num}`}>Count</th>
            <th className={`${th} ${num}`}>ex GST</th>
            <th className={`${th} ${num}`}>GST</th>
            <th className={`${th} ${num}`}>inc GST</th>
            <th className={`${th} ${num}`}>Claimable</th>
          </tr>
        </thead>
        <tbody>
          {summary.expenses.byCategory.map((c) => (
            <tr key={c.categoryId ?? 'none'}>
              <td className={td}>{c.name}</td>
              <td className={`${td} ${num}`}>{c.count}</td>
              <td className={`${td} ${num}`}>{formatMoney(c.exGstCents)}</td>
              <td className={`${td} ${num}`}>{formatMoney(c.gstCents)}</td>
              <td className={`${td} ${num}`}>{formatMoney(c.incGstCents)}</td>
              <td className={`${td} ${num}`}>{formatMoney(c.deductibleCents)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={td}>Total</td>
            <td className={`${td} ${num}`}>{t.count}</td>
            <td className={`${td} ${num}`}>{formatMoney(t.exGstCents)}</td>
            <td className={`${td} ${num}`}>{formatMoney(t.gstCents)}</td>
            <td className={`${td} ${num}`}>{formatMoney(t.incGstCents)}</td>
            <td className={`${td} ${num}`}>{formatMoney(t.deductibleCents)}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mb-1 text-sm font-bold">Payouts</h2>
      <table className="mb-6 w-full">
        <thead>
          <tr>
            <th className={th}>Received</th>
            <th className={th}>Account</th>
            <th className={`${th} ${num}`}>Gross (USD)</th>
            <th className={`${th} ${num}`}>Received (AUD)</th>
            <th className={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {[...payouts].reverse().map((p) => (
            <tr key={p.id}>
              <td className={td}>{DateTime.fromISO(p.receivedDate).toFormat('d LLL yyyy')}</td>
              <td className={td}>{lookups.name(p.accountId) || '—'}</td>
              <td className={`${td} ${num}`}>{p.grossUsdCents == null ? '—' : formatMoney(p.grossUsdCents, 'USD')}</td>
              <td className={`${td} ${num}`}>{formatMoney(p.audReceivedCents)}</td>
              <td className={td}>{p.notes}</td>
            </tr>
          ))}
          {payouts.length === 0 && (
            <tr>
              <td className={td} colSpan={5}>
                None
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-1 text-sm font-bold">All expenses</h2>
      <table className="w-full">
        <thead>
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Name</th>
            <th className={th}>Vendor</th>
            <th className={th}>Category</th>
            <th className={`${th} ${num}`}>ex GST</th>
            <th className={`${th} ${num}`}>GST</th>
            <th className={`${th} ${num}`}>inc GST</th>
            <th className={`${th} ${num}`}>Bus. %</th>
            <th className={`${th} ${num}`}>Claimable</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.id} className="break-inside-avoid">
              <td className={`${td} whitespace-nowrap`}>{DateTime.fromISO(e.date).toFormat('d LLL yyyy')}</td>
              <td className={td}>{e.name}</td>
              <td className={td}>{e.vendor}</td>
              <td className={td}>{lookups.name(e.categoryId)}</td>
              <td className={`${td} ${num}`}>{formatMoney(e.exGstCents)}</td>
              <td className={`${td} ${num}`}>{formatMoney(e.gstCents)}</td>
              <td className={`${td} ${num}`}>{formatMoney(e.incGstCents)}</td>
              <td className={`${td} ${num}`}>{e.businessUsePct}%</td>
              <td className={`${td} ${num}`}>{formatMoney(claimable(e, gstRegistered).deductibleCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-black/60">
        Claimable = {gstRegistered ? 'amount ex GST' : 'amount inc GST'} × business-use %. Receipts are stored with each expense in TradeTime.
      </p>
    </div>
  );
}
