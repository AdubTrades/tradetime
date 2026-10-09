import { and, gte, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import { z } from 'zod';
import { feedbackConfig } from './config';
import { db } from './context';
import { AppError } from './errors';

export const feedbackSchema = z.object({
  kind: z.enum(['bug', 'idea', 'general']).default('general'),
  message: z.string().trim().min(3, 'Write a few words first').max(5000, 'Keep it under 5,000 characters'),
  page: z.string().max(300).nullable().optional(),
  appVersion: z.string().max(40).nullable().optional(),
});

const PER_HOUR = 10;
const labels = { bug: 'Problem', idea: 'Idea', general: 'Feedback' } as const;

/**
 * Store feedback from the app (the admin reads the `feedback` table in Supabase) and, if FEEDBACK_WEBHOOK_URL is set,
 * post it to a Discord or Slack channel. The sender's email is included so you can reply; the form says so.
 */
export async function sendFeedback(input: z.infer<typeof feedbackSchema>, from: { email: string | null; userAgent: string | null; demo: boolean }) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.feedback).where(and(gte(schema.feedback.createdAt, since)))) as [{ n: number }];
  if (n >= PER_HOUR) throw new AppError(422, 'That’s a lot of feedback for one hour. Thank you! Please try again a bit later.');
  const [row] = await db
    .insert(schema.feedback)
    .values({ id: newId(), kind: input.kind, message: input.message, page: input.page ?? null, userAgent: from.userAgent?.slice(0, 300) ?? null, appVersion: input.appVersion ?? null })
    .returning();

  if (feedbackConfig.webhookUrl) {
    const who = from.demo ? 'a demo visitor' : (from.email ?? 'a tester');
    const text = `**${labels[input.kind]}** from ${who}${input.page ? ` on \`${input.page}\`` : ''}\n${input.message}`.slice(0, 1900);
    try {
      // Discord reads `content`, Slack reads `text`; sending both works with either.
      await fetch(feedbackConfig.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, text }) });
    } catch (err) {
      console.error(`[feedback] webhook failed: ${(err as Error).message}`);
    }
  }
  return row!;
}
