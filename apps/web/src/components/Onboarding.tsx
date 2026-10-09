import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { currentZone } from '@tc/domain';
import { api, type Settings } from '../lib/api';
import { inDemo } from '../lib/demoSession';
import { useInstall } from '../lib/install';
import { enablePush, pushState, type PushState } from '../lib/push';
import { useUpdateSettings, zoneList } from '../lib/settings';
import { Button, Field, Input, Select, cn } from './ui';
import { Wordmark } from './AppShell';

type Step = 'day' | 'account' | 'play' | 'alerts';
const steps: Step[] = ['day', 'account', 'play', 'alerts'];

/**
 * First-run welcome for a new account: time zone and rollover, a first prop firm account, a first Play, and
 * notifications (with the iPhone Home Screen tip). Every step can be skipped, and it never shows again once finished
 * or skipped. Accounts brought across from the Mac app, and the demo, start with it done.
 */
export function Onboarding({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [step, setStep] = useState<Step>('day');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.querySelector<HTMLElement>('input, select, button')?.focus(), [step]);

  if (settings.onboarded || inDemo()) return null;
  const finish = () => update.mutate({ onboarded: true });
  const next = () => {
    const i = steps.indexOf(step);
    if (i === steps.length - 1) finish();
    else setStep(steps[i + 1]!);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-page/95 px-4 py-8 backdrop-blur-sm">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="card w-full max-w-[480px] p-7 max-sm:p-5">
        <div className="mb-5 flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-ember" aria-hidden />
            <Wordmark />
          </span>
          <button type="button" onClick={finish} className="rounded-sm text-[13px] text-muted underline-offset-[3px] hover:text-text hover:underline">
            Skip setup
          </button>
        </div>
        <ol className="mb-6 flex gap-1.5" aria-label={`Step ${steps.indexOf(step) + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <li key={s} className={cn('h-1 flex-1 rounded-full', i <= steps.indexOf(step) ? 'bg-text' : 'bg-border')} />
          ))}
        </ol>
        {step === 'day' && <DayStep settings={settings} onNext={next} />}
        {step === 'account' && <AccountStep onNext={next} />}
        {step === 'play' && <PlayStep onNext={next} />}
        {step === 'alerts' && <AlertsStep onDone={finish} />}
      </div>
    </div>
  );
}

function StepHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 id="welcome-title" className="text-[22px] leading-tight font-semibold">
        {title}
      </h1>
      <p className="mt-1.5 mb-5 text-sm text-muted">{children}</p>
    </>
  );
}

function Actions({ busy, onSkip, label = 'Next' }: { busy?: boolean; onSkip?: () => void; label?: string }) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      {onSkip && (
        <Button variant="ghost" onClick={onSkip}>
          Skip
        </Button>
      )}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : label}
      </Button>
    </div>
  );
}

function DayStep({ settings, onNext }: { settings: Settings; onNext: () => void }) {
  const update = useUpdateSettings();
  const [zone, setZone] = useState(settings.timeZone ?? currentZone());
  const [rollover, setRollover] = useState(settings.rolloverTime);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ timeZone: zone, rolloverTime: rollover }, { onSuccess: onNext });
  };
  return (
    <form onSubmit={submit}>
      <StepHeader title="Welcome to TradeTime">
        First, your trading day. Trades and sessions count towards the day they started, and a late-night session can roll over
        into the next morning.
      </StepHeader>
      <div className="space-y-4">
        <Field label="Time zone">
          <Select aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)}>
            {zoneList(zone).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ').replace(/\//g, ' / ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trading day rolls over at" hint="Anything before this time counts towards the previous trading day. 10:00 suits US sessions traded from Australia." error={update.error?.message}>
          <Input type="time" value={rollover} onChange={(e) => setRollover(e.target.value)} required />
        </Field>
      </div>
      <Actions busy={update.isPending} />
    </form>
  );
}

function AccountStep({ onNext }: { onNext: () => void }) {
  const qc = useQueryClient();
  const [firm, setFirm] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('evaluation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return onNext();
    setBusy(true);
    setError(null);
    try {
      const f = firm.trim() ? await api.post<{ id: string }>('/firms', { name: firm.trim() }) : null;
      await api.post('/accounts', { firmId: f?.id ?? null, name: name.trim(), type, status: 'active' });
      await qc.invalidateQueries({ queryKey: ['accounts'] });
      await qc.invalidateQueries({ queryKey: ['firms'] });
      onNext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <StepHeader title="Your first account">
        The prop firm account you trade, so trades and P&L are tracked per account. You can add more, and group copies, in Settings.
      </StepHeader>
      <div className="space-y-4">
        <Field label="Prop firm" hint="Optional">
          <Input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Lucid Trading" autoComplete="off" />
        </Field>
        <Field label="Account name" error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 50K Flex #1" autoComplete="off" />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="evaluation">Evaluation</option>
            <option value="funded">Funded</option>
            <option value="live">Live</option>
            <option value="sim">Sim</option>
          </Select>
        </Field>
      </div>
      <Actions busy={busy} onSkip={onNext} label={name.trim() ? 'Add account' : 'Next'} />
    </form>
  );
}

function PlayStep({ onNext }: { onNext: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return onNext();
    setBusy(true);
    setError(null);
    try {
      await api.post('/plays', { title: title.trim(), description: description.trim() || null });
      await qc.invalidateQueries({ queryKey: ['plays'] });
      onNext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <StepHeader title="Your first Play">
        A setup you trade. Each trade is graded against its checklist, so you can see which setups work. Add the checklist in the
        Playbook afterwards.
      </StepHeader>
      <div className="space-y-4">
        <Field label="Name" error={error}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Opening range breakout" autoComplete="off" />
        </Field>
        <Field label="What it looks like" hint="Optional">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Break and hold of the first 15-minute range" autoComplete="off" />
        </Field>
      </div>
      <Actions busy={busy} onSkip={onNext} label={title.trim() ? 'Add Play' : 'Next'} />
    </form>
  );
}

function AlertsStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const { state: install } = useInstall();
  useEffect(() => {
    void pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);
  const turnOn = async () => {
    setBusy(true);
    try {
      setState(await enablePush());
    } catch {
      setState(await pushState().catch(() => 'unsupported' as const));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onDone();
      }}
    >
      <StepHeader title="Stay on track">
        TradeTime can remind you to check in during long sessions, nudge you when a session runs on, and flag calendar reminders and
        subscription renewals.
      </StepHeader>
      {state === 'off' && (
        <Button disabled={busy} onClick={() => void turnOn()}>
          {busy ? 'Asking…' : 'Turn on notifications'}
        </Button>
      )}
      {state === 'on' && <p className="text-sm">Notifications are on for this device.</p>}
      {state === 'denied' && <p className="text-sm text-muted">Notifications are blocked in this browser’s settings. You can allow them later and turn them on in Settings.</p>}
      {(state === 'needs-install' || install === 'ios') && state !== 'on' && (
        <p className="mt-3 rounded-md bg-inset px-3 py-2.5 text-sm">
          On iPhone and iPad: tap <span className="font-medium">Share</span>, then <span className="font-medium">Add to Home Screen</span>, and open
          TradeTime from there to get notifications.
        </p>
      )}
      {(state === 'unsupported' || state === 'server-off') && <p className="text-sm text-muted">Notifications aren’t available here. The in-app reminders still work.</p>}
      <Actions label="Start using TradeTime" />
    </form>
  );
}
