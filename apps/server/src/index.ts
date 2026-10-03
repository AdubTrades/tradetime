import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';
import { dataDir, host, isDemo, isProduction, port, webDist } from './config';
import { sqlite } from './context';
import { seedDemo } from './demo/seed';
import { startJobs } from './jobs';

if (isProduction) {
  if (!existsSync(webDist)) console.warn(`Web build not found at ${webDist}. Run "pnpm build" first.`);
  // index.html is always re-checked so a new build shows up on the next load; hashed assets never change.
  const cacheHeaders = { onFound: (path: string, c: { header: (k: string, v: string) => void }) => c.header('Cache-Control', path.endsWith('.html') ? 'no-cache' : path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache') };
  app.use('/*', serveStatic({ root: webDist, ...cacheHeaders }));
  // Client-side routes fall back to index.html.
  app.get('*', serveStatic({ root: webDist, path: 'index.html', ...cacheHeaders }));
}

// The demo copy fills itself with sample data the first time it starts.
if (isDemo && (sqlite.prepare('SELECT count(*) AS n FROM trade').get() as { n: number }).n === 0) {
  console.log('[demo] generating sample data…');
  await seedDemo();
  console.log('[demo] sample data ready');
}

startJobs();

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`TradeTime ${isDemo ? 'DEMO ' : ''}server on http://${host}:${info.port} (data: ${dataDir})`);
});
