import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Health {
  ok: boolean;
  startedAt: string;
  /** The demo is available on this server; `public` means people without an account can open it too. */
  demo: { public: boolean } | null;
  /** The hosted (Postgres) version: file backups, restore and the local demo copy don't apply. */
  cloud?: boolean;
  /** The server has its own FRED key, so economic events work without one in Settings. */
  fredConfigured?: boolean;
  /** Where screenshots and receipts live. */
  storage?: { kind: 'supabase'; bucket: string } | { kind: 'local' };
  /** Where testers can reach the person running the beta (shown on the privacy page and feedback form). */
  supportEmail?: string | null;
  /** Sign-in is switched on (Supabase Auth). */
  auth?: boolean;
}

/** What this server offers (sign-in, storage, demo, economic events). */
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/health'), staleTime: Infinity });
