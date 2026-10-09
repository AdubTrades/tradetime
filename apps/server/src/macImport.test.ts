import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '@tc/db';
import { exportAccount, exportTables, type AccountExport } from './accountData';
import { seedDemo } from './demo/seed';
import { buildZip, openMacSource, readMacDatabase, rehearse } from './macImport';
import { asUser, useTestDb } from './testing';

useTestDb();

const dir = mkdtempSync(path.join(tmpdir(), 'mac-import-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tables = new Map<string, PgTable>();
for (const v of Object.values(schema)) if (v instanceof PgTable) tables.set(getTableConfig(v).name, v);

/**
 * A database shaped like the Mac app's: the same tables and column names without user_id, JSON stored as text and
 * booleans as 0/1, plus a backup setting the cloud doesn't have.
 */
function writeMacDb(file: string, data: AccountExport) {
  const db = new DatabaseSync(file);
  for (const name of exportTables) {
    const cols = Object.entries(getTableColumns(tables.get(name)!)).filter(([k]) => k !== 'userId');
    db.exec(`create table "${name}" (${cols.map(([, c]) => `"${c.name}" ${c.columnType === 'PgDoublePrecision' ? 'real' : c.columnType === 'PgInteger' || c.columnType === 'PgBoolean' ? 'integer' : 'text'}`).join(', ')})`);
    const insert = db.prepare(`insert into "${name}" (${cols.map(([, c]) => `"${c.name}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})`);
    const rows = name === 'setting' ? [...(data.tables.setting ?? []), { key: 'backupFolder', value: '/Users/me/iCloud', updatedAt: '2026-01-01T00:00:00Z' }] : (data.tables[name] ?? []);
    for (const row of rows) {
      insert.run(
        ...cols.map(([k, c]) => {
          const v = row[k];
          if (v === undefined || v === null) return null;
          if (c.columnType === 'PgJsonb') return JSON.stringify(v);
          if (c.columnType === 'PgBoolean') return v ? 1 : 0;
          return v as string | number;
        }),
      );
    }
  }
  db.close();
}

describe('bringing data across from the Mac app', () => {
  it('converts a Mac backup zip, rehearses it, and every record and total matches', async () => {
    // The demo trader stands in for the Mac data: every table, JSON fields, booleans and screenshots.
    await asUser(() => seedDemo(), 'mac-owner');
    const original = await asUser(() => exportAccount(), 'mac-owner');
    const withoutZone = { ...original, tables: { ...original.tables, setting: original.tables.setting!.filter((s) => s.key !== 'timeZone') } };
    const dbFile = path.join(dir, 'app.db');
    writeMacDb(dbFile, withoutZone);

    // Packed like a Mac backup: app.db plus attachments/<2 chars>/<sha>.<ext>.
    const zip: Record<string, Uint8Array> = { 'manifest.json': strToU8('{}'), 'app.db': new Uint8Array(readFileSync(dbFile)) };
    for (const a of original.tables.attachment as { sha256: string }[]) zip[`attachments/${a.sha256.slice(0, 2)}/${a.sha256}.png`] = strToU8(`file ${a.sha256}`);
    const backup = path.join(dir, 'tradetime-backup-test.zip');
    writeFileSync(backup, zipSync(zip));

    const source = openMacSource(backup);
    const { data, dropped } = readMacDatabase(source.dbPath);
    expect(dropped).toEqual([]);
    expect(source.files.size).toBe(original.tables.attachment!.length);
    // Backup settings stay behind, and the Mac app's Perth time zone is made explicit.
    expect(data.tables.setting!.map((s) => s.key)).not.toContain('backupFolder');
    expect(data.tables.setting!.find((s) => s.key === 'timeZone')?.value).toBe('Australia/Perth');
    expect(data.tables.trade!.length).toBe(original.tables.trade!.length);
    expect(typeof data.tables.calendar_event_type![0]!.isNoTrade).toBe('boolean');

    const r = await rehearse(data, { ownDb: false });
    expect(r.mismatches).toEqual([]);
    expect(r.cloud).toEqual(r.mac);
    expect(r.mac.trades).toBeGreaterThan(40);

    const { zip: out, missing } = buildZip(data, source.files);
    expect(missing).toEqual([]);
    const entries = unzipSync(out);
    expect(Object.keys(entries).filter((n) => n.startsWith('attachments/'))).toHaveLength(original.tables.attachment!.length);
    expect(JSON.parse(new TextDecoder().decode(entries['data.json']!)).kind).toBe('account-export');
    source.cleanup();
  }, 60_000);

  it('refuses the live data folder', () => {
    expect(() => openMacSource(path.join(homedir(), 'TradingCompanion'))).toThrow(/live data folder|Not found/);
  });
});
