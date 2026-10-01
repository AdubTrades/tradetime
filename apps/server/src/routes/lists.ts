import { Hono } from 'hono';
import { z } from 'zod';
import { createAccount, createFirm, listAccounts, listFirms, updateAccount, updateFirm } from '../accounts';
import { AppError } from '../errors';
import { body, cents, isoDate } from '../http';
import { findOrCreateListItem, listItems, listKinds, updateListItem, type ListKind } from '../lists';

const kindParam = (raw: string): ListKind => {
  if (!(listKinds as readonly string[]).includes(raw)) throw new AppError(404, 'Unknown list');
  return raw as ListKind;
};

export const listRoutes = new Hono()
  .get('/:kind', (c) => c.json(listItems(kindParam(c.req.param('kind')))))
  .post('/:kind', async (c) => {
    const kind = kindParam(c.req.param('kind'));
    const { name } = await body(c.req, z.object({ name: z.string().trim().min(1).max(80) }));
    const id = findOrCreateListItem(kind, name);
    return c.json(listItems(kind).find((i) => i.id === id), 201);
  })
  .patch('/item/:id', async (c) => {
    const patch = await body(
      c.req,
      z.object({ name: z.string().trim().min(1).max(80), color: z.string().nullable(), archived: z.boolean(), sortOrder: z.number().int() }).partial().strict(),
    );
    return c.json(updateListItem(c.req.param('id'), patch));
  });

const accountSchema = z.object({
  firmId: z.string().nullable(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(['evaluation', 'funded', 'live', 'sim']),
  status: z.enum(['active', 'passed', 'failed', 'closed']),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  startingBalanceCents: cents.nullable(),
  notes: z.string().max(2000).nullable(),
});

export const firmRoutes = new Hono()
  .get('/', (c) => c.json(listFirms()))
  .post('/', async (c) => c.json(createFirm(await body(c.req, z.object({ name: z.string().trim().min(1).max(80), website: z.string().nullable().optional() }))), 201))
  .patch('/:id', async (c) =>
    c.json(
      updateFirm(c.req.param('id'), await body(c.req, z.object({ name: z.string().trim().min(1), website: z.string().nullable(), archived: z.boolean() }).partial().strict())),
    ),
  );

export const accountRoutes = new Hono()
  .get('/', (c) => c.json(listAccounts()))
  .post('/', async (c) => c.json(createAccount(await body(c.req, accountSchema.partial({ firmId: true, status: true, startDate: true, endDate: true, startingBalanceCents: true, notes: true }))), 201))
  .patch('/:id', async (c) => c.json(updateAccount(c.req.param('id'), await body(c.req, accountSchema.partial().strict()))));
