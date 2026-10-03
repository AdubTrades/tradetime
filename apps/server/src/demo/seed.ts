import { DateTime } from 'luxon';
import {
  financialYear,
  financialYearOf,
  fomcEvents,
  LOCAL_ZONE,
  simpleFills,
  zonedToUtc,
  type MarketEventInput,
} from '@tc/domain';
import { createAccount, createFirm } from '../accounts';
import { linkAttachment, storeAttachment } from '../attachments';
import { createEvent } from '../calendar';
import { createReading } from '../checkins';
import { saveAccountGroup, updateContract } from '../contracts';
import { createExpense, createPayout, createRecurring, generateRecurringExpenses } from '../expenses';
import { findOrCreateListItem } from '../lists';
import { upsertMarketEvents } from '../marketEvents';
import { addCriterion, addExample, createPlay, updatePlay } from '../plays';
import { createManualSession } from '../sessions';
import { updateSettings } from '../settings';
import { createTrade, saveDailyReview } from '../trades';
import { chartPng, rng } from './chartImage';

const DAYS = 56; // about eight weeks of trading history
const perth = (date: string, time: string) => zonedToUtc(date, time, LOCAL_ZONE);
const plusMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tick = (p: number) => Math.round(p * 4) / 4;

/**
 * Fill an empty database with a fictional trader ("Alex Morgan") across every tab. Dates are relative to
 * today so the demo always looks current. Deterministic, so a reset produces the same story.
 */
