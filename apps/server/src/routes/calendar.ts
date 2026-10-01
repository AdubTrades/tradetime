import { Hono } from 'hono';
import { z } from 'zod';
import {
  calendarRange,
  createEvent,
  createEventType,
  deleteEvent,
  listEventTypes,
  setTaskDone,
  updateEvent,
  updateEventType,
  upcoming,
  upsertException,
} from '../calendar';
import { body, isoDate } from '../http';
import { getMarketStatus, refreshMarketEvents } from '../marketEvents';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const recurrence = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(52),
    byWeekday: z.array(z.number().int().min(1).max(7)).optional(),
    until: isoDate.nullable().optional(),
  })
  .nullable();

const eventSchema = z.object({
  typeId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).nullable().optional(),
  link: z.string().max(2000).nullable().optional(),
  date: isoDate,
  allDay: z.boolean().optional(),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
  recurrence: recurrence.optional(),
  reminderMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  isTask: z.boolean().optional(),
});

export const calendarRoutes = new Hono()
  .get('/range', (c) => c.json(calendarRange(isoDate.parse(c.req.query('from')), isoDate.parse(c.req.query('to')))))
  .get('/upcoming', (c) => c.json(upcoming(Math.min(31, Math.max(1, Number(c.req.query('days') ?? 7))))))
  .get('/types', (c) => c.json(listEventTypes()))
  .post('/types', async (c) =>
    c.json(
      createEventType(
        await body(c.req, z.object({ name: z.string().trim().min(1).max(60), color: z.string(), sessionTypeId: z.string().nullable().optional(), isNoTrade: z.boolean().optional() })),
      ),
      201,
    ),
  )
  .patch('/types/:id', async (c) =>
    c.json(
      updateEventType(
        c.req.param('id'),
        await body(
          c.req,
          z
            .object({ name: z.string().trim().min(1).max(60), color: z.string(), sessionTypeId: z.string().nullable(), isNoTrade: z.boolean(), archived: z.boolean(), sortOrder: z.number().int() })
            .partial()
            .strict(),
        ),
      ),
    ),
  )
  .post('/events', async (c) => c.json(createEvent(await body(c.req, eventSchema)), 201))
  .patch('/events/:id', async (c) => c.json(updateEvent(c.req.param('id'), await body(c.req, eventSchema.partial().strict()))))
  .delete('/events/:id', (c) => {
    deleteEvent(c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/events/:id/done', async (c) => {
    const { done } = await body(c.req, z.object({ done: z.boolean() }));
    setTaskDone(c.req.param('id'), done);
    return c.body(null, 204);
  })
  /** Change a single occurrence of a repeating event. */
  .put('/events/:id/occurrences/:date', async (c) => {
    const change = await body(
      c.req,
      z.object({
        skipped: z.boolean().optional(),
        done: z.boolean().optional(),
        override: z
          .object({ title: z.string().trim().min(1).max(200).optional(), date: isoDate.optional(), startTime: hhmm.nullable().optional(), endTime: hhmm.nullable().optional(), notes: z.string().nullable().optional() })
          .nullable()
          .optional(),
      }),
    );
    upsertException(c.req.param('id'), isoDate.parse(c.req.param('date')), change);
    return c.body(null, 204);
  })
  .get('/market/status', (c) => c.json(getMarketStatus()))
  .post('/market/refresh', async (c) => {
    const status = await refreshMarketEvents();
    return c.json(status, status.lastError ? 502 : 200);
  });
