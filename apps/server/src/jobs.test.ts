import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app';
import * as cal from './calendar';
import { claimLease, runTick } from './jobs';
import { listSubscriptions, setPushSender, subscribe } from './push';
import * as sessions from './sessions';
import * as settings from './settings';
import { asUser, useTestDb } from './testing';

useTestDb();

/** A fake push service that records what it would have delivered, by endpoint. */
let delivered: { endpoint: string; title: string; body: string; url?: string }[] = [];
let gone = new Set<string>();
beforeEach(() => {
  delivered = [];
  gone = new Set();
  setPushSender(async (sub, payload) => {
    if (gone.has(sub.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    delivered.push({ endpoint: sub.endpoint, ...(JSON.parse(payload) as { title: string; body: string; url?: string }) });
  });
});

const device = (name: string) => ({ endpoint: `https://push.example.com/${name}`, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('scheduled jobs', () => {
  it('only lets one tick run at a time', async () => {
    const now = Date.now();
    expect(await claimLease('test.lease', 30_000, now)).toBe(true);
    expect(await claimLease('test.lease', 30_000, now + 1_000)).toBe(false);
    expect(await claimLease('test.lease', 30_000, now + 31_000)).toBe(true);
    expect((await runTick(now)).ran).toBe(true);
    expect((await runTick(now + 5_000)).ran).toBe(false);
  });

  it('pushes a due check-in to each of the user’s devices, once', async () => {
    await asUser(async () => {
      await settings.updateSettings({ checkInEnabled: true, checkInMinutes: 90, checkInSecondMinutes: null });
      await subscribe(device('alice-phone'));
      await subscribe(device('alice-laptop'));
      await sessions.startTimer('st_trading', minsAgo(95));
    }, 'alice');
    await asUser(() => subscribe(device('bob-phone')).then(() => undefined), 'bob');

    await runTick(Date.now() + 120_000);
    expect(delivered.map((d) => d.endpoint).sort()).toEqual(['https://push.example.com/alice-laptop', 'https://push.example.com/alice-phone']);
    expect(delivered[0]).toMatchObject({ title: 'Time to check in', url: '/time-log' });

    delivered = [];
    await runTick(Date.now() + 240_000);
    expect(delivered).toEqual([]);
  });

  it('sends event reminders when their time passes, and forgets devices that are gone', async () => {
    await asUser(async () => {
      await settings.updateSettings({ timeZone: 'UTC', checkInEnabled: false });
      await subscribe(device('old-phone'));
      await subscribe(device('new-phone'));
      // Starts about 12 minutes from now with a 10-minute reminder, so the reminder falls 1–2 minutes from now.
      const start = new Date(Date.now() + 12 * 60_000);
      await cal.createEvent({ typeId: 'cet_general', title: 'NY open', date: start.toISOString().slice(0, 10), startTime: start.toISOString().slice(11, 16), reminderMinutes: 10 });
    }, 'carol');
    gone.add('https://push.example.com/old-phone');

    const now = Date.now();
    await runTick(now);
    expect(delivered).toEqual([]);
    await runTick(now + 3 * 60_000);
    expect(delivered.map((d) => [d.endpoint, d.title])).toEqual([['https://push.example.com/new-phone', 'NY open']]);
    expect((await asUser(() => listSubscriptions(), 'carol')).length).toBe(1);
  });
});

describe('/api/jobs/tick', () => {
  afterEach(() => {
    delete process.env.JOBS_SECRET;
  });
  const post = (auth?: string) => app.request('/api/jobs/tick', { method: 'POST', headers: { host: 'tradetime.example.com', ...(auth ? { authorization: auth } : {}) } });

  it('is off without a secret, refuses a wrong one, and runs with the right one', async () => {
    expect((await post('Bearer anything')).status).toBe(404);
    process.env.JOBS_SECRET = 'cron-secret-for-tests';
    expect((await post()).status).toBe(403);
    expect((await post('Bearer wrong')).status).toBe(403);
    const ok = await post('Bearer cron-secret-for-tests');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ran: true });
  });
});

describe('/api/push', () => {
  it('keeps each user’s devices to themselves', async () => {
    const token = (sub: string) =>
      new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setAudience('authenticated')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
    const call = async (method: string, path: string, sub: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { host: 'tradetime.example.com', authorization: `Bearer ${await token(sub)}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect(await (await call('GET', '/api/push/key', 'dave')).json()).toMatchObject({ enabled: true });
    expect((await call('POST', '/api/push/subscribe', 'dave', device('dave-phone'))).status).toBe(201);
    expect(await (await call('GET', '/api/push/subscriptions', 'erin')).json()).toEqual([]);
    expect(((await (await call('GET', '/api/push/subscriptions', 'dave')).json()) as unknown[]).length).toBe(1);
    expect((await call('POST', '/api/push/test', 'dave')).status).toBe(204);
    expect(delivered.map((d) => d.endpoint)).toEqual(['https://push.example.com/dave-phone']);
  });
});
