import { useState } from 'react';
import { Card } from '../../components/ui';
import { accessToken } from '../../lib/auth';
import { enterDemo, exitDemo, inDemo } from '../../lib/demoSession';

/** On/off switch for demo mode: your own copy of a fictional trader's account, to show TradeTime without your data. */
export function DemoSettings() {
  const on = inDemo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    if (on) return exitDemo();
    setBusy(true);
    setError(null);
    try {
      await enterDemo(accessToken());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card
      title="Demo mode"
      description="Show TradeTime to someone without showing your data. The demo is a separate account filled with sample data; your own data is never opened or changed."
    >
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-text' : 'bg-border'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow-card transition-all ${on ? 'left-6' : 'left-1'}`} aria-hidden />
          <span className="sr-only">Demo mode</span>
        </button>
        <div className="text-sm">
          <div className="font-medium">{busy ? 'Opening the demo…' : on ? 'Demo mode is on' : 'Demo mode is off'}</div>
          <div className="text-muted">
            {on ? 'Switch off to return to your own TradeTime.' : 'Switch on to open a fresh copy. It shows a fictional trader across every tab.'}
          </div>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-loss">{error}</p>}
      <p className="mt-4 text-xs text-muted">
        In the demo, notifications, uploads and imports are switched off. Each demo copy is separate, so changes in it never reach your account or anyone
        else’s, and it’s deleted after a day.
      </p>
    </Card>
  );
}
