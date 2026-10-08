import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
    // Each test file starts its own in-memory Postgres; give that room when the machine is busy.
    hookTimeout: 60_000,
    // Tests use in-memory Postgres; files they store go to a throwaway folder, never a real data folder.
    // A test-only JWT secret turns sign-in on, so API tests can sign their own tokens (see api.test.ts).
    env: { TC_DATA_DIR: path.join(tmpdir(), 'tradetime-tests'), SUPABASE_JWT_SECRET: 'test-secret-not-for-production-use-0123456789' },
  },
});
