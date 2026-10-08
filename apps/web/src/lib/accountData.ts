import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { DateTime } from 'luxon';
import { ApiError, apiFetch, api } from './api';
import { supabase } from './auth';

/**
 * "Download my data" and "Import into my account". The browser builds and unpacks the zip itself: the server only
 * sends and receives the data as gzipped JSON, and files go straight to and from storage. That keeps every request
 * small enough for the serverless host, however many screenshots you have.
 *
 * Zip layout: manifest.json, data.json (every record), attachments/<sha256>.<ext>.
 */
interface AttachmentRow {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
}
export interface AccountExport {
  app: 'tradetime';
  kind: 'account-export';
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};
const fileName = (a: { sha256: string; mime: string }) => `attachments/${a.sha256}.${extensions[a.mime] ?? 'bin'}`;

async function failure(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new ApiError(data.error ?? res.statusText, res.status);
}

export type Progress = (message: string) => void;

/** Build the export zip and save it. Returns how many files couldn't be fetched (they're listed in the manifest). */
export async function downloadMyData(progress: Progress): Promise<{ files: number; missing: number }> {
  progress('Gathering your records…');
  const res = await apiFetch('/account/export');
  if (!res.ok) throw await failure(res);
  const data = JSON.parse(strFromU8(gunzipSync(new Uint8Array(await res.arrayBuffer())))) as AccountExport;

  const attachments = (data.tables.attachment ?? []) as unknown as AttachmentRow[];
  const zip: Zippable = {};
  const missing: string[] = [];
  for (const [i, a] of attachments.entries()) {
    progress(`Packing files: ${i + 1} of ${attachments.length}…`);
    // Cloud: the API redirects to a short-lived storage link. Images are already compressed, so store them as-is.
    const file = await apiFetch(`/attachments/${a.id}/file`);
    if (file.ok) zip[fileName(a)] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }];
    else missing.push(a.sha256);
  }
  const manifest = { app: 'tradetime', kind: 'account-export', formatVersion: data.formatVersion, exportedAt: data.exportedAt, files: attachments.length - missing.length, missingFiles: missing };
  zip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  zip['data.json'] = strToU8(JSON.stringify(data));

  progress('Saving…');
  const blob = new Blob([zipSync(zip, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tradetime-export-${DateTime.now().toFormat('yyyyLLdd-HHmm')}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { files: attachments.length - missing.length, missing: missing.length };
}

export interface ImportPreview {
  data: AccountExport;
  files: Record<string, Uint8Array>;
  counts: { trades: number; sessions: number; expenses: number; files: number };
  missingFiles: number;
}

/** Open an export zip and summarise it, before anything is changed. */
export async function readExport(file: File): Promise<ImportPreview> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('That file isn’t a zip. Choose a TradeTime export (tradetime-export-….zip).');
  }
  if (!entries['data.json']) throw new Error('That zip isn’t a TradeTime export: it has no data.json.');
  const data = JSON.parse(strFromU8(entries['data.json'])) as AccountExport;
  if (data.app !== 'tradetime' || data.kind !== 'account-export') throw new Error('That zip isn’t a TradeTime account export.');
  const attachments = (data.tables.attachment ?? []) as unknown as AttachmentRow[];
  const files: Record<string, Uint8Array> = {};
  for (const a of attachments) {
    const bytes = entries[fileName(a)];
    if (bytes) files[a.sha256] = bytes;
  }
  const live = (name: string) => (data.tables[name] ?? []).filter((r) => !r.deletedAt).length;
  return {
    data,
    files,
    counts: { trades: live('trade'), sessions: live('session'), expenses: live('expense'), files: Object.keys(files).length },
    missingFiles: attachments.length - Object.keys(files).length,
  };
}

type FilePlan = { mode: 'supabase'; uploads: { sha256: string; bucket: string; path: string }[] } | { mode: 'local'; missing: string[] };

/** Replace everything in the signed-in account with an export: files first, then the records in one step. */
export async function importIntoAccount(preview: ImportPreview, progress: Progress): Promise<Record<string, number>> {
  const attachments = ((preview.data.tables.attachment ?? []) as unknown as AttachmentRow[]).filter((a) => preview.files[a.sha256]);
  progress('Checking files…');
  const plan = await api.post<FilePlan>('/account/import/files', { files: attachments.map(({ sha256, mime, bytes }) => ({ sha256, mime, bytes })) });
  const byHash = new Map(attachments.map((a) => [a.sha256, a]));
  if (plan.mode === 'supabase') {
    if (!supabase) throw new Error('Cloud storage isn’t set up in this app');
    for (const [i, u] of plan.uploads.entries()) {
      progress(`Uploading files: ${i + 1} of ${plan.uploads.length}…`);
      const a = byHash.get(u.sha256)!;
      const blob = new Blob([preview.files[u.sha256]! as Uint8Array<ArrayBuffer>], { type: a.mime });
      const { error } = await supabase.storage.from(u.bucket).upload(u.path, blob, { contentType: a.mime, upsert: true, cacheControl: '31536000' });
      if (error) throw new Error(`Couldn’t upload a file: ${error.message}`);
    }
  } else {
    for (const [i, sha] of plan.missing.entries()) {
      progress(`Copying files: ${i + 1} of ${plan.missing.length}…`);
      const a = byHash.get(sha)!;
      const form = new FormData();
      form.append('file', new File([preview.files[sha]! as Uint8Array<ArrayBuffer>], fileName(a).slice('attachments/'.length), { type: a.mime }));
      const res = await apiFetch('/account/import/file', { method: 'POST', body: form });
      if (!res.ok) throw await failure(res);
    }
  }

  progress('Importing your records…');
  const res = await apiFetch('/account/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip' },
    body: gzipSync(strToU8(JSON.stringify(preview.data))) as Uint8Array<ArrayBuffer>,
  });
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as { counts: Record<string, number> }).counts;
}
