import { sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { beforeAll, beforeEach } from 'vitest';
import { initDb, resetSeededCache, rootDb, withUser } from './context';

/** Tests share one in-memory Postgres (PGlite) per test file. */
export const TEST_USER = 'test-user';

export function useTestDb(opts: { resetEach?: boolean } = {}) {
  beforeAll(async () => {
    await initDb({ memory: true });
  });
  if (opts.resetEach !== false) beforeEach(resetDb);
}

/** Empty every table, so each test starts from a fresh account (defaults are re-seeded on first use). */
export async function resetDb(): Promise<void> {
  const tables = [...schema.userTables, 'market_event', 'app_state'].map((t) => `"tradetime"."${t}"`).join(', ');
  await rootDb().execute(sql.raw(`truncate ${tables} cascade`));
  resetSeededCache();
}

/** Run `fn` as the test user (or another user), like an API request: one transaction, row-level security on. */
export const asUser = <T>(fn: () => Promise<T>, userId = TEST_USER): Promise<T> => withUser(userId, fn);
