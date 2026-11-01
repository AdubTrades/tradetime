import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINE_LABEL, DEFAULT_LINE_STYLE, marketOrder, newSimAccount } from '@tc/domain';
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

  it('save and load lines per instrument, and line templates', async () => {
    backtest.ownerIds.push(OWNER);
    expect(await (await call('GET', '/api/backtest/drawings/NQ', OWNER)).json()).toEqual({ lines: [] });
    expect((await call('PUT', '/api/backtest/drawings/NQ', OWNER, { lines: [line] })).status).toBe(200);
    expect(await (await call('GET', '/api/backtest/drawings/NQ', OWNER)).json()).toEqual({ lines: [line] });
    expect(await (await call('GET', '/api/backtest/drawings/ES', OWNER)).json()).toEqual({ lines: [] });

    const tools = { templates: [{ id: 't1', name: 'Asia High', style: DEFAULT_LINE_STYLE, label: line.label }], last: null };
    expect((await call('PUT', '/api/backtest/line-tools', OWNER, tools)).status).toBe(200);
    expect(await (await call('GET', '/api/backtest/line-tools', OWNER)).json()).toEqual(tools);
  });

  it('save and load the practice account per instrument', async () => {
    backtest.ownerIds.push(OWNER);
    expect(await (await call('GET', '/api/backtest/sim/BTCUSDT', OWNER)).json()).toBeNull();
    const account = marketOrder(newSimAccount(10_000), { symbol: 'BTCUSDT', pointValue: 1, feePerSide: 0, feeRate: 0.001 }, 'buy', 0.05, 80_000, 1_800_000_000, { stop: 79_000, target: null });
    expect((await call('PUT', '/api/backtest/sim/BTCUSDT', OWNER, account)).status).toBe(200);
    expect(await (await call('GET', '/api/backtest/sim/BTCUSDT', OWNER)).json()).toEqual(account);
  });

  it('refuse bad input and unknown instruments', async () => {
    backtest.ownerIds.push(OWNER);
    expect((await call('PUT', '/api/backtest/drawings/NQ', OWNER, { lines: [{ ...line, style: { ...line.style, color: 'red' } }] })).status).toBe(400);
    expect((await call('GET', '/api/backtest/drawings/XYZ', OWNER)).status).toBe(404);
  });
});
