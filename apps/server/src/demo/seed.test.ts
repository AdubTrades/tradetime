import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let seed: typeof import('./seed');
let trades: typeof import('../trades');
let plays: typeof import('../plays');
let expenses: typeof import('../expenses');
let calendar: typeof import('../calendar');
let settings: typeof import('../settings');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-demo-'));
  seed = await import('./seed');
  trades = await import('../trades');
  plays = await import('../plays');
  expenses = await import('../expenses');
  calendar = await import('../calendar');
  settings = await import('../settings');
});

describe('demo data', () => {
  it('fills every tab with consistent sample data relative to today', async () => {
    await seed.seedDemo();
    const all = trades.listTrades({ from: '2000-01-01', to: '2100-01-01' });
    expect(all.length).toBeGreaterThan(40);
    expect(all.every((t) => t.accounts.length === 2)).toBe(true);
    expect(all.filter((t) => t.needsReview)).toHaveLength(2);
    expect(all.filter((t) => !t.needsReview).every((t) => t.sessionId && t.state)).toBe(true);
    expect(new Set(all.map((t) => t.grade ?? 'outside')).size).toBeGreaterThan(3);
    expect(all.every((t) => Date.parse(t.closedAt) < Date.now())).toBe(true);
    expect(plays.listPlays().map((p) => p.exampleCount).every((n) => n > 0)).toBe(true);
    expect(expenses.listExpenses({ from: '2000-01-01', to: '2100-01-01' }).length).toBeGreaterThan(8);
    expect(calendar.upcoming(7).occurrences.length).toBeGreaterThan(0);
    expect(settings.getSettings()).toMatchObject({ reportName: 'Alex Morgan', backupIntervalHours: 0, fredApiKey: null });
  }, 30_000);
});
