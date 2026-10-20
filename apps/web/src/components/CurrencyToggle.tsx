import { usePnlCurrency, type PnlCurrency } from '../lib/pnlCurrency';
import { useSettings, useUpdateSettings } from '../lib/settings';
import { cn } from './ui';

const options: PnlCurrency[] = ['USD', 'AUD'];

/**
 * A small inline USD · AUD switch for the Home dashboard, read as part of "After fees, in …". Trades are stored in USD;
 * AUD converts each day's P&L at that day's ECB rate. While the rates load, or if they can't be fetched, it says so
 * (the card keeps showing USD).
 */
export function CurrencyToggle() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { chosen, status } = usePnlCurrency();
  if (!settings) return null;
  return (
    <>
      <span role="group" aria-label="Show P&L in" className="inline-flex items-center">
        {options.map((c, i) => (
          <span key={c} className="inline-flex items-center">
            {i > 0 && (
              <span className="px-1 text-faint" aria-hidden>
                ·
              </span>
            )}
            <button
              type="button"
              aria-pressed={chosen === c}
              onClick={() => chosen !== c && update.mutate({ pnlCurrency: c })}
              className={cn(
                'rounded-sm text-[13px] transition-colors pointer-coarse:px-1 pointer-coarse:py-1.5',
                chosen === c ? 'font-medium text-text' : 'text-faint hover:text-secondary',
              )}
            >
              {c}
            </button>
          </span>
        ))}
      </span>
      {chosen === 'AUD' && status !== 'ready' && (
        <span role="status" className={status === 'error' ? 'text-warning' : 'text-faint'}>
          {status === 'loading' ? '(getting rates…)' : '(couldn’t get rates, showing USD)'}
        </span>
      )}
    </>
  );
}
