import { DateTime } from 'luxon';
import type { Cents } from './money';
import { parseImportMoney } from './expenses';
import type { Direction, Fill } from './trades';

// ---------- Parsing helpers ----------

const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * Root symbol from a broker's contract name: "MNQ 12-26" (NinjaTrader), "MNQZ6"/"MNQZ26" (Tradovate/CME),
 * "MNQ DEC26", "/MNQZ6". Returns null if it can't be read.
 */
export function contractRoot(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^\//, '');
  if (!s) return null;
  const spaced = /^([A-Z0-9]{1,6})[\s._-]+.+$/.exec(s);
  if (spaced) return spaced[1]!;
  const coded = new RegExp(`^([A-Z0-9]{1,6}?)[${MONTH_CODES}]\\d{1,2}$`).exec(s);
  if (coded) return coded[1]!;
  return /^[A-Z0-9]{1,6}$/.test(s) ? s : null;
}

export type DateOrder = 'dmy' | 'mdy';

const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/;

/** Guess day-first or month-first from slash dates: any first part over 12 means day-first, any second part over 12 means month-first. */
export function detectDateOrder(samples: string[]): DateOrder | null {
  let dmy = false;
  let mdy = false;
  for (const s of samples) {
    const m = SLASH_DATE.exec(s.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return null;
}

/**
 * A broker timestamp → UTC ISO instant. Handles ISO strings (with or without an offset), "d/M/yyyy H:mm:ss",
 * "M/d/yyyy h:mm:ss AM", and epoch milliseconds. Times without an offset are read in `zone`.
 */
export function parseBrokerTime(raw: string, zone: string, order: DateOrder): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Whole seconds throughout, so times sort consistently as strings (ties keep file order).
  const out = (dt: DateTime) => (dt.isValid ? dt.toUTC().set({ millisecond: 0 }).toISO({ suppressMilliseconds: true }) : null);
  if (/^\d{12,14}$/.test(s)) return out(DateTime.fromMillis(Number(s), { zone: 'utc' }));
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
    return out(DateTime.fromISO(s.replace(' ', 'T'), { zone: hasOffset ? undefined : zone, setZone: true }));
  }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d+))?\s*(AM|PM)?$/i.exec(s);
  if (!m) return null;
  const [, a, b, y, hh, mm, ss, , ampm] = m;
  const day = Number(order === 'dmy' ? a : b);
  const month = Number(order === 'dmy' ? b : a);
  let year = Number(y);
  if (year < 100) year += 2000;
  let hour = Number(hh);
  if (ampm) {
    const pm = ampm.toUpperCase() === 'PM';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return out(DateTime.fromObject({ year, month, day, hour, minute: Number(mm), second: Number(ss ?? 0) }, { zone }));
}

/** Plain number from broker text: "20,001.25", "$0.62", "(1.20)". */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(neg ? s.slice(1, -1) : s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// ---------- Executions → round trips ----------

export interface Execution {
  /** Broker's id for the fill, used to skip it on re-import. */
  externalId: string;
  account: string;
  root: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  at: string;
  commissionCents: Cents;
}

export interface RoundTrip {
  account: string;
  root: string;
  direction: Direction;
  fills: (Fill & { externalId: string })[];
  commissionCents: Cents;
  openedAt: string;
  closedAt: string;
  maxQty: number;
}

/**
 * Group executions into flat-to-flat round trips per account and contract. A fill that flips the position
 * (long → short) is split: the closing part ends one trip and the rest opens the next. Executions left
 * open at the end of the file are returned separately.
 */
export function groupRoundTrips(executions: readonly Execution[]): { trips: RoundTrip[]; open: Execution[] } {
  const sorted = executions.map((e, i) => ({ e, i })).sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i).map((x) => x.e);
  const trips: RoundTrip[] = [];
  const open: Execution[] = [];
  const current = new Map<string, { trip: RoundTrip; position: number; execs: Execution[] }>();

  for (const e of sorted) {
    const key = `${e.account}|${e.root}`;
    const signed = e.side === 'buy' ? e.qty : -e.qty;
    let state = current.get(key);
    if (!state) {
      state = {
        trip: { account: e.account, root: e.root, direction: signed > 0 ? 'long' : 'short', fills: [], commissionCents: 0, openedAt: e.at, closedAt: e.at, maxQty: 0 },
        position: 0,
        execs: [],
      };
      current.set(key, state);
    }
    const after = state.position + signed;
    const flips = state.position !== 0 && Math.sign(after) !== 0 && Math.sign(after) !== Math.sign(state.position);
    // Quantity that closes the current position on a flip; the remainder opens a new trip.
    const closeQty = flips ? Math.abs(state.position) : e.qty;
    const share = closeQty / e.qty;
    state.trip.fills.push({ at: e.at, side: e.side, qty: closeQty, price: e.price, externalId: flips ? `${e.externalId}#close` : e.externalId });
    state.trip.commissionCents += Math.round(e.commissionCents * share);
    state.trip.closedAt = e.at;
    state.execs.push(e);
    const newPos = flips ? 0 : after;
    state.position = newPos;
    state.trip.maxQty = Math.max(state.trip.maxQty, Math.abs(newPos), flips ? 0 : Math.abs(after));
    if (newPos === 0) {
      trips.push(state.trip);
      current.delete(key);
    }
    if (flips) {
      const rest = e.qty - closeQty;
      const next: RoundTrip = {
        account: e.account,
        root: e.root,
        direction: after > 0 ? 'long' : 'short',
        fills: [{ at: e.at, side: e.side, qty: rest, price: e.price, externalId: `${e.externalId}#open` }],
        commissionCents: e.commissionCents - Math.round(e.commissionCents * share),
        openedAt: e.at,
        closedAt: e.at,
        maxQty: rest,
      };
      current.set(key, { trip: next, position: after, execs: [e] });
    }
  }
  for (const s of current.values()) open.push(...s.execs);
  return { trips, open };
}

