import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DateTime } from 'luxon';
import { FOMC_SCHEDULE_ENDS, formatLocal } from '@tc/domain';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { api, type CalendarEventType, type MarketStatus, type Settings } from '../../lib/api';
import { useEventTypes, useMarketStatus } from '../../lib/calendar';
import { useSessionTypes } from '../../lib/sessions';
import { useUpdateSettings } from '../../lib/settings';

export function CalendarSettings({ settings, demo = false }: { settings: Settings; demo?: boolean }) {
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const { data: status } = useMarketStatus();
  const [key, setKey] = useState('');
  const refresh = useMutation({
    mutationFn: () => api.post<MarketStatus>('/calendar/market/refresh'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  });
  const saveKey = (value: string | null) =>
    update.mutate(
      { fredApiKey: value },
      {
        onSuccess: () => {
          setKey('');
          // The server fetches straight away when a new key is saved.
          setTimeout(() => void qc.invalidateQueries({ queryKey: ['calendar'] }), 4000);
        },
      },
    );

  return (
    <Card title="Calendar" description="High-impact US economic releases are fetched from FRED and stored locally, so past and upcoming events work offline.">
      <div className="space-y-6">
        <div className="space-y-2">
          {demo ? (
            <p className="text-sm text-muted">The demo shows sample economic releases; fetching from FRED is switched off.</p>
          ) : (
            <>
          <Field
            label="FRED API key"
            hint={
              <>
                Free: create an account at{' '}
                <a href="https://fredaccount.stlouisfed.org/apikeys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-ember hover:underline">
                  fredaccount.stlouisfed.org <ExternalLink size={11} aria-hidden />
                </a>{' '}
                and request an API key. It's stored only in your local database (and its backups).
              </>
            }
            error={update.error?.message}
          >
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value.trim())}
                placeholder={settings.fredApiKey ? `Saved (${settings.fredApiKey})` : '32-character key'}
              />
              <Button variant="primary" disabled={!key || update.isPending} onClick={() => saveKey(key)}>
                Save key
              </Button>
              {settings.fredApiKey && (
                <Button variant="ghost" onClick={() => window.confirm('Remove the saved FRED API key?') && saveKey(null)}>
                  Remove
                </Button>
              )}
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle bg-inset p-3 text-sm">
            <span className="flex-1">
              {status?.lastSuccessAt ? (
                <>
                  Last updated {formatLocal(status.lastSuccessAt, 'ccc d LLL, HH:mm')} · {status.count} releases
                </>
              ) : (
                <span className="text-muted">Not fetched yet.</span>
              )}
              {status?.lastError && <span className="block text-loss">Last attempt failed: {status.lastError}</span>}
            </span>
            <Button disabled={!settings.fredApiKey || refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw size={14} aria-hidden className={refresh.isPending ? 'animate-spin' : ''} /> Refresh now
            </Button>
          </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.includeMediumEvents} onChange={(e) => update.mutate({ includeMediumEvents: e.target.checked })} />
            Also show medium-impact releases (jobless claims, JOLTS)
          </label>
          <p className="text-xs text-muted">
            Covered: CPI, Non-Farm Payrolls, PPI, GDP, PCE and Retail Sales (high); jobless claims and JOLTS (medium). Times are the standard US
            release times converted to Perth, with US daylight saving handled. FOMC statements come from the Federal Reserve's published meeting
            schedule, built in through {DateTime.fromISO(FOMC_SCHEDULE_ENDS).toFormat('LLLL yyyy')}
            {FOMC_SCHEDULE_ENDS < DateTime.now().plus({ months: 3 }).toISODate()! && <strong className="text-warning"> — the app needs updating with next year's dates</strong>}. This product uses the FRED® API but is not endorsed or
            certified by the Federal Reserve Bank of St. Louis.{' '}
            <a href="https://fred.stlouisfed.org/docs/api/terms_of_use.html" target="_blank" rel="noreferrer" className="underline">
              FRED API terms of use
            </a>
            .
          </p>
        </div>
        <EventTypesEditor />
      </div>
    </Card>
  );
}

function EventTypesEditor() {
  const qc = useQueryClient();
  const { data: types = [] } = useEventTypes();
  const { data: sessionTypes = [] } = useSessionTypes();
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<CalendarEventType> & { id: string }) => api.patch(`/calendar/types/${id}`, b), onSettled: refresh });
  const create = useMutation({
    mutationFn: () => api.post('/calendar/types', { name, color: '#9a958c' }),
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });

  return (
    <div>
      <div className="mb-1 text-sm font-medium">Event types</div>
      <p className="mb-2 text-xs text-muted">Each type is a colour-coded layer. Link a session type to start that session from an event; no-trade types are excluded from “days available”.</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {types.map((t) => (
          <li key={t.id} className={`flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm ${t.archived ? 'opacity-50' : ''}`}>
            <input type="color" aria-label={`Colour for ${t.name}`} value={t.color} onChange={(e) => patch.mutate({ id: t.id, color: e.target.value })} className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" />
            <Input
              key={t.name}
              defaultValue={t.name}
              aria-label="Name"
              className="min-w-40 flex-1 border-transparent bg-transparent"
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patch.mutate({ id: t.id, name: e.target.value })}
            />
            <Select aria-label="Starts session type" className="w-44" value={t.sessionTypeId ?? ''} onChange={(e) => patch.mutate({ id: t.id, sessionTypeId: e.target.value || null })}>
              <option value="">No session</option>
              {sessionTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  Starts {s.name.toLowerCase()}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={t.isNoTrade} onChange={(e) => patch.mutate({ id: t.id, isNoTrade: e.target.checked })} /> No-trade
            </label>
            <Button variant="ghost" className="text-xs" onClick={() => patch.mutate({ id: t.id, archived: !t.archived })}>
              {t.archived ? 'Restore' : 'Archive'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New event type" className="max-w-64" />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </form>
    </div>
  );
}
