import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
    // Tests use in-memory Postgres; files they store go to a throwaway folder, never a real data folder.
    env: { TC_DATA_DIR: path.join(tmpdir(), 'tradetime-tests') },
  },
});
