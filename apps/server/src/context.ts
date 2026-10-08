import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { asUser, ensureUserSeeded, openDb, type Database, type Db } from '@tc/db';
import { databaseUrl, paths } from './config';
import { loadSettings, type Settings } from './settings';

interface UserScope {
  userId: string;
  tx: Db;
  /** Loaded once per scope so date maths can read settings synchronously. */
  settings: Settings;
}

let database: Database | null = null;
const scope = new AsyncLocalStorage<UserScope>();

/** Open the database once (Supabase when DATABASE_URL is set, else PGlite on disk) and apply migrations. */
export async function initDb(opts?: { url?: string; dir?: string; memory?: boolean }): Promise<Database> {
  if (database) return database;
  if (opts?.memory) database = await openDb();
  else if (opts?.url ?? databaseUrl) database = await openDb({ url: opts?.url ?? databaseUrl! });
  else {
    mkdirSync(paths.pgdata, { recursive: true });
    database = await openDb({ dir: opts?.dir ?? paths.pgdata });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await database?.close();
  database = null;
}

function root(): Db {
  if (!database) throw new Error('Database not initialised: call initDb() first');
  return database.db;
}

/**
 * The database for the current request: the signed-in user's transaction (row-level security applies), or
 * the root connection outside a user scope (shared tables only). Code keeps writing `db.select()…`.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = scope.getStore()?.tx ?? root();
    const value = Reflect.get(target as object, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/** The root connection, for app-wide tables and admin work outside any user. */
export const rootDb = (): Db => root();

const seeded = new Set<string>();

/** Run `fn` as `userId`: one transaction, row-level security on, defaults seeded on first use. */
export async function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return asUser(root(), userId, async (tx) => {
    if (!seeded.has(userId)) {
      await ensureUserSeeded(tx, userId);
      seeded.add(userId);
    }
    const settings = await loadSettings(tx);
    return scope.run({ userId, tx, settings }, fn);
  });
}

export function currentScope(): UserScope {
  const s = scope.getStore();
  if (!s) throw new Error('No user scope: wrap this call in withUser()');
  return s;
}

export const currentUserId = (): string => currentScope().userId;

/** Forget which users have been seeded (tests that wipe the database). */
export function resetSeededCache(): void {
  seeded.clear();
}
