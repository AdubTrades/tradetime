/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. With this and the publishable key set, the app requires sign-in. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key. Safe to ship to the browser; row-level security protects the data. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Optional Sentry DSN for browser error reports. */
  readonly VITE_SENTRY_DSN?: string;
  /** The build's commit (set from Vercel's VERCEL_GIT_COMMIT_SHA in vite.config.ts). */
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
