import { Hono } from 'hono';
import { z } from 'zod';
import {
  createQuestion,
  createReading,
  deleteReading,
  dismissCheckIn,
  getDueCheckIn,
  listQuestions,
  readingsForDay,
  snoozeCheckIn,
  updateQuestion,
} from '../checkins';
import { body, isoDate } from '../http';

const answers = z.array(z.object({ questionId: z.string(), value: z.union([z.string(), z.number(), z.null()]) }));

export const questionRoutes = new Hono()
  .get('/', (c) => c.json(listQuestions()))
  .post('/', async (c) =>
    c.json(
      createQuestion(
        await body(c.req, z.object({ prompt: z.string().trim().min(1).max(200), kind: z.enum(['mood', 'scale', 'yesPartlyNo', 'text']), appliesTo: z.enum(['both', 'start', 'checkin']) })),
      ),
      201,
    ),
  )
  .patch('/:id', async (c) =>
    c.json(
      updateQuestion(
        c.req.param('id'),
        await body(c.req, z.object({ prompt: z.string().trim().min(1).max(200), appliesTo: z.enum(['both', 'start', 'checkin']), archived: z.boolean(), sortOrder: z.number().int() }).partial().strict()),
      ),
    ),
  );

export const readingRoutes = new Hono()
  .get('/', (c) => c.json(readingsForDay(isoDate.parse(c.req.query('day')))))
  .post('/', async (c) => {
    const { sessionId, ...input } = await body(
      c.req,
      z.object({ sessionId: z.string().min(1), kind: z.enum(['start', 'checkin']), answers, decision: z.enum(['keep_trading', 'take_break', 'stop']).nullable().optional() }),
    );
    return c.json(createReading(sessionId, input), 201);
  })
  .delete('/:id', (c) => {
    deleteReading(c.req.param('id'));
    return c.body(null, 204);
  });

export const checkInRoutes = new Hono()
  .get('/due', (c) => c.json(getDueCheckIn()))
  .post('/:sessionId/snooze', (c) => {
    snoozeCheckIn(c.req.param('sessionId'));
    return c.body(null, 204);
  })
  .post('/:sessionId/dismiss', (c) => {
    dismissCheckIn(c.req.param('sessionId'));
    return c.body(null, 204);
  });

export { answers as answersSchema };
