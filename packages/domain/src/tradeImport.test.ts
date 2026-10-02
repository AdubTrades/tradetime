import { describe, expect, it } from 'vitest';
import { pnlFromFills } from './trades';
import {
  contractRoot,
  detectDateOrder,
  detectFormat,
  groupRoundTrips,
  mergeCopyTrades,
  parseBrokerTime,
  rowsToExecutions,
  suggestImportMapping,
  type Execution,
} from './tradeImport';

describe('parsing', () => {
  it('reads contract roots in broker formats', () => {
    expect(contractRoot('MNQ 12-26')).toBe('MNQ');
    expect(contractRoot('MNQZ6')).toBe('MNQ');
    expect(contractRoot('ESZ26')).toBe('ES');
    expect(contractRoot('/MESZ6')).toBe('MES');
    expect(contractRoot('NQ DEC26')).toBe('NQ');
    expect(contractRoot('MNQ')).toBe('MNQ');
    expect(contractRoot('')).toBeNull();
  });

  it('detects date order and parses broker times in a zone', () => {
    expect(detectDateOrder(['1/10/2026 21:31:05', '29/09/2026 22:00:00'])).toBe('dmy');
    expect(detectDateOrder(['9/29/2026 9:31:05 PM'])).toBe('mdy');
    expect(detectDateOrder(['1/10/2026 9:31:05 PM'])).toBeNull();
    // 21:31 Perth = 13:31 UTC
    expect(parseBrokerTime('1/10/2026 21:31:05', 'Australia/Perth', 'dmy')).toBe('2026-10-01T13:31:05Z');
    expect(parseBrokerTime('10/1/2026 9:31:05 PM', 'Australia/Perth', 'mdy')).toBe('2026-10-01T13:31:05Z');
    // 08:31 New York in October (EDT, UTC−4) = 12:31 UTC
    expect(parseBrokerTime('2026-10-01 08:31:00', 'America/New_York', 'dmy')).toBe('2026-10-01T12:31:00Z');
    expect(parseBrokerTime('2026-10-01T13:31:05.120Z', 'Australia/Perth', 'dmy')).toBe('2026-10-01T13:31:05Z');
    expect(parseBrokerTime('nonsense', 'Australia/Perth', 'dmy')).toBeNull();
  });

  it('recognises known export layouts', () => {
    expect(detectFormat(['Instrument', 'Action', 'Quantity', 'Price', 'Time', 'ID', 'E/X', 'Position', 'Order ID', 'Name', 'Commission', 'Rate', 'Account', 'Connection'])).toBe(
      'ninjatrader-executions',
    );
    expect(
      detectFormat(['symbol', '_priceFormat', '_priceFormatType', '_tickSize', 'buyFillId', 'sellFillId', 'qty', 'buyPrice', 'sellPrice', 'pnl', 'boughtTimestamp', 'soldTimestamp', 'duration']),
    ).toBe('tradovate-performance');
    expect(detectFormat(['Fill Time', 'Side', 'Qty', 'Fill Price', 'Contract'])).toBe('generic');
    expect(suggestImportMapping(['Fill Time', 'Side', 'Qty', 'Fill Price', 'Contract', 'Account'])).toEqual({
      time: 'Fill Time',
      side: 'Side',
      qty: 'Qty',
      price: 'Fill Price',
      symbol: 'Contract',
      account: 'Account',
    });
  });
});

const ex = (id: string, account: string, side: 'buy' | 'sell', qty: number, price: number, t: string, commissionCents = 37): Execution => ({
  externalId: id,
  account,
  root: 'MNQ',
  side,
  qty,
  price,
  at: `2026-10-01T13:${t}Z`,
  commissionCents,
});

