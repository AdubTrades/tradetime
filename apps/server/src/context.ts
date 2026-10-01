import { mkdirSync } from 'node:fs';
import { openDb } from '@tc/db';
import { paths } from './config';
import { applyPendingRestore } from './restoreApply';

for (const [name, dir] of Object.entries(paths)) {
  if (!dir.endsWith('.db') && name !== 'restorePending') mkdirSync(dir, { recursive: true });
}

applyPendingRestore();

export const { db, sqlite } = openDb(paths.db);
