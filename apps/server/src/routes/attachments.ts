import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { storage } from '../config';
import { demoFile } from '../demo/account';
import { body, formatZodError } from '../http';
import {
  attachmentPath,
  attachmentsFor,
  completeUpload,
  fileLink,
  getAttachment,
  isAllowedMime,
  linkAttachment,
  MAX_ATTACHMENT_BYTES,
  prepareUpload,
  storageUsed,
  storeAttachment,
  unlinkAttachment,
} from '../attachments';

const fileSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid file hash'),
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  name: z.string().max(255).nullable().optional(),
});
const ownerSchema = z.object({ ownerType: z.string().min(1).optional(), ownerId: z.string().min(1).optional(), role: z.string().nullable().optional() });

const linkSchema = z.object({
  attachmentId: z.string().min(1),
  ownerType: z.string().min(1),
  ownerId: z.string().min(1),
  role: z.string().nullable().optional(),
});

export const attachmentRoutes = new Hono()
  /** Upload one or more files (multipart field "file"). Optionally link them to an owner in the same call. */
  .post('/', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(body.file ?? []).filter((f): f is File => f instanceof File);
    if (files.length === 0) return c.json({ error: 'No file provided' }, 400);
    const ownerType = typeof body.ownerType === 'string' ? body.ownerType : null;
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId : null;
    const role = typeof body.role === 'string' ? body.role : null;

    const results = [];
    for (const file of files) {
      if (!isAllowedMime(file.type)) return c.json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, 415);
      if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: `${file.name} is larger than 25 MB` }, 413);
      const attachment = await storeAttachment(Buffer.from(await file.arrayBuffer()), file.type, file.name || null);
      const link = ownerType && ownerId ? await linkAttachment(attachment.id, ownerType, ownerId, role) : null;
      results.push({ attachment, link });
    }
    return c.json(results, 201);
  })
  /** Cloud uploads, step 1: reuse an identical file, or get the storage path to upload it to from the browser. */
  .post('/prepare', async (c) => {
    const f = await body(c.req, fileSchema);
    return c.json(await prepareUpload({ ...f, name: f.name ?? null }));
  })
  /** Cloud uploads, step 2: record the uploaded file and optionally link it to an owner. */
  .post('/complete', async (c) => {
    const { ownerType, ownerId, role, ...f } = await body(c.req, fileSchema.merge(ownerSchema));
    const attachment = await completeUpload({ ...f, name: f.name ?? null });
    const link = ownerType && ownerId ? await linkAttachment(attachment.id, ownerType, ownerId, role ?? null) : null;
    return c.json({ attachment, link }, 201);
  })
  .get('/usage', async (c) => c.json({ usedBytes: await storageUsed(), capBytes: storage.capBytes }))
  .post('/links', async (c) => {
    const parsed = linkSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);
    if (!(await getAttachment(parsed.data.attachmentId))) return c.json({ error: 'Attachment not found' }, 404);
    const { attachmentId, ownerType, ownerId, role } = parsed.data;
    return c.json(await linkAttachment(attachmentId, ownerType, ownerId, role ?? null), 201);
  })
  .delete('/links/:id', async (c) => ((await unlinkAttachment(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404)))
  .get('/for/:ownerType/:ownerId', async (c) => c.json(await attachmentsFor(c.req.param('ownerType'), c.req.param('ownerId'))))
  .get('/:id/file', async (c) => {
    const row = await getAttachment(c.req.param('id'));
    if (!row) return c.json({ error: 'Not found' }, 404);
    const drawn = demoFile(row);
    if (drawn) {
      c.header('Content-Type', row.mime);
      c.header('Cache-Control', 'private, max-age=86400');
      return c.body(new Uint8Array(drawn));
    }
    if (storage.remote) {
      // Send the browser on to a short-lived private link; the file itself comes from Supabase Storage.
      const url = await fileLink(row);
      if (!url) return c.json({ error: 'File missing from storage' }, 410);
      c.header('Cache-Control', 'private, max-age=300');
      return c.redirect(url, 302);
    }
    const file = attachmentPath(row.sha256, row.mime);
    if (!existsSync(file)) return c.json({ error: 'File missing from attachments folder' }, 410);
    c.header('Content-Type', row.mime);
    c.header('Content-Length', String(row.bytes));
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
  });
