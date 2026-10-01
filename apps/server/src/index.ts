import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';
import { dataDir, host, isProduction, port, webDist } from './config';
import { startJobs } from './jobs';

if (isProduction) {
  if (!existsSync(webDist)) console.warn(`Web build not found at ${webDist}. Run "pnpm build" first.`);
  app.use('/*', serveStatic({ root: webDist }));
  // Client-side routes fall back to index.html.
  app.get('*', serveStatic({ root: webDist, path: 'index.html' }));
}

startJobs();

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`TradeTime server on http://${host}:${info.port} (data: ${dataDir})`);
});
