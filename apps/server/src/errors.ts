/** Errors with an HTTP status and optional structured detail, rendered by app.onError. */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}
