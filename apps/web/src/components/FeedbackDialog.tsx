import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useHealth } from '../lib/demo';
import { inDemo } from '../lib/demoSession';
import { KNOWN_ISSUES } from '../lib/knownIssues';
import { Dialog } from './Dialog';
import { Button, SegmentedTabs } from './ui';

type Kind = 'bug' | 'idea' | 'general';

/** "Send feedback": a problem, an idea or anything else, sent to whoever runs the beta. */
export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const supportEmail = useHealth().data?.supportEmail;
  const [kind, setKind] = useState<Kind>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind('bug');
    setMessage('');
    setError(null);
    setSent(false);
  }, [open]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/feedback', { kind, message, page: window.location.pathname, appVersion: import.meta.env.VITE_RELEASE || null });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const email = session?.user.email;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Send feedback"
      footer={
        sent ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy || message.trim().length < 3} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <p className="text-sm">Thanks, it’s been sent. {email ? 'If a reply is needed, it’ll come to your email.' : ''}</p>
      ) : (
        <div className="space-y-4">
          <SegmentedTabs
            label="Kind of feedback"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'bug', label: 'Something’s wrong' },
              { value: 'idea', label: 'An idea' },
              { value: 'general', label: 'Other' },
            ]}
          />
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">
              {kind === 'bug' ? 'What happened, and what did you expect?' : kind === 'idea' ? 'What would make TradeTime better for you?' : 'What’s on your mind?'}
            </span>
            <textarea
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-card"
            />
          </label>
          {error && <p className="text-sm text-loss">{error}</p>}
          <p className="text-xs text-muted">
            {inDemo()
              ? 'Sent anonymously from the demo.'
              : `Sent with ${email ? `your email (${email})` : 'your account'} and the page you’re on, so the reply can find you.`}
            {supportEmail && (
              <>
                {' '}
                You can also email <a className="link-ember" href={`mailto:${supportEmail}`}>{supportEmail}</a>.
              </>
            )}
          </p>
          {KNOWN_ISSUES.length > 0 && (
            <details className="rounded-md bg-inset px-3 py-2.5 text-sm">
              <summary className="cursor-pointer font-medium">Known issues</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {KNOWN_ISSUES.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}
