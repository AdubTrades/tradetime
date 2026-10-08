import { describe, expect, it } from 'vitest';
import * as settings from './settings';
import { asUser, useTestDb } from './testing';

useTestDb();

describe('settings', () => {
  it('returns defaults on a fresh account', () =>
    asUser(async () => {
      expect(settings.getSettings()).toEqual(settings.defaultSettings);
    }));

  it('only changes the keys in a patch, and the change is visible to the next request', async () => {
    await asUser(async () => {
      await settings.updateSettings({ longSessionHours: 7, reportName: 'Sam' });
      await settings.updateSettings({ theme: 'dark' });
    });
    await asUser(async () => {
      expect(settings.getSettings()).toMatchObject({ theme: 'dark', longSessionHours: 7, reportName: 'Sam', rolloverTime: '10:00' });
    });
  });

  it('treats null as reset to default', () =>
    asUser(async () => {
      await settings.updateSettings({ reportName: 'Sam' });
      await settings.updateSettings({ reportName: null });
      expect(settings.getSettings().reportName).toBeNull();
    }));

  it('rejects invalid and unknown keys', () =>
    asUser(async () => {
      await expect(settings.updateSettings({ rolloverTime: '7pm' })).rejects.toThrow();
      await expect(settings.updateSettings({ nope: 1 } as never)).rejects.toThrow();
    }));

  it('keeps each user’s settings separate', async () => {
    await asUser(() => settings.updateSettings({ theme: 'dark', rolloverTime: '09:00' }), 'alice');
    await asUser(async () => {
      expect(settings.getSettings()).toMatchObject({ theme: 'system', rolloverTime: '10:00' });
    }, 'bob');
    await asUser(async () => {
      expect(settings.getSettings()).toMatchObject({ theme: 'dark', rolloverTime: '09:00' });
    }, 'alice');
  });
});
