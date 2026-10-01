import type { Cents } from './money';

export type Side = 'buy' | 'sell';
export type Direction = 'long' | 'short';

export interface Fill {
  at: string;
  side: Side;
  qty: number;
  price: number;
}

export interface FillResult {
  direction: Direction;
  /** Largest position held at once. */
  maxQty: number;
  /** Total contracts traded (entries + exits), for fee estimates. */
  totalQty: number;
  avgEntry: number;
  avgExit: number;
  /** Realised P&L in points × contracts. */
  grossPoints: number;
  grossCents: Cents;
  openedAt: string;
  closedAt: string;
}

export class FillError extends Error {}

const round = (n: number, dp = 8) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Realised P&L of a round trip built from fills, matching exits to entries first-in-first-out.
 * Supports scaling in and out. The position must start and end flat and may not reverse through zero.
 */
export function pnlFromFills(fills: readonly Fill[], pointValueCents: Cents): FillResult {
  if (fills.length < 2) throw new FillError('A trade needs at least an entry and an exit');
  const ordered = fills.map((f, i) => ({ ...f, i })).sort((a, b) => a.at.localeCompare(b.at) || a.i - b.i);
  for (const f of ordered) {
    if (!Number.isInteger(f.qty) || f.qty <= 0) throw new FillError('Fill quantities must be whole numbers above zero');
    if (!Number.isFinite(f.price) || f.price <= 0) throw new FillError('Fill prices must be above zero');
  }

  const direction: Direction = ordered[0]!.side === 'buy' ? 'long' : 'short';
  const sign = direction === 'long' ? 1 : -1;
  const lots: { qty: number; price: number }[] = [];
  let position = 0;
  let maxQty = 0;
  let entryQty = 0;
  let entryNotional = 0;
  let exitQty = 0;
  let exitNotional = 0;
  let grossPoints = 0;

  for (const f of ordered) {
    const opening = (f.side === 'buy') === (direction === 'long');
    if (opening) {
      if (position === 0 && entryQty > 0) throw new FillError('The position went flat and re-opened. Log that as a separate trade.');
      lots.push({ qty: f.qty, price: f.price });
      position += f.qty;
      entryQty += f.qty;
      entryNotional += f.qty * f.price;
      maxQty = Math.max(maxQty, position);
      continue;
    }
    if (f.qty > position) throw new FillError('An exit is larger than the open position (a reversal). Log the reversal as a separate trade.');
    let remaining = f.qty;
    while (remaining > 0) {
      const lot = lots[0]!;
      const matched = Math.min(lot.qty, remaining);
      grossPoints += (f.price - lot.price) * matched * sign;
      lot.qty -= matched;
      remaining -= matched;
      if (lot.qty === 0) lots.shift();
    }
    position -= f.qty;
    exitQty += f.qty;
    exitNotional += f.qty * f.price;
  }
  if (position !== 0) throw new FillError(`The position isn't flat: ${position} contract${position === 1 ? '' : 's'} still open`);

  grossPoints = round(grossPoints);
  return {
    direction,
    maxQty,
    totalQty: entryQty + exitQty,
    avgEntry: round(entryNotional / entryQty),
    avgExit: round(exitNotional / exitQty),
    grossPoints,
    grossCents: Math.round(grossPoints * pointValueCents),
    openedAt: ordered[0]!.at,
    closedAt: ordered[ordered.length - 1]!.at,
  };
}

/** Copy-trade fills to another account at `multiplier` × size. */
export const replicateFills = (fills: readonly Fill[], multiplier: number): Fill[] => fills.map((f) => ({ ...f, qty: f.qty * multiplier }));

/** Fills for a simple one-entry, one-exit trade. */
export function simpleFills(direction: Direction, qty: number, entry: { at: string; price: number }, exit: { at: string; price: number }): Fill[] {
  return [
    { at: entry.at, side: direction === 'long' ? 'buy' : 'sell', qty, price: entry.price },
    { at: exit.at, side: direction === 'long' ? 'sell' : 'buy', qty, price: exit.price },
  ];
}

export const isOnTick = (price: number, tick: number): boolean => Math.abs(price / tick - Math.round(price / tick)) < 1e-6;

export interface RiskPlan {
  /** Points from the first entry to the stop. */
  riskPoints: number | null;
  /** Planned risk in money at the largest position size. */
  riskCents: Cents | null;
  /** Reward-to-risk to the target, from the first entry. */
  plannedRR: number | null;
}

/** Planned risk from a stop (or a typed risk in points) and the planned reward-to-risk. */
export function riskPlan(
  firstEntryPrice: number,
  maxQty: number,
  pointValueCents: Cents,
  plan: { stopPrice?: number | null; targetPrice?: number | null; riskPoints?: number | null },
): RiskPlan {
  const riskPoints = plan.stopPrice != null ? round(Math.abs(firstEntryPrice - plan.stopPrice)) : (plan.riskPoints ?? null);
  if (!riskPoints) return { riskPoints: riskPoints ?? null, riskCents: null, plannedRR: null };
  return {
    riskPoints,
    riskCents: Math.round(riskPoints * pointValueCents * maxQty),
    plannedRR: plan.targetPrice != null ? round(Math.abs(plan.targetPrice - firstEntryPrice) / riskPoints, 2) : null,
  };
}

/** Actual R multiple: net result divided by planned risk. */
export const rMultiple = (netCents: Cents, riskCents: Cents | null): number | null => (riskCents ? round(netCents / riskCents, 2) : null);
