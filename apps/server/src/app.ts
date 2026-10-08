import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { attachmentRoutes } from './routes/attachments';
import { AppError } from './errors';
import { sql } from 'drizzle-orm';
import { reportError } from '@tc/domain';
import { auth, authEnabled, demo, errorReporting, fredApiKey, localUserId, storage } from './config';
import { tokenFrom, verifyAccessToken, type AuthUser } from './auth';
import { rootDb, withUser } from './context';
import { dataHealth } from './health';
import { calendarRoutes } from './routes/calendar';
import { tradeImportRoutes } from './routes/tradeImport';
import { checkInRoutes, questionRoutes, readingRoutes } from './routes/checkins';
import { expenseRoutes, payoutRoutes, recurringRoutes } from './routes/expenses';
import { accountGroupRoutes, contractRoutes, dailyReviewRoutes, playRoutes, tradeRoutes } from './routes/journal';
import { accountRoutes, firmRoutes, listRoutes } from './routes/lists';
import { sessionRoutes, sessionTypeRoutes } from './routes/sessions';
import { settingsRoutes } from './routes/settings';
import { pushRoutes } from './routes/push';
import { runTick } from './jobs';
import { accountRoutes as accountDataRoutes } from './routes/account';
import { demoAvailable, isDemoToken, startDemo, verifyDemoToken } from './demo/account';
import { timingSafeEqual } from 'node:crypto';

const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const hostOf = (origin: string) => (URL.canParse(origin) ? new URL(origin).host : '');

export const app = new Hono<{ Variables: { user: AuthUser } }>();

/**
 * Request checks.
 * - Local mode (no sign-in): the server listens on 127.0.0.1 only, and also rejects foreign Host/Origin headers so
 *   a malicious page can't reach it via DNS rebinding or cross-site requests.
 * - Signed-in mode: a page on another site may not send changes (the Origin must be this site or APP_ORIGINS).
 */
app.use('/api/*', async (c, next) => {
  const hostHeader = c.req.header('host') ?? '';
  const origin = c.req.header('origin');
  if (!authEnabled) {
    if (!localHost.test(hostHeader)) throw new HTTPException(403, { message: 'Forbidden host' });
    if (origin && c.req.method !== 'GET' && !localHost.test(hostOf(origin))) throw new HTTPException(403, { message: 'Forbidden origin' });
  } else if (origin && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const allowed = hostOf(origin) === hostHeader || auth.allowedOrigins.includes(origin);
    if (!allowed) throw new HTTPException(403, { message: 'Forbidden origin' });
  }
  await next();
});

const startedAt = new Date().toISOString();
app.get('/api/health', (c) => c.json({ ok: true, startedAt, demo: demoAvailable() ? { public: demo.public || !authEnabled } : null, cloud: true, fredConfigured: !!fredApiKey, auth: authEnabled, storage: storage.remote ? { kind: 'supabase', bucket: storage.bucket } : { kind: 'local' } }));

/** Database check for uptime monitors and the keep-alive job: one tiny query, no sign-in. */
app.get('/api/health/ping', async (c) => {
  const started = Date.now();
  try {
    await rootDb().execute(sql`select 1`);
    return c.json({ ok: true, db: 'up', ms: Date.now() - started });
  } catch (err) {
    console.error(`[ping] ${(err as Error).message}`);
    return c.json({ ok: false, db: 'down' }, 503);
  }
});

/**
 * Scheduled jobs, called every minute by Supabase pg_cron (cloud) with `Authorization: Bearer <JOBS_SECRET>`.
 * Not a user request, so it's checked before the sign-in step and runs every user's jobs itself.
 */
const secretMatches = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
app.post('/api/jobs/tick', async (c) => {
  const secret = process.env.JOBS_SECRET;
  if (!secret) return c.json({ error: 'Scheduled jobs endpoint is off (JOBS_SECRET not set)' }, 404);
  const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secretMatches(given, secret)) return c.json({ error: 'Forbidden' }, 403);
  return c.json(await runTick());
});

