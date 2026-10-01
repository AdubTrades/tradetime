import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { z } from 'zod';
import { checkWritableFolder, detectCloudFolders } from '../backup';
import { recomputeTradingDays } from '../sessions';
import { getSettings, settingsPatchSchema, updateSettings } from '../settings';

const execFileAsync = promisify(execFile);

export const settingsRoutes = new Hono()
  .get('/', (c) => c.json(getSettings()))
  .patch('/', async (c) => {
    const parsed = settingsPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    if (parsed.data.backupFolder) {
      const problem = await checkWritableFolder(parsed.data.backupFolder);
      if (problem) return c.json({ error: problem }, 400);
    }
    const before = getSettings();
    const after = updateSettings(parsed.data);
    if (after.rolloverTime !== before.rolloverTime) recomputeTradingDays(after.rolloverTime);
    return c.json(after);
  })
  .get('/backup-folders', (c) => c.json(detectCloudFolders()))
  /** Open the native macOS folder picker on the Mac running the server. */
  .post('/choose-folder', async (c) => {
    if (process.platform !== 'darwin') return c.json({ error: 'Folder picker is only available on macOS' }, 400);
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Choose a folder for Trading Companion backups")',
      ]);
      return c.json({ path: stdout.trim().replace(/\/$/, '') });
    } catch {
      return c.json({ path: null });
    }
  });
