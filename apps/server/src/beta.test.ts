import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportAccount } from './accountData';
import { app } from './app';
import { rootDb } from './context';
import { subscribe } from './push';
import { asUser, useTestDb } from './testing';

useTestDb();

const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const tokenFor = (sub: string) =>
  new SignJWT({ email: `${sub.slice(0, 5)}@example.com` }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('1h').sign(secret);
const call = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { host: 'tt.example.com', authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

afterEach(() => vi.restoreAllMocks());

describe('feedback', () => {
  it('stores feedback for the sender and posts it to the webhook with their email', async () => {
    const posted: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      posted.push({ url: String(url), body: String(init?.body) });
      return new Response('ok');
    });
    const token = await tokenFor(ALICE);
    expect((await call('POST', '/api/feedback', token, { kind: 'bug', message: 'The calendar skipped a day', page: '/calendar' })).status).toBe(201);
    expect((await call('POST', '/api/feedback', token, { message: 'x' })).status).toBe(400);

    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe('https://hooks.example.test/feedback');
    expect(JSON.parse(posted[0]!.body).content).toContain('**Problem** from 11111@example.com on `/calendar`');
    const rows = (await asUser(() => exportAccount(), ALICE)).tables.feedback!;
    expect(rows).toMatchObject([{ kind: 'bug', message: 'The calendar skipped a day', page: '/calendar' }]);
    expect((await asUser(() => exportAccount(), BOB)).tables.feedback).toEqual([]);
  });

  it('limits how much one person can send in an hour', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const token = await tokenFor(ALICE);
    for (let i = 0; i < 10; i++) expect((await call('POST', '/api/feedback', token, { message: `note ${i}` })).status).toBe(201);
    expect((await call('POST', '/api/feedback', token, { message: 'one more' })).status).toBe(422);
  });
});

describe('deleting an account', () => {
  it('needs confirming, then removes every record, the devices and the sign-in, and nobody else’s', async () => {
    // A stand-in for Supabase's sign-in accounts.
    for (const stmt of ['create schema if not exists auth', 'create table if not exists auth.users (id uuid primary key)', 'truncate auth.users']) await rootDb().execute(sql.raw(stmt));
    await rootDb().execute(sql.raw(`insert into auth.users values ('${ALICE}'), ('${BOB}')`));
    const alice = await tokenFor(ALICE);
    const bob = await tokenFor(BOB);
    await call('POST', '/api/firms', alice, { name: 'Alice Funding' });
    await call('POST', '/api/firms', bob, { name: 'Bob Funding' });
    await asUser(() => subscribe({ endpoint: 'https://push.example/alice', keys: { p256dh: 'k', auth: 'a' } }), ALICE);

    expect((await call('DELETE', '/api/account', alice, {})).status).toBe(400);
    expect((await call('DELETE', '/api/account', alice, { confirm: 'delete' })).status).toBe(400);
    const res = await call('DELETE', '/api/account', alice, { confirm: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: 0, signIn: 'deleted' });

    const users = (await rootDb().execute(sql.raw(`select id::text from auth.users order by id`))) as unknown as { rows: { id: string }[] };
    expect(users.rows.map((r) => r.id)).toEqual([BOB]);
    const left = (await rootDb().execute(sql.raw(`select count(*)::int as n from tradetime.firm where user_id = '${ALICE}'`))) as unknown as { rows: { n: number }[] };
    expect(left.rows[0]!.n).toBe(0);
    const devices = (await rootDb().execute(sql.raw(`select count(*)::int as n from tradetime.push_subscription where user_id = '${ALICE}'`))) as unknown as { rows: { n: number }[] };
    expect(devices.rows[0]!.n).toBe(0);
    expect(((await (await call('GET', '/api/firms', bob)).json()) as { name: string }[]).map((f) => f.name)).toEqual(['Bob Funding']);
  });

  it('isn’t possible from the demo', async () => {
    const { token } = (await (await call('POST', '/api/demo/session', await tokenFor(ALICE))).json()) as { token: string };
    expect((await call('DELETE', '/api/account', token, { confirm: 'DELETE' })).status).toBe(403);
  }, 60_000);
});
