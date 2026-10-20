import { moneyText, usePnlCurrency, type PnlCurrency } from '../lib/pnlCurrency';
import { cn } from './ui';

/** Grade pill: A+ filled near-black, A filled dark grey, B+ and below white with a border. Outside plan in orange. */
export function GradeBadge({ grade, outsidePlan, className }: { grade: string | null; outsidePlan?: boolean; className?: string }) {
  const base = 'inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-full px-2 text-xs font-semibold whitespace-nowrap';
  if (outsidePlan) return <span className={cn(base, 'border border-ember text-warning', className)}>Outside plan</span>;
  if (!grade) return <span className="text-faint">—</span>;
  const style =
    grade === 'A+'
      ? { background: 'var(--grade-a-plus-bg)', color: 'var(--grade-a-plus-fg)' }
      : grade === 'A'
        ? { background: 'var(--grade-a-bg)', color: 'var(--grade-a-fg)' }
        : { background: 'var(--grade-b-bg)', color: 'var(--grade-b-fg)', border: '1px solid var(--grade-b-border)' };
  return (
    <span className={cn(base, className)} style={style}>
      {grade}
    </span>
  );
}

/** Signed money with P&L colour, always showing the sign (+$322.14, -$33.98). */
export function Pnl({
  cents,
  day,
  className,
  onDark = false,
  currency,
}: {
  cents: number;
  /** Marks `cents` as stored USD for this trading day, to be shown in the app's currency (AUD when chosen). */
  day?: string;
  className?: string;
  onDark?: boolean;
  /** Forces a currency for an amount that is already in it, e.g. the USD figures in the trade form. */
  currency?: PnlCurrency;
}) {
  const app = usePnlCurrency();
  const shown = currency ?? app.currency;
  const amount = day !== undefined && currency === undefined ? app.toDisplay(cents, day) : cents;
  const text = moneyText(amount, shown, app.currency, { sign: true });
  return (
    <span className={cn('tabular-nums', amount > 0 ? (onDark ? 'text-profit-dark' : 'text-profit') : amount < 0 ? 'text-loss' : onDark ? 'text-dark-muted' : 'text-muted', className)}>
      {text}
    </span>
  );
}
