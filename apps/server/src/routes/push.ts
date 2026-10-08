import { Hono } from 'hono';
import { z } from 'zod';
import { push, pushEnabled } from '../config';
import { body } from '../http';
import { notify } from '../notify';
import { listSubscriptions, subscribe, unsubscribe } from '../push';

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  userAgent: z.string().max(300).nullable().optional(),
});

export const pushRoutes = new Hono()
  /** The public key browsers need to subscribe, or null when push isn't set up on this server. */
  .get('/key', async (c) => c.json({ enabled: pushEnabled, publicKey: push.publicKey }))
  .get('/subscriptions', async (c) => c.json(await listSubscriptions()))
  .post('/subscribe', async (c) => c.json(await subscribe(await body(c.req, subscriptionSchema)), 201))
  .post('/unsubscribe', async (c) => {
    const { endpoint } = await body(c.req, z.object({ endpoint: z.url() }));
    await unsubscribe(endpoint);
    return c.body(null, 204);
  })
  /** Send a test notification to all of this user's devices. */
  .post('/test', async (c) => {
    await notify('TradeTime notifications are on', 'You’ll get check-ins, reminders and renewal notices here.', { url: '/settings', tag: 'test' });
    return c.body(null, 204);
  });
