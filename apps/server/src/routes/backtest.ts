import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { findInstrument, TIMEFRAMES } from '@tc/domain';
import { storage } from '../config';
import { body } from '../http';
import { getState, setState } from '../settings';
import { AppError } from '../errors';
import type { AuthUser } from '../auth';
import { canBacktest, isMarketPath, localMarketFile, marketFileLink } from '../marketData';

const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Invalid colour');
const lineStyle = z.object({ color, width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), dash: z.enum(['solid', 'dashed', 'dotted']), priceLabel: z.boolean() });
const lineLabel = z.object({
  text: z.string().max(200),
  color: color.nullable(),
  size: z.number().int().min(8).max(32),
  bold: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  place: z.enum(['above', 'middle', 'below']),
});
const line = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(['hray', 'hline']),
  price: z.number().finite(),
  time: z.number().int(),
  style: lineStyle,
  label: lineLabel,
  hiddenOn: z.array(z.enum(TIMEFRAMES as [string, ...string[]])),
});
const drawingsSchema = z.object({ lines: z.array(line).max(2000) });
const lineToolsSchema = z.object({
  templates: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(60), style: lineStyle, label: lineLabel })).max(200),
  last: z.object({ style: lineStyle, label: lineLabel }).nullable(),
});

const num = z.number().finite();
const bracket = z.object({ stop: num.nullable(), target: num.nullable() });
const side = z.enum(['buy', 'sell']);
const fill = z.object({ time: z.number().int(), side, qty: num.positive(), price: num, fee: num, reason: z.enum(['entry', 'manual', 'stop', 'target']) });
const id = z.string().min(1).max(40);
const simSchema = z.object({
  startBalance: num.min(0),
  processedTo: z.number().int().nullable(),
  orders: z.array(z.object({ id, symbol: z.string().max(20), type: z.enum(['limit', 'stop']), side, qty: num.positive(), price: num, bracket, placedAt: z.number().int() })).max(200),
  positions: z
    .array(
      z.object({
        id,
        symbol: z.string().max(20),
        side: z.enum(['long', 'short']),
        qty: num.positive(),
        avgEntry: num,
        openedAt: z.number().int(),
        bracket,
        initialStop: num.nullable(),
        fills: z.array(fill).max(500),
        realised: num,
        maxQty: num,
        ambiguous: z.boolean(),
      }),
    )
    .max(20),
  trades: z
    .array(
      z.object({
        id,
        symbol: z.string().max(20),
        side: z.enum(['long', 'short']),
        qty: num,
        avgEntry: num,
        avgExit: num,
        openedAt: z.number().int(),
        closedAt: z.number().int(),
        gross: num,
        fees: num,
        net: num,
        initialStop: num.nullable(),
        riskPoints: num.nullable(),
        r: num.nullable(),
        exitReason: z.enum(['entry', 'manual', 'stop', 'target']),
        ambiguous: z.boolean(),
        fills: z.array(fill).max(500),
      }),
    )
    .max(5000),
  fees: z.object({ cryptoRate: num.min(0).max(0.05) }),
});

const instrumentParam = (id: string) => {
  if (!findInstrument(id)) throw new AppError(404, 'Unknown instrument');
  return id;
};

/** The backtesting page: price history, and the owner's drawings and line templates. Owner only (see `canBacktest`). */
export const backtestRoutes = new Hono<{ Variables: { user: AuthUser } }>()
  .use(async (c, next) => {
    const user = c.get('user');
    if (!canBacktest(user.userId, !!user.demo)) throw new AppError(404, 'Not found');
    await next();
  })
  /** One price file (gzipped JSON; the browser unpacks it). Missing files are a 404: no data for that day. */
  .get('/data/*', async (c) => {
    const p = c.req.path.replace(/^\/api\/backtest\/data\//, '');
    if (!isMarketPath(p)) return c.json({ error: 'Not found' }, 404);
    if (storage.remote) {
      const url = await marketFileLink(p);
      if (!url) return c.json({ error: 'No data' }, 404);
      c.header('Cache-Control', 'private, max-age=300');
      return c.redirect(url, 302);
    }
    const file = localMarketFile(p);
    if (!existsSync(file)) return c.json({ error: 'No data' }, 404);
    c.header('Content-Type', 'application/gzip');
    c.header('Content-Length', String(statSync(file).size));
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
  })
  /** Lines drawn on an instrument's chart. */
  .get('/drawings/:instrument', async (c) => c.json((await getState(`backtest.drawings.${instrumentParam(c.req.param('instrument'))}`)) ?? { lines: [] }))
  .put('/drawings/:instrument', async (c) => {
    const id = instrumentParam(c.req.param('instrument'));
    const data = await body(c.req, drawingsSchema);
    await setState(`backtest.drawings.${id}`, data);
    return c.json(data);
  })
  /** Line templates and the look of the next new line. */
  .get('/line-tools', async (c) => c.json((await getState('backtest.lineTools')) ?? { templates: [], last: null }))
  .put('/line-tools', async (c) => {
    const data = await body(c.req, lineToolsSchema);
    await setState('backtest.lineTools', data);
    return c.json(data);
  })
  /** The simulated trading account on an instrument (balance, orders, positions, closed trades). */
  .get('/sim/:instrument', async (c) => c.json((await getState(`backtest.sim.${instrumentParam(c.req.param('instrument'))}`)) ?? null))
  .put('/sim/:instrument', async (c) => {
    const id = instrumentParam(c.req.param('instrument'));
    const data = await body(c.req, simSchema);
    await setState(`backtest.sim.${id}`, data);
    return c.json(data);
  });
