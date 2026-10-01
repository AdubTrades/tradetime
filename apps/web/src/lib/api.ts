export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(`/api${url}`, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, res.status);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

// Shapes returned by the server. Kept here until a shared types package is needed.
export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  rolloverTime: string;
  theme: Theme;
  backupFolder: string | null;
  backupIntervalHours: 0 | 6 | 12 | 24 | 168;
  backupRetention: number;
}
export interface BackupStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastFile: string | null;
  lastBytes: number | null;
  folder: string;
}
export interface Attachment {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  originalName: string | null;
}
export interface AttachmentLink {
  id: string;
  attachmentId: string;
  ownerType: string;
  ownerId: string;
  role: string | null;
}
