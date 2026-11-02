import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { addSnapshot, closePosition, DEFAULT_LINE_LABEL, DEFAULT_LINE_STYLE, marketOrder, newSimAccount } from '@tc/domain';
import { app } from './app';
import { backtest } from './config';
import { useTestDb } from './testing';

useTestDb();

const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const tokenFor = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('1h').sign(secret);
const call = async (method: string, path: string, sub: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { host: 'tt.example.com', authorization: `Bearer ${await tokenFor(sub)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const line = { id: 'l1', kind: 'hray', price: 21000.25, time: 1_780_000_000, style: DEFAULT_LINE_STYLE, label: { ...DEFAULT_LINE_LABEL, text: 'Asia High' }, hiddenOn: ['1W'] };

afterEach(() => backtest.ownerIds.splice(0));

describe('backtesting routes', () => {
  it('are only for the owner', async () => {
    backtest.ownerIds.push(OWNER);
    expect((await call('GET', '/api/backtest/line-tools', OTHER)).status).toBe(404);
    expect(await (await call('GET', '/api/me', OTHER)).json()).toMatchObject({ backtest: false });
    expect(await (await call('GET', '/api/me', OWNER)).json()).toMatchObject({ backtest: true });
  });

  it('keep sessions, each with its own lines and practice account; templates are shared', async () => {
    backtest.ownerIds.push(OWNER);
    const create = (name: string) => call('POST', '/api/backtest/sessions', OWNER, { name, instrument: 'BTCUSDT', startBalance: 10_000, cursor: null, tf: '5m' });
    const a = (await (await create('FVGC Practice')).json()) as { id: string; accountId: string };
    const b = (await (await create('Other')).json()) as { id: string };
    expect((await create('fvgc practice')).status).toBe(409);
    expect(((await (await call('GET', '/api/backtest/sessions', OWNER)).json()) as unknown[]).length).toBe(2);

    expect((await call('PUT', `/api/backtest/drawings/${a.id}`, OWNER, { lines: [line] })).status).toBe(200);
    expect(await (await call('GET', `/api/backtest/drawings/${a.id}`, OWNER)).json()).toEqual({ lines: [line] });
    expect(await (await call('GET', `/api/backtest/drawings/${b.id}`, OWNER)).json()).toEqual({ lines: [] });
    expect(await (await call('GET', `/api/backtest/sim/${a.id}`, OWNER)).json()).toMatchObject({ startBalance: 10_000, trades: [] });

    const tools = { templates: [{ id: 't1', name: 'Asia High', style: DEFAULT_LINE_STYLE, label: line.label }], last: null };
    expect((await call('PUT', '/api/backtest/line-tools', OWNER, tools)).status).toBe(200);
    expect(await (await call('GET', '/api/backtest/line-tools', OWNER)).json()).toEqual(tools);

    expect((await call('DELETE', `/api/backtest/sessions/${b.id}`, OWNER)).status).toBe(204);
    expect((await call('GET', `/api/backtest/drawings/${b.id}`, OWNER)).status).toBe(404);
  });

  it('save closed practice trades to the journal once, under the Backtesting account, with fractional sizes', async () => {
    backtest.ownerIds.push(OWNER);
    const s = (await (await call('POST', '/api/backtest/sessions', OWNER, { name: 'Crypto', instrument: 'BTCUSDT', startBalance: 10_000, cursor: null, tf: '5m' })).json()) as {
      id: string;
      accountId: string;
    };
    const spec = { symbol: 'BTCUSDT', pointValue: 1, feePerSide: 0, feeRate: 0.001 };
    let acc = marketOrder(newSimAccount(10_000), spec, 'buy', 0.05, 80_000, 1_790_000_000, { stop: 79_000, target: 82_000 });
    acc = closePosition(acc, spec, acc.positions[0]!.id, 81_000, 1_790_003_600);
    const put = await call('PUT', `/api/backtest/sim/${s.id}`, OWNER, acc);
    expect(await put.json()).toEqual({ journaled: 1, failed: [] });
    // Saving again doesn't add it twice.
    expect(await (await call('PUT', `/api/backtest/sim/${s.id}`, OWNER, acc)).json()).toEqual({ journaled: 0, failed: [] });

    const trades = (await (await call('GET', '/api/trades?from=2000-01-01&to=2100-01-01', OWNER)).json()) as {
      source: string;
      needsReview: boolean;
      stopPrice: number;
      targetPrice: number;
      notes: string;
      accounts: { accountId: string; maxQty: number; grossCents: number; feesCents: number }[];
    }[];
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ source: 'backtest', needsReview: true, stopPrice: 79_000, targetPrice: 82_000, notes: 'Backtest: Crypto' });
    expect(trades[0]!.accounts[0]).toMatchObject({ accountId: s.accountId, maxQty: 0.05, grossCents: 5000, feesCents: Math.round((4 + 4.05) * 100) });
    const accounts = (await (await call('GET', '/api/accounts', OWNER)).json()) as { id: string; name: string }[];
    expect(accounts.find((a) => a.id === s.accountId)?.name).toBe('Backtesting');
    expect(((await (await call('GET', '/api/backtest/sessions', OWNER)).json()) as { trades: number; net: number }[])[0]).toMatchObject({ trades: 1 });
  });

  it('give journaled trades the session’s strategy (Playbook Play)', async () => {
    backtest.ownerIds.push(OWNER);
    const play = (await (await call('POST', '/api/plays', OWNER, { title: 'FVG continuation' })).json()) as { id: string };
    const res = await call('POST', '/api/backtest/sessions', OWNER, {
      name: 'FVG',
      description: 'London open only',
      playId: play.id,
      instrument: 'BTCUSDT',
      startBalance: 10_000,
      cursor: null,
      tf: '5m',
    });
    const s = (await res.json()) as { id: string; description: string; playId: string };
    expect(s).toMatchObject({ description: 'London open only', playId: play.id });
    const spec = { symbol: 'BTCUSDT', pointValue: 1, feePerSide: 0, feeRate: 0.001 };
    let acc = marketOrder(newSimAccount(10_000), spec, 'buy', 0.05, 80_000, 1_790_000_000);
    acc = closePosition(acc, spec, acc.positions[0]!.id, 81_000, 1_790_003_600);
    await call('PUT', `/api/backtest/sim/${s.id}`, OWNER, acc);
    const trades = (await (await call('GET', '/api/trades?from=2000-01-01&to=2100-01-01', OWNER)).json()) as { playId: string | null }[];
    expect(trades[0]!.playId).toBe(play.id);
    expect((await call('PATCH', `/api/backtest/sessions/${s.id}`, OWNER, { playId: 'nope' })).status).toBe(422);
    expect(await (await call('PATCH', `/api/backtest/sessions/${s.id}`, OWNER, { playId: null, description: '  ' })).json()).toMatchObject({ playId: null, description: null });
  });

  it('put chart snapshots on the journal trade, including ones taken after it was saved', async () => {
    backtest.ownerIds.push(OWNER);
    const upload = async () => {
      const form = new FormData();
      form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9, Math.random() * 255])], 'snap.jpg', { type: 'image/jpeg' }));
      const res = await app.request('/api/attachments', { method: 'POST', headers: { host: 'tt.example.com', authorization: `Bearer ${await tokenFor(OWNER)}` }, body: form });
      return ((await res.json()) as { attachment: { id: string } }[])[0]!.attachment.id;
    };
    const s = (await (await call('POST', '/api/backtest/sessions', OWNER, { name: 'Snaps', instrument: 'BTCUSDT', startBalance: 10_000, cursor: null, tf: '5m' })).json()) as { id: string };
    const spec = { symbol: 'BTCUSDT', pointValue: 1, feePerSide: 0, feeRate: 0.001 };
    let acc = marketOrder(newSimAccount(10_000), spec, 'buy', 0.05, 80_000, 1_790_000_000);
    acc = addSnapshot(acc, await upload())!;
    acc = closePosition(acc, spec, acc.positions[0]!.id, 81_000, 1_790_003_600);
    await call('PUT', `/api/backtest/sim/${s.id}`, OWNER, acc);
    acc = addSnapshot(acc, await upload())!; // after the trade was journaled
    await call('PUT', `/api/backtest/sim/${s.id}`, OWNER, acc);
    await call('PUT', `/api/backtest/sim/${s.id}`, OWNER, acc); // saving again links nothing twice
    const [trade] = (await (await call('GET', '/api/trades?from=2000-01-01&to=2100-01-01', OWNER)).json()) as { id: string }[];
    const shots = (await (await call('GET', `/api/attachments/for/trade/${trade!.id}`, OWNER)).json()) as unknown[];
    expect(shots).toHaveLength(2);
  });

  it('refuse bad input and unknown sessions', async () => {
    backtest.ownerIds.push(OWNER);
    const s = (await (await call('POST', '/api/backtest/sessions', OWNER, { name: 'X', instrument: 'NQ', startBalance: 1, cursor: null, tf: '1m' })).json()) as { id: string };
    expect((await call('PUT', `/api/backtest/drawings/${s.id}`, OWNER, { lines: [{ ...line, style: { ...line.style, color: 'red' } }] })).status).toBe(400);
    expect((await call('GET', '/api/backtest/drawings/nope', OWNER)).status).toBe(404);
    expect((await call('POST', '/api/backtest/sessions', OWNER, { name: 'Y', instrument: 'XYZ', startBalance: 1, cursor: null, tf: '1m' })).status).toBe(422);
  });
});
