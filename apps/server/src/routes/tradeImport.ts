import { Hono } from 'hono';
import { z } from 'zod';
import { body } from '../http';
import { commitImport, deleteAlias, listAliases, previewImport } from '../tradeImport';

const options = z.object({
  csv: z.string().min(1),
  format: z.enum(['ninjatrader-executions', 'tradovate-performance', 'generic']).optional(),
  mapping: z.partialRecord(z.enum(['time', 'date', 'side', 'qty', 'price', 'symbol', 'account', 'id', 'commission']), z.string()).optional(),
  zone: z.string().optional(),
  dateOrder: z.enum(['dmy', 'mdy']).optional(),
  defaultAccount: z.string().max(100).optional(),
  accountMap: z.record(z.string(), z.string()).optional(),
  attachToLogged: z.boolean().optional(),
});

export const tradeImportRoutes = new Hono()
  .post('/preview', async (c) => c.json(previewImport(await body(c.req, options))))
  .post('/commit', async (c) => c.json(commitImport(await body(c.req, options)), 201))
  .get('/aliases', (c) => c.json(listAliases()))
  .delete('/aliases/:alias', (c) => {
    deleteAlias(decodeURIComponent(c.req.param('alias')));
    return c.body(null, 204);
  });
