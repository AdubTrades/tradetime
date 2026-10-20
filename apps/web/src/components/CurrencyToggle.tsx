import { useSettings, useUpdateSettings } from '../lib/settings';
import { usePnlCurrency, type PnlCurrency } from '../lib/pnlCurrency';
import { SegmentedTabs } from './ui';

const options: { value: PnlCurrency; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'AUD', label: 'AUD' },
];

/**
 * Chooses the currency P&L is shown in across the app. Trades are stored in USD; AUD converts each day's P&L at that
 * day's ECB rate. Says so while it works, and if the rates can't be fetched (the app then keeps showing USD).
 */
export function CurrencyToggle({ className }: { className?: string }) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { chosen, status } = usePnlCurrency();
  if (!settings) return null;
  return (
    <div className={className}>
      <SegmentedTabs label="P&L currency" value={chosen} onChange={(pnlCurrency) => update.mutate({ pnlCurrency })} options={options} />
      {chosen === 'AUD' && (
        <p className={status === 'error' ? 'mt-1 text-xs text-warning' : 'mt-1 text-xs text-faint'} role="status">
          {status === 'loading' ? 'Getting AUD rates…' : status === 'error' ? 'Couldn’t get AUD rates, so this is showing USD' : 'At each trading day’s ECB rate'}
        </p>
      )}
    </div>
  );
}
