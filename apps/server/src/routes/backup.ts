import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { createArchive, getBackupStatus, runBackup } from '../backup';
import { getSettings } from '../settings';
import { paths } from '../config';

export const backupRoutes = new Hono()
  .get('/status', (c) => c.json({ ...getBackupStatus(), folder: getSettings().backupFolder ?? paths.localBackups }))
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
