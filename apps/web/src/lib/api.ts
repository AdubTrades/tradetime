export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
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
  if (!res.ok) {
    const { error, detail } = data as { error?: string; detail?: unknown };
    throw new ApiError(error ?? res.statusText, res.status, detail);
  }
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
  longSessionHours: number;
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
export interface SessionType {
  id: string;
  name: string;
  isTrading: boolean;
  color: string;
  sortOrder: number;
  archived: boolean;
}
export interface Session {
  id: string;
  typeId: string;
  start: string;
  end: string | null;
  tradingDay: string;
  source: 'timer' | 'manual';
  notes: string | null;
  editedAt: string | null;
  createdAt: string;
}
export interface AuditEntry {
  id: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  at: string;
}
