import { reportError } from '@tc/domain';
import { signedInUserId } from './auth';

/**
 * Browser error reports to Sentry, when VITE_SENTRY_DSN is set at build time. Sends the error, the page and the
 * user's id only. Repeats of the same message are sent once per page load.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;
const sent = new Set<string>();

export function report(error: unknown, extra?: Record<string, string>): void {
  if (!dsn) return;
  const key = error instanceof Error ? error.message : String(error);
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  void reportError(dsn, error, {
    platform: 'javascript',
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE,
    userId: signedInUserId(),
    url: window.location.pathname,
    tags: extra,
  });
}

export function installErrorReporting(): void {
  if (!dsn) return;
  window.addEventListener('error', (e) => report(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}
