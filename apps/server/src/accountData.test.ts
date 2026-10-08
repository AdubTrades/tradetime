import { gunzipSync, gzipSync } from 'node:zlib';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { exportAccount, importAccount, type AccountExport } from './accountData';
import { createFirm, listFirms } from './accounts';
import { app } from './app';
import { cleanUpDemos } from './demo/account';
import { seedDemo } from './demo/seed';
import { listSubscriptions, subscribe } from './push';
import { asUser, useTestDb } from './testing';
import { listTrades } from './trades';

useTestDb();

const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const tokenFor = (sub: string) =>
  new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('1h').sign(secret);

const HOST = 'tradetime.example.com';
async function call(method: string, path: string, opts: { token?: string; body?: BodyInit; type?: string } = {}) {
  const headers: Record<string, string> = { host: HOST };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.type) headers['content-type'] = opts.type;
  return app.request(path, { method, headers, body: opts.body });
}
const json = (value: unknown) => ({ body: JSON.stringify(value), type: 'application/json' });

/** An export without the timestamp, with rows sorted, for comparing two accounts' contents. */
const contents = (e: AccountExport) =>
  Object.fromEntries(Object.entries(e.tables).map(([name, rows]) => [name, [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));

const range = { from: '2000-01-01', to: '2100-01-01' };

describe('account export and import', () => {
  it('copies a whole account into another, replacing what was there and keeping its devices', async () => {
    await asUser(() => seedDemo(), 'alice');
    const fromAlice = await asUser(() => exportAccount(), 'alice');
    expect(fromAlice.tables.trade!.length).toBeGreaterThan(40);
    expect(fromAlice.tables.attachment!.length).toBeGreaterThan(0);
    expect(JSON.stringify(fromAlice)).not.toContain('"userId"');

    await asUser(async () => {
      await createFirm({ name: 'Bob’s old firm' });
      await subscribe({ endpoint: 'https://push.example/bob', keys: { p256dh: 'k', auth: 'a' } });
    }, 'bob');
    const result = await asUser(() => importAccount(fromAlice), 'bob');
    expect(result).toMatchObject({ missingFiles: 0, counts: { trade: fromAlice.tables.trade!.length } });

    const intoBob = await asUser(() => exportAccount(), 'bob');
    expect(contents(intoBob)).toEqual(contents(fromAlice));
    await asUser(async () => {
      expect((await listFirms()).map((f) => f.name)).not.toContain('Bob’s old firm');
      expect(await listSubscriptions()).toHaveLength(1);
      // Settings come across too, and apply straight away.
      expect((await import('./settings')).getSettings().reportName).toBe('Alex Morgan');
    }, 'bob');
    // Alice is untouched.
    expect((await asUser(() => listTrades(range), 'alice')).length).toBe(fromAlice.tables.trade!.length);
  }, 60_000);

  it('changes nothing if any row is bad', async () => {
    await asUser(() => createFirm({ name: 'Keep me' }), 'carol');
    const broken: AccountExport = {
      app: 'tradetime',
      kind: 'account-export',
      formatVersion: 1,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: { firm: [{ id: 'f1', name: 'New firm' }], account: [{ id: 'a1', firmId: 'missing-firm', name: 'Orphan', type: 'funded', status: 'active' }] },
    };
    await expect(asUser(() => importAccount(broken), 'carol')).rejects.toThrow(/Couldn’t import account/);
    expect((await asUser(() => listFirms(), 'carol')).map((f) => f.name)).toEqual(['Keep me']);
  });

  it('refuses exports from a newer version, other files and unknown tables', async () => {
    const base = await asUser(() => exportAccount(), 'dave');
    await expect(asUser(() => importAccount({ ...base, schemaVersion: base.schemaVersion + 1 }), 'dave')).rejects.toThrow(/newer version/);
    await expect(asUser(() => importAccount({ hello: 'world' }), 'dave')).rejects.toThrow(/TradeTime/);
    await expect(asUser(() => importAccount({ ...base, tables: { ...base.tables, mystery: [] } }), 'dave')).rejects.toThrow(/doesn’t know/);
  });

  it('round-trips over HTTP as gzipped JSON, per user', async () => {
    const erin = await tokenFor('erin');
    const frank = await tokenFor('frank');
    await call('POST', '/api/firms', { token: erin, ...json({ name: 'Erin Funding' }) });
    const res = await call('GET', '/api/account/export', { token: erin });
    expect(res.headers.get('content-type')).toBe('application/gzip');
    const gz = Buffer.from(await res.arrayBuffer());
    const data = JSON.parse(gunzipSync(gz).toString()) as AccountExport;
    expect(data.tables.firm!.map((f) => f.name)).toEqual(['Erin Funding']);

    const plan = await call('POST', '/api/account/import/files', { token: frank, ...json({ files: [{ sha256: 'a'.repeat(64), mime: 'image/png', bytes: 10 }] }) });
    expect(await plan.json()).toEqual({ mode: 'local', missing: ['a'.repeat(64)] });
    const tooBig = await call('POST', '/api/account/import/files', { token: frank, ...json({ files: [{ sha256: 'a'.repeat(64), mime: 'image/png', bytes: 200 * 1024 * 1024 }] }) });
    expect(tooBig.status).toBe(422);

    const imported = await call('POST', '/api/account/import', { token: frank, body: gzipSync(JSON.stringify(data)), type: 'application/gzip' });
    expect(imported.status).toBe(200);
    expect((await (await call('GET', '/api/firms', { token: frank })).json()).map((f: { name: string }) => f.name)).toEqual(['Erin Funding']);
    expect((await call('POST', '/api/account/import', { token: frank, body: 'not json', type: 'application/json' })).status).toBe(422);
  });
});

describe('demo', () => {
  it('needs a signed-in user (unless public), and gives each visitor their own copy', async () => {
    expect((await call('POST', '/api/demo/session')).status).toBe(401);
    const signedIn = await tokenFor('gina');
    const first = (await (await call('POST', '/api/demo/session', { token: signedIn })).json()) as { token: string };
    const second = (await (await call('POST', '/api/demo/session', { token: signedIn })).json()) as { token: string };

    const me = await (await call('GET', '/api/me', { token: first.token })).json();
    expect(me).toMatchObject({ demo: true, email: null });
    expect(me.userId).toMatch(/^demo-/);
    const trades = (await (await call('GET', '/api/trades?from=2000-01-01&to=2100-01-01', { token: first.token })).json()) as unknown[];
    expect(trades.length).toBeGreaterThan(40);

    // One visitor's changes don't reach the other, or the signed-in user's own account.
    await call('POST', '/api/firms', { token: first.token, ...json({ name: 'Scribble' }) });
    const firmNames = async (token: string) => ((await (await call('GET', '/api/firms', { token })).json()) as { name: string }[]).map((f) => f.name);
    expect(await firmNames(first.token)).toContain('Scribble');
    expect(await firmNames(second.token)).not.toContain('Scribble');
    expect(await firmNames(signedIn)).toEqual([]);

    // Screenshots are drawn on request.
    const plays = (await (await call('GET', '/api/plays', { token: first.token })).json()) as { coverAttachmentIds: string[] }[];
    const file = await call('GET', `/api/attachments/${plays[0]!.coverAttachmentIds[0]}/file`, { token: first.token });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
  }, 60_000);

  it('blocks what would reach outside the sample account', async () => {
    const { token } = (await (await call('POST', '/api/demo/session', { token: await tokenFor('hal') })).json()) as { token: string };
    expect((await call('POST', '/api/account/import', { token, ...json({}) })).status).toBe(403);
    expect((await call('POST', '/api/push/subscribe', { token, ...json({ endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } }) })).status).toBe(403);
    expect((await call('POST', '/api/attachments/prepare', { token, ...json({}) })).status).toBe(403);
    expect((await call('PATCH', '/api/settings', { token, ...json({ fredApiKey: 'a'.repeat(32) }) })).status).toBe(403);
    expect((await call('PATCH', '/api/settings', { token, ...json({ theme: 'dark' }) })).status).toBe(200);
    expect((await call('GET', '/api/account/export', { token })).status).toBe(200);
    // A forged or expired demo token is refused.
    expect((await call('GET', '/api/me', { token: token.slice(0, -4) + 'AAAA' })).status).toBe(401);
  }, 60_000);

  it('removes copies older than a day', async () => {
    const { token } = (await (await call('POST', '/api/demo/session', { token: await tokenFor('ivy') })).json()) as { token: string };
    expect(await cleanUpDemos()).toBe(0);
    expect(await cleanUpDemos(Date.now() + 26 * 3600_000)).toBe(1);
    // The copy is gone (a request would just start an empty account, so check the data directly).
    const me = (await (await call('GET', '/api/me', { token })).json()) as { userId: string };
    expect(await asUser(() => listTrades(range), me.userId)).toEqual([]);
  }, 60_000);
});
