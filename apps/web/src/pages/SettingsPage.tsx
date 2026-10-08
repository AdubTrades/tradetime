import { useEffect, useState } from 'react';
import { currentZone, zoneLabel } from '@tc/domain';
import { Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { type Settings } from '../lib/api';
import { authEnabled, signOut, useAuth } from '../lib/auth';
import { useHealth } from '../lib/demo';
import { inDemo } from '../lib/demoSession';
import { browserZone, useSettings, useUpdateSettings } from '../lib/settings';
import { AccountSettings } from './settings/AccountSettings';
import { DemoSettings } from './settings/DemoSettings';
import { DataHealth } from './settings/DataHealth';
import { DataSettings } from './settings/DataSettings';
import { CalendarSettings } from './settings/CalendarSettings';
import { CheckInSettings } from './settings/CheckInSettings';
import { ExpenseSettings } from './settings/ExpenseSettings';
import { JournalSettings } from './settings/JournalSettings';
import { TimeLogSettings } from './settings/TimeLogSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { InstallSettings } from './settings/InstallSettings';

export function SettingsPage() {
  const { data: settings } = useSettings();
  const health = useHealth().data;
  const demo = inDemo();
  if (!settings) return null;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {(health?.demo || inDemo()) && <DemoSettings />}
        {authEnabled && !inDemo() && <AccountCard />}
        <GeneralSettings settings={settings} />
        <InstallSettings />
        {!demo && <NotificationSettings />}
        <TimeLogSettings settings={settings} />
        <CheckInSettings settings={settings} />
        <CalendarSettings settings={settings} demo={demo} />
        <AccountSettings />
        <JournalSettings />
        <ExpenseSettings settings={settings} />
        <DataSettings />
        <DataHealth />
      </div>
    </div>
  );
}

/** Who's signed in, with Sign out (the sidebar's Sign out button is hidden on phones). */
function AccountCard() {
  const { session } = useAuth();
  return (
    <Card title="Account">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          Signed in as <span className="font-medium">{session?.user.email}</span>
        </span>
        <Button onClick={() => void signOut()}>Sign out</Button>
      </div>
    </Card>
  );
}

/** Every IANA zone the browser knows (with the current one guaranteed), sorted by name. */
function zoneList(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...all, current])].sort();
}

function GeneralSettings({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const zone = settings.timeZone ?? currentZone();
  const browser = browserZone();
  const [rollover, setRollover] = useState(settings.rolloverTime);
  useEffect(() => setRollover(settings.rolloverTime), [settings.rolloverTime]);

  return (
    <Card title="General">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Time zone"
          hint={
            browser && browser !== zone
              ? `Your device is set to ${browser.replace(/_/g, ' ')}. Trading days, the calendar, reminders and reports use this zone.`
              : 'Trading days, the calendar, reminders and reports use this zone.'
          }
        >
          <Select aria-label="Time zone" value={zone} onChange={(e) => e.target.value !== zone && update.mutate({ timeZone: e.target.value })}>
            {zoneList(zone).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ').replace(/\//g, ' / ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Trading day rolls over at"
          hint={`${zoneLabel()} time. Trades and sessions before this time count toward the previous trading day.`}
          error={update.error?.message}
        >
          <Input
            type="time"
            value={rollover}
            onChange={(e) => setRollover(e.target.value)}
            onBlur={() => rollover !== settings.rolloverTime && update.mutate({ rolloverTime: rollover })}
          />
        </Field>
        <Field label="Name on reports" hint="Shown on the printable hours and expenses reports">
          <Input
            defaultValue={settings.reportName ?? ''}
            key={settings.reportName ?? ''}
            placeholder="Your name or business name"
            onBlur={(e) => e.target.value !== (settings.reportName ?? '') && update.mutate({ reportName: e.target.value.trim() || null })}
          />
        </Field>
        <Field label="ABN on reports" hint="Optional" error={update.error?.message?.includes('ABN') ? update.error.message : undefined}>
          <Input
            defaultValue={settings.reportAbn ?? ''}
            key={settings.reportAbn ?? ''}
            inputMode="numeric"
            placeholder="11 digits"
            onBlur={(e) => e.target.value !== (settings.reportAbn ?? '') && update.mutate({ reportAbn: e.target.value.trim() || null })}
          />
        </Field>
        <label className="flex items-start gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={settings.homeHidePnl} onChange={(e) => update.mutate({ homeHidePnl: e.target.checked })} />
          <span>
            <span className="font-medium">Hide P&L on Home until I reveal it</span>
            <span className="block text-muted">Results stay hidden each trading day until you press Reveal, so a red or green week doesn't colour your next session.</span>
          </span>
        </label>
        <Field label="Theme">
          <Select value={settings.theme} onChange={(e) => update.mutate({ theme: e.target.value as Settings['theme'] })}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}
