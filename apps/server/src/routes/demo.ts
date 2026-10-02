import { Hono } from 'hono';
import { z } from 'zod';
import { isDemo } from '../config';
import { demoStatus, ensureDemo, resetDemo, stopDemo } from '../demo/manager';
import { body } from '../http';

export const demoRoutes = new Hono()
  .get('/status', async (c) => c.json(isDemo ? { running: true, isDemo: true } : await demoStatus()))
  /** Real app: start (or reset) the demo copy and return its address. */
  .post('/start', async (c) => {
    const { reset } = await body(c.req, z.object({ reset: z.boolean().optional() }));
    return c.json({ url: reset ? await resetDemo() : await ensureDemo() });
  })
  .post('/stop', async (c) => {
    await stopDemo();
    return c.body(null, 204);
  });
