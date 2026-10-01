import { eq } from 'drizzle-orm';
import { schema } from '@tc/db';
import { z } from 'zod';
import { db } from './context';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

/** Every user-editable setting. Stored one row per key so new settings appear without migrations. */
const settingsShape = z.object({
  rolloverTime: hhmm,
  theme: z.enum(['system', 'light', 'dark']),
  backupFolder: z.string().nullable(),
  backupIntervalHours: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(24), z.literal(168)]),
  backupRetention: z.number().int().min(1).max(365),
  /** A running session longer than this triggers a "still going?" prompt. */
  longSessionHours: z.number().min(1).max(24),
  /** Registered for GST: claim ex-GST amounts plus GST credits instead of inc-GST amounts. */
  gstRegistered: z.boolean(),
  /** Mid-session check-in prompts for trading sessions, based on screen time since Start. */
  checkInEnabled: z.boolean(),
  checkInMinutes: z.number().int().min(5).max(720),
  checkInSecondMinutes: z.number().int().min(5).max(720).nullable(),
  checkInSnoozeMinutes: z.number().int().min(1).max(120),
  /** Your own FRED API key (free from fred.stlouisfed.org). Stored only in the local database. */
  fredApiKey: z.string().trim().regex(/^[a-z0-9]{32}$/i, 'A FRED API key is 32 letters and numbers').nullable(),
  /** Show medium-impact releases as well as high-impact ones. */
  includeMediumEvents: z.boolean(),
  /** Shown on printable reports for your accountant. */
  reportName: z.string().trim().max(120).nullable(),
  reportAbn: z.string().trim().regex(/^(\d\s?){11}$/, 'An ABN is 11 digits').nullable(),
});

export type Settings = z.infer<typeof settingsShape>;

export const defaultSettings: Settings = {
  rolloverTime: '10:00',
  theme: 'system',
  backupFolder: null,
  backupIntervalHours: 24,
  backupRetention: 30,
  longSessionHours: 6,
  gstRegistered: false,
  checkInEnabled: true,
  checkInMinutes: 90,
  checkInSecondMinutes: null,
  checkInSnoozeMinutes: 15,
  fredApiKey: null,
  includeMediumEvents: false,
  reportName: null,
  reportAbn: null,
};

// No defaults here: a patch must only touch the keys it names.
export const settingsPatchSchema = settingsShape.partial().strict();

export function getSettings(): Settings {
  const rows = db.select().from(schema.setting).all();
  const stored = Object.fromEntries(rows.filter((r) => r.key in defaultSettings).map((r) => [r.key, r.value]));
  const merged = { ...defaultSettings, ...stored };
  // Fall back to defaults for any stored value that no longer validates.
  const result = settingsShape.safeParse(merged);
  if (result.success) return result.data;
  const repaired: Record<string, unknown> = { ...merged };
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof Settings;
    repaired[key] = defaultSettings[key];
  }
  return settingsShape.parse(repaired);
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const valid = settingsPatchSchema.parse(patch);
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(valid)) {
      if (value === undefined) continue;
      if (value === null) {
        // Null means "back to default"; the column can't hold SQL NULL.
        tx.delete(schema.setting).where(eq(schema.setting.key, key)).run();
        continue;
      }
      tx.insert(schema.setting)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: schema.setting.key, set: { value, updatedAt: now } })
        .run();
    }
  });
  return getSettings();
}

/** Internal state (not user-editable), e.g. last backup result. */
export function getState<T>(key: string): T | undefined {
  const row = db.select().from(schema.setting).where(eq(schema.setting.key, `state.${key}`)).get();
  return row?.value as T | undefined;
}

export function setState(key: string, value: unknown): void {
  const now = new Date().toISOString();
  db.insert(schema.setting)
    .values({ key: `state.${key}`, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value, updatedAt: now } })
    .run();
}
