import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyOptions } from 'jose';
import { auth } from './config';

export interface AuthUser {
  userId: string;
  email: string | null;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Verify a Supabase access token and return who it belongs to. Tokens signed with the shared secret (HS256:
 * older projects, tests) use SUPABASE_JWT_SECRET; asymmetric ones use the project's published keys.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const options: JWTVerifyOptions = { audience: 'authenticated', ...(auth.supabaseUrl ? { issuer: `${auth.supabaseUrl}/auth/v1` } : {}) };
  const { alg } = decodeProtectedHeader(token);
  let payload;
  if (alg === 'HS256') {
    if (!auth.jwtSecret) throw new Error('Token signed with a shared secret, but SUPABASE_JWT_SECRET is not set');
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(auth.jwtSecret), { ...options, algorithms: ['HS256'] }));
  } else {
    if (!auth.supabaseUrl) throw new Error('SUPABASE_URL is not set');
    jwks ??= createRemoteJWKSet(new URL(`${auth.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    ({ payload } = await jwtVerify(token, jwks, options));
  }
  if (!payload.sub) throw new Error('Token has no user');
  return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}

/** The access token from `Authorization: Bearer …`, or (GET requests only) the `tt_at` cookie for images and downloads. */
export function tokenFrom(req: { method: string; header: (name: string) => string | undefined }): string | null {
  const header = req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null;
  // Cookies are only accepted for reads, so a cross-site page can't make changes with them.
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const cookie = req.header('cookie') ?? '';
  const match = /(?:^|;\s*)tt_at=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}
