/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. With this and the publishable key set, the app requires sign-in. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key. Safe to ship to the browser; row-level security protects the data. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
