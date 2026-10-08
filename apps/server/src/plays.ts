import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { defaultGradeRules, GRADES, newId, validateGradeRules, type GradeRule } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { play, playCriterion, playExample, attachment } = schema;
const nowIso = () => new Date().toISOString();

export async function listPlays() {
  const plays = await db.select().from(play).where(isNull(play.deletedAt)).orderBy(asc(play.sortOrder), asc(play.title));
  const criteria = await db.select().from(playCriterion).where(isNull(playCriterion.deletedAt)).orderBy(asc(playCriterion.sortOrder));
  const examples = await db
    .select({ playId: playExample.playId, attachmentId: playExample.attachmentId, grade: playExample.grade, mime: attachment.mime })
    .from(playExample)
    .innerJoin(attachment, eq(attachment.id, playExample.attachmentId))
    .where(isNull(playExample.deletedAt))
    .orderBy(asc(playExample.sortOrder), asc(playExample.createdAt));
  const gradeRank = (g: string) => (GRADES as readonly string[]).indexOf(g);
  return plays.map((p) => {
    const own = examples.filter((e) => e.playId === p.id);
    return {
      ...p,
      criteria: criteria.filter((c) => c.playId === p.id),
      exampleCount: own.length,
      // Up to three images for the card collage, best grade first.
      coverAttachmentIds: own
        .filter((e) => e.mime.startsWith('image/'))
        .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade))
        .slice(0, 3)
        .map((e) => e.attachmentId),
    };
  });
}

export async function getPlay(id: string) {
  const p = (await listPlays()).find((x) => x.id === id);
  if (!p) throw new AppError(404, 'Play not found');
  const rows = await db
    .select({ example: playExample, attachment })
    .from(playExample)
    .innerJoin(attachment, eq(attachment.id, playExample.attachmentId))
    .where(and(eq(playExample.playId, id), isNull(playExample.deletedAt)))
    .orderBy(asc(playExample.sortOrder), asc(playExample.createdAt));
  const examples = rows.map(({ example, attachment: a }) => ({ ...example, mime: a.mime }));
  return { ...p, examples };
}

export async function createPlay(input: { title: string; description?: string | null }) {
  const [max] = await db.select({ max: sql<number>`coalesce(max(${play.sortOrder}), -1)` }).from(play);
  const [row] = await db
    .insert(play)
    .values({ id: newId(), title: input.title.trim(), description: input.description ?? null, gradeRules: defaultGradeRules(), sortOrder: (max?.max ?? -1) + 1 })
    .returning();
  return row!;
}

export async function updatePlay(id: string, patch: Partial<{ title: string; description: string | null; gradeRules: GradeRule[]; archived: boolean; sortOrder: number }>) {
  if (patch.gradeRules) {
    const problem = validateGradeRules(patch.gradeRules);
    if (problem) throw new AppError(422, problem);
  }
  const [row] = await db.update(play).set({ ...patch, updatedAt: nowIso() }).where(eq(play.id, id)).returning();
  if (!row) throw new AppError(404, 'Play not found');
  return row;
}

export async function addCriterion(playId: string, input: { label: string; mustHave?: boolean }) {
  await getPlayRow(playId);
  const [max] = await db.select({ max: sql<number>`coalesce(max(${playCriterion.sortOrder}), -1)` }).from(playCriterion).where(eq(playCriterion.playId, playId));
  const [row] = await db
    .insert(playCriterion)
    .values({ id: newId(), playId, label: input.label.trim(), mustHave: input.mustHave ?? false, sortOrder: (max?.max ?? -1) + 1 })
    .returning();
  return row!;
}

/** Criteria are archived rather than deleted so past trades keep their checklist. */
export async function updateCriterion(id: string, patch: Partial<{ label: string; mustHave: boolean; archived: boolean; sortOrder: number }>) {
  const [row] = await db.update(playCriterion).set({ ...patch, updatedAt: nowIso() }).where(eq(playCriterion.id, id)).returning();
  if (!row) throw new AppError(404, 'Criterion not found');
  return row;
}

async function getPlayRow(id: string) {
  const [row] = await db.select().from(play).where(eq(play.id, id));
  if (!row || row.deletedAt) throw new AppError(404, 'Play not found');
  return row;
}

export interface ExampleInput {
  grade: string;
  attachmentId: string;
  caption?: string | null;
  date?: string | null;
  resultLabel?: string | null;
  sourceTradeId?: string | null;
}

const assertGrade = (g: string) => {
  if (!(GRADES as readonly string[]).includes(g)) throw new AppError(422, `Unknown grade ${g}`);
};

export async function addExample(playId: string, input: ExampleInput) {
  await getPlayRow(playId);
  assertGrade(input.grade);
  if (!(await db.select({ id: attachment.id }).from(attachment).where(eq(attachment.id, input.attachmentId))).length) throw new AppError(422, 'Unknown attachment');
  const [row] = await db.insert(playExample).values({ id: newId(), playId, ...input }).returning();
  return row!;
}

export async function updateExample(id: string, patch: Partial<Omit<ExampleInput, 'attachmentId'>> & { sortOrder?: number }) {
  if (patch.grade) assertGrade(patch.grade);
  const [row] = await db.update(playExample).set({ ...patch, updatedAt: nowIso() }).where(eq(playExample.id, id)).returning();
  if (!row) throw new AppError(404, 'Example not found');
  return row;
}

export async function deleteExample(id: string) {
  await db.update(playExample).set({ deletedAt: nowIso() }).where(eq(playExample.id, id));
}
