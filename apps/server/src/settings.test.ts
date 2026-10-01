import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let settings: typeof import('./settings');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-settings-'));
  settings = await import('./settings');
});

describe('settings', () => {
  it('returns defaults on a fresh database', () => {
    expect(settings.getSettings()).toEqual(settings.defaultSettings);
  });

  it('only changes the keys in a patch', () => {
    settings.updateSettings({ backupRetention: 7, backupFolder: '/tmp' });
    settings.updateSettings({ theme: 'dark' });
    expect(settings.getSettings()).toMatchObject({ theme: 'dark', backupRetention: 7, backupFolder: '/tmp', rolloverTime: '10:00' });
  });

  it('treats null as reset to default', () => {
    settings.updateSettings({ backupFolder: null });
    expect(settings.getSettings().backupFolder).toBeNull();
  });

  it('rejects invalid and unknown keys', () => {
    expect(() => settings.updateSettings({ rolloverTime: '7pm' })).toThrow();
    expect(() => settings.updateSettings({ nope: 1 } as never)).toThrow();
  });
});
