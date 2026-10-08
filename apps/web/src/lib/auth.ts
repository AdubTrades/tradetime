import { createClient, type Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Supabase Auth, when configured. Without the two VITE_SUPABASE_* settings the app runs without sign-in as the
 * single local user (local development), and the server does the same.
 */
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const authEnabled = !!supabase;

// What an emailed link was for, read before supabase-js tidies the URL: an invite or a password reset needs a new
// password; an expired link comes back with an error to show on the sign-in page.
const linkParams = new URLSearchParams(window.location.hash.slice(1));
const linkType = linkParams.get('type');
const linkError = linkParams.get('error_description');

export interface AuthState {
  ready: boolean;
  session: Session | null;
  /** Arrived from an invite or password-reset link: choose a password before going on. */
  needsPassword: 'invite' | 'recovery' | null;
  linkError: string | null;
}

let state: AuthState = {
  ready: !supabase,
  session: null,
  needsPassword: linkType === 'invite' || linkType === 'recovery' ? linkType : null,
  linkError: linkError ? linkError.replace(/\+/g, ' ') : null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<AuthState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/**
 * The access token also lives in a cookie scoped to /api, so <img src="/api/attachments/…"> and download links
 * work. The server only accepts the cookie for reads; changes always need the Authorization header.
 */
function syncCookie(session: Session | null) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = session
    ? `tt_at=${encodeURIComponent(session.access_token)}; Path=/api; Max-Age=${session.expires_in ?? 3600}; SameSite=Lax${secure}`
    : `tt_at=; Path=/api; Max-Age=0; SameSite=Lax${secure}`;
}

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    syncCookie(data.session);
    set({ ready: true, session: data.session });
  });
  supabase.auth.onAuthStateChange((event, session) => {
    syncCookie(session);
    set({ ready: true, session, ...(event === 'PASSWORD_RECOVERY' ? { needsPassword: 'recovery' as const } : {}) });
  });
}

export const useAuth = (): AuthState =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

export const accessToken = (): string | null => state.session?.access_token ?? null;
export const passwordChosen = () => set({ needsPassword: null });
export const clearLinkError = () => set({ linkError: null });

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
