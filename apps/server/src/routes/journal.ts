import { Hono } from 'hono';
import { z } from 'zod';
import { GRADES } from '@tc/domain';
import { getAttachment } from '../attachments';
import { createContract, deleteAccountGroup, listAccountGroups, listContracts, saveAccountGroup, updateContract } from '../contracts';
import { AppError } from '../errors';
import { body, cents, instant, isoDate } from '../http';
import { addCriterion, addExample, createPlay, deleteExample, getPlay, listPlays, updateCriterion, updateExample, updatePlay } from '../plays';
import {
  createTrade,
  deleteTrade,
  getDailyReview,
  getTrade,
  listDailyReviewDays,
  listTrades,
  resultLabel,
  saveDailyReview,
  tradeHistory,
  updateTrade,
} from '../trades';

const price = z.number().positive();
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid id');

const contractSchema = z.object({
  symbol: z.string().trim().min(1).max(12),
  name: z.string().trim().min(1).max(80),
  tickSize: z.number().positive(),
  pointValueCents: cents.positive(),
  feePerSideCents: cents.min(0).optional(),
  archived: z.boolean().optional(),
});

export const contractRoutes = new Hono()
  .get('/', (c) => c.json(listContracts()))
  .post('/', async (c) => c.json(createContract(await body(c.req, contractSchema)), 201))
  .patch('/:id', async (c) => c.json(updateContract(c.req.param('id'), await body(c.req, contractSchema.partial().strict()))));

const groupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  members: z.array(z.object({ accountId: z.string().min(1), multiplier: z.number().int().min(1).max(100) })),
});

export const accountGroupRoutes = new Hono()
  .get('/', (c) => c.json(listAccountGroups()))
  .post('/', async (c) => c.json(saveAccountGroup(null, await body(c.req, groupSchema)), 201))
  .put('/:id', async (c) => c.json(saveAccountGroup(c.req.param('id'), await body(c.req, groupSchema))))
  .delete('/:id', (c) => {
    deleteAccountGroup(c.req.param('id'));
    return c.body(null, 204);
  });

const gradeEnum = z.enum(GRADES);
const exampleSchema = z.object({
  grade: gradeEnum,
  attachmentId: z.string().min(1),
  caption: z.string().max(500).nullable().optional(),
  date: isoDate.nullable().optional(),
  resultLabel: z.string().max(50).nullable().optional(),
  sourceTradeId: z.string().nullable().optional(),
});

export const playRoutes = new Hono()
  .get('/', (c) => c.json(listPlays()))
  .post('/', async (c) => c.json(createPlay(await body(c.req, z.object({ title: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional() }))), 201))
  .get('/:id', (c) => c.json(getPlay(c.req.param('id'))))
  .patch('/:id', async (c) =>
    c.json(
      updatePlay(
        c.req.param('id'),
        await body(
          c.req,
          z
            .object({
              title: z.string().trim().min(1).max(120),
              description: z.string().max(2000).nullable(),
              gradeRules: z.array(z.object({ grade: gradeEnum, maxMissed: z.number().int().min(0), riskNote: z.string().max(200).nullable().optional() })),
              archived: z.boolean(),
              sortOrder: z.number().int(),
            })
            .partial()
            .strict(),
        ),
      ),
    ),
  )
  .post('/:id/criteria', async (c) =>
    c.json(addCriterion(c.req.param('id'), await body(c.req, z.object({ label: z.string().trim().min(1).max(300), mustHave: z.boolean().optional() }))), 201),
  )
  .patch('/criteria/:id', async (c) =>
    c.json(
      updateCriterion(
        c.req.param('id'),
        await body(c.req, z.object({ label: z.string().trim().min(1).max(300), mustHave: z.boolean(), archived: z.boolean(), sortOrder: z.number().int() }).partial().strict()),
      ),
    ),
  )
  .post('/:id/examples', async (c) => c.json(addExample(c.req.param('id'), await body(c.req, exampleSchema)), 201))
  .patch('/examples/:id', async (c) =>
    c.json(updateExample(c.req.param('id'), await body(c.req, exampleSchema.omit({ attachmentId: true }).extend({ sortOrder: z.number().int() }).partial().strict()))),
  )
  .delete('/examples/:id', (c) => {
    deleteExample(c.req.param('id'));
    return c.body(null, 204);
  });

const tradeSchema = z.object({
  id: ulid.optional(),
  tradingDay: isoDate,
  contractId: z.string().min(1),
  playId: z.string().min(1).nullable().optional(),
  checks: z.array(z.object({ criterionId: z.string(), checked: z.boolean() })).optional(),
  stopPrice: price.nullable().optional(),
  targetPrice: price.nullable().optional(),
  riskPoints: z.number().positive().nullable().optional(),
  followedPlan: z.enum(['yes', 'partly', 'no']).nullable().optional(),
  emotionId: z.string().min(1).nullable().optional(),
  confidence: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  mistakeIds: z.array(z.string()).optional(),
  sessionId: z.string().nullable().optional(),
  fills: z.array(z.object({ at: instant, side: z.enum(['buy', 'sell']), qty: z.number().int().positive(), price })).min(2),
  accounts: z.array(z.object({ accountId: z.string().min(1), multiplier: z.number().int().min(1).max(100), feesCents: cents.min(0).nullable().optional() })).min(1),
});

export const tradeRoutes = new Hono()
  .get('/', (c) => {
    const from = isoDate.safeParse(c.req.query('from'));
    const to = isoDate.safeParse(c.req.query('to'));
    if (!from.success || !to.success) throw new AppError(400, 'from and to (YYYY-MM-DD) are required');
    return c.json(listTrades({ from: from.data, to: to.data }));
  })
  .post('/', async (c) => c.json(createTrade(await body(c.req, tradeSchema)), 201))
  .get('/:id', (c) => c.json(getTrade(c.req.param('id'))))
  .put('/:id', async (c) => {
    const { reason, ...input } = await body(c.req, tradeSchema.extend({ reason: z.string().max(500).nullable().optional() }));
    return c.json(updateTrade(c.req.param('id'), input, reason ?? null));
  })
  .delete('/:id', (c) => {
    deleteTrade(c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/:id/history', (c) => c.json(tradeHistory(c.req.param('id'))))
  /** Add one of the trade's screenshots to its Play's gallery at the trade's grade. */
  .post('/:id/send-to-playbook', async (c) => {
    const { attachmentId, caption } = await body(c.req, z.object({ attachmentId: z.string().min(1), caption: z.string().max(500).nullable().optional() }));
    const t = getTrade(c.req.param('id'));
    if (!t.playId) throw new AppError(422, 'This trade has no Play');
    if (!t.grade) throw new AppError(422, "Outside-plan trades don't have a grade, so they can't go on a grade shelf");
    if (!getAttachment(attachmentId)) throw new AppError(422, 'Unknown attachment');
    return c.json(
      addExample(t.playId, { grade: t.grade, attachmentId, caption: caption ?? null, date: t.tradingDay, resultLabel: resultLabel(t), sourceTradeId: t.id }),
      201,
    );
  });

export const dailyReviewRoutes = new Hono()
  .get('/', (c) => {
    const from = isoDate.parse(c.req.query('from'));
    const to = isoDate.parse(c.req.query('to'));
    return c.json(listDailyReviewDays({ from, to }));
  })
  .get('/:day', (c) => c.json(getDailyReview(isoDate.parse(c.req.param('day')))))
  .put('/:day', async (c) => {
    const { notes } = await body(c.req, z.object({ notes: z.string().max(20000) }));
    return c.json(saveDailyReview(isoDate.parse(c.req.param('day')), notes));
  });
