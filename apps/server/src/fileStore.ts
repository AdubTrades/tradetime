import { auth, storage } from './config';

/**
 * Minimal Supabase Storage client (REST). Calls go out with the signed-in user's access token, so Supabase's
 * storage policies apply (each user can only touch `<their id>/…` in the bucket). Scripts without a user fall back
 * to SUPABASE_SECRET_KEY.
 */
type Fetcher = typeof fetch;

export interface StoreConfig {
  url: string;
  bucket: string;
  publishableKey: string;
  secretKey: string | null;
  fetcher?: Fetcher;
}

export const storeConfig = (): StoreConfig => ({
  url: auth.supabaseUrl!,
  bucket: storage.bucket,
  publishableKey: storage.publishableKey!,
  secretKey: storage.secretKey,
});

function headers(cfg: StoreConfig, token: string | null): Record<string, string> {
  const bearer = token ?? cfg.secretKey;
  if (!bearer) throw new Error('No signed-in user and no SUPABASE_SECRET_KEY: can’t reach file storage');
  return { apikey: cfg.publishableKey, Authorization: `Bearer ${bearer}` };
}

const objectUrl = (cfg: StoreConfig, kind: 'object' | 'object/sign', path: string) =>
  `${cfg.url}/storage/v1/${kind}/${encodeURIComponent(cfg.bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Upload (or overwrite) an object. */
export async function putObject(cfg: StoreConfig, token: string | null, path: string, data: Uint8Array, mime: string): Promise<void> {
  const res = await (cfg.fetcher ?? fetch)(objectUrl(cfg, 'object', path), {
    method: 'POST',
    headers: { ...headers(cfg, token), 'Content-Type': mime, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
    body: data as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`File storage refused the upload (${res.status}): ${await res.text().catch(() => '')}`.trim());
}

/** A temporary link to a private object, or null if it doesn't exist (or isn't this user's). */
export async function signedUrl(cfg: StoreConfig, token: string | null, path: string, expiresIn = 3600): Promise<string | null> {
  const res = await (cfg.fetcher ?? fetch)(objectUrl(cfg, 'object/sign', path), {
    method: 'POST',
    headers: { ...headers(cfg, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`File storage couldn’t sign a link (${res.status})`);
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL ?? body.signedUrl;
  if (!rel) return null;
  return rel.startsWith('http') ? rel : `${cfg.url}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
}
