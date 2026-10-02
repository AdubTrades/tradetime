import { useEffect, useState } from 'react';
import { Wordmark } from '../components/AppShell';
import { Button } from '../components/ui';
import { api } from '../lib/api';

type Action = 'open' | 'reset' | 'exit';
const messages: Record<Action, string> = {
  open: 'Opening the demo…',
  reset: 'Generating fresh demo data…',
  exit: 'Leaving the demo…',
};

/** Real app page that starts, resets or stops the demo copy, then sends you to the right place. */
export function DemoSwitch({ action }: { action: Action }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        if (action === 'exit') {
          await api.post('/demo/stop');
          window.location.replace('/home');
          return;
        }
        const { url } = await api.post<{ url: string }>('/demo/start', { reset: action === 'reset' });
        window.location.replace(`${url}/home`);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [action]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-8 text-center">
      <Wordmark className="text-[32px]" />
      {error ? (
        <>
          <p className="text-loss">{error}</p>
          <Button onClick={() => window.location.replace('/home')}>Back to TradeTime</Button>
        </>
      ) : (
        <p className="text-muted">{messages[action]}</p>
      )}
    </div>
  );
}
