#!/usr/bin/env node
/**
 * Vercel build (vercel.json → buildCommand). Produces .vercel/output in Vercel's Build Output API format:
 *   static/              the web app (apps/web/dist)
 *   functions/api.func/  the whole API bundled into one file (apps/server/src/vercel.ts)
 *   config.json          routes: /api/* → the function, files as-is, everything else → index.html
 * Production builds also apply database migrations first, so a deploy never runs against an old schema.
 * Preview builds never touch the database.
 *
 * Run locally with `pnpm vercel-build` to check the output (no migrations unless VERCEL_ENV=production).
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const fn = path.join(out, 'functions/api.func');
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const production = process.env.VERCEL_ENV === 'production';

if (production) {
  console.log('▸ Applying database migrations (production)…');
  run('pnpm --filter @tc/server db:migrate');
} else {
  console.log(`▸ Skipping migrations (${process.env.VERCEL_ENV ?? 'local'} build)`);
}

console.log('▸ Building the web app…');
run('pnpm --filter @tc/web build');

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });

console.log('▸ Bundling the API…');
await build({
  entryPoints: [path.join(root, 'apps/server/src/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  sourcemap: 'inline',
  legalComments: 'none',
  // Local-only database (never used when DATABASE_URL is set) and the migration runner stay out of the bundle.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator', 'drizzle-orm/postgres-js/migrator'],
  // Some dependencies (web-push) are CommonJS and call require() at runtime.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // Opening a demo seeds a whole account; everything else takes well under a second.
      maxDuration: 60,
      // Next to the Supabase database (Sydney).
      regions: ['syd1'],
    },
    null,
    2,
  ),
);

const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
};
writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/(.*)', headers: security, continue: true },
        // Hashed build files never change; everything else is re-checked on each load.
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '/sw.js', headers: { 'Cache-Control': 'no-cache' }, continue: true },
        { src: '^/api(/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        // Client-side routes (/journal, /calendar…) load the app.
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('✓ .vercel/output is ready');
