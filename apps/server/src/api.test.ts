import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { app } from './app';
import { useTestDb } from './testing';

useTestDb();

const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const tokenFor = (sub: string, opts: { expiresIn?: string; aud?: string } = {}) =>
  new SignJWT({ email: `${sub}@example.com`, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(secret);

const HOST = 'tradetime.example.com';
async function call(method: string, path: string, opts: { token?: string; cookie?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { host: HOST };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = `tt_at=${opts.cookie}`;
  if (opts.origin) headers.origin = opts.origin;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as never };
}

describe('sign-in', () => {
  it('requires a valid, unexpired token for everything except health', async () => {
    expect((await call('GET', '/api/health')).status).toBe(200);
    expect((await call('GET', '/api/settings')).status).toBe(401);
    expect((await call('GET', '/api/settings', { token: 'not-a-jwt' })).status).toBe(401);
    expect((await call('GET', '/api/settings', { token: await tokenFor('alice', { expiresIn: '-1m' }) })).status).toBe(401);
    expect((await call('GET', '/api/settings', { token: await tokenFor('alice', { aud: 'anon' }) })).status).toBe(401);
    const me = await call('GET', '/api/me', { token: await tokenFor('alice') });
    expect(me).toMatchObject({ status: 200, json: { userId: 'alice', email: 'alice@example.com', auth: true } });
  });

  it('gives a new account its own default lists', async () => {
    const res = await call('GET', '/api/session-types', { token: await tokenFor('new-user') });
    expect(res.status).toBe(200);
    expect((res.json as { id: string }[]).map((t) => t.id)).toContain('st_trading');
  });

  it("keeps users' data apart through every kind of request", async () => {
    const alice = await tokenFor('alice');
    const bob = await tokenFor('bob');
    const firm = await call('POST', '/api/firms', { token: alice, body: { name: 'Alice Funding' } });
    expect(firm.status).toBe(201);
    const firmId = (firm.json as { id: string }).id;
    const event = await call('POST', '/api/calendar/events', { token: alice, body: { typeId: 'cet_general', title: 'Alice only', date: '2026-10-09' } });
    expect(event.status).toBe(201);

    // Bob can't see, change or delete Alice's records.
    expect((await call('GET', '/api/firms', { token: bob })).json).toEqual([]);
    expect((await call('PATCH', `/api/firms/${firmId}`, { token: bob, body: { name: 'Hijacked' } })).status).toBe(404);
    expect(((await call('GET', '/api/calendar/upcoming?days=7', { token: bob })).json as { occurrences: unknown[] }).occurrences).toEqual([]);
    await call('PATCH', '/api/settings', { token: bob, body: { theme: 'dark' } });

    // Alice still has hers, unchanged, and Bob's settings didn't touch hers.
    expect(((await call('GET', '/api/firms', { token: alice })).json as { name: string }[]).map((f) => f.name)).toEqual(['Alice Funding']);
    expect((await call('GET', '/api/settings', { token: alice })).json).toMatchObject({ theme: 'system' });
  });

  it('accepts the cookie only for reads, and refuses changes from other sites', async () => {
    const alice = await tokenFor('alice');
    expect((await call('GET', '/api/settings', { cookie: alice })).status).toBe(200);
    expect((await call('POST', '/api/firms', { cookie: alice, body: { name: 'Via cookie' } })).status).toBe(401);
    expect((await call('POST', '/api/firms', { token: alice, origin: 'https://evil.example', body: { name: 'Cross-site' } })).status).toBe(403);
    expect((await call('POST', '/api/firms', { token: alice, origin: `https://${HOST}`, body: { name: 'Same site' } })).status).toBe(201);
  });

  it("doesn't serve one user's files to another", async () => {
    const alice = await tokenFor('alice');
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'chart.png', { type: 'image/png' }));
    const up = await app.request('/api/attachments', { method: 'POST', headers: { host: HOST, authorization: `Bearer ${alice}` }, body: form });
    expect(up.status).toBe(201);
    const { attachment } = ((await up.json()) as { attachment: { id: string } }[])[0]!;
    expect((await call('GET', `/api/attachments/${attachment.id}/file`, { cookie: alice })).status).toBe(200);
    expect((await call('GET', `/api/attachments/${attachment.id}/file`, { token: await tokenFor('bob') })).status).toBe(404);
  });
});
