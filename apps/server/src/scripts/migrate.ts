/**
 * Apply pending database migrations to DATABASE_MIGRATION_URL (or DATABASE_URL). Run by the production deploy's build
 * step (scripts/vercel-build.mjs), so the live database is never migrated by hand or from a preview build.
 * Usage: pnpm --filter @tc/server db:migrate
 */
import { knownMigrationCount, openDb } from '@tc/db';

const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set; nothing to migrate.');
  process.exit(1);
}
const started = Date.now();
const db = await openDb({ url });
await db.close();
console.log(`Database is up to date (${knownMigrationCount()} migrations, ${Date.now() - started} ms).`);
