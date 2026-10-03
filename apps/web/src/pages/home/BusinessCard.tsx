import { Link } from '@tanstack/react-router';
import { ChevronRight, Clock, Percent, Receipt, Wallet, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { durationMinutes, financialYear, formatDuration, formatMoney, weekStart } from '@tc/domain';
import { CardHeader, cn, ViewLink } from '../../components/ui';
import { useExpenses, useFySummary } from '../../lib/expenses';
import { useSessions } from '../../lib/sessions';

function Row({ to, icon: Icon, label, sub, value, valueClass }: { to: string; icon: LucideIcon; label: string; sub: ReactNode; value: ReactNode; valueClass?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md bg-inset py-3 pr-3 pl-3.5 text-text hover:bg-nav-active">
      <Icon size={18} strokeWidth={1.6} className="shrink-0 text-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{sub}</span>
      </span>
      <span className={cn('text-[15px] font-medium whitespace-nowrap', valueClass)}>{value}</span>
      <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
    </Link>
  );
}

export function BusinessCard({ fyStartYear, today }: { fyStartYear: number; today: string }) {
  const fy = financialYear(fyStartYear);
  const { data: summary } = useFySummary(fyStartYear);
  const { data: expenses = [] } = useExpenses(fyStartYear);
  const { data: sessions = [] } = useSessions(fy.start, fy.end);
  const hours = sessions.reduce((s, x) => s + durationMinutes(x), 0);
  const week = weekStart(today);
  const weekHours = sessions.filter((s) => s.tradingDay >= week && s.tradingDay <= today).reduce((s, x) => s + durationMinutes(x), 0);
  const withGst = expenses.filter((e) => e.gstCents > 0).length;
  const t = summary?.expenses.total;

  return (
    <section aria-labelledby="bz-h" className="card flex min-w-0 flex-[1_1_280px] flex-col gap-4 p-6">
      <CardHeader id="bz-h" title="Business" description={`FY ${fy.label}, in AUD`} action={<ViewLink to="/expenses">Expenses</ViewLink>} />
      <div className="-mt-5 flex flex-col gap-2">
        <Row to="/expenses" icon={Receipt} label="Expenses" sub={`${t?.count ?? 0} expense${t?.count === 1 ? '' : 's'}, inc GST`} value={formatMoney(t?.incGstCents ?? 0)} />
        <Row
          to="/expenses"
          icon={Wallet}
          label="Claimable"
          sub={summary?.gstRegistered ? 'Ex GST, after business-use %' : 'After business-use %'}
          value={formatMoney(t?.deductibleCents ?? 0)}
          valueClass="text-profit"
        />
        <Row to="/expenses" icon={Percent} label="GST paid" sub={`Across ${withGst} expense${withGst === 1 ? '' : 's'}`} value={formatMoney(t?.gstCents ?? 0)} />
        <Row to="/time-log" icon={Clock} label="Hours logged" sub={`${formatDuration(weekHours)} this week`} value={formatDuration(hours)} />
      </div>
    </section>
  );
}
