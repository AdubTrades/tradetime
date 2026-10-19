import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema } from '@tc/db';
import { rootDb } from './context';
import { useTestDb } from './testing';

useTestDb();

describe('row-level security policies', () => {
  it('every per-user table has its own-rows rule, looking up the user once per query', async () => {
    const result = (await rootDb().execute(
      sql.raw(`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'tradetime' and policyname like '%_own_rows'`),
    )) as unknown as { rows: { tablename: string; qual: string; with_check: string }[] };
    const byTable = new Map(result.rows.map((r) => [r.tablename, r]));
    for (const table of schema.userTables) {
      const p = byTable.get(table);
      expect(p, `${table} has no own-rows policy`).toBeTruthy();
      // Wrapped in a sub-select, Postgres evaluates current_setting() once per statement (Supabase "auth_rls_initplan").
      for (const clause of [p!.qual, p!.with_check]) expect(clause, table).toMatch(/user_id = \( SELECT current_setting\('app\.user_id'::text, true\)/);
    }
  });
});
