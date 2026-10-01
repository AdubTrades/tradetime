import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { defaultGradeRules, GRADES, newId, validateGradeRules, type GradeRule } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { play, playCriterion, playExample, attachment } = schema;
const nowIso = () => new Date().toISOString();

export function listPlays() {
  const plays = db.select().from(play).where(isNull(play.deletedAt)).orderBy(asc(play.sortOrder), asc(play.title)).all();
  const criteria = db.select().from(playCriterion).where(isNull(playCriterion.deletedAt)).orderBy(asc(playCriterion.sortOrder)).all();
  const counts = db
    .select({ playId: playExample.playId, n: sql<number>`count(*)` })
    .from(playExample)
    .where(isNull(playExample.deletedAt))
    .groupBy(playExample.playId)
    .all();
  return plays.map((p) => ({
    ...p,
    criteria: criteria.filter((c) => c.playId === p.id),
    exampleCount: counts.find((c) => c.playId === p.id)?.n ?? 0,
  }));
}

export function getPlay(id: string) {
  const p = listPlays().find((x) => x.id === id);
  if (!p) throw new AppError(404, 'Play not found');
  const examples = db
    .select({ example: playExample, attachment })
    .from(playExample)
    .innerJoin(attachment, eq(attachment.id, playExample.attachmentId))
    .where(and(eq(playExample.playId, id), isNull(playExample.deletedAt)))
    .orderBy(asc(playExample.sortOrder), asc(playExample.createdAt))
    .all()
    .map(({ example, attachment: a }) => ({ ...example, mime: a.mime }));
  return { ...p, examples };
}

export function createPlay(input: { title: string; description?: string | null }) {
  const sortOrder = db.select({ max: sql<number>`coalesce(max(${play.sortOrder}), -1)` }).from(play).get()?.max ?? -1;
  return db
    .insert(play)
    .values({ id: newId(), title: input.title.trim(), description: input.description ?? null, gradeRules: defaultGradeRules(), sortOrder: sortOrder + 1 })
    .returning()
    .get();
}

export function updatePlay(id: string, patch: Partial<{ title: string; description: string | null; gradeRules: GradeRule[]; archived: boolean; sortOrder: number }>) {
  if (patch.gradeRules) {
    const problem = validateGradeRules(patch.gradeRules);
    if (problem) throw new AppError(422, problem);
  }
  const row = db.update(play).set({ ...patch, updatedAt: nowIso() }).where(eq(play.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Play not found');
  return row;
}

export function addCriterion(playId: string, input: { label: string; mustHave?: boolean }) {
  getPlayRow(playId);
  const sortOrder =
    db.select({ max: sql<number>`coalesce(max(${playCriterion.sortOrder}), -1)` }).from(playCriterion).where(eq(playCriterion.playId, playId)).get()?.max ?? -1;
  return db
    .insert(playCriterion)
    .values({ id: newId(), playId, label: input.label.trim(), mustHave: input.mustHave ?? false, sortOrder: sortOrder + 1 })
    .returning()
    .get();
}

/** Criteria are archived rather than deleted so past trades keep their checklist. */
export function updateCriterion(id: string, patch: Partial<{ label: string; mustHave: boolean; archived: boolean; sortOrder: number }>) {
  const row = db.update(playCriterion).set({ ...patch, updatedAt: nowIso() }).where(eq(playCriterion.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Criterion not found');
  return row;
}

function getPlayRow(id: string) {
  const row = db.select().from(play).where(eq(play.id, id)).get();
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

export function addExample(playId: string, input: ExampleInput) {
  getPlayRow(playId);
  assertGrade(input.grade);
  if (!db.select({ id: attachment.id }).from(attachment).where(eq(attachment.id, input.attachmentId)).get()) throw new AppError(422, 'Unknown attachment');
  return db.insert(playExample).values({ id: newId(), playId, ...input }).returning().get();
}

export function updateExample(id: string, patch: Partial<Omit<ExampleInput, 'attachmentId'>> & { sortOrder?: number }) {
  if (patch.grade) assertGrade(patch.grade);
  const row = db.update(playExample).set({ ...patch, updatedAt: nowIso() }).where(eq(playExample.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Example not found');
  return row;
}

export function deleteExample(id: string) {
  db.update(playExample).set({ deletedAt: nowIso() }).where(eq(playExample.id, id)).run();
}
