import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { attachmentRoutes } from './routes/attachments';
import { AppError } from './errors';
import { fredApiKey, localUserId } from './config';
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

export const app = new Hono();

// The server only listens on 127.0.0.1, but also reject foreign Host/Origin headers
// so a malicious web page can't reach it via DNS rebinding or cross-site requests.
app.use('/api/*', async (c, next) => {
  const hostHeader = c.req.header('host') ?? '';
  if (!localHost.test(hostHeader)) throw new HTTPException(403, { message: 'Forbidden host' });
  const origin = c.req.header('origin');
  if (origin && c.req.method !== 'GET') {
    const originHost = URL.canParse(origin) ? new URL(origin).host : '';
    if (!localHost.test(originHost)) throw new HTTPException(403, { message: 'Forbidden origin' });
  }
  await next();
});

const startedAt = new Date().toISOString();
app.get('/api/health', (c) => c.json({ ok: true, startedAt, demo: false, realAppUrl: null, cloud: true, fredConfigured: !!fredApiKey }));

/**
 * Every other API request runs as one user, in one transaction with row-level security on. Until sign-in
 * arrives (Phase 2) that's the single local user. If the handler fails, the whole request is rolled back.
 */
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next();
  try {
    await withUser(localUserId, async () => {
      await next();
      if (c.error) throw c.error;
    });
  } catch (err) {
    // The error response was already rendered by onError; rethrow anything else.
    if (err !== c.error) throw err;
  }
});
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
