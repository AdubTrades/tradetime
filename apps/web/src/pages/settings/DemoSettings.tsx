import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui';
import { api } from '../../lib/api';
import { useHealth } from '../../lib/demo';

/** On/off switch for demo mode. Turning it on opens a separate copy of TradeTime filled with sample data. */
export function DemoSettings() {
  const { data: health } = useHealth();
  const { data: status } = useQuery({ queryKey: ['demo-status'], queryFn: () => api.get<{ running: boolean }>('/demo/status'), enabled: !!health && !health.demo });
  const inDemo = !!health?.demo;
  const go = (action: 'open' | 'reset' | 'exit') => {
    const base = inDemo ? (health?.realAppUrl ?? '') : '';
    window.location.href = `${base}/demo-switch?action=${action}`;
  };

  return (
    <Card
      title="Demo mode"
      description="Show TradeTime to someone without showing your data. The demo is a separate copy with its own sample data; your real data is never opened or changed."
    >
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={inDemo}
          onClick={() => go(inDemo ? 'exit' : 'open')}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${inDemo ? 'bg-text' : 'bg-border'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-bg transition-all ${inDemo ? 'left-6' : 'left-1'}`} aria-hidden />
          <span className="sr-only">Demo mode</span>
        </button>
        <div className="text-sm">
          <div className="font-medium">{inDemo ? 'Demo mode is on' : 'Demo mode is off'}</div>
          <div className="text-muted">
            {inDemo
              ? 'Switch off to return to your own TradeTime.'
              : `Switch on to open the demo${status?.running ? ' (already running)' : ''}. It shows a fictional trader across every tab.`}
          </div>
        </div>
        <button type="button" onClick={() => go('reset')} className="link-ember ml-auto text-sm">
          Reset demo data
        </button>
      </div>
      <p className="mt-4 text-xs text-muted">
        In the demo, notifications, backups, restore and fetching economic events are switched off. Anything changed in the demo stays in the demo, and
        Reset puts it back to the original sample.
      </p>
    </Card>
  );
}