describe('groupRoundTrips', () => {
  it('groups flat-to-flat with scale-outs and keeps accounts separate', () => {
    const { trips, open } = groupRoundTrips([
      ex('1', 'A', 'buy', 2, 20000, '31:00'),
      ex('2', 'A', 'sell', 1, 20010, '33:00'),
      ex('3', 'B', 'buy', 2, 20000.25, '31:01'),
      ex('4', 'A', 'sell', 1, 20015, '35:00'),
      ex('5', 'B', 'sell', 2, 20012, '35:01'),
    ]);
    expect(open).toEqual([]);
    expect(trips.map((t) => [t.account, t.direction, t.fills.length, t.maxQty, t.commissionCents])).toEqual([
      ['A', 'long', 3, 2, 111],
      ['B', 'long', 2, 2, 74],
    ]);
    expect(pnlFromFills(trips[0]!.fills, 200).grossCents).toBe(5000);
  });

  it('splits a reversal into two trips', () => {
    const { trips, open } = groupRoundTrips([ex('1', 'A', 'buy', 1, 20000, '31:00'), ex('2', 'A', 'sell', 3, 19990, '32:00', 111), ex('3', 'A', 'buy', 2, 19980, '34:00')]);
    expect(open).toEqual([]);
    expect(trips.map((t) => [t.direction, t.fills.map((f) => `${f.side}${f.qty}`).join(' '), t.commissionCents])).toEqual([
      ['long', 'buy1 sell1', 37 + 37],
      ['short', 'sell2 buy2', 74 + 37],
    ]);
  });

  it('returns an unfinished position as open', () => {
    const { trips, open } = groupRoundTrips([ex('1', 'A', 'buy', 1, 20000, '31:00')]);
    expect(trips).toEqual([]);
    expect(open).toHaveLength(1);
  });
});

describe('mergeCopyTrades', () => {
  it('merges the same trade across accounts, allowing different fill prices', () => {
    const { trips } = groupRoundTrips([
      ex('1', 'A', 'buy', 1, 20000, '31:00'),
      ex('2', 'B', 'buy', 2, 20000.25, '31:02'),
      ex('3', 'A', 'sell', 1, 20010, '36:00'),
      ex('4', 'B', 'sell', 2, 20009.75, '36:04'),
      ex('5', 'A', 'buy', 1, 20020, '50:00'),
      ex('6', 'A', 'sell', 1, 20025, '51:00'),
    ]);
    const merged = mergeCopyTrades(trips);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.accounts.map((a) => [a.account, a.multiplier, a.fills[0]!.price])).toEqual([
      ['A', 1, 20000],
      ['B', 2, 20000.25],
    ]);
    expect(merged[1]!.accounts).toHaveLength(1);
  });
});

describe('rowsToExecutions', () => {
  it('reads a NinjaTrader executions export', () => {
    const rows = [
      { Instrument: 'MNQ 12-26', Action: 'Buy', Quantity: '2', Price: '20,000.25', Time: '1/10/2026 21:31:05', ID: 'abc1', 'E/X': 'Entry', Commission: '$0.74', Account: 'LTT-1001' },
      { Instrument: 'MNQ 12-26', Action: 'Sell', Quantity: '2', Price: '20,010.00', Time: '1/10/2026 21:36:40', ID: 'abc2', 'E/X': 'Exit', Commission: '$0.74', Account: 'LTT-1001' },
    ];
    const { executions, issues } = rowsToExecutions(rows, 'ninjatrader-executions', {}, { zone: 'Australia/Perth', dateOrder: 'dmy' });
    expect(issues).toEqual([]);
    expect(executions[0]).toEqual({ externalId: 'nt:abc1', account: 'LTT-1001', root: 'MNQ', side: 'buy', qty: 2, price: 20000.25, at: '2026-10-01T13:31:05Z', commissionCents: 74 });
  });

  it('reads a Tradovate performance export as paired fills', () => {
    const rows = [
      { symbol: 'MNQZ6', buyFillId: '11', sellFillId: '12', qty: '1', buyPrice: '20000.25', sellPrice: '20010.5', boughtTimestamp: '10/01/2026 08:31:05', soldTimestamp: '10/01/2026 08:36:00' },
    ];
    const { executions } = rowsToExecutions(rows, 'tradovate-performance', {}, { zone: 'America/New_York', dateOrder: 'mdy', defaultAccount: 'TV-1' });
    expect(executions.map((e) => [e.side, e.price, e.at, e.account])).toEqual([
      ['buy', 20000.25, '2026-10-01T12:31:05Z', 'TV-1'],
      ['sell', 20010.5, '2026-10-01T12:36:00Z', 'TV-1'],
    ]);
  });

  it('reports rows it cannot read', () => {
    const { executions, issues } = rowsToExecutions([{ T: 'soon', S: 'hold', Q: 'x', P: '1', C: 'MNQ' }], 'generic', { time: 'T', side: 'S', qty: 'Q', price: 'P', symbol: 'C' }, { zone: 'UTC', dateOrder: 'dmy' });
    expect(executions).toEqual([]);
    expect(issues[0]!.message).toMatch(/side, quantity, time/);
  });
});
