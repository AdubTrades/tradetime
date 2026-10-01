import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { attachmentRoutes } from './routes/attachments';
import { AppError } from './errors';
import { backupRoutes } from './routes/backup';
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

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/settings', settingsRoutes);
app.route('/api/attachments', attachmentRoutes);
app.route('/api/backup', backupRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/session-types', sessionTypeRoutes);

app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message, detail: err.detail }, err.status);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, 500);
});
