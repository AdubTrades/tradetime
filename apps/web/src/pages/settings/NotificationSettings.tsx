import { useEffect, useState } from 'react';
import { Button, Card } from '../../components/ui';
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../../lib/push';

const messages: Record<Exclude<PushState, 'on' | 'off'>, string> = {
  'needs-install':
    'On iPhone and iPad, notifications only work once TradeTime is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.',
  'server-off': 'Notifications aren’t set up on the server yet. The in-app check-in prompts still work.',
  denied: 'Notifications are blocked for TradeTime in this browser’s settings. Allow them there, then reload this page.',
};

/** Turn web push on or off for this device (each phone, tablet or computer is set up separately). */
export function NotificationSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);

  const run = async (fn: () => Promise<PushState | unknown>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      const next = await fn();
      if (typeof next === 'string') setState(next as PushState);
      if (done) setNote(done);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Notifications" description="Check-in prompts, “still going?” alerts, calendar reminders and renewal notices, on this device.">
      {state === null ? (
        <p className="text-sm text-muted">Checking this device…</p>
      ) : state === 'on' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="mr-auto flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-profit" aria-hidden /> On for this device
          </span>
          <Button disabled={busy} onClick={() => void run(sendTestPush, 'Test sent. It should appear in a few seconds.')}>
            Send a test
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(disablePush)}>
            Turn off here
          </Button>
        </div>
      ) : state === 'off' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="mr-auto text-muted">Off for this device. Turn it on on each phone or computer you use.</span>
          <Button variant="primary" disabled={busy} onClick={() => void run(enablePush)}>
            Turn on notifications
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">{messages[state]}</p>
      )}
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </Card>
  );
}
