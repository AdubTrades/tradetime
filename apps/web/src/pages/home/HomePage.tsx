import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { financialYear, financialYearOf, LOCAL_ZONE, tradingDay } from '@tc/domain';
import { MenuButton } from '../../components/Menu';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useHealth } from '../../lib/demo';
import { useTrades } from '../../lib/journal';
import { useNow, useSessionTypes } from '../../lib/sessions';
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

/** Landing page: tonight's agenda and timer, then summaries that link through to each tab. */
export function HomePage() {
  const { data: settings } = useSettings();
  const now = useNow(30_000);
  const today = tradingDay(now, settings?.rolloverTime);
  const fy = financialYear(financialYearOf(today).startYear);
  const { data: trades = [] } = useTrades(fy.start, fy.end);
  const { data: types = [] } = useSessionTypes();
  const [revealed, setRevealed] = usePnlReveal(settings?.homeHidePnl ?? true, today);
  const [dialog, setDialog] = useState<'trade' | 'expense' | 'event' | null>(null);
  if (!settings) return null;

  const local = DateTime.fromJSDate(now).setZone(LOCAL_ZONE);
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
        <div className="flex items-center gap-2">
          <MenuButton
            label="Add"
            items={[
              { label: 'Event', onSelect: () => setDialog('event') },
              { label: 'Expense', onSelect: () => setDialog('expense') },
            ]}
          />
          <Button variant="primary" className="h-11 px-[18px]" onClick={() => setDialog('trade')}>
            Log trades
          </Button>
        </div>
      </header>

      <Alerts />

      <TonightCard now={now} today={today} types={types} trades={trades} revealed={revealed} longSessionHours={settings.longSessionHours} />

      <div className="flex flex-wrap gap-6">
        <PerformanceCard trades={trades} today={today} fyLabel={fy.label} revealed={revealed} onReveal={setRevealed} canHide={settings.homeHidePnl} />
        <DisciplineCard trades={trades} today={today} />
      </div>

      <div className="flex flex-wrap gap-6">
        <RecentTradesCard trades={trades} revealed={revealed} />
        <BusinessCard fyStartYear={fy.startYear} today={today} />
      </div>

      <TodoCard today={today} />

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
  if (settings && !settings.fredApiKey) items.push({ text: 'Add your FRED API key to see economic events', to: '/settings' });
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
