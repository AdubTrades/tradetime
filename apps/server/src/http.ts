import { z } from 'zod';
import { financialYearOf, localDate } from '@tc/domain';
import { AppError } from './errors';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const instant = z.iso.datetime({ offset: true });
export const cents = z.number().int();

/** Parse a JSON body with a Zod schema, throwing a 400 with a readable message. */
export async function body<T extends z.ZodType>(req: { json: () => Promise<unknown> }, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

/** `?fy=2026` → 2026, defaulting to the current financial year. */
export function fyParam(raw: string | undefined): number {
  const year = raw ? Number(raw) : financialYearOf(localDate(new Date())).startYear;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError(400, 'Invalid financial year');
  return year;
}
