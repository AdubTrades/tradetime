import { and, eq } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import webpush from 'web-push';
import { push, pushEnabled } from './config';
import { db } from './context';

const { pushSubscription } = schema;

if (pushEnabled) webpush.setVapidDetails(push.subject, push.publicKey!, push.privateKey!);

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when the notification is clicked. */
  url?: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
let send: Sender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 60 * 60 });

/** Tests swap in a fake push service. */
export function setPushSender(fn: Sender): void {
  send = fn;
}

/** Save (or refresh) this device's subscription for the current user. */
export async function subscribe(input: SubscriptionInput) {
  const [row] = await db
    .insert(pushSubscription)
    .values({ id: newId(), endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null })
    .onConflictDoUpdate({ target: [pushSubscription.userId, pushSubscription.endpoint], set: { p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? null } })
    .returning();
  return row!;
}

export async function unsubscribe(endpoint: string): Promise<void> {
  await db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint));
}

export const listSubscriptions = () => db.select({ id: pushSubscription.id, userAgent: pushSubscription.userAgent, createdAt: pushSubscription.createdAt, lastUsedAt: pushSubscription.lastUsedAt }).from(pushSubscription);

/**
 * Send a notification to every device the current user has subscribed. Devices the push service says are gone
 * (404/410) are removed. Returns how many devices it reached. Never throws.
 */
export async function pushToUser(payload: PushPayload): Promise<number> {
  if (!pushEnabled) return 0;
  const subs = await db.select().from(pushSubscription);
  let delivered = 0;
  const now = new Date().toISOString();
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      delivered++;
      await db.update(pushSubscription).set({ lastUsedAt: now }).where(eq(pushSubscription.id, s.id));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.delete(pushSubscription).where(and(eq(pushSubscription.id, s.id), eq(pushSubscription.endpoint, s.endpoint)));
      else console.error(`[push] ${status ?? ''} ${(err as Error).message}`);
    }
  }
  return delivered;
}
