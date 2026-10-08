import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import { paths, storage } from './config';
import { currentScope, db } from './context';
import { AppError } from './errors';
import { putObject, signedUrl, storeConfig } from './fileStore';

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

/** Local mode: where a file lives on disk (content-addressed, so duplicates are stored once). */
export function attachmentPath(sha256: string, mime: string): string {
  return path.join(paths.attachments, sha256.slice(0, 2), `${sha256}.${extensions[mime] ?? 'bin'}`);
}

/** Cloud mode: the object's path in the bucket. The first folder is the user's id, which storage policies check. */
export const objectPath = (userId: string, sha256: string, mime: string) => `${userId}/${sha256}.${extensions[mime] ?? 'bin'}`;

type AttachmentRow = typeof schema.attachment.$inferSelect;

export function checkFile(mime: string, bytes: number) {
  if (!isAllowedMime(mime)) throw new AppError(422, `Unsupported file type: ${mime || 'unknown'}`);
  if (bytes > MAX_ATTACHMENT_BYTES) throw new AppError(422, 'File is larger than 25 MB');
}

const findBySha = async (sha256: string) => (await db.select().from(schema.attachment).where(eq(schema.attachment.sha256, sha256)))[0];

/** Bytes this user has stored (deleted links still count: the file is kept). */
export async function storageUsed(): Promise<number> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${schema.attachment.bytes}), 0)` }).from(schema.attachment);
  return Number(row?.total ?? 0);
}

async function checkQuota(bytes: number) {
  if ((await storageUsed()) + bytes > storage.capBytes) {
    throw new AppError(422, `You've used your ${Math.round(storage.capBytes / 1024 / 1024)} MB of file storage for the beta. Remove some screenshots or ask for more room.`);
  }
}

/** Record a file that's already where it belongs (or, in the demo, one that's drawn on request). */
export async function recordAttachment(sha256: string, mime: string, bytes: number, originalName: string | null): Promise<AttachmentRow> {
  const [row] = await db
    .insert(schema.attachment)
    .values({ id: newId(), sha256, mime, bytes, originalName })
    .onConflictDoNothing({ target: [schema.attachment.userId, schema.attachment.sha256] })
    .returning();
  return row ?? (await findBySha(sha256))!;
}

/** Local mode: put a file in the attachments folder (if it isn't there already) and return its hash. */
export function writeLocalFile(data: Buffer, mime: string): string {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const target = attachmentPath(sha256, mime);
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    mkdirSync(paths.tmp, { recursive: true });
    const tmp = path.join(paths.tmp, `${sha256}.part`);
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  }
  return sha256;
}

/** Store file content (once per user and hash) and return its attachment row. Used by server-side uploads and scripts. */
export async function storeAttachment(data: Buffer, mime: string, originalName: string | null): Promise<AttachmentRow> {
  checkFile(mime, data.byteLength);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const existing = await findBySha(sha256);
  if (existing) return existing;
  await checkQuota(data.byteLength);

  if (storage.remote) {
    const { userId, token } = currentScope();
    await putObject(storeConfig(), token, objectPath(userId, sha256, mime), data, mime);
  } else {
    writeLocalFile(data, mime);
  }
  return recordAttachment(sha256, mime, data.byteLength, originalName);
}

export interface FileInfo {
  sha256: string;
  mime: string;
  bytes: number;
  name: string | null;
}

/**
 * Cloud uploads, step 1: the browser sends the file's hash. If the user already has that file, it's reused;
 * otherwise the browser gets the path to upload to (straight to Supabase Storage, bypassing the API's size limit).
 */
export async function prepareUpload(f: FileInfo): Promise<{ attachment: AttachmentRow; upload: null } | { attachment: null; upload: { bucket: string; path: string } }> {
  if (!storage.remote) throw new AppError(400, 'Direct uploads are only for cloud storage; post the file instead');
  checkFile(f.mime, f.bytes);
  const existing = await findBySha(f.sha256);
  if (existing) return { attachment: existing, upload: null };
  await checkQuota(f.bytes);
  return { attachment: null, upload: { bucket: storage.bucket, path: objectPath(currentScope().userId, f.sha256, f.mime) } };
}

/** Cloud uploads, step 2: once the file is in storage, record it. */
export async function completeUpload(f: FileInfo): Promise<AttachmentRow> {
  if (!storage.remote) throw new AppError(400, 'Direct uploads are only for cloud storage');
  checkFile(f.mime, f.bytes);
  const existing = await findBySha(f.sha256);
  if (existing) return existing;
  const { userId, token } = currentScope();
  if (!(await signedUrl(storeConfig(), token, objectPath(userId, f.sha256, f.mime), 60))) throw new AppError(422, 'The file didn’t reach storage. Please try again.');
  return recordAttachment(f.sha256, f.mime, f.bytes, f.name);
}

/** Cloud mode: a temporary link to the file. Null in local mode (the API streams it from disk). */
export async function fileLink(row: AttachmentRow): Promise<string | null> {
  if (!storage.remote) return null;
  const { userId, token } = currentScope();
  return signedUrl(storeConfig(), token, objectPath(userId, row.sha256, row.mime));
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
