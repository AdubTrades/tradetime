/**
 * Minimal error reporting to Sentry (or any Sentry-compatible service) over its HTTP "envelope" API, shared by the
 * server and the browser so neither needs an SDK. Off unless a DSN is configured. Sends the error, where it
 * happened and the user's id; never their email or any of their data.
 */
export interface ErrorContext {
  platform: 'node' | 'javascript';
  environment?: string;
  release?: string;
  userId?: string | null;
  url?: string;
  method?: string;
  tags?: Record<string, string>;
}

/** `https://<key>@<host>/<project>` → where to send and how to authenticate. Null for anything else. */
export function parseDsn(dsn: string): { url: string; key: string } | null {
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  const [, scheme, key, host, path, project] = m;
  return { url: `${scheme}://${host}/${path ? `${path}/` : ''}api/${project}/envelope/?sentry_key=${key}&sentry_version=7`, key: key! };
}

const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

export function buildEnvelope(dsn: string, error: unknown, ctx: ErrorContext): { url: string; body: string } | null {
  const target = parseDsn(dsn);
  if (!target) return null;
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
  const eventId = hex(16);
  const now = new Date().toISOString();
  const event = {
    event_id: eventId,
    timestamp: now,
    platform: ctx.platform,
    level: 'error',
    environment: ctx.environment ?? 'production',
    ...(ctx.release ? { release: ctx.release } : {}),
    exception: { values: [{ type: err.name || 'Error', value: err.message }] },
    extra: { stack: err.stack?.split('\n').slice(0, 30).join('\n') },
    ...(ctx.userId ? { user: { id: ctx.userId } } : {}),
    ...(ctx.url ? { request: { url: ctx.url, method: ctx.method } } : {}),
    ...(ctx.tags ? { tags: ctx.tags } : {}),
  };
  const body = [JSON.stringify({ event_id: eventId, sent_at: now, dsn }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
  return { url: target.url, body };
}

/** Fire-and-forget: reporting must never cause an error of its own. */
export async function reportError(dsn: string | null | undefined, error: unknown, ctx: ErrorContext): Promise<void> {
  if (!dsn) return;
  const envelope = buildEnvelope(dsn, error, ctx);
  if (!envelope) return;
  try {
    await fetch(envelope.url, { method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope' }, body: envelope.body, keepalive: true });
  } catch {
    // Offline or blocked; nothing more to do.
  }
}
