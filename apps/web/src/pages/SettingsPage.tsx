import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Download, FolderOpen, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currentZone, formatLocal, zoneLabel } from '@tc/domain';
import { Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { api, type BackupStatus, type Settings } from '../lib/api';
import { authEnabled, signOut, useAuth } from '../lib/auth';
import { useHealth } from '../lib/demo';
import { browserZone, useSettings, useUpdateSettings } from '../lib/settings';
import { AccountSettings } from './settings/AccountSettings';
import { DemoSettings } from './settings/DemoSettings';
import { DataHealth } from './settings/DataHealth';
import { RestoreBackup } from './settings/RestoreBackup';
import { CalendarSettings } from './settings/CalendarSettings';
import { CheckInSettings } from './settings/CheckInSettings';
import { ExpenseSettings } from './settings/ExpenseSettings';
import { JournalSettings } from './settings/JournalSettings';
import { TimeLogSettings } from './settings/TimeLogSettings';

const intervals: { value: Settings['backupIntervalHours']; label: string }[] = [
  { value: 0, label: 'Off (manual only)' },
  { value: 6, label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Daily' },
  { value: 168, label: 'Weekly' },
];

const formatBytes = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function SettingsPage() {
  const { data: settings } = useSettings();
  const health = useHealth().data;
  const demo = !!health?.demo;
  const cloud = !!health?.cloud;
  if (!settings) return null;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {!cloud && <DemoSettings />}
        {authEnabled && <AccountCard />}
        <GeneralSettings settings={settings} />
        <TimeLogSettings settings={settings} />
        <CheckInSettings settings={settings} />
        <CalendarSettings settings={settings} demo={demo} />
        <AccountSettings />
        <JournalSettings />
        <ExpenseSettings settings={settings} />
        {cloud ? null : demo ? (
          <Card title="Backups">
            <p className="text-sm text-muted">Backups and restore are switched off in demo mode.</p>
          </Card>
        ) : (
          <BackupSettings settings={settings} />
        )}
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

function BackupSettings({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const [folderDraft, setFolderDraft] = useState(settings.backupFolder ?? '');
  useEffect(() => setFolderDraft(settings.backupFolder ?? ''), [settings.backupFolder]);

  const { data: status } = useQuery({ queryKey: ['backup-status'], queryFn: () => api.get<BackupStatus>('/backup/status'), refetchInterval: 60_000 });
  const { data: cloudFolders = [] } = useQuery({
    queryKey: ['backup-folders'],
    queryFn: () => api.get<{ label: string; path: string }[]>('/settings/backup-folders'),
  });

  const chooseFolder = useMutation({
    mutationFn: () => api.post<{ path: string | null }>('/settings/choose-folder'),
    onSuccess: ({ path }) => path && saveFolder(path),
  });
  const runBackup = useMutation({
    mutationFn: () => api.post<BackupStatus>('/backup/run'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['backup-status'] }),
  });

  const saveFolder = (path: string | null) =>
    update.mutate({ backupFolder: path }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-status'] }) });

  return (
    <Card
      title="Backups"
      description="Zipped snapshots of all data and attachments. Choose a folder in iCloud Drive or Google Drive to keep an off-machine copy."
    >
      <div className="space-y-5">
        <Field
          label="Backup folder"
          hint={settings.backupFolder ? undefined : `Not set — backups go to the local fallback folder: ${status?.folder ?? ''}`}
          error={update.error?.message}
        >
          <div className="flex gap-2">
            <Input
              value={folderDraft}
              placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Trading backups"
              onChange={(e) => setFolderDraft(e.target.value)}
              onBlur={() => folderDraft !== (settings.backupFolder ?? '') && saveFolder(folderDraft.trim() || null)}
            />
            <Button onClick={() => chooseFolder.mutate()} disabled={chooseFolder.isPending}>
              <FolderOpen size={16} aria-hidden /> Choose…
            </Button>
          </div>
        </Field>
        {cloudFolders.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Detected:</span>
            {cloudFolders.map((f) => (
              <Button key={f.path} variant="ghost" onClick={() => saveFolder(f.path)} title={f.path}>
                <Cloud size={16} aria-hidden /> {f.label}
              </Button>
            ))}
            {settings.backupFolder && (
              <Button variant="ghost" onClick={() => saveFolder(null)}>
                <HardDrive size={16} aria-hidden /> Use local folder
              </Button>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Automatic backup">
            <Select
              value={settings.backupIntervalHours}
              onChange={(e) => update.mutate({ backupIntervalHours: Number(e.target.value) as Settings['backupIntervalHours'] })}
            >
              {intervals.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Keep the most recent" hint="Older backups in the folder are deleted automatically.">
            <Select value={settings.backupRetention} onChange={(e) => update.mutate({ backupRetention: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90, 365].map((n) => (
                <option key={n} value={n}>
                  {n} backups
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-md border border-border-subtle bg-inset p-3 text-sm">
          {status?.lastSuccessAt ? (
            <p>
              Last backup: <span className="font-medium">{formatLocal(status.lastSuccessAt, 'ccc d LLL yyyy, HH:mm')}</span>
              {status.lastBytes != null && <span className="text-muted"> · {formatBytes(status.lastBytes)}</span>}
            </p>
          ) : (
            <p className="text-muted">No backup has been made yet.</p>
          )}
          {status?.lastError && <p className="mt-1 text-loss">Last attempt failed: {status.lastError}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
            {runBackup.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
          <a
            href="/api/backup/export"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-sm font-medium shadow-card hover:bg-hover"
          >
            <Download size={16} aria-hidden /> Export everything (.zip)
          </a>
        </div>
        <RestoreBackup />
      </div>
    </Card>
  );
}
