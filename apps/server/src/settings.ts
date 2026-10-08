import { eq, like, not } from 'drizzle-orm';
import { schema, type Db } from '@tc/db';
import { z } from 'zod';
import { isValidZone } from '@tc/domain';
import { currentScope, db } from './context';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

/** Every user-editable setting. Stored one row per key so new settings appear without migrations. */
const settingsShape = z.object({
  rolloverTime: hhmm,
  /** IANA time zone for trading days, calendar times and reminders. Null until chosen (treated as Perth). */
  timeZone: z.string().refine(isValidZone, 'Choose a valid time zone').nullable(),
  theme: z.enum(['system', 'light', 'dark']),
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
  /** Keep P&L figures on Home hidden until revealed, so results don't colour the next session. */
  homeHidePnl: z.boolean(),
});

export type Settings = z.infer<typeof settingsShape>;

export const defaultSettings: Settings = {
  rolloverTime: '10:00',
  timeZone: null,
  theme: 'system',
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
  homeHidePnl: true,
};

// No defaults here: a patch must only touch the keys it names.
export const settingsPatchSchema = settingsShape.partial().strict();

/** Read the user's settings from the database (once per request; see `withUser`). */
export async function loadSettings(tx: Db): Promise<Settings> {
  const rows = await tx.select().from(schema.setting).where(not(like(schema.setting.key, 'state.%')));
  return parseSettings(rows);
}

/** The current user's settings, loaded at the start of the request. */
export function getSettings(): Settings {
  return currentScope().settings;
}

/** Settings if there's a signed-in user in scope (background work may run outside one). */
export function trySettings(): Settings | null {
  try {
    return currentScope().settings;
  } catch {
    return null;
  }
}

function parseSettings(rows: { key: string; value: unknown }[]): Settings {
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

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const valid = settingsPatchSchema.parse(patch);
  const before = getSettings();
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(valid)) {
    if (value === undefined) continue;
    if (value === null) {
      // Null means "back to default"; the column can't hold SQL NULL.
      await db.delete(schema.setting).where(eq(schema.setting.key, key));
      continue;
    }
    await db
      .insert(schema.setting)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: [schema.setting.userId, schema.setting.key], set: { value, updatedAt: now } });
  }
  const scope = currentScope();
  scope.settings = await loadSettings(scope.tx);
  // Trading days depend on the rollover time and the time zone, so re-date sessions when either changes.
  if (scope.settings.rolloverTime !== before.rolloverTime || scope.settings.timeZone !== before.timeZone) {
    const { recomputeTradingDays } = await import('./sessions');
    await recomputeTradingDays(scope.settings.rolloverTime);
  }
  return scope.settings;
}

/** Internal per-user state (not user-editable), e.g. which session was already flagged as long. */
export async function getState<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, `state.${key}`));
  return row?.value as T | undefined;
}

export async function setState(key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(schema.setting)
    .values({ key: `state.${key}`, value, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.setting.userId, schema.setting.key], set: { value, updatedAt: now } });
}

/** App-wide state shared by everyone (economic-events fetch status). */
export async function getAppState<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select().from(schema.appState).where(eq(schema.appState.key, key));
  return row?.value as T | undefined;
}

export async function setAppState(key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(schema.appState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value, updatedAt: now } });
}
