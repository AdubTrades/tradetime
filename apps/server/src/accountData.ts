import { existsSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { knownMigrationCount, schema } from '@tc/db';
import { z } from 'zod';
import { attachmentPath, checkFile, objectPath } from './attachments';
import { withoutOwner } from './audit';
import { storage } from './config';
import { currentScope, db } from './context';
import { AppError } from './errors';
import { loadSettings } from './settings';

/**
 * A whole account as data: every record the user owns, for "Download my data" and "Import into my account"
 * (bringing data across, or restoring one user). Files travel separately in the export zip, by hash.
 */
export const EXPORT_FORMAT = 1;

/** Device push subscriptions belong to a browser, not the data; the profile row is the account itself. */
const notExported = new Set(['user_profile', 'push_subscription']);

/** Tables in foreign-key order (parents first), as listed in the schema. */
export const exportTables = schema.userTables.filter((t) => !notExported.has(t));

const tableByName = new Map<string, PgTable>();
for (const value of Object.values(schema)) {
  if (value instanceof PgTable) tableByName.set(getTableConfig(value).name, value);
}
const table = (name: string) => tableByName.get(name)!;
/** JS property names of a table's columns, e.g. `originalName`. */
const columnKeys = (t: PgTable) => Object.keys(getTableColumns(t)).filter((k) => k !== 'userId');

export interface AccountExport {
  app: 'tradetime';
  kind: 'account-export';
  formatVersion: number;
  /** Database version that wrote it; an older app refuses exports from a newer one. */
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportAccount(): Promise<AccountExport> {
  const tables: AccountExport['tables'] = {};
  for (const name of exportTables) {
    const rows = (await db.select().from(table(name))) as Record<string, unknown>[];
    tables[name] = rows.map(({ userId: _owner, ...row }) => (name === 'audit_log' ? { ...row, oldValue: withoutOwner(row.oldValue), newValue: withoutOwner(row.newValue) } : row));
  }
  return { app: 'tradetime', kind: 'account-export', formatVersion: EXPORT_FORMAT, schemaVersion: knownMigrationCount(), exportedAt: new Date().toISOString(), tables };
}

/** Delete the current user's records (children first). `everything` also removes their devices and profile. */
export async function wipeAccount(opts: { everything?: boolean } = {}): Promise<void> {
  const names = opts.everything ? [...schema.userTables] : exportTables;
  for (const name of [...names].reverse()) await db.delete(table(name));
}

const exportSchema = z.object({
  app: z.literal('tradetime', { message: 'This isn’t a TradeTime export' }),
  kind: z.literal('account-export', { message: 'This isn’t a TradeTime account export' }),
  formatVersion: z.number().int().positive(),
  schemaVersion: z.number().int().nonnegative(),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

const attachmentRow = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), mime: z.string(), bytes: z.number().int().nonnegative() });

/** Check an export can be imported here and return its attachment rows (for the storage cap and file checks). */
export function validateExport(input: unknown): { data: AccountExport; files: z.infer<typeof attachmentRow>[] } {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) throw new AppError(422, parsed.error.issues[0]?.message ?? 'Not a TradeTime export');
  const data = parsed.data as AccountExport;
  if (data.formatVersion > EXPORT_FORMAT || data.schemaVersion > knownMigrationCount()) {
    throw new AppError(422, 'This export was made by a newer version of TradeTime. Update the app, then import it again.');
  }
  const files = (data.tables.attachment ?? []).map((row, i) => {
    const r = attachmentRow.safeParse(row);
    if (!r.success) throw new AppError(422, `Attachment ${i + 1} in the export is damaged`);
    return r.data;
  });
  checkTotal(files);
  return { data, files };
}

function checkTotal(files: { bytes: number }[]) {
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (total > storage.capBytes) {
    throw new AppError(422, `The export has ${Math.ceil(total / 1024 / 1024)} MB of files, more than the ${Math.round(storage.capBytes / 1024 / 1024)} MB each account has during the beta.`);
  }
}

/**
 * Before importing, the browser puts the export's files in place. Cloud: it uploads each one straight to the user's
 * folder in Storage (paths returned here). Local: it posts the ones missing from disk.
 */
export function planFiles(files: { sha256: string; mime: string; bytes: number }[]) {
  for (const f of files) checkFile(f.mime, f.bytes);
  checkTotal(files);
  if (storage.remote) {
    const { userId } = currentScope();
    return { mode: 'supabase' as const, uploads: files.map((f) => ({ sha256: f.sha256, bucket: storage.bucket, path: objectPath(userId, f.sha256, f.mime) })) };
  }
  return { mode: 'local' as const, missing: files.filter((f) => !existsSync(attachmentPath(f.sha256, f.mime))).map((f) => f.sha256) };
}

const BATCH = 500;

/**
 * Replace everything in the current account with an export. Runs inside the request's transaction, so it either
 * all lands or (on any bad row) nothing changes.
 */
export async function importAccount(input: unknown): Promise<{ counts: Record<string, number>; missingFiles: number }> {
  const { data, files } = validateExport(input);
  const unknown = Object.keys(data.tables).filter((n) => !exportTables.includes(n as (typeof exportTables)[number]));
  if (unknown.length) throw new AppError(422, `The export has data this version doesn’t know (${unknown.join(', ')}).`);

  await wipeAccount();
  const counts: Record<string, number> = {};
  for (const name of exportTables) {
    const t = table(name);
    const keys = columnKeys(t);
    const rows = (data.tables[name] ?? []).map((row) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]])));
    for (let i = 0; i < rows.length; i += BATCH) {
      try {
        await db.insert(t).values(rows.slice(i, i + BATCH) as never);
      } catch (err) {
        const cause = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message;
        throw new AppError(422, `Couldn’t import ${name.replace(/_/g, ' ')}: ${cause}`);
      }
    }
    counts[name] = rows.length;
  }

  const scope = currentScope();
  scope.settings = await loadSettings(scope.tx);
  // Local mode can check the files are on disk; in the cloud the browser has just uploaded them.
  const missingFiles = storage.remote ? 0 : files.filter((f) => !existsSync(attachmentPath(f.sha256, f.mime))).length;
  return { counts, missingFiles };
}
