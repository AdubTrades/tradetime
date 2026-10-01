import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  attachmentPath,
  attachmentsFor,
  getAttachment,
  isAllowedMime,
  linkAttachment,
  MAX_ATTACHMENT_BYTES,
  storeAttachment,
  unlinkAttachment,
} from '../attachments';

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
      const attachment = storeAttachment(Buffer.from(await file.arrayBuffer()), file.type, file.name || null);
      const link = ownerType && ownerId ? linkAttachment(attachment.id, ownerType, ownerId, role) : null;
      results.push({ attachment, link });
    }
    return c.json(results, 201);
  })
  .post('/links', async (c) => {
    const parsed = linkSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    if (!getAttachment(parsed.data.attachmentId)) return c.json({ error: 'Attachment not found' }, 404);
    const { attachmentId, ownerType, ownerId, role } = parsed.data;
    return c.json(linkAttachment(attachmentId, ownerType, ownerId, role ?? null), 201);
  })
  .delete('/links/:id', (c) => (unlinkAttachment(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404)))
  .get('/for/:ownerType/:ownerId', (c) => c.json(attachmentsFor(c.req.param('ownerType'), c.req.param('ownerId'))))
  .get('/:id/file', (c) => {
    const row = getAttachment(c.req.param('id'));
    if (!row) return c.json({ error: 'Not found' }, 404);
    const file = attachmentPath(row.sha256, row.mime);
    if (!existsSync(file)) return c.json({ error: 'File missing from attachments folder' }, 410);
    c.header('Content-Type', row.mime);
    c.header('Content-Length', String(row.bytes));
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
  });
