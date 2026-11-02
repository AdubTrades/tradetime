import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { TIMEFRAMES, type Timeframe } from '@tc/domain';
import { storage } from '../config';
import { body } from '../http';
import { getState, setState } from '../settings';
import { AppError } from '../errors';
import type { AuthUser } from '../auth';
import { canBacktest, isMarketPath, localMarketFile, marketFileLink } from '../marketData';
import { createSession, deleteSession, getSession, listSessions, saveSim, updateSession } from '../backtestSessions';

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
const rectStyle = z.object({
  border: color,
  borderWidth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  fill: color,
  fillOpacity: z.number().min(0).max(1),
  midline: z.boolean(),
  midDash: z.enum(['solid', 'dashed', 'dotted']),
  extendRight: z.boolean(),
});
const tfs = z.array(z.enum(TIMEFRAMES as [string, ...string[]]));
const shape = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1).max(40),
    kind: z.literal('rect'),
    t1: z.number().int(),
    t2: z.number().int(),
    p1: z.number().finite(),
    p2: z.number().finite(),
    style: rectStyle,
    label: lineLabel,
    hiddenOn: tfs,
  }),
  z.object({
    id: z.string().min(1).max(40),
    kind: z.enum(['long', 'short']),
    t1: z.number().int(),
    t2: z.number().int(),
    entry: z.number().finite(),
    stop: z.number().finite(),
    target: z.number().finite(),
    symbol: z.string().min(1).max(20),
    riskMode: z.enum(['usd', 'percent']).optional(),
    riskUsd: z.number().min(0).max(1e9),
    riskPct: z.number().min(0).max(100).optional(),
    hiddenOn: tfs,
  }),
]);
const drawingsSchema = z.object({ lines: z.array(line).max(2000), shapes: z.array(shape).max(2000).optional() });
const lineToolsSchema = z.object({
  templates: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(60), style: lineStyle, label: lineLabel })).max(200),
  last: z.object({ style: lineStyle, label: lineLabel }).nullable(),
  rectLast: rectStyle.nullable().optional(),
  riskUsd: z.number().min(0).max(1e9).nullable().optional(),
  riskMode: z.enum(['usd', 'percent']).nullable().optional(),
  riskPct: z.number().min(0).max(100).nullable().optional(),
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
        initialTarget: num.nullable().optional(),
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
        initialTarget: num.nullable().optional(),
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

const timeframe = z.enum(TIMEFRAMES as [Timeframe, ...Timeframe[]]);
const sessionCreate = z.object({
  name: z.string().trim().min(1, 'Name the session').max(60),
  instrument: z.string().min(1).max(20),
  accountId: z.string().min(1).nullable().optional(),
  startBalance: num.min(0).max(1e9),
  cursor: z.number().int().nullable(),
  tf: timeframe,
});
const sessionPatch = z.object({ name: z.string().trim().min(1).max(60).optional(), tf: timeframe.optional(), cursor: z.number().int().nullable().optional(), accountId: z.string().min(1).optional() });

/** A session id in the URL: it must be one of the user's sessions. */
const sessionParam = async (id: string) => (await getSession(id)).id;

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
  /** Backtesting sessions. */
  .get('/sessions', async (c) => c.json(await listSessions()))
  .post('/sessions', async (c) => c.json(await createSession(await body(c.req, sessionCreate)), 201))
  .patch('/sessions/:id', async (c) => c.json(await updateSession(c.req.param('id'), await body(c.req, sessionPatch))))
  .delete('/sessions/:id', async (c) => {
    await deleteSession(c.req.param('id'));
    return c.body(null, 204);
  })
  /** Lines drawn in a session. */
  .get('/drawings/:id', async (c) => c.json((await getState(`backtest.drawings.${await sessionParam(c.req.param('id'))}`)) ?? { lines: [] }))
  .put('/drawings/:id', async (c) => {
    const id = await sessionParam(c.req.param('id'));
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
  /** A session's practice account (balance, orders, positions, closed trades). Saving also journals new trades. */
  .get('/sim/:id', async (c) => c.json((await getState(`backtest.sim.${await sessionParam(c.req.param('id'))}`)) ?? null))
  .put('/sim/:id', async (c) => {
    const result = await saveSim(c.req.param('id'), await body(c.req, simSchema));
    return c.json({ journaled: result.journaled, failed: result.failed });
  });
