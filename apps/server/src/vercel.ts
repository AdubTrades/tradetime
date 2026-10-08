/**
 * The API as one Vercel Function. scripts/vercel-build.mjs bundles this file (and everything it imports) into
 * .vercel/output/functions/api.func; every /api/* request is routed here with its original path.
 *
 * Differences from the local server (index.ts): no static files (Vercel serves the web build), no in-process
 * timers (Supabase pg_cron calls /api/jobs/tick), and no migrations at start-up (the production build runs them).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { app } from './app';
import { authEnabled, databaseUrl, storage } from './config';
import { initDb } from './context';

/** Settings the hosted app can't run without: a database, sign-in and file storage. */
const missing = [!databaseUrl && 'DATABASE_URL', !authEnabled && 'SUPABASE_URL', !storage.remote && 'SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);

const listener = getRequestListener(app.fetch);
let ready: Promise<unknown> | null = null;

function fail(res: ServerResponse, status: number, error: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (missing.length) return fail(res, 500, `The server isn’t configured yet: set ${missing.join(', ')} in Vercel.`);
  // One connection pool per function instance, reused across requests.
  ready ??= initDb({ migrate: false });
  try {
    await ready;
  } catch (err) {
    ready = null;
    console.error(`[db] ${(err as Error).message}`);
    return fail(res, 503, 'The database isn’t reachable right now. Please try again in a moment.');
  }
  await listener(req, res);
}
