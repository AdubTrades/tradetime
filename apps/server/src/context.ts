import { mkdirSync } from 'node:fs';
import { openDb } from '@tc/db';
import { paths } from './config';

for (const dir of Object.values(paths)) {
  if (!dir.endsWith('.db')) mkdirSync(dir, { recursive: true });
}

export const { db, sqlite } = openDb(paths.db);
