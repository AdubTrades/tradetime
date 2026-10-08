import { createHash, randomBytes } from 'node:crypto';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { listUserIds, schema } from '@tc/db';
import { eq } from 'drizzle-orm';
import { wipeAccount } from '../accountData';
import { recordAttachment } from '../attachments';
import type { AuthUser } from '../auth';
import { authEnabled, demo } from '../config';
import { currentUserId, db, rootDb, withUser } from '../context';
import { AppError } from '../errors';
import { chartPng } from './chartImage';
import { seedDemo } from './seed';

/**
 * The demo: each visitor gets their own copy of the fictional trader's account (user id `demo-…`), so nobody sees
 * anyone else's changes. It's reached with a short-lived token this server signs (not a Supabase sign-in), and the
 * hourly job deletes copies older than a day.
 */
const PREFIX = 'demo-';
const ISSUER = 'tradetime-demo';
const TOKEN_HOURS = 24;
/** Keep the free database small: if this many copies are live, new visitors wait for old ones to expire. */
const MAX_LIVE = 40;

export const isDemoUser = (userId: string) => userId.startsWith(PREFIX);

/** Local mode has no secrets to protect (everyone is the one local user), so a fixed key keeps tokens valid across restarts. */
const secret = () => new TextEncoder().encode(demo.secret ?? 'tradetime-local-demo');
export const demoAvailable = () => !!demo.secret || !authEnabled;

export function isDemoToken(token: string): boolean {
  try {
    return decodeJwt(token).iss === ISSUER;
  } catch {
    return false;
  }
}

export async function verifyDemoToken(token: string): Promise<AuthUser> {
  // The fixed local key is public, so with sign-in on, demo tokens are only accepted when DEMO_SECRET is set.
  if (!demoAvailable()) throw new Error('The demo is off');
  const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'] });
  if (!payload.sub || !isDemoUser(payload.sub)) throw new Error('Not a demo token');
  return { userId: payload.sub, email: null, demo: true };
}

/** A fresh demo copy and the token to use it. */
export async function startDemo(): Promise<{ token: string; expiresAt: string }> {
  if (!demoAvailable()) throw new AppError(404, 'The demo isn’t switched on for this server');
  const live = (await listUserIds(rootDb())).filter(isDemoUser);
  if (live.length >= MAX_LIVE) throw new AppError(503, 'The demo is busy right now. Please try again in a while.');
  const userId = `${PREFIX}${randomBytes(9).toString('base64url')}`;
  await withUser(userId, () => seedDemo());
  const expires = Date.now() + TOKEN_HOURS * 3600_000;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires / 1000))
    .sign(secret());
  return { token, expiresAt: new Date(expires).toISOString() };
}

/** Delete demo copies older than their token (plus an hour's grace). Returns how many went. */
export async function cleanUpDemos(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - (TOKEN_HOURS + 1) * 3600_000).toISOString();
  let removed = 0;
  for (const userId of (await listUserIds(rootDb())).filter(isDemoUser)) {
    const gone = await withUser(userId, async () => {
      const [profile] = await db.select().from(schema.userProfile).where(eq(schema.userProfile.userId, userId));
      if (profile && profile.createdAt > cutoff) return false;
      await wipeAccount({ everything: true });
      return true;
    });
    if (gone) removed++;
  }
  return removed;
}

// Demo screenshots aren't stored anywhere: the attachment row names the drawing, and it's redrawn when viewed.
const chartName = /^demo-chart-(\d+)-(long|short)-(win|loss)\.png$/;

export async function recordDemoChart(seed: number, direction: 'long' | 'short', outcome: 'win' | 'loss') {
  const png = chartPng(seed, { direction, outcome });
  return recordAttachment(createHash('sha256').update(png).digest('hex'), 'image/png', png.byteLength, `demo-chart-${seed}-${direction}-${outcome}.png`);
}

/** The picture for a demo account's screenshot, or null if this isn't one. */
export function demoFile(row: { originalName: string | null }): Buffer | null {
  if (!isDemoUser(currentUserId())) return null;
  const m = chartName.exec(row.originalName ?? '');
  return m ? chartPng(Number(m[1]), { direction: m[2] as 'long' | 'short', outcome: m[3] as 'win' | 'loss' }) : null;
}
