import path from 'node:path';

export const isProduction = process.env.NODE_ENV === 'production';
export const port = Number(process.env.TC_PORT ?? 4317);
export const host = process.env.TC_HOST ?? '127.0.0.1';

/**
 * Database: a Postgres URL (Supabase, via the transaction pooler) when DATABASE_URL is set; otherwise PGlite,
 * an in-process Postgres stored in TC_DATA_DIR/pgdata for local development.
 */
export const databaseUrl = process.env.DATABASE_URL || null;

export const dataDir = path.resolve(process.env.TC_DATA_DIR ?? path.join(process.cwd(), 'data-local'));
export const paths = {
  pgdata: path.join(dataDir, 'pgdata'),
  attachments: path.join(dataDir, 'attachments'),
  tmp: path.join(dataDir, 'tmp'),
};

/** Without sign-in configured (local development), every request acts as this one local user. */
export const localUserId = process.env.TC_LOCAL_USER ?? 'local';

/**
 * Sign-in (Supabase Auth). When SUPABASE_URL (or SUPABASE_JWT_SECRET) is set, every API request needs a valid
 * Supabase access token; otherwise the app runs as the single local user above (local development).
 * - SUPABASE_URL: the project URL; its public signing keys verify tokens (current Supabase projects).
 * - SUPABASE_JWT_SECRET: the legacy shared JWT secret, for older projects and tests.
 * - APP_ORIGINS: extra comma-separated origins allowed to send changes (the app's own origin always is).
 */
export const auth = {
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, '') || null,
  jwtSecret: process.env.SUPABASE_JWT_SECRET || null,
  allowedOrigins: (process.env.APP_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
};
export const authEnabled = !!(auth.supabaseUrl || auth.jwtSecret);

/** Economic events are fetched once for everyone with the server's FRED key (free from fred.stlouisfed.org). */
export const fredApiKey = process.env.FRED_API_KEY || null;

export const webDist = path.resolve(import.meta.dirname, '../../web/dist');
