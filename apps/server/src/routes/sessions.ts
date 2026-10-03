import { Hono } from 'hono';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { decimalHours, durationMinutes, financialYearOf, formatLocal, tradingDay } from '@tc/domain';
import { getSettings } from '../settings';
import { createReading, relinkSessionTrades } from '../checkins';
import { toCsv } from '../csv';
import { answersSchema } from './checkins';
import { body, fyParam, instant, isoDate } from '../http';
import { AppError } from '../errors';
import {
  createManualSession,
  createSessionType,
  deleteSession,
  getRunningSession,
  listSessions,
  listSessionTypes,
  restoreSession,
  sessionHistory,
  sessionFinancialYears,
  sessionsForFinancialYear,
  startTimer,
  stopTimer,
  updateSession,
  updateSessionType,
} from '../sessions';

export const sessionTypeRoutes = new Hono()
  .get('/', (c) => c.json(listSessionTypes()))
  .post('/', async (c) => {
    const input = await body(c.req, z.object({ name: z.string().trim().min(1).max(50), isTrading: z.boolean().optional(), color: z.string().optional() }));
    return c.json(createSessionType(input), 201);
  })
  .patch('/:id', async (c) => {
    const patch = await body(
      c.req,
      z
        .object({
          name: z.string().trim().min(1).max(50),
          isTrading: z.boolean(),
          color: z.string(),
          archived: z.boolean(),
          sortOrder: z.number().int(),
        })
        .partial()
        .strict(),
    );
    return c.json(updateSessionType(c.req.param('id'), patch));
  });

export const sessionRoutes = new Hono()
  .get('/', (c) => {
    const from = isoDate.safeParse(c.req.query('from'));
    const to = isoDate.safeParse(c.req.query('to'));
    if (!from.success || !to.success) throw new AppError(400, 'from and to (YYYY-MM-DD) are required');
    return c.json(listSessions({ from: from.data, to: to.data }));
  })
  .get('/years', (c) => c.json(sessionFinancialYears(financialYearOf(tradingDay(new Date(), getSettings().rolloverTime)).startYear)))
  .get('/running', (c) => c.json(getRunningSession()))
  /** Start the timer. Trading sessions may include the session-start checklist answers. */
  .post('/start', async (c) => {
    const { typeId, startAnswers } = await body(c.req, z.object({ typeId: z.string().min(1), startAnswers: answersSchema.optional() }));
    const session = startTimer(typeId);
    if (startAnswers) createReading(session.id, { kind: 'start', answers: startAnswers });
    return c.json(session, 201);
  })
  .post('/:id/stop', async (c) => {
    const { end } = await body(c.req, z.object({ end: instant.optional() }));
    const stopped = stopTimer(c.req.param('id'), end);
    relinkSessionTrades(stopped.id);
    return c.json(stopped);
  })
  .post('/', async (c) => {
    const input = await body(
      c.req,
      z.object({ typeId: z.string().min(1), start: instant, end: instant, notes: z.string().max(2000).nullable().optional(), force: z.boolean().optional() }),
    );
    const created = createManualSession(input, input.force);
    relinkSessionTrades(created.id);
    return c.json(created, 201);
  })
  .patch('/:id', async (c) => {
    const { reason, force, ...patch } = await body(
      c.req,
      z
        .object({
          typeId: z.string().min(1),
          start: instant,
          end: instant,
          notes: z.string().max(2000).nullable(),
          reason: z.string().max(500).nullable(),
          force: z.boolean(),
        })
        .partial()
        .strict(),
    );
    const updated = updateSession(c.req.param('id'), patch, reason ?? null, force);
    relinkSessionTrades(updated.id);
    return c.json(updated);
  })
  .delete('/:id', (c) => {
    deleteSession(c.req.param('id'));
    relinkSessionTrades(c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/:id/restore', (c) => {
    restoreSession(c.req.param('id'));
    relinkSessionTrades(c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/:id/history', (c) => c.json(sessionHistory(c.req.param('id'))))
  /** All completed sessions in a financial year, for the printable report. */
  .get('/report', (c) => c.json(sessionsForFinancialYear(fyParam(c.req.query('fy')))))
  .get('/export.csv', (c) => {
    const { fy, sessions } = sessionsForFinancialYear(fyParam(c.req.query('fy')));
    const types = new Map(listSessionTypes().map((t) => [t.id, t.name]));
    const rows = sessions.map((s) => {
      const minutes = durationMinutes(s);
      return [
        s.tradingDay,
        DateTime.fromISO(s.tradingDay).toFormat('ccc'),
        types.get(s.typeId) ?? 'Unknown',
        formatLocal(s.start, 'yyyy-MM-dd HH:mm'),
        formatLocal(s.end!, 'yyyy-MM-dd HH:mm'),
        Math.round(minutes),
        decimalHours(minutes).toFixed(2),
        s.source === 'timer' ? 'Timer' : 'Manual',
        s.editedAt ? `Edited ${formatLocal(s.editedAt, 'yyyy-MM-dd HH:mm')}` : '',
        s.notes,
      ];
    });
    const totalMinutes = sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
    rows.push([], ['Total', '', '', '', '', Math.round(totalMinutes), decimalHours(totalMinutes).toFixed(2)]);
    const csv = toCsv(
      ['Trading day', 'Day', 'Type', 'Start (Perth)', 'End (Perth)', 'Minutes', 'Hours', 'Recorded by', 'Edited', 'Notes'],
      rows,
    );
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="time-log-FY${fy.label.replace('–', '-')}.csv"`);
    return c.body(csv);
  });