// ---------- Copy-trade merging ----------

export interface ImportTrade {
  root: string;
  direction: Direction;
  openedAt: string;
  closedAt: string;
  /** One entry per account; fills are each account's actual fills (prices can differ slightly between accounts). */
  accounts: { account: string; fills: RoundTrip['fills']; commissionCents: Cents; maxQty: number; multiplier: number }[];
}

const within = (a: string, b: string, seconds: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= seconds * 1000;

/**
 * Merge round trips on different accounts that are the same trade copied: same contract and direction,
 * entries within `entrySeconds` and exits within `exitSeconds`. Multipliers are relative to the smallest size.
 */
export function mergeCopyTrades(trips: readonly RoundTrip[], entrySeconds = 5, exitSeconds = 20): ImportTrade[] {
  const sorted = [...trips].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const used = new Set<RoundTrip>();
  const out: ImportTrade[] = [];
  for (const t of sorted) {
    if (used.has(t)) continue;
    used.add(t);
    const group = [t];
    for (const o of sorted) {
      if (used.has(o) || o.account === t.account || group.some((g) => g.account === o.account)) continue;
      if (o.root === t.root && o.direction === t.direction && within(o.openedAt, t.openedAt, entrySeconds) && within(o.closedAt, t.closedAt, exitSeconds)) {
        group.push(o);
        used.add(o);
      }
    }
    const base = Math.min(...group.map((g) => g.maxQty));
    out.push({
      root: t.root,
      direction: t.direction,
      openedAt: group.map((g) => g.openedAt).sort()[0]!,
      closedAt: group.map((g) => g.closedAt).sort().at(-1)!,
      accounts: group.map((g) => ({ account: g.account, fills: g.fills, commissionCents: g.commissionCents, maxQty: g.maxQty, multiplier: Math.max(1, Math.round(g.maxQty / base)) })),
    });
  }
  return out;
}

// ---------- Export formats ----------

export type ImportField = 'time' | 'date' | 'side' | 'qty' | 'price' | 'symbol' | 'account' | 'id' | 'commission';
export type ImportMapping = Partial<Record<ImportField, string>>;

export interface FormatPreset {
  id: 'ninjatrader-executions' | 'tradovate-performance' | 'generic';
  label: string;
}

/** Recognise a known export layout from its headers. */
export function detectFormat(headers: string[]): FormatPreset['id'] {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  if (['instrument', 'action', 'quantity', 'price', 'time'].every((k) => h.has(k)) && (h.has('e/x') || h.has('position') || h.has('order id'))) return 'ninjatrader-executions';
  if (['symbol', 'buyfillid', 'sellfillid', 'qty', 'buyprice', 'sellprice', 'boughttimestamp', 'soldtimestamp'].every((k) => h.has(k))) return 'tradovate-performance';
  return 'generic';
}

const HINTS: Record<ImportField, RegExp> = {
  time: /^(time|timestamp|fill time|exec(ution)? time|date\s*\/\s*time|datetime)$/i,
  date: /^(date|trade date)$/i,
  side: /^(action|side|b\/s|buy\/sell|direction)$/i,
  qty: /^(quantity|qty|filled qty|size|contracts)$/i,
  price: /^(price|fill price|avg(\.|erage)? price|exec(ution)? price)$/i,
  symbol: /^(instrument|symbol|contract|product)$/i,
  account: /^(account|account name|account id)$/i,
  id: /^(id|fill id|execution id|exec id|trade id)$/i,
  commission: /^(commission|commissions|fees|comm\.?)$/i,
};

/** Suggest which column feeds each field for a generic fills export. */
export function suggestImportMapping(headers: string[]): ImportMapping {
  const map: ImportMapping = {};
  const used = new Set<string>();
  for (const f of Object.keys(HINTS) as ImportField[]) {
    const col = headers.find((h) => !used.has(h) && HINTS[f].test(h.trim()));
    if (col) {
      map[f] = col;
      used.add(col);
    }
  }
  return map;
}

export interface ParseOptions {
  zone: string;
  dateOrder: DateOrder;
  /** Account name to use when the file has no account column (e.g. a per-account Tradovate report). */
  defaultAccount?: string;
}

export type RowIssue = { line: number; message: string };

/** Turn CSV rows into executions using a known format or a column mapping. */
export function rowsToExecutions(
  rows: Record<string, string>[],
  format: FormatPreset['id'],
  mapping: ImportMapping,
  opts: ParseOptions,
): { executions: Execution[]; issues: RowIssue[] } {
  const executions: Execution[] = [];
  const issues: RowIssue[] = [];
  const get = (row: Record<string, string>, col?: string) => (col ? (row[col] ?? '').trim() : '');

  if (format === 'tradovate-performance') {
    // Each row pairs a buy fill with a sell fill; a fill split across rows keeps a per-row id.
    rows.forEach((row, i) => {
      const line = i + 2;
      const root = contractRoot(get(row, 'symbol'));
      const qty = parseNumber(get(row, 'qty'));
      const buy = parseNumber(get(row, 'buyPrice'));
      const sell = parseNumber(get(row, 'sellPrice'));
      const bt = parseBrokerTime(get(row, 'boughtTimestamp'), opts.zone, opts.dateOrder);
      const st = parseBrokerTime(get(row, 'soldTimestamp'), opts.zone, opts.dateOrder);
      if (!root || !qty || buy === null || sell === null || !bt || !st) {
        issues.push({ line, message: 'Missing or unreadable symbol, qty, price or timestamp' });
        return;
      }
      const account = opts.defaultAccount ?? '';
      const pair = `${get(row, 'buyFillId')}:${get(row, 'sellFillId')}`;
      executions.push({ externalId: `tv:${pair}:b`, account, root, side: 'buy', qty, price: buy, at: bt, commissionCents: 0 });
      executions.push({ externalId: `tv:${pair}:s`, account, root, side: 'sell', qty, price: sell, at: st, commissionCents: 0 });
    });
    return { executions, issues };
  }

  const m: ImportMapping =
    format === 'ninjatrader-executions'
      ? { time: 'Time', side: 'Action', qty: 'Quantity', price: 'Price', symbol: 'Instrument', account: 'Account', id: 'ID', commission: 'Commission' }
      : mapping;
  rows.forEach((row, i) => {
    const line = i + 2;
    const sideRaw = get(row, m.side).toLowerCase();
    const side = /buy|^b$|long|cover/.test(sideRaw) ? 'buy' : /sell|^s$|short/.test(sideRaw) ? 'sell' : null;
    const qty = parseNumber(get(row, m.qty));
    const price = parseNumber(get(row, m.price));
    const root = contractRoot(get(row, m.symbol));
    const timeRaw = m.date ? `${get(row, m.date)} ${get(row, m.time)}` : get(row, m.time);
    const at = parseBrokerTime(timeRaw, opts.zone, opts.dateOrder);
    const account = get(row, m.account) || opts.defaultAccount || '';
    const problems = [!side && 'side', !qty && 'quantity', price === null && 'price', !root && 'contract', !at && 'time'].filter(Boolean);
    if (problems.length) {
      issues.push({ line, message: `Couldn't read ${problems.join(', ')}` });
      return;
    }
    const commission = m.commission ? (parseImportMoney(get(row, m.commission)) ?? 0) : 0;
    executions.push({
      externalId: get(row, m.id) ? `${format === 'ninjatrader-executions' ? 'nt' : 'csv'}:${get(row, m.id)}` : `row:${account}:${at}:${side}:${qty}:${price}`,
      account,
      root: root!,
      side: side!,
      qty: Math.abs(qty!),
      price: price!,
      at: at!,
      commissionCents: Math.abs(commission),
    });
  });
  return { executions, issues };
}
