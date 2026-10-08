import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../../packages/db/migrations/0002_storage.sql', import.meta.url)), 'utf8');

/** A tiny stand-in for Supabase's storage and auth schemas, enough to run the storage migration against. */
const fakeSupabase = `
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage, auth to authenticated;
  grant select, insert, update on storage.objects to authenticated;
  grant usage on sequence storage.objects_id_seq to authenticated;
`;

describe('storage migration (0002)', () => {
  it('does nothing on a database without Supabase storage', async () => {
    const db = new PGlite();
    await db.exec(migration);
    expect((await db.query(`select 1 from pg_namespace where nspname = 'storage'`)).rows).toHaveLength(0);
  });

  it('creates the private bucket and limits each user to their own folder', async () => {
    const db = new PGlite();
    await db.exec(fakeSupabase);
    await db.exec(migration);
    await db.exec(migration); // safe to run again
    const bucket = (await db.query<{ public: boolean; file_size_limit: number }>(`select public, file_size_limit from storage.buckets where id = 'attachments'`)).rows[0];
    expect(bucket).toMatchObject({ public: false });

    const alice = '11111111-1111-1111-1111-111111111111';
    const bob = '22222222-2222-2222-2222-222222222222';
    const as = (user: string, sql: string) => db.exec(`begin; set local role authenticated; set local request.jwt.claim.sub = '${user}'; ${sql}; commit;`);
    await as(alice, `insert into storage.objects (bucket_id, name) values ('attachments', '${alice}/a.png')`);
    await expect(as(alice, `insert into storage.objects (bucket_id, name) values ('attachments', '${bob}/sneaky.png')`)).rejects.toThrow(/row-level security/);
    await db.exec('rollback');
    const seen = async (user: string) => {
      await db.exec(`begin; set local role authenticated; set local request.jwt.claim.sub = '${user}'`);
      const rows = (await db.query<{ name: string }>('select name from storage.objects')).rows.map((r) => r.name);
      await db.exec('commit');
      return rows;
    };
    expect(await seen(alice)).toEqual([`${alice}/a.png`]);
    expect(await seen(bob)).toEqual([]);
  });
});
