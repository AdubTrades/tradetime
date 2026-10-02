import { parse } from 'csv-parse/sync';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import {
  detectDateOrder,
  detectFormat,
  groupRoundTrips,
  mergeCopyTrades,
  pnlFromFills,
  rowsToExecutions,
  suggestImportMapping,
  tradingDay,
  type DateOrder,
  type FormatPreset,
  type ImportMapping,
  type ImportTrade,
} from '@tc/domain';
import { listAccounts } from './accounts';
import { db } from './context';
import { listContracts } from './contracts';
import { AppError } from './errors';
import { getSettings } from './settings';
import { createTrade, getTrade, updateTrade } from './trades';

const { fill, trade, accountAlias } = schema;
const MAX_BYTES = 10 * 1024 * 1024;

export interface ImportOptions {
  csv: string;
  format?: FormatPreset['id'];
  mapping?: ImportMapping;
  zone?: string;
  dateOrder?: DateOrder;
  /** For exports without an account column. */
  defaultAccount?: string;
  /** Broker account name → TradeTime account id, or 'skip'. Saved for next time on commit. */
  accountMap?: Record<string, string>;
  /** Attach imported fills to a trade you logged live at the same time, instead of creating a new one. */
  attachToLogged?: boolean;
}

function readCsv(text: string) {
  if (text.length > MAX_BYTES) throw new AppError(422, 'The file is larger than 10 MB');
  try {
    const rows = parse(text, { columns: (h: string[]) => h.map((x) => x.trim()), bom: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
    return { headers: rows.length ? Object.keys(rows[0]!) : [], rows };
  } catch (err) {
    throw new AppError(422, `Couldn't read the CSV: ${(err as Error).message}`);
  }
}

const aliases = () => new Map(db.select().from(accountAlias).all().map((a) => [a.alias, a.accountId]));

/** Best guess at which TradeTime account a broker account name means, from saved aliases or a name match. */
function guessAccount(name: string, saved: Map<string, string>): string | null {
  if (saved.has(name)) return saved.get(name)!;
  const accounts = listAccounts();
  const n = name.toLowerCase();
  return accounts.find((a) => a.name.toLowerCase() === n || a.name.toLowerCase().includes(n) || (a.notes ?? '').toLowerCase().includes(n))?.id ?? null;
}

/** A manual trade logged live that these fills belong to: same day, contract and direction, entry within 3 minutes. */
function findLoggedTrade(day: string, contractId: string, direction: string, openedAt: string): string | null {
  const candidates = db
    .select({ id: trade.id, openedAt: trade.openedAt })
    .from(trade)
    .where(and(isNull(trade.deletedAt), eq(trade.tradingDay, day), eq(trade.contractId, contractId), eq(trade.direction, direction as 'long'), eq(trade.source, 'manual')))
    .all();
  const near = candidates
    .map((c) => ({ ...c, gap: Math.abs(Date.parse(c.openedAt) - Date.parse(openedAt)) }))
    .filter((c) => c.gap <= 3 * 60_000)
    .sort((a, b) => a.gap - b.gap);
  return near[0]?.id ?? null;
}

export interface PreviewTrade {
  key: string;
  tradingDay: string;
  contractId: string | null;
  symbol: string;
  direction: string;
  openedAt: string;
  closedAt: string;
  accounts: { name: string; accountId: string | null; maxQty: number; multiplier: number; fills: number; netCents: number | null }[];
  netCents: number | null;
  status: 'new' | 'attach' | 'error';
  attachTo: string | null;
  issues: string[];
}

function analyse(opts: ImportOptions) {
  const { headers, rows } = readCsv(opts.csv);
  const format = opts.format ?? detectFormat(headers);
  const mapping = format === 'generic' ? (opts.mapping ?? suggestImportMapping(headers)) : {};
  const timeCol = format === 'ninjatrader-executions' ? 'Time' : format === 'tradovate-performance' ? 'boughtTimestamp' : mapping.time;
  const detectedOrder = detectDateOrder(rows.slice(0, 200).map((r) => (timeCol ? (r[timeCol] ?? '') : '')));
  const dateOrder = opts.dateOrder ?? detectedOrder ?? 'dmy';
  const zone = opts.zone ?? 'Australia/Perth';
  if (format === 'generic') {
    const missing = (['time', 'side', 'qty', 'price', 'symbol'] as const).filter((f) => !mapping[f]);
    if (missing.length) return { headers, format, mapping, zone, dateOrder, detectedOrder, missing, accountsInFile: [], trades: [] as PreviewTrade[], counts: { rows: rows.length, executions: 0, duplicates: 0, open: 0, issues: 0 }, rowIssues: [], merged: [] as ImportTrade[] };
  }

  const { executions, issues: rowIssues } = rowsToExecutions(rows, format, mapping, { zone, dateOrder, defaultAccount: opts.defaultAccount });

  // Fills already in TradeTime are skipped, so overlapping exports only add what's new.
  const ids = executions.map((e) => e.externalId);
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const variants = chunk.flatMap((id) => [id, `${id}#close`, `${id}#open`]);
    for (const r of db.select({ id: fill.externalId }).from(fill).where(inArray(fill.externalId, variants)).all()) if (r.id) seen.add(r.id.replace(/#(close|open)$/, ''));
  }
  const fresh = executions.filter((e) => !seen.has(e.externalId));
  const { trips, open } = groupRoundTrips(fresh);
  const merged = mergeCopyTrades(trips);

  const saved = aliases();
  const names = [...new Set(executions.map((e) => e.account))];
  const accountsInFile = names.map((name) => ({ name, accountId: opts.accountMap?.[name] ?? guessAccount(name, saved), saved: saved.has(name) }));
  const accountFor = (name: string) => {
    const id = accountsInFile.find((a) => a.name === name)?.accountId;
    return id && id !== 'skip' ? id : null;
  };
  const contracts = listContracts();
  const { rolloverTime } = getSettings();

  const trades: PreviewTrade[] = merged.map((t, i) => {
    const c = contracts.find((x) => x.symbol === t.root) ?? null;
    const issues: string[] = [];
    if (!c) issues.push(`${t.root} isn't a contract in TradeTime — add it in Settings → Contracts`);
    const skipped = t.accounts.filter((a) => opts.accountMap?.[a.account] === 'skip');
    const accounts = t.accounts
      .filter((a) => !skipped.includes(a))
      .map((a) => {
        const id = accountFor(a.account);
        let net: number | null = null;
        if (c) {
          const r = pnlFromFills(a.fills, c.pointValueCents);
          const fees = a.commissionCents || r.totalQty * c.feePerSideCents;
          net = r.grossCents - fees;
        }
        return { name: a.account, accountId: id, maxQty: a.maxQty, multiplier: a.multiplier, fills: a.fills.length, netCents: net };
      });
    if (accounts.length === 0) issues.push('All accounts in this trade are set to skip');
    if (accounts.some((a) => !a.accountId)) issues.push('Choose a TradeTime account for every account in the file');
    const day = tradingDay(t.openedAt, rolloverTime);
    const attachTo = c && opts.attachToLogged !== false ? findLoggedTrade(day, c.id, t.direction, t.openedAt) : null;
    return {
      key: `${i}`,
      tradingDay: day,
      contractId: c?.id ?? null,
      symbol: t.root,
      direction: t.direction,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      accounts,
      netCents: accounts.every((a) => a.netCents !== null) ? accounts.reduce((s, a) => s + a.netCents!, 0) : null,
      status: issues.length ? 'error' : attachTo ? 'attach' : 'new',
      attachTo,
      issues,
    };
  });

  return {
    headers,
    format,
    mapping,
    zone,
    dateOrder,
    detectedOrder,
    missing: [] as string[],
    accountsInFile,
    trades,
    merged,
    rowIssues: rowIssues.slice(0, 50),
    counts: { rows: rows.length, executions: executions.length, duplicates: executions.length - fresh.length, open: open.length, issues: rowIssues.length },
  };
}

/** Read an export and report what would be imported, without saving anything. */
export function previewImport(opts: ImportOptions) {
  const { merged: _merged, ...rest } = analyse(opts);
  void _merged;
  return rest;
}

/** Import all trades without errors. New trades are flagged "needs review"; fills matching a live-logged trade attach to it. */
export function commitImport(opts: ImportOptions) {
  const a = analyse(opts);
  if (a.missing.length) throw new AppError(422, `Choose columns for: ${a.missing.join(', ')}`);
  // Remember account mappings for next time.
  for (const acc of a.accountsInFile) {
    if (acc.accountId && acc.accountId !== 'skip' && acc.name) {
      db.insert(accountAlias).values({ alias: acc.name, accountId: acc.accountId }).onConflictDoUpdate({ target: accountAlias.alias, set: { accountId: acc.accountId } }).run();
    }
  }
  let created = 0;
  let attached = 0;
  const failed: { when: string; message: string }[] = [];
  a.trades.forEach((p, i) => {
    if (p.status === 'error' || !p.contractId) return;
    const t = a.merged[i]!;
    const accounts = t.accounts
      .filter((x) => opts.accountMap?.[x.account] !== 'skip')
      .map((x) => ({
        accountId: p.accounts.find((pa) => pa.name === x.account)!.accountId!,
        multiplier: x.multiplier,
        feesCents: x.commissionCents || null,
        fills: x.fills,
      }));
    const base = accounts.reduce((m, x) => (x.multiplier < m.multiplier ? x : m), accounts[0]!);
    try {
      if (p.attachTo) {
        // Keep everything you logged live (Play, checklist, notes); replace the fills with the broker's.
        const logged = getTrade(p.attachTo);
        updateTrade(
          logged.id,
          {
            tradingDay: logged.tradingDay,
            contractId: p.contractId,
            playId: logged.playId,
            checks: logged.checks.map((c) => ({ criterionId: c.criterionId, checked: c.checked })),
            stopPrice: logged.stopPrice,
            targetPrice: logged.targetPrice,
            riskPoints: logged.stopPrice == null ? logged.plannedRiskPoints : null,
            followedPlan: logged.followedPlan,
            emotionId: logged.emotionId,
            confidence: logged.confidence,
            notes: logged.notes,
            mistakeIds: logged.mistakeIds,
            sessionId: logged.sessionId,
            ...(logged.stateOverridden ? { stateReadingId: logged.stateReadingId } : {}),
            fills: base.fills,
            accounts,
            source: 'import',
            needsReview: false,
          },
          'Fills replaced by broker import',
        );
        attached++;
      } else {
        createTrade({ tradingDay: p.tradingDay, contractId: p.contractId, fills: base.fills, accounts, source: 'import', needsReview: true });
        created++;
      }
    } catch (err) {
      failed.push({ when: p.openedAt, message: (err as Error).message });
    }
  });
  return { created, attached, skipped: a.trades.filter((t) => t.status === 'error').length, failed, duplicates: a.counts.duplicates, open: a.counts.open };
}

export const listAliases = () => db.select().from(accountAlias).all();
export function deleteAlias(alias: string) {
  db.delete(accountAlias).where(eq(accountAlias.alias, alias)).run();
}
