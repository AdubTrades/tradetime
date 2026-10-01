import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { createArchive, getBackupStatus, runBackup } from '../backup';
import { getSettings } from '../settings';
import { paths } from '../config';
import { AppError } from '../errors';
import { body } from '../http';
import { inspectBackup, lastRestore, listBackups, saveUpload, stageRestore } from '../restore';
import { z } from 'zod';

export const backupRoutes = new Hono()
  .get('/status', (c) => c.json({ ...getBackupStatus(), folder: getSettings().backupFolder ?? paths.localBackups, lastRestore: lastRestore() }))
  .get('/list', (c) => c.json(listBackups()))
  .post('/inspect', async (c) => {
    const { path } = await body(c.req, z.object({ path: z.string().min(1) }));
    return c.json(await inspectBackup(path));
  })
  /** Upload a backup zip from elsewhere (e.g. another Mac or a cloud folder) and inspect it. */
  .post('/upload', async (c) => {
    const form = await c.req.parseBody();
    if (!(form.file instanceof File)) throw new AppError(400, 'No file provided');
    const saved = await saveUpload(form.file);
    return c.json(await inspectBackup(saved));
  })
  /** Replace all data with a backup. A safety backup of the current data is written first; the app then restarts. */
  .post('/restore', async (c) => {
    const { path, confirm } = await body(c.req, z.object({ path: z.string().min(1), confirm: z.literal('RESTORE') }));
    void confirm;
    return c.json(await stageRestore(path));
  })
  .post('/run', async (c) => {
    const status = await runBackup();
    return c.json(status, status.lastError ? 500 : 200);
  })
  /** One-click full export: streams a zip of the database snapshot and all attachments. */
  .get('/export', async (c) => {
    const { archive, cleanup, fileName } = await createArchive();
    archive.on('end', cleanup);
    archive.on('error', cleanup);
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return c.body(Readable.toWeb(archive) as ReadableStream);
  });
