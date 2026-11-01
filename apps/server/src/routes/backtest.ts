import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { storage } from '../config';
import { AppError } from '../errors';
import type { AuthUser } from '../auth';
import { canBacktest, isMarketPath, localMarketFile, marketFileLink } from '../marketData';

/** The backtesting page's price history. Owner only (see `canBacktest`). */
export const backtestRoutes = new Hono<{ Variables: { user: AuthUser } }>()
  .use(async (c, next) => {
    const user = c.get('user');
    if (!canBacktest(user.userId, !!user.demo)) throw new AppError(404, 'Not found');
    await next();
  })
  /** One price file (gzipped JSON; the browser unpacks it). Missing files are a 404: no data for that day. */
  .get('/data/*', async (c) => {
    const p = c.req.path.replace(/^\/api\/backtest\/data\//, '');
    if (!isMarketPath(p)) return c.json({ error: 'Not found' }, 404);
    if (storage.remote) {
      const url = await marketFileLink(p);
      if (!url) return c.json({ error: 'No data' }, 404);
      c.header('Cache-Control', 'private, max-age=300');
      return c.redirect(url, 302);
    }
    const file = localMarketFile(p);
    if (!existsSync(file)) return c.json({ error: 'No data' }, 404);
    c.header('Content-Type', 'application/gzip');
    c.header('Content-Length', String(statSync(file).size));
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
  });
