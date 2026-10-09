import { useState, type FormEvent, type ReactNode } from 'react';
import { Wordmark } from '../../components/AppShell';
import { Button, Field, Input } from '../../components/ui';
import { useHealth } from '../../lib/demo';
import { enterDemo } from '../../lib/demoSession';
import { clearLinkError, passwordChosen, signOut, supabase, useAuth } from '../../lib/auth';

/** Centred card on the page background, shared by the sign-in screens. */
function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ember" aria-hidden />
          <Wordmark className="text-[18px]" />
        </div>
        <section className="card p-7">
          <h1 className="text-[22px] leading-tight font-semibold">{title}</h1>
          {intro && <p className="mt-1.5 text-sm text-muted">{intro}</p>}
          <div className="mt-6">{children}</div>
        </section>
        <p className="mt-5 text-center text-xs text-faint">
          A trading journal, time log and expenses for traders. Not financial or tax advice.{' '}
          <a href="/privacy" className="underline underline-offset-2 hover:text-text">
            Privacy and terms
          </a>
        </p>
      </div>
    </main>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-md border px-3 py-2.5 text-sm ${tone === 'error' ? 'border-loss/30 bg-loss-tint text-loss' : 'border-border bg-inset text-text'}`}>
      {children}
    </p>
  );
}

type Mode = 'password' | 'magic' | 'reset';

/** Sign in with a password, or have a one-time link emailed. Access is by invitation, so no sign-up here. */
export function SignInPage() {
  const { linkError } = useAuth();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const { data: health } = useHealth();
  const [deleted] = useState(() => {
    try {
      const was = sessionStorage.getItem('tt_deleted') === '1';
      sessionStorage.removeItem('tt_deleted');
      return was;
    } catch {
      return false;
    }
  });
  const [demoBusy, setDemoBusy] = useState(false);
  const openDemo = async () => {
    setDemoBusy(true);
    setError(null);
    try {
      await enterDemo(null);
    } catch (err) {
      setError((err as Error).message);
      setDemoBusy(false);
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setSent(null);
    clearLinkError();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setSent(null);
    clearLinkError();
    const redirectTo = window.location.origin;
    const result =
      mode === 'password'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : mode === 'magic'
          ? await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })
          : await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setBusy(false);
    if (result.error) {
      // Don't reveal whether an address has an account; a wrong password or unknown email reads the same.
      setError(mode === 'password' ? 'That email and password don’t match. Check them, or use a sign-in link.' : result.error.message);
      return;
    }
    if (mode !== 'password') setSent(mode === 'magic' ? 'If that address has an account, a sign-in link is on its way. Open it on this device.' : 'If that address has an account, a link to choose a new password is on its way.');
  };

  const titles: Record<Mode, string> = { password: 'Sign in', magic: 'Email me a sign-in link', reset: 'Reset your password' };
  return (
    <AuthCard
      title={titles[mode]}
      intro={mode === 'password' ? 'Access is by invitation during the beta.' : mode === 'magic' ? 'No password needed: we’ll email you a link that signs you in.' : 'We’ll email you a link to choose a new password.'}
    >
      {deleted && <Notice tone="ok">Your account and everything in it have been deleted. Thanks for trying TradeTime.</Notice>}
      {linkError && <Notice tone="error">That link didn’t work: {linkError}. Request a new one below.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {sent && <Notice tone="ok">{sent}</Notice>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === 'password' && (
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <Button variant="primary" type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : mode === 'magic' ? 'Send sign-in link' : 'Send reset link'}
        </Button>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-[13px]">
        {mode === 'password' ? (
          <>
            <button type="button" className="rounded-sm text-secondary underline-offset-[3px] hover:text-text hover:underline" onClick={() => switchTo('magic')}>
              Email me a sign-in link
            </button>
            <button type="button" className="rounded-sm text-secondary underline-offset-[3px] hover:text-text hover:underline" onClick={() => switchTo('reset')}>
              Forgot your password?
            </button>
          </>
        ) : (
          <button type="button" className="rounded-sm text-secondary underline-offset-[3px] hover:text-text hover:underline" onClick={() => switchTo('password')}>
            ← Sign in with a password
          </button>
        )}
      </div>
      {health?.demo?.public && (
        <div className="mt-5 border-t border-border-subtle pt-5 text-center text-[13px]">
          <button type="button" disabled={demoBusy} className="link-ember" onClick={() => void openDemo()}>
            {demoBusy ? 'Opening the demo…' : 'No invite yet? Look around the demo'}
          </button>
        </div>
      )}
    </AuthCard>
  );
}

/** After an invite or password-reset link: choose a password, then carry on into the app. */
export function SetPasswordPage({ reason }: { reason: 'invite' | 'recovery' }) {
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    window.history.replaceState(null, '', window.location.pathname);
    passwordChosen();
  };

  return (
    <AuthCard
      title={reason === 'invite' ? 'Welcome to TradeTime' : 'Choose a new password'}
      intro={
        <>
          {reason === 'invite' ? 'Choose a password for ' : 'Signed in as '}
          <span className="font-medium text-text">{session?.user.email}</span>
          {reason === 'invite' ? '. You can also sign in with an emailed link any time.' : '.'}
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button variant="primary" type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? 'Saving…' : reason === 'invite' ? 'Save and continue' : 'Save new password'}
        </Button>
      </form>
      <button type="button" className="mt-5 rounded-sm text-[13px] text-secondary underline-offset-[3px] hover:text-text hover:underline" onClick={() => void signOut()}>
        Not you? Sign out
      </button>
    </AuthCard>
  );
}
