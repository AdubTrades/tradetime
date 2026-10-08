import { Download } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import { useInstall } from '../../lib/install';

/** Offer to install TradeTime as an app, where the browser supports it. Hidden once installed. */
export function InstallSettings() {
  const { state, install } = useInstall();
  if (state === 'installed' || state === 'unavailable') return null;
  return (
    <Card title="Install the app" description="Open TradeTime from your home screen or dock in its own window, like any other app.">
      {state === 'prompt' ? (
        <Button variant="primary" onClick={() => void install()}>
          <Download size={16} aria-hidden /> Install TradeTime
        </Button>
      ) : (
        <p className="text-sm text-muted">
          In Safari, tap <span className="font-medium text-text">Share</span>, then <span className="font-medium text-text">Add to Home Screen</span>. Open TradeTime
          from there to get notifications on iPhone and iPad.
        </p>
      )}
    </Card>
  );
}
