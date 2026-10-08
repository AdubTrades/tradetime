/**
 * The demo: a visitor's own copy of the fictional trader's account, reached with a token the server signs (not a
 * Supabase sign-in). While it's open, every request uses that token instead of the user's own, and the copy expires
 * after a day. Kept in localStorage so it survives a reload and other tabs follow along.
 */
const KEY = 'tt_demo';

interface DemoSession {
  token: string;
  expiresAt: string;
}

function read(): DemoSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as DemoSession) : null;
    return s && Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

const session = read();

/** The demo token, if this browser is in the demo. Fixed for the page's life: entering or leaving reloads. */
export const demoToken = (): string | null => session?.token ?? null;
export const inDemo = (): boolean => !!session;

function setCookie(token: string | null, maxAge = 0) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = token ? `tt_at=${encodeURIComponent(token)}; Path=/api; Max-Age=${maxAge}; SameSite=Lax${secure}` : `tt_at=; Path=/api; Max-Age=0; SameSite=Lax${secure}`;
}
// Images and downloads (<img src="/api/…">) authenticate with the cookie, so it carries the demo token too.
if (session) setCookie(session.token, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));

/**
 * Open a fresh demo copy and reload into it. `signedInToken` is the user's own token (the server only gives
 * demos to signed-in users unless the demo is public).
 */
export async function enterDemo(signedInToken: string | null): Promise<void> {
  const res = await fetch('/api/demo/session', { method: 'POST', headers: signedInToken ? { Authorization: `Bearer ${signedInToken}` } : {} });
  const data = (await res.json().catch(() => ({}))) as Partial<DemoSession> & { error?: string };
  if (!res.ok || !data.token || !data.expiresAt) throw new Error(data.error ?? 'Couldn’t open the demo. Please try again.');
  try {
    localStorage.setItem(KEY, JSON.stringify({ token: data.token, expiresAt: data.expiresAt }));
  } catch {
    throw new Error('This browser is blocking site storage, which the demo needs.');
  }
  window.location.assign('/');
}

/** Back to your own account (or the sign-in page). */
export function exitDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored; carry on.
  }
  setCookie(null);
  window.location.assign('/');
}
