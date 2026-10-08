import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { attachmentRoutes } from './routes/attachments';
import { AppError } from './errors';
import { auth, authEnabled, fredApiKey, localUserId, storage } from './config';
import { tokenFrom, verifyAccessToken, type AuthUser } from './auth';
import { withUser } from './context';
import { dataHealth } from './health';
import { calendarRoutes } from './routes/calendar';
import { tradeImportRoutes } from './routes/tradeImport';
import { checkInRoutes, questionRoutes, readingRoutes } from './routes/checkins';
import { expenseRoutes, payoutRoutes, recurringRoutes } from './routes/expenses';
import { accountGroupRoutes, contractRoutes, dailyReviewRoutes, playRoutes, tradeRoutes } from './routes/journal';
import { accountRoutes, firmRoutes, listRoutes } from './routes/lists';
import { sessionRoutes, sessionTypeRoutes } from './routes/sessions';
import { settingsRoutes } from './routes/settings';

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
app.get('/api/health', (c) => c.json({ ok: true, startedAt, demo: false, realAppUrl: null, cloud: true, fredConfigured: !!fredApiKey, auth: authEnabled, storage: storage.remote ? { kind: 'supabase', bucket: storage.bucket } : { kind: 'local' } }));

/**
 * Who's asking: the signed-in user from their Supabase access token, or the single local user when sign-in isn't
 * configured. Every other API request then runs as that user, in one transaction with row-level security on.
 * If the handler fails, the whole request is rolled back.
 */
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next();
  let user: AuthUser = { userId: localUserId, email: null };
  let token: string | null = null;
  if (authEnabled) {
    token = tokenFrom({ method: c.req.method, header: (n) => c.req.header(n) });
    if (!token) throw new HTTPException(401, { message: 'Please sign in' });
    try {
      user = await verifyAccessToken(token);
    } catch {
      throw new HTTPException(401, { message: 'Your session has expired. Please sign in again.' });
    }
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
app.get('/api/me', (c) => c.json({ ...c.get('user'), auth: authEnabled }));
app.get('/api/health/data', async (c) => c.json(await dataHealth()));
app.route('/api/settings', settingsRoutes);
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

app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message, detail: err.detail }, err.status);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, 500);
});
