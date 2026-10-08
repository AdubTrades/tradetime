import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import { paths } from './config';
import { db } from './context';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export const isAllowedMime = (mime: string): boolean => mime in extensions;

export function attachmentPath(sha256: string, mime: string): string {
  return path.join(paths.attachments, sha256.slice(0, 2), `${sha256}.${extensions[mime] ?? 'bin'}`);
}

/** Store file content once per hash and return its attachment row (existing or new). */
export async function storeAttachment(data: Buffer, mime: string, originalName: string | null) {
  if (!isAllowedMime(mime)) throw new Error(`Unsupported file type: ${mime}`);
  if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('File is larger than 25 MB');

  const sha256 = createHash('sha256').update(data).digest('hex');
  const [existing] = await db.select().from(schema.attachment).where(eq(schema.attachment.sha256, sha256));
  if (existing) return existing;

  const target = attachmentPath(sha256, mime);
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    mkdirSync(paths.tmp, { recursive: true });
    const tmp = path.join(paths.tmp, `${sha256}.part`);
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  }
  const [row] = await db.insert(schema.attachment).values({ id: newId(), sha256, mime, bytes: data.byteLength, originalName }).returning();
  return row!;
}

export async function getAttachment(id: string) {
  const [row] = await db.select().from(schema.attachment).where(eq(schema.attachment.id, id));
  return row;
}

export async function linkAttachment(attachmentId: string, ownerType: string, ownerId: string, role: string | null = null) {
  const [row] = await db.insert(schema.attachmentLink).values({ id: newId(), attachmentId, ownerType, ownerId, role }).returning();
  return row!;
}

export async function attachmentsFor(ownerType: string, ownerId: string) {
  return db
    .select({ link: schema.attachmentLink, attachment: schema.attachment })
    .from(schema.attachmentLink)
    .innerJoin(schema.attachment, eq(schema.attachment.id, schema.attachmentLink.attachmentId))
    .where(
      and(
        eq(schema.attachmentLink.ownerType, ownerType),
        eq(schema.attachmentLink.ownerId, ownerId),
        isNull(schema.attachmentLink.deletedAt),
      ),
    )
    .orderBy(asc(schema.attachmentLink.sortOrder), asc(schema.attachmentLink.createdAt));
}

export async function unlinkAttachment(linkId: string): Promise<boolean> {
  const rows = await db
    .update(schema.attachmentLink)
    .set({ deletedAt: new Date().toISOString() })
    .where(and(eq(schema.attachmentLink.id, linkId), isNull(schema.attachmentLink.deletedAt)))
    .returning({ id: schema.attachmentLink.id });
  return rows.length > 0;
}
