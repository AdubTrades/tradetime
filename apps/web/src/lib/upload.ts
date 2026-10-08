import { api, type Attachment, type AttachmentLink } from './api';
import { supabase } from './auth';
import type { Health } from './demo';

export interface Owner {
  ownerType: string;
  ownerId: string;
  role?: string | null;
}

export interface Uploaded {
  attachment: Attachment;
  link: AttachmentLink | null;
}

let storageKind: Promise<'supabase' | 'local'> | null = null;
const getStorageKind = () => (storageKind ??= api.get<Health>('/health').then((h) => (h.storage?.kind === 'supabase' ? 'supabase' : 'local')));

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Upload screenshots and receipts, optionally linking them to a record.
 * - Cloud: each file goes straight from the browser to Supabase Storage (into the user's own folder), skipping files
 *   the user already has, then the API records it. This avoids the API's request-size limit.
 * - Local: files are posted to the API, which keeps them on disk.
 */
export async function uploadFiles(files: File[], owner?: Owner): Promise<Uploaded[]> {
  if ((await getStorageKind()) === 'local' || !supabase) {
    const form = new FormData();
    for (const f of files) form.append('file', f);
    if (owner) {
      form.append('ownerType', owner.ownerType);
      form.append('ownerId', owner.ownerId);
      if (owner.role) form.append('role', owner.role);
    }
    return api.post<Uploaded[]>('/attachments', form);
  }
  const results: Uploaded[] = [];
  for (const file of files) {
    const info = { sha256: await sha256Hex(file), mime: file.type, bytes: file.size, name: file.name || null };
    const prep = await api.post<{ attachment: Attachment | null; upload: { bucket: string; path: string } | null }>('/attachments/prepare', info);
    if (prep.upload) {
      const { error } = await supabase.storage.from(prep.upload.bucket).upload(prep.upload.path, file, { contentType: file.type, upsert: true, cacheControl: '31536000' });
      if (error) throw new Error(`Couldn’t upload ${file.name || 'the file'}: ${error.message}`);
    }
    results.push(await api.post<Uploaded>('/attachments/complete', { ...info, ...owner }));
  }
  return results;
}
