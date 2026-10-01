import { gradeTone } from '../lib/journal';
import { cn } from './ui';

export function GradeBadge({ grade, outsidePlan, className }: { grade: string | null; outsidePlan?: boolean; className?: string }) {
  if (outsidePlan) return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium text-ember ring-1 ring-inset ring-ember', className)}>Outside plan</span>;
  if (!grade) return <span className="text-muted">—</span>;
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', gradeTone[grade], className)}>{grade}</span>;
}

/** Signed money with profit/loss colour. */
export function Pnl({ cents, className }: { cents: number; className?: string }) {
  const text = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', signDisplay: 'exceptZero' }).format(cents / 100);
  return <span className={cn('tabular', cents > 0 ? 'text-profit' : cents < 0 ? 'text-loss' : 'text-muted', className)}>{text}</span>;
}
