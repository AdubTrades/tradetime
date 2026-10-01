# Trading Companion

A local-first trading journal, time log, expenses tracker, playbook and calendar for a futures scalper. All data stays on this Mac in `~/TradingCompanion/`.

## Daily use

The app runs in the background and is opened in a browser at **http://127.0.0.1:4317**.

Install it as a login item (builds the app and starts it now):

```bash
./scripts/install-launchd.sh
```

To stop and remove it (your data is kept):

```bash
./scripts/uninstall-launchd.sh
```

After pulling changes, run `pnpm install` and then the install script again to rebuild and restart.

## Data and backups

- `~/TradingCompanion/app.db` holds the SQLite database. `attachments/` holds screenshots and receipts (each file is named by its content hash).
- Settings → Backups writes zipped snapshots on a schedule to a folder you choose (iCloud Drive or Google Drive), and deletes old backups past the retention count.
- Settings → "Export everything" downloads the same zip on demand.
- To restore, unzip a backup into an empty `~/TradingCompanion/` folder while the app is stopped.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev        # web on http://127.0.0.1:5173, API on :4318, data in ./data-dev
pnpm test       # unit tests
pnpm typecheck
pnpm db:generate --name <change>   # after editing packages/db/src/schema.ts
```

| Folder | Purpose |
|---|---|
| `apps/web` | React UI (Vite, Tailwind, TanStack Router/Query) |
| `apps/server` | Hono API, background jobs (backups), attachment store |
| `packages/domain` | Pure logic: trading day, financial year, money. Unit-tested |
| `packages/db` | Drizzle schema and SQL migrations (applied automatically on start) |

### Conventions

- Store times as UTC ISO instants. Trades, sessions, check-ins and reviews use `tradingDay()`, which rolls over at the configured time (default 10:00 Perth). Expenses and payouts use the local date. The financial year runs 1 July – 30 June.
- Store money as integer cents. GST is always entered, never assumed to be 10%.
- Records are soft-deleted (`deleted_at`). Edits to tax-relevant records (sessions, expenses, payouts, trades) are written to `audit_log`.
- Store attachments once and link them to owners through `attachment_link`.
