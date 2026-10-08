import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { defaultCalendarEventTypes, defaultContracts, defaultListItems, defaultQuestions, defaultSessionTypes } from './defaults';
import * as schema from './schema';

export * as schema from './schema';
export * as defaults from './defaults';
export type { ReadingAnswer, Recurrence } from './schema';
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export interface Database {
  db: Db;
  close: () => Promise<void>;
}

/**
 * Open the database and apply pending migrations.
 * - `url`: a Postgres connection string (Supabase; use the transaction pooler for serverless).
 * - otherwise PGlite, an in-process Postgres: `dir` for a folder on disk (local dev), or in memory (tests).
 */
export async function openDb(opts: { url?: string; dir?: string } = {}): Promise<Database> {
  if (opts.url) {
    // prepare: false is required by Supabase's transaction-mode pooler.
    const client = postgres(opts.url, { prepare: false, max: Number(process.env.TC_DB_POOL ?? 5), onnotice: () => undefined });
    const db = drizzlePostgres(client, { schema }) as unknown as Db;
    await migratePostgres(db as never, { migrationsFolder });
    return { db, close: () => client.end() };
  }
  const client = new PGlite(opts.dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migratePglite(db as never, { migrationsFolder });
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
  const journal = JSON.parse(readFileSync(fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url)), 'utf8')) as { entries: unknown[] };
  return journal.entries.length;
}
