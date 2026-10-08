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

/**
 * Until real sign-in arrives (Phase 2), every request acts as this one local user. Tests and jobs pass their
 * own user ids explicitly.
 */
export const localUserId = process.env.TC_LOCAL_USER ?? 'local';

/** Economic events are fetched once for everyone with the server's FRED key (free from fred.stlouisfed.org). */
export const fredApiKey = process.env.FRED_API_KEY || null;

export const webDist = path.resolve(import.meta.dirname, '../../web/dist');
