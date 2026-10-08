import { describe, expect, it } from 'vitest';
import * as calendar from '../calendar';
import * as expenses from '../expenses';
import * as plays from '../plays';
import * as settings from '../settings';
import { asUser, useTestDb } from '../testing';
import * as trades from '../trades';
import * as seed from './seed';

useTestDb();

describe('demo data', () => {
  it('fills every tab with consistent sample data relative to today', async () => {
    await asUser(() => seed.seedDemo(), 'demo');
    await asUser(async () => {
      const all = await trades.listTrades({ from: '2000-01-01', to: '2100-01-01' });
      expect(all.length).toBeGreaterThan(40);
      expect(all.every((t) => t.accounts.length === 2)).toBe(true);
      expect(all.filter((t) => t.needsReview)).toHaveLength(2);
      expect(all.filter((t) => !t.needsReview).every((t) => t.sessionId && t.state)).toBe(true);
      expect(new Set(all.map((t) => t.grade ?? 'outside')).size).toBeGreaterThan(3);
      expect(all.every((t) => Date.parse(t.closedAt) < Date.now())).toBe(true);
      const playList = await plays.listPlays();
      expect(playList.map((p) => p.exampleCount).every((n) => n > 0)).toBe(true);
      expect((await expenses.listExpenses({ from: '2000-01-01', to: '2100-01-01' })).length).toBeGreaterThan(8);
      expect((await calendar.upcoming(7)).occurrences.length).toBeGreaterThan(0);
      // The FY pickers and collage have something to show.
      expect((await expenses.expenseFinancialYears(2026)).length).toBeGreaterThan(1);
      expect(playList.map((p) => p.coverAttachmentIds.length)).toEqual(expect.arrayContaining([3, 2, 1]));
      expect((await expenses.listRecurring(new Date().toISOString().slice(0, 10))).some((r) => r.frequency === 'yearly')).toBe(true);
      expect(settings.getSettings()).toMatchObject({ reportName: 'Alex Morgan', fredApiKey: null });
    }, 'demo');
    // The demo account's data is invisible to everyone else.
    await asUser(async () => {
      expect(await trades.listTrades({ from: '2000-01-01', to: '2100-01-01' })).toHaveLength(0);
      expect(await plays.listPlays()).toHaveLength(0);
    }, 'someone-else');
  }, 60_000);
});
