import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let restore: typeof import('./restore');
let backup: typeof import('./backup');
let expenses: typeof import('./expenses');
let config: typeof import('./config');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-restore-'));
  config = await import('./config');
  backup = await import('./backup');
  expenses = await import('./expenses');
  restore = await import('./restore');
});

describe('backups', () => {
  it('lists, inspects and counts a real backup', async () => {
    expenses.createExpense({ name: 'Feed', date: '2026-09-01', exGstCents: 5000, gstCents: 0 });
    const status = await backup.runBackup();
    expect(status.lastError).toBeNull();
    const list = restore.listBackups();
    expect(list).toHaveLength(1);
    const info = await restore.inspectBackup(list[0]!.path);
    expect(info).toMatchObject({ integrity: 'ok', counts: { expenses: 1, trades: 0 }, latestActivity: '2026-09-01' });
  });

  it('refuses paths that are not listed backups or uploads', async () => {
    await expect(restore.inspectBackup('/etc/passwd')).rejects.toThrow(/not found/);
  });

  it('rejects zips that are not Trading Companion backups, and unsafe paths', async () => {
    const dir = restore.uploadsDir();
    execFileSync('mkdir', ['-p', dir]);
    const notOurs = path.join(dir, 'upload-1.zip');
    writeFileSync(path.join(config.paths.tmp, 'readme.txt'), 'hello');
    execFileSync('/usr/bin/zip', ['-j', '-q', notOurs, path.join(config.paths.tmp, 'readme.txt')]);
    await expect(restore.inspectBackup(notOurs)).rejects.toThrow(/doesn't look like/);
  });

  it('stages a restore after writing a safety backup', async () => {
    const list = restore.listBackups().filter((b) => b.name.includes('-backup-'));
    // Prevent the staged restart from exiting the test process.
    const realExit = process.exit;
    process.exit = (() => undefined) as never;
    try {
      const res = await restore.stageRestore(list[0]!.path);
      expect(path.basename(res.safetyBackup)).toMatch(/^trading-companion-pre-restore-/);
      expect(existsSync(path.join(config.paths.restorePending, 'app.db'))).toBe(true);
      expect(readdirSync(config.paths.localBackups).some((f) => f.includes('pre-restore'))).toBe(true);
    } finally {
      await new Promise((r) => setTimeout(r, 400));
      process.exit = realExit;
    }
  });
});

