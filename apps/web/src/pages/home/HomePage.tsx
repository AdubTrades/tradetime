import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { currentZone, financialYear, financialYearOf, tradingDay } from '@tc/domain';
import { SessionTimer } from '../../components/SessionTimer';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useHealth } from '../../lib/demo';
import { useTrades } from '../../lib/journal';
import { useNow, useSessionTypes } from '../../lib/sessions';
import { PnlCurrencyProvider } from '../../lib/pnlCurrency';
import { useSettings } from '../../lib/settings';
import { EventDialog } from '../calendar/EventDialog';
import { ExpenseDialog } from '../expenses/ExpenseDialog';
import { TradeForm } from '../journal/TradeForm';
import { BusinessCard } from './BusinessCard';
import { DisciplineCard } from './DisciplineCard';
import { PerformanceCard } from './PerformanceCard';
import { RecentTradesCard } from './RecentTradesCard';
import { TodoCard } from './TodoCard';
import { TonightCard } from './TonightCard';
import { usePnlReveal } from './usePnlReveal';

/** Landing page: performance and tonight's agenda, then summaries that link through to each tab. The session timer sits in the header. */
/** The USD / AUD choice applies to the Home dashboard only; every other screen shows P&L in USD. */
export function HomePage() {
  return (
    <PnlCurrencyProvider>
      <HomeDashboard />
    </PnlCurrencyProvider>
  );
}

function HomeDashboard() {
  const { data: settings } = useSettings();
  const now = useNow(30_000);
  const today = tradingDay(now, settings?.rolloverTime);
  const fy = financialYear(financialYearOf(today).startYear);
  const { data: trades = [] } = useTrades(fy.start, fy.end);
  const { data: types = [] } = useSessionTypes();
  const [revealed, setRevealed] = usePnlReveal(settings?.homeHidePnl ?? true, today);
  const [dialog, setDialog] = useState<'trade' | 'expense' | 'event' | null>(null);
  if (!settings) return null;

  const local = DateTime.fromJSDate(now).setZone(currentZone());
  const greeting = local.hour < 12 ? 'Good morning' : local.hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = settings.reportName?.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="mb-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-sm text-muted">
            {local.toFormat('cccc d LLLL')}
            {today !== local.toISODate() && ` · trading day ${DateTime.fromISO(today).toFormat('ccc d LLL')}`}
          </p>
          <h1 className="text-[32px] leading-tight">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        {/* One row on a phone: Log trades and the timer controls share the same height and edges. */}
        <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
          <Button variant="primary" className="h-11 shrink-0 px-[18px]" onClick={() => setDialog('trade')}>
            Log trades
          </Button>
          <SessionTimer types={types} longSessionHours={settings.longSessionHours} layout="compact" />
        </div>
      </header>

      <Alerts />

      <div className="flex flex-wrap gap-6">
        <PerformanceCard trades={trades} today={today} fyLabel={fy.label} revealed={revealed} onReveal={setRevealed} canHide={settings.homeHidePnl} />
        <TonightCard now={now} today={today} types={types} trades={trades} revealed={revealed} onAdd={() => setDialog('event')} />
      </div>

      <div className="flex flex-wrap gap-6">
        <RecentTradesCard trades={trades} revealed={revealed} />
        <DisciplineCard trades={trades} today={today} />
      </div>

      <div className="flex flex-wrap gap-6">
        <BusinessCard fyStartYear={fy.startYear} today={today} onAdd={() => setDialog('expense')} />
        <TodoCard today={today} />
      </div>

      <TradeForm open={dialog === 'trade'} onClose={() => setDialog(null)} defaults={{ tradingDay: today }} />
      <ExpenseDialog open={dialog === 'expense'} expense={null} onClose={() => setDialog(null)} onHistory={() => undefined} onMakeRecurring={() => undefined} />
      <EventDialog open={dialog === 'event'} onClose={() => setDialog(null)} defaultDate={today} />
    </div>
  );
}

// Only shown when something needs attention.
function Alerts() {
  const { data: settings } = useSettings();
  const { data: appHealth } = useHealth();
  const { data: backup } = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => api.get<{ lastSuccessAt: string | null; lastError: string | null }>('/backup/status'),
    // The hosted version has no file backups to warn about.
    enabled: appHealth !== undefined && !appHealth.cloud,
  });
  const { data: health } = useQuery({
    queryKey: ['data-health'],
    queryFn: () => api.get<{ checks: { id: string; status: string; detail: string }[] }>('/health/data'),
  });
  const items: { text: string; to: string }[] = [];
  if (backup?.lastError) items.push({ text: `The last backup failed: ${backup.lastError}`, to: '/settings' });
  else if (backup && (!backup.lastSuccessAt || Date.now() - Date.parse(backup.lastSuccessAt) > 72 * 3_600_000))
    items.push({ text: 'No backup in the last 3 days', to: '/settings' });
  for (const c of health?.checks ?? []) if (c.status === 'fail' || (c.id === 'timer' && c.status === 'warn')) items.push({ text: c.detail, to: c.id === 'timer' ? '/time-log' : '/settings' });
  if (settings && !settings.fredApiKey && !appHealth?.fredConfigured) items.push({ text: 'Add your FRED API key to see economic events', to: '/settings' });
  // The demo copy has no backups or FRED key by design, so its alerts would only confuse.
  if (items.length === 0 || appHealth?.demo) return null;
  return (
    <ul className="-mt-2 space-y-1.5">
      {items.map((i) => (
        <li key={i.text}>
          <Link to={i.to} className="flex min-h-11 items-center gap-2.5 rounded-md border border-border bg-card px-4 text-sm hover:bg-hover">
            <AlertTriangle size={15} className="shrink-0 text-warning" aria-hidden />
            <span className="flex-1">{i.text}</span>
            <ArrowRight size={14} className="text-faint" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
