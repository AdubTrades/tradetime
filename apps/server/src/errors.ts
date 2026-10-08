/** Errors with an HTTP status and optional structured detail, rendered by app.onError. */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/** True for a Postgres unique-constraint violation (drizzle wraps driver errors in `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
