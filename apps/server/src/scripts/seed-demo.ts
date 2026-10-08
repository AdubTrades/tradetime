/**
 * Fill an account with the demo trader's sample data, for trying the app locally.
 * Usage: pnpm --filter @tc/server seed:demo [userId]   (defaults to the local user; refuses a non-empty account)
 */
import { listTrades } from '../trades';
import { localUserId } from '../config';
import { closeDb, initDb, withUser } from '../context';
import { seedDemo } from '../demo/seed';

const userId = process.argv[2] ?? localUserId;
await initDb();
await withUser(userId, async () => {
  if ((await listTrades({ from: '2000-01-01', to: '2100-01-01' })).length) throw new Error(`${userId} already has trades; not seeding over them`);
  await seedDemo();
});
console.log(`Seeded demo data for ${userId}`);
await closeDb();
