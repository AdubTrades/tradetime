import { LogOut, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { accessToken } from '../lib/auth';
import { enterDemo, exitDemo, inDemo } from '../lib/demoSession';

/** Shown across the top while you're in the demo, with ways to start it afresh or leave. */
export function DemoBanner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!inDemo()) return null;
  const reset = async () => {
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
    <div className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-1 bg-text px-6 py-2 text-sm text-bg">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-ember" aria-hidden />
        <span className="font-display">Demo mode</span>
      </span>
      <span className="opacity-75">
        {error ?? 'Sample data for Alex Morgan, a fictional trader. This copy is yours to try things in, and it’s cleared after a day.'}
      </span>
      <span className="ml-auto flex items-center gap-4">
        <button type="button" disabled={busy} onClick={() => void reset()} className="inline-flex items-center gap-1.5 rounded-sm opacity-80 hover:opacity-100 disabled:opacity-50">
          <RotateCcw size={14} aria-hidden /> {busy ? 'Starting afresh…' : 'Reset demo'}
        </button>
        <button type="button" onClick={exitDemo} className="inline-flex items-center gap-1.5 rounded-sm underline decoration-ember underline-offset-4">
          <LogOut size={14} aria-hidden /> Exit demo
        </button>
      </span>
    </div>
  );
}