/**
 * Open a fresh copy of the demo account. Signed-in users can always do this (Settings → Demo); people without an
 * account only when DEMO_PUBLIC=1 (a link on the sign-in page).
 */
app.post('/api/demo/session', async (c) => {
  if (authEnabled && !demo.public) {
    const token = tokenFrom({ method: c.req.method, header: (n) => c.req.header(n) });
    const ok = token && (isDemoToken(token) ? await verifyDemoToken(token).catch(() => null) : await verifyAccessToken(token).catch(() => null));
    if (!ok) throw new HTTPException(401, { message: 'Please sign in to open the demo' });
  }
  return c.json(await startDemo(), 201);
});

/** Things a demo visitor can't do: they'd reach outside the sample account (devices, uploads, imports, the FRED key). */
const demoBlocked = (method: string, path: string) =>
  method !== 'GET' && (/^\/api\/push\/(subscribe|test)$/.test(path) || /^\/api\/attachments(\/prepare|\/complete)?$/.test(path) || path.startsWith('/api/account/import'));

/**
 * Who's asking: the signed-in user from their Supabase access token, or the single local user when sign-in isn't
 * configured. Every other API request then runs as that user, in one transaction with row-level security on.
 * If the handler fails, the whole request is rolled back.
 */
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health' || c.req.path === '/api/health/ping' || c.req.path === '/api/jobs/tick' || c.req.path === '/api/demo/session') return next();
  let user: AuthUser = { userId: localUserId, email: null };
  let token = tokenFrom({ method: c.req.method, header: (n) => c.req.header(n) });
  if (token && isDemoToken(token)) {
    try {
      user = await verifyDemoToken(token);
    } catch {
      throw new HTTPException(401, { message: 'This demo has expired. Open it again from Settings.' });
    }
    // The demo's token isn't a Supabase one, so storage calls can't use it (demo screenshots are drawn on request).
    token = null;
    if (demoBlocked(c.req.method, c.req.path)) throw new AppError(403, 'That’s switched off in the demo.');
  } else if (authEnabled) {
    if (!token) throw new HTTPException(401, { message: 'Please sign in' });
    try {
      user = await verifyAccessToken(token);
    } catch {
      throw new HTTPException(401, { message: 'Your session has expired. Please sign in again.' });
    }
  } else {
    token = null;
  }
  c.set('user', user);
  try {
    await withUser(
      user.userId,
      async () => {
        await next();
        if (c.error) throw c.error;
      },
      { token },
    );
  } catch (err) {
    // The error response was already rendered by onError; rethrow anything else.
    if (err !== c.error) throw err;
  }
});
app.get('/api/me', (c) => c.json({ demo: false, ...c.get('user'), auth: authEnabled }));
app.route('/api/account', accountDataRoutes);
app.get('/api/health/data', async (c) => c.json(await dataHealth()));
app.route('/api/settings', settingsRoutes);
app.route('/api/push', pushRoutes);
app.route('/api/attachments', attachmentRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/session-types', sessionTypeRoutes);
app.route('/api/lists', listRoutes);
app.route('/api/firms', firmRoutes);
app.route('/api/accounts', accountRoutes);
app.route('/api/expenses', expenseRoutes);
app.route('/api/recurring-expenses', recurringRoutes);
app.route('/api/payouts', payoutRoutes);
app.route('/api/contracts', contractRoutes);
app.route('/api/account-groups', accountGroupRoutes);
app.route('/api/plays', playRoutes);
app.route('/api/trades', tradeRoutes);
app.route('/api/daily-reviews', dailyReviewRoutes);
app.route('/api/questions', questionRoutes);
app.route('/api/readings', readingRoutes);
app.route('/api/check-ins', checkInRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/trade-import', tradeImportRoutes);

app.onError(async (err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message, detail: err.detail }, err.status);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  await reportError(errorReporting.dsn, err, {
    platform: 'node',
    environment: errorReporting.environment,
    release: errorReporting.release,
    userId: c.get('user')?.userId,
    url: c.req.path,
    method: c.req.method,
  });
  return c.json({ error: err.message || 'Internal error' }, 500);
});
