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
    // A throwaway Web Push key pair (generated for tests only) turns push on so it can be tested with a fake sender.
    env: {
      TC_DATA_DIR: path.join(tmpdir(), 'tradetime-tests'),
      SUPABASE_JWT_SECRET: 'test-secret-not-for-production-use-0123456789',
      VAPID_PUBLIC_KEY: 'BIK21WFTxBD2kTd65lv7dbJjewLr9giA_LcDN05MsexLsjThRc2ZggiDk2txjBgUpkRpRuAR9ygTupGUzOsHY9w',
      VAPID_PRIVATE_KEY: 'vQhDiUASNOsUOBnqr5sdAdyOTeI7xfv7PzZM6AJoSvg',
    },
  },
});
