import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';
import { databaseUrl, host, isProduction, paths, port, webDist } from './config';
import { initDb } from './context';
import { startJobs } from './jobs';

if (isProduction) {
  if (!existsSync(webDist)) console.warn(`Web build not found at ${webDist}. Run "pnpm build" first.`);
  // index.html is always re-checked so a new build shows up on the next load; hashed assets never change.
  const cacheHeaders = { onFound: (path: string, c: { header: (k: string, v: string) => void }) => c.header('Cache-Control', path.endsWith('.html') ? 'no-cache' : path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache') };
  app.use('/*', serveStatic({ root: webDist, ...cacheHeaders }));
  // Client-side routes fall back to index.html.
  app.get('*', serveStatic({ root: webDist, path: 'index.html', ...cacheHeaders }));
}

await initDb();
startJobs();

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`TradeTime server on http://${host}:${info.port} (database: ${databaseUrl ? 'Postgres' : `PGlite at ${paths.pgdata}`})`);
});
