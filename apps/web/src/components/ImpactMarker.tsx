import { Zap } from 'lucide-react';
import { cn } from './ui';

/**
 * Marker for an economic release: a filled red lightning bolt for high impact (FinancialJuice-style),
 * an orange dot for medium. `onDark` uses the brighter red for the dark panels.
 */
export function ImpactMarker({ impact, onDark = false, size = 13, className }: { impact: string; onDark?: boolean; size?: number; className?: string }) {
  if (impact === 'high') {
    return (
      <Zap
        size={size}
        strokeWidth={1.5}
        className={cn('shrink-0', onDark ? 'fill-impact-dark text-impact-dark' : 'fill-impact text-impact', className)}
        role="img"
        aria-label="High impact"
      />
    );
  }
  const dot = Math.max(6, Math.round(size * 0.55));
  return <span className={cn('inline-block shrink-0 rounded-full bg-medium', className)} style={{ width: dot, height: dot }} role="img" aria-label="Medium impact" />;
}
