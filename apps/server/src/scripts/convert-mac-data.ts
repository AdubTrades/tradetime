/**
 * Convert a Mac app backup into an export you can import into TradeTime in the cloud (Settings → Your data → Import).
 * Rehearses the import in a throwaway in-memory database first and stops if anything doesn't match.
 *
 * Usage: pnpm --filter @tc/server convert:mac <backup.zip> [output.zip]
 *   backup.zip  a tradetime-backup-*.zip from the Mac app (Settings → Backups → Back up now)
 *   output.zip  where to write the export (default: ~/Downloads/tradetime-from-mac-<date>.zip)
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';
import { formatMoney } from '@tc/domain';
import { storage } from '../config';
import { buildZip, openMacSource, readMacDatabase, rehearse, type Headline } from '../macImport';

const [source, outArg] = process.argv.slice(2);
if (!source) {
  console.error('Usage: pnpm --filter @tc/server convert:mac <backup.zip> [output.zip]');
  process.exit(1);
}
const out = path.resolve(outArg ?? path.join(homedir(), 'Downloads', `tradetime-from-mac-${DateTime.now().toFormat('yyyyLLdd-HHmm')}.zip`));

const mac = openMacSource(source);
try {
  console.log(`Reading ${path.basename(source)}…`);
  const { data, dropped } = readMacDatabase(mac.dbPath);
  const counts = Object.entries(data.tables).filter(([, rows]) => rows.length).map(([n, rows]) => `${n} ${rows.length}`);
  console.log(`  ${counts.join(', ')}`);
  if (dropped.length) console.log(`  Not carried over (no longer used): ${dropped.join(', ')}`);

  const { zip, missing } = buildZip(data, mac.files);
  const fileBytes = [...mac.files.values()].reduce((s, f) => s + f.byteLength, 0);
  console.log(`  ${mac.files.size} files, ${(fileBytes / 1024 / 1024).toFixed(1)} MB${missing.length ? `; ${missing.length} attachment(s) have no file in the backup` : ''}`);
  if (fileBytes > storage.capBytes) console.log(`  ⚠ That's more than the ${Math.round(storage.capBytes / 1024 / 1024)} MB per account; the import will refuse until the cap is raised (TC_STORAGE_CAP_MB).`);

  console.log('Rehearsing the import in a throwaway database…');
  const r = await rehearse(data);
  const fmt = (h: Headline): Record<string, string> => ({
    Trades: `${h.trades} on ${h.tradingDays} days`,
    'Net P&L (USD)': formatMoney(h.netCents, 'USD'),
    Sessions: `${h.sessions} (${h.hours} h)`,
    ...Object.fromEntries(Object.entries(h.expensesByFy).sort().map(([fy, c]) => [`Expenses FY ${fy}`, formatMoney(c)])),
    Payouts: `${h.payouts} (${formatMoney(h.payoutsAudCents)})`,
    Files: String(h.files),
  });
  const a = fmt(r.mac);
  const b = fmt(r.cloud);
  let same = r.mismatches.length === 0;
  console.log(`\n  ${'Check'.padEnd(22)}${'Mac backup'.padEnd(26)}Cloud (rehearsal)`);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ok = a[k] === b[k];
    same &&= ok;
    console.log(`${ok ? '  ' : '✗ '}${k.padEnd(22)}${(a[k] ?? '—').padEnd(26)}${b[k] ?? '—'}`);
  }
  for (const m of r.mismatches) console.log(`✗ ${m.table}: sent ${m.sent}, came back ${m.back}, ${m.differing} differ`);
  if (!same) {
    console.error('\nThe rehearsal didn’t match, so no export was written. Send me this output.');
    process.exit(1);
  }
  writeFileSync(out, zip);
  console.log(`\n✓ Every record came back unchanged. Export written to ${out}`);
  console.log('  Next: sign in to TradeTime, open Settings → Your data → Import an export…, and choose that file.');
} finally {
  mac.cleanup();
}
