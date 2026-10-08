import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import journal from '../migrations/meta/_journal.json' with { type: 'json' };
import { defaultCalendarEventTypes, defaultContracts, defaultListItems, defaultQuestions, defaultSessionTypes } from './defaults';
import * as schema from './schema';

export * as schema from './schema';
export * as defaults from './defaults';
export type { ReadingAnswer, Recurrence } from './schema';
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The migration files. Only read when migrating (local dev, tests, and the deploy's migrate step). */
const migrationsFolder = () => fileURLToPath(new URL('../migrations', import.meta.url));

export interface Database {
  db: Db;
  close: () => Promise<void>;
}

/**
 * Open the database and (unless `migrate: false`) apply pending migrations.
 * - `url`: a Postgres connection string (Supabase; use the transaction pooler for serverless).
 * - otherwise PGlite, an in-process Postgres: `dir` for a folder on disk (local dev), or in memory (tests).
 *   Loaded only when used, so the deployed server doesn't carry it.
 * The deployed server opens with `migrate: false`: production migrations run once, in the deploy's build step.
 */
export async function openDb(opts: { url?: string; dir?: string; migrate?: boolean } = {}): Promise<Database> {
  const migrate = opts.migrate !== false;
  if (opts.url) {
    // prepare: false is required by Supabase's transaction-mode pooler.
    const client = postgres(opts.url, { prepare: false, max: Number(process.env.TC_DB_POOL ?? 5), onnotice: () => undefined });
    const db = drizzlePostgres(client, { schema }) as unknown as Db;
    if (migrate) {
      const { migrate: run } = await import('drizzle-orm/postgres-js/migrator');
      await run(db as never, { migrationsFolder: migrationsFolder() });
    }
    return { db, close: () => client.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const client = new PGlite(opts.dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  if (migrate) {
    const { migrate: run } = await import('drizzle-orm/pglite/migrator');
    await run(db as never, { migrationsFolder: migrationsFolder() });
  }
  return { db, close: () => client.close() };
}

/**
 * Run `fn` as one user: inside a transaction, as the restricted app role, with app.user_id set, so row-level
 * security limits every query to that user's rows and new rows get their user_id automatically.
 */
export async function asUser<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (!userId) throw new Error('asUser: missing user id');
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role tradetime_app`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}

/** Create the user's profile and default lists the first time they're seen. Call inside `asUser`. */
export async function ensureUserSeeded(tx: Db, userId: string): Promise<boolean> {
  const existing = await tx.select({ userId: schema.userProfile.userId }).from(schema.userProfile).limit(1);
  if (existing.length) return false;
  await tx.insert(schema.userProfile).values({ userId });
  await tx.insert(schema.sessionType).values(defaultSessionTypes);
  await tx.insert(schema.listItem).values(defaultListItems);
  await tx.insert(schema.contract).values(defaultContracts);
  await tx.insert(schema.question).values(defaultQuestions.map((q) => ({ ...q })));
  await tx.insert(schema.calendarEventType).values(defaultCalendarEventTypes);
  return true;
}

/** Ids of every account the app has seen (for background jobs). Runs outside any user transaction. */
export async function listUserIds(db: Db): Promise<string[]> {
  const rows = await db.select({ userId: schema.userProfile.userId }).from(schema.userProfile);
  return rows.map((r) => r.userId);
}

/** Number of migrations this version of the app knows about. */
export function knownMigrationCount(): number {
  return journal.entries.length;
}
