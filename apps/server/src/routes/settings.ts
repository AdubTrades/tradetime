import { Hono } from 'hono';
import { formatZodError } from '../http';
import { refreshMarketEvents } from '../marketEvents';
import { recomputeTradingDays } from '../sessions';
import { getSettings, settingsPatchSchema, updateSettings } from '../settings';

/** The API key never goes back to the browser in full: just enough to recognise it. */
const forClient = (s: ReturnType<typeof getSettings>) => ({ ...s, fredApiKey: s.fredApiKey ? `••••${s.fredApiKey.slice(-4)}` : null });

export const settingsRoutes = new Hono()
  .get('/', async (c) => c.json(forClient(getSettings())))
  .patch('/', async (c) => {
    const parsed = settingsPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);
    const before = getSettings();
    const after = await updateSettings(parsed.data);
    if (after.rolloverTime !== before.rolloverTime) await recomputeTradingDays(after.rolloverTime);
    if (after.fredApiKey && after.fredApiKey !== before.fredApiKey) await refreshMarketEvents();
    return c.json(forClient(after));
  });