export async function seedDemo(): Promise<void> {
  const r = rng(20261002);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const now = DateTime.now().setZone(LOCAL_ZONE);
  const today = now.toISODate()!;

  updateSettings({ reportName: 'Alex Morgan', homeHidePnl: false, backupIntervalHours: 0, includeMediumEvents: true });
  updateContract('ct_mnq', { feePerSideCents: 37 });
  updateContract('ct_mes', { feePerSideCents: 37 });
  updateContract('ct_nq', { feePerSideCents: 129 });
  updateContract('ct_es', { feePerSideCents: 129 });

  // ---------- Accounts (fictional firms) ----------
  const summit = createFirm({ name: 'Summit Funding (demo)' });
  const northline = createFirm({ name: 'Northline Capital (demo)' });
  const start = now.minus({ days: DAYS + 20 }).toISODate()!;
  const a1 = createAccount({ firmId: summit.id, name: 'Summit 50K Funded #1', type: 'funded', status: 'active', startDate: start, startingBalanceCents: 5_000_000 });
  const a2 = createAccount({ firmId: summit.id, name: 'Summit 50K Funded #2', type: 'funded', status: 'active', startDate: start, startingBalanceCents: 5_000_000 });
  createAccount({ firmId: northline.id, name: 'Northline 100K Evaluation', type: 'evaluation', status: 'failed', startDate: now.minus({ days: 90 }).toISODate()!, endDate: now.minus({ days: 70 }).toISODate()!, startingBalanceCents: 10_000_000 });
  saveAccountGroup(null, { name: 'Summit pair', members: [{ accountId: a1.id, multiplier: 1 }, { accountId: a2.id, multiplier: 1 }] });

  // ---------- Playbook ----------
  const orb = createPlay({ title: 'Opening range breakout', description: 'Break and hold of the first 15-minute range after the New York open, with volume.' });
  const vwap = createPlay({ title: 'VWAP reclaim', description: 'Price loses VWAP early, then reclaims and holds it on a retest.' });
  const fade = createPlay({ title: 'Failed breakout fade', description: 'A push through a key level that fails and closes back inside within two bars.' });
  const crit: Record<string, { id: string; mustHave: boolean }[]> = {};
  const criteria: [string, [string, boolean][]][] = [
    [orb.id, [['Clean break of the 15-min opening range', true], ['Volume expands on the break', false], ['With the higher-timeframe trend', false], ['Retest holds the range edge', false]]],
    [vwap.id, [['Clear loss of VWAP in the first 30 minutes', true], ['Reclaim on a full-body candle', true], ['Retest of VWAP holds', false], ['Room to the next level is at least 2R', false]]],
    [fade.id, [['Break of a marked level from the plan', true], ['Closes back inside within two bars', false], ['Divergence on delta', false]]],
  ];
  for (const [playId, list] of criteria) crit[playId] = list.map(([label, mustHave]) => ({ id: addCriterion(playId, { label, mustHave }).id, mustHave }));
  updatePlay(orb.id, {
    gradeRules: [
      { grade: 'A+', maxMissed: 0, riskNote: 'Full risk (1R = $200)' },
      { grade: 'A', maxMissed: 1, riskNote: 'Full risk' },
      { grade: 'B+', maxMissed: 1, riskNote: 'Three-quarter risk' },
      { grade: 'B', maxMissed: 2, riskNote: 'Half risk' },
      { grade: 'C+', maxMissed: 3, riskNote: 'Quarter risk or skip' },
    ],
  });
  let imgSeed = 1;
  const image = (direction: 'long' | 'short', outcome: 'win' | 'loss') => storeAttachment(chartPng(imgSeed++, { direction, outcome }), 'image/png', 'chart.png');
  for (const [playId, grade, caption] of [
    [orb.id, 'A+', 'Textbook: range break on volume, retest holds'],
    [orb.id, 'A+', 'Trend day continuation after the first pullback'],
    [orb.id, 'A', 'Good break, no retest — still worked'],
    [orb.id, 'B', 'Against the daily trend; tighter target'],
    [vwap.id, 'A+', 'Lost VWAP, reclaimed on a full body, retest held'],
    [vwap.id, 'B+', 'Reclaim was fine, room to the level was tight'],
    [fade.id, 'A', 'Failed push above yesterday’s high'],
  ] as const) {
    const a = image(r() > 0.3 ? 'long' : 'short', 'win');
    addExample(playId, { grade, attachmentId: a.id, caption, date: now.minus({ days: Math.floor(r() * DAYS) }).toISODate()! });
  }

  // ---------- Lists ----------
  const moods = ['li_mood_focused', 'li_mood_neutral', 'li_mood_content', 'li_mood_stressed', 'li_mood_frustrated'];
  const mistakes = ['li_mistake_fomo', 'li_mistake_early_exit', 'li_mistake_moved_stop', 'li_mistake_chased'];

  // ---------- Sessions, check-ins and trades ----------
  let price = 21250;
  for (let back = DAYS; back >= 1; back--) {
    const d = now.minus({ days: back });
    const day = d.toISODate()!;
    const weekday = d.weekday;

    if (weekday === 6) {
      createManualSession({ typeId: 'st_backtesting', start: perth(day, '10:00'), end: perth(day, '11:45'), notes: 'Replay: ORB setups' }, true);
      continue;
    }
    if (weekday === 7) {
      createManualSession({ typeId: 'st_weekly_review', start: perth(day, '09:30'), end: perth(day, '10:30') }, true);
      continue;
    }
    if (r() < 0.12) continue; // the odd day off

    // New York session from 21:20 Perth; a long session gets a check-in.
    const sStart = perth(day, pick(['21:15', '21:20', '21:25']));
    const length = 80 + Math.floor(r() * 90);
    const session = createManualSession({ typeId: 'st_trading', start: sStart, end: plusMin(sStart, length) }, true);
    const focus = 2 + Math.floor(r() * 4);
    createReading(session.id, {
      kind: 'start',
      answers: [
        { questionId: 'q_mood', value: pick(moods.slice(0, 3)) },
        { questionId: 'q_focus', value: focus },
        { questionId: 'q_energy', value: 2 + Math.floor(r() * 4) },
        { questionId: 'q_plan', value: 'yes' },
        { questionId: 'q_day_plan', value: pick(['ORB only, max 3 trades', 'Wait for VWAP reclaim', 'A+ setups only — CPI week', 'Two trades then review']) },
      ],
    });
    let tilted = false;
    if (length > 95) {
      tilted = r() < 0.3;
      createReading(session.id, {
        kind: 'checkin',
        at: plusMin(sStart, 90),
        decision: tilted ? pick(['take_break', 'stop'] as const) : 'keep_trading',
        answers: [
          { questionId: 'q_mood', value: tilted ? pick(moods.slice(3)) : pick(moods.slice(0, 3)) },
          { questionId: 'q_focus', value: tilted ? 2 : Math.max(2, focus - 1) },
          { questionId: 'q_energy', value: tilted ? 2 : 3 },
          { questionId: 'q_plan', value: tilted ? 'partly' : 'yes' },
          { questionId: 'q_changed', value: tilted ? 'Two losers in a row, getting impatient' : null },
        ],
      });
    }

    const count = 1 + Math.floor(r() * 3) + (r() < 0.15 ? 1 : 0);
    let t = 6 + Math.floor(r() * 10);
    for (let k = 0; k < count && t < length - 6; k++) {
      const playId = pick([orb.id, orb.id, orb.id, vwap.id, vwap.id, fade.id]);
      // Most trades follow the plan; some miss criteria; a few miss a must-have (outside the plan).
      const quality = r();
      const checks = crit[playId]!.map((c) => ({
        criterionId: c.id,
        checked: c.mustHave ? quality > 0.08 : r() < (quality > 0.55 ? 0.82 : quality > 0.25 ? 0.5 : 0.3),
      }));
      const outside = checks.some((c, i) => crit[playId]![i]!.mustHave && !c.checked);
      const missed = checks.filter((c) => !c.checked).length;
      const late = t > 95 && tilted;
      const winP = outside ? 0.36 : late ? 0.35 : missed === 0 ? 0.64 : missed === 1 ? 0.55 : 0.45;
      const win = r() < winP;
      const direction = r() < 0.58 ? 'long' : 'short';
      const sign = direction === 'long' ? 1 : -1;
      const riskPts = pick([8, 10, 10, 12, 15]);
      const rMult = win ? pick([1, 1.5, 2, 2, 2.5, 3]) : pick([-1, -1, -1, -0.5, -1.25]);
      price = tick(price + (r() - 0.5) * 60);
      const entry = tick(price);
      const exit = tick(entry + rMult * riskPts * sign);
      const entryAt = plusMin(sStart, t);
      const exitAt = plusMin(entryAt, 2 + Math.floor(r() * 14));
      const contract = r() < 0.8 ? 'ct_mnq' : 'ct_mes';
      const size = contract === 'ct_mnq' ? pick([2, 3, 4]) : pick([1, 2]);
      // ES/MES prices live on a different scale.
      const scale = contract === 'ct_mes' ? 0.27 : 1;
      const e = tick(entry * scale);
      const x = tick(e + (exit - entry) * scale);
      const stop = tick(e - riskPts * scale * sign);
      const target = tick(e + riskPts * 2 * scale * sign);
      const mistakeIds = !win && r() < 0.45 ? [pick(mistakes)] : r() < 0.08 ? [pick(mistakes)] : [];
      const trade = createTrade({
        tradingDay: day,
        contractId: contract,
        playId,
        checks,
        stopPrice: stop,
        targetPrice: target,
        followedPlan: outside || mistakeIds.length ? pick(['partly', 'no'] as const) : r() < 0.9 ? 'yes' : 'partly',
        emotionId: late ? pick(moods.slice(3)) : pick(moods.slice(0, 3)),
        confidence: outside ? 2 : 3 + Math.floor(r() * 3),
        mistakeIds,
        notes: win && r() < 0.2 ? 'Patient entry, let it work.' : !win && mistakeIds.length ? 'Should have waited for the retest.' : null,
        fills: simpleFills(direction, size, { at: entryAt, price: e }, { at: exitAt, price: x }),
        accounts: [
          { accountId: a1.id, multiplier: 1 },
          { accountId: a2.id, multiplier: 1 },
        ],
      });
      if (r() < 0.35) linkAttachment(image(direction, win ? 'win' : 'loss').id, 'trade', trade.id, 'chart');
      t += 8 + Math.floor(r() * 30);
    }
    if (r() < 0.6) {
      saveDailyReview(
        day,
        pick([
          'Stuck to the plan. Two clean ORB entries, skipped the chop after 22:30.',
          'Took a B setup too early. Need to wait for the retest before sizing up.',
          'Good patience. Stopped after the check-in when focus dropped — right call.',
          'Overtraded the last 30 minutes. Next time stop at the check-in.',
          'Quiet session. One A+ trade, flat after fees on the rest.',
        ]),
      );
    }
    if (r() < 0.45) createManualSession({ typeId: 'st_daily_review', start: plusMin(sStart, length + 10), end: plusMin(sStart, length + 35) }, true);
  }

  // Two trades from yesterday's session imported from the broker and still waiting for review.
  const yesterday = now.minus({ days: now.weekday === 1 ? 3 : now.weekday === 7 ? 2 : 1 }).toISODate()!;
  for (const [time, entry, exit, dir] of [
    ['22:42', 21310, 21322.5, 'long'],
    ['23:05', 21336, 21342.25, 'short'],
  ] as const) {
    const at = perth(yesterday, time);
    const fills = simpleFills(dir, 2, { at, price: entry }, { at: plusMin(at, 6), price: exit });
    createTrade({
      tradingDay: yesterday,
      contractId: 'ct_mnq',
      fills,
      accounts: [
        { accountId: a1.id, multiplier: 1, fills },
        { accountId: a2.id, multiplier: 1, fills: fills.map((f) => ({ ...f, price: f.price + (f.side === 'buy' ? 0.25 : 0) })) },
      ],
      source: 'import',
      needsReview: true,
    });
  }

  // ---------- Expenses and payouts (this financial year) ----------
  const fy = financialYear(financialYearOf(today).startYear);
  const cat = (n: string) => findOrCreateListItem('expense_category', n);
  createRecurring({ name: 'TradingView Premium', vendor: 'TradingView', categoryId: cat('Charting & Software'), typeId: 'li_type_digital', paymentMethodId: 'li_pm_credit_card', exGstCents: 8995, gstCents: 0, frequency: 'monthly', interval: 1, startDate: DateTime.fromISO(fy.start).plus({ days: 2 }).toISODate()! });
  createRecurring({ name: 'CME market data (non-pro)', vendor: 'NinjaTrader', categoryId: cat('Market Data / Feeds'), typeId: 'li_type_digital', paymentMethodId: 'li_pm_credit_card', exGstCents: 1650, gstCents: 0, frequency: 'monthly', interval: 1, startDate: DateTime.fromISO(fy.start).plus({ days: 9 }).toISODate()! });
  createRecurring({ name: 'Home internet', vendor: 'Aussie Broadband', categoryId: cat('Internet & Phone'), typeId: 'li_type_service', paymentMethodId: 'li_pm_debit_card', exGstCents: 8182, gstCents: 818, businessUsePct: 40, frequency: 'monthly', interval: 1, startDate: DateTime.fromISO(fy.start).plus({ days: 14 }).toISODate()! });

  // ---------- Previous financial year (so the FY pickers have more than one year) ----------
  // A yearly subscription that started last FY bills once in each year and shows the "Yearly" pill.
  const lastFy = financialYear(financialYearOf(today).startYear - 1);
  createRecurring({ name: 'Journal & tax software', vendor: 'Ledgerly (demo)', categoryId: cat('Charting & Software'), typeId: 'li_type_digital', paymentMethodId: 'li_pm_credit_card', exGstCents: 21818, gstCents: 2182, frequency: 'yearly', interval: 1, startDate: DateTime.fromISO(lastFy.start).plus({ days: 20 }).toISODate()! });
  generateRecurringExpenses(today);
  const lastFyDay = (daysBeforeEnd: number) => DateTime.fromISO(lastFy.end).minus({ days: daysBeforeEnd }).toISODate()!;
  createExpense({ name: 'Order flow course', vendor: 'Tape Reading School (demo)', date: lastFyDay(60), categoryId: cat('Education'), typeId: 'li_type_digital', paymentMethodId: 'li_pm_credit_card', exGstCents: 45455, gstCents: 4545 });
  createExpense({ name: 'Summit 50K evaluation', vendor: 'Summit Funding (demo)', date: lastFyDay(25), categoryId: cat('Prop Firm Fees'), typeId: 'li_type_digital', paymentMethodId: 'li_pm_credit_card', exGstCents: 10900, gstCents: 0 });
  for (const [back, type, notes] of [
    [70, 'st_education', 'Order flow course, module 1'],
    [63, 'st_education', 'Order flow course, module 2'],
    [40, 'st_backtesting', 'Replay: ORB setups'],
    [12, 'st_backtesting', 'Replay: VWAP reclaims'],
  ] as const) {
    const day = lastFyDay(back);
    createManualSession({ typeId: type, start: perth(day, '10:00'), end: perth(day, '11:30'), notes }, true);
  }
  const oneOff = (name: string, vendor: string, category: string, days: number, ex: number, gst: number, pct = 100) =>
    createExpense({ name, vendor, date: now.minus({ days }).toISODate()!, categoryId: cat(category), typeId: 'li_type_digital', paymentMethodId: 'li_pm_credit_card', exGstCents: ex, gstCents: gst, businessUsePct: pct });
  oneOff('Summit 50K evaluation', 'Summit Funding (demo)', 'Prop Firm Fees', 75, 10900, 0);
  oneOff('Summit 50K evaluation', 'Summit Funding (demo)', 'Prop Firm Fees', 62, 10900, 0);
  oneOff('Northline 100K evaluation', 'Northline Capital (demo)', 'Prop Firm Fees', 90, 16500, 0);
  oneOff('Second monitor', 'Officeworks', 'Office Equipment', 48, 31818, 3182, 90);
  oneOff('Trading psychology book', 'Booktopia', 'Education', 33, 2909, 291);
  const mid = (days: number) => now.minus({ days }).toISODate()!;
  createPayout({ accountId: a1.id, requestedDate: mid(26), receivedDate: mid(22), grossUsdCents: 150_000, audReceivedCents: 228_450, notes: 'First payout' });
  createPayout({ accountId: a2.id, requestedDate: mid(9), receivedDate: mid(5), grossUsdCents: 120_000, audReceivedCents: 181_920 });

  // ---------- Calendar ----------
  const monday = now.minus({ days: now.weekday - 1 }).minus({ weeks: 8 }).toISODate()!;
  createEvent({ typeId: 'cet_trading', title: 'NY open session', date: monday, startTime: '21:15', endTime: '23:30', recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, reminderMinutes: 15 });
  createEvent({ typeId: 'cet_backtest', title: 'Weekly review', date: now.minus({ days: (now.weekday % 7) + 56 }).toISODate()!, startTime: '09:30', endTime: '10:30', recurrence: { freq: 'weekly', interval: 1 } });
  createEvent({ typeId: 'cet_no_trade', title: 'Family weekend away', date: now.plus({ days: 9 }).toISODate()!, allDay: true });
  createEvent({ typeId: 'cet_education', title: 'Mentor live stream', date: now.plus({ days: 3 }).toISODate()!, startTime: '09:00', endTime: '10:30', link: 'https://example.com/live' });
  createEvent({ typeId: 'cet_admin', title: 'Send receipts to accountant', date: now.minus({ days: 2 }).toISODate()!, allDay: true, isTask: true });
  createEvent({ typeId: 'cet_admin', title: 'Quarterly BAS check-in', date: now.plus({ days: 18 }).toISODate()!, allDay: true, isTask: true });

  // Sample US releases around today (fixed patterns, labelled as demo data) plus the real FOMC schedule.
  const events: MarketEventInput[] = [];
  const ny = (date: string, time: string) => zonedToUtc(date, time, 'America/New_York');
  const add = (date: string, title: string, time: string, impact: 'high' | 'medium') => events.push({ provider: 'demo', providerId: `${title}:${date}`, title, at: ny(date, time), impact, country: 'US', currency: 'USD' });
  // Weekend dates move to the following Monday, like real release calendars.
  const weekday = (dt: DateTime) => (dt.weekday === 6 ? dt.plus({ days: 2 }) : dt.weekday === 7 ? dt.plus({ days: 1 }) : dt).toISODate()!;
  for (let m = -2; m <= 2; m++) {
    const first = now.plus({ months: m }).startOf('month');
    add(first.plus({ days: (5 - first.weekday + 7) % 7 }).toISODate()!, 'Non-Farm Payrolls', '08:30', 'high');
    add(weekday(first.plus({ days: 11 })), 'CPI', '08:30', 'high');
    add(weekday(first.plus({ days: 14 })), 'Retail Sales', '08:30', 'high');
    add(weekday(first.plus({ days: 15 })), 'PPI', '08:30', 'high');
  }
  for (let w = -8; w <= 6; w++) {
    const thu = now.plus({ weeks: w }).set({ weekday: 4 }).toISODate()!;
    add(thu, 'Unemployment Claims', '08:30', 'medium');
  }
  const nyToday = DateTime.now().setZone('America/New_York');
  events.push(...fomcEvents(nyToday.minus({ days: 70 }).toISODate()!, nyToday.plus({ days: 120 }).toISODate()!));
  upsertMarketEvents(events);
}
