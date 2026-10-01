import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let apply: typeof import('./restoreApply');
let config: typeof import('./config');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-apply-'));
  config = await import('./config');
  apply = await import('./restoreApply');
});

describe('applyPendingRestore', () => {
  it('does nothing without a staged restore', () => {
    expect(() => apply.applyPendingRestore()).not.toThrow();
  });

  it('swaps the database, keeps the old one, and merges attachments', () => {
    const { paths } = config;
    for (const d of [paths.attachments, paths.localBackups, paths.logs, path.join(paths.restorePending, 'attachments', 'ab')]) mkdirSync(d, { recursive: true });
    writeFileSync(paths.db, 'current');
    mkdirSync(path.join(paths.attachments, 'cd'), { recursive: true });
    writeFileSync(path.join(paths.attachments, 'cd', 'existing.png'), 'kept');
    writeFileSync(path.join(paths.restorePending, 'app.db'), 'restored');
    writeFileSync(path.join(paths.restorePending, 'attachments', 'ab', 'from-backup.png'), 'img');

    apply.applyPendingRestore();

    expect(readFileSync(paths.db, 'utf8')).toBe('restored');
    expect(readdirSync(paths.localBackups).some((f) => f.startsWith('replaced-by-restore-'))).toBe(true);
    expect(readFileSync(path.join(paths.attachments, 'ab', 'from-backup.png'), 'utf8')).toBe('img');
    expect(readFileSync(path.join(paths.attachments, 'cd', 'existing.png'), 'utf8')).toBe('kept');
    expect(existsSync(paths.restorePending)).toBe(false);
    expect(existsSync(path.join(paths.logs, 'last-restore.json'))).toBe(true);
  });
});
