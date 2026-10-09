import { gunzipSync, gzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteAccount, exportAccount, importAccount, planFiles } from '../accountData';
import { checkFile, writeLocalFile } from '../attachments';
import { storage } from '../config';
import { AppError } from '../errors';
import { body } from '../http';

const MAX_IMPORT_JSON = 200 * 1024 * 1024;

const filesSchema = z.object({
  files: z.array(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), mime: z.string(), bytes: z.number().int().nonnegative() })),
});

/**
 * Your whole account as data. The JSON travels gzipped both ways, so a large account still fits in one serverless
 * request; the browser builds (and unpacks) the zip with the files itself.
 */
export const accountRoutes = new Hono()
  .get('/export', async (c) => {
    const json = JSON.stringify(await exportAccount());
    c.header('Content-Type', 'application/gzip');
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(gzipSync(json)));
  })
  /** Step 1 of an import: check the files fit, and say where to put them. */
  .post('/import/files', async (c) => c.json(planFiles((await body(c.req, filesSchema)).files)))
  /** Local mode, step 2: one file from the export, onto disk (recorded by the import itself). */
  .post('/import/file', async (c) => {
    if (storage.remote) throw new AppError(400, 'Upload files straight to storage');
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new AppError(400, 'No file provided');
    checkFile(file.type, file.size);
    return c.json({ sha256: writeLocalFile(Buffer.from(await file.arrayBuffer()), file.type) }, 201);
  })
  /** Delete the account, its files and its sign-in. The body must confirm it: {"confirm":"DELETE"}. */
  .delete('/', async (c) => {
    await body(c.req, z.object({ confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }) }));
    return c.json(await deleteAccount());
  })
  /** Final step: replace everything in the account with the export's data (all or nothing). */
  .post('/import', async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    let text: string;
    try {
      text = c.req.header('content-type')?.includes('gzip') ? gunzipSync(raw, { maxOutputLength: MAX_IMPORT_JSON }).toString('utf8') : raw.toString('utf8');
    } catch {
      throw new AppError(422, 'The export file is damaged or too large');
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AppError(422, 'The export file is damaged');
    }
    return c.json(await importAccount(data));
  });
