import { Hono } from 'hono';
import { currentUserId } from '../context';
import { isDemoUser } from '../demo/account';
import { AppError } from '../errors';
import { formatZodError } from '../http';
import { refreshMarketEvents } from '../marketEvents';
import { getSettings, settingsPatchSchema, updateSettings } from '../settings';

/** The API key never goes back to the browser in full: just enough to recognise it. */
const forClient = (s: ReturnType<typeof getSettings>) => ({ ...s, fredApiKey: s.fredApiKey ? `••••${s.fredApiKey.slice(-4)}` : null });

export const settingsRoutes = new Hono()
  .get('/', async (c) => c.json(forClient(getSettings())))
  .patch('/', async (c) => {
    const parsed = settingsPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);
    if ('fredApiKey' in parsed.data && isDemoUser(currentUserId())) throw new AppError(403, 'That’s switched off in the demo.');
    const before = getSettings();
    const after = await updateSettings(parsed.data);
    if (after.fredApiKey && after.fredApiKey !== before.fredApiKey) await refreshMarketEvents();
    return c.json(forClient(after));
  });
