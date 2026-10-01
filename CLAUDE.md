# Notes for Claude Code

- The build plan and confirmed product decisions are in `docs/plan.md`. Follow its phase order.
- pnpm lives at `~/.local/bin/pnpm` (`export PATH="$HOME/.local/bin:$PATH"`).
- Dev ports: web 5173 → API 4318 (`data-dev/`). The installed app uses 4317 and `~/TradingCompanion` — never point dev or tests at the real data folder.
- Zod 4: `.partial()` still applies `.default()` values, so patch schemas must not have defaults (see `apps/server/src/settings.ts`).
- archiver v8 has no published types; `apps/server/src/types/archiver.d.ts` covers the subset in use.
- Migrations may be hand-extended after `drizzle-kit generate` for things Drizzle can't express (seed rows, partial indexes such as `session_one_running_idx` in `0001_sessions.sql`). Never edit a migration that has already shipped. Add a new one instead.
- Server errors: throw `AppError(status, message, detail?)` from `apps/server/src/errors.ts`. Overlap conflicts return 409 with `detail.overlaps`, and the UI then offers "Save anyway" (`force: true`).
- To update the installed app after a phase: `pnpm build`, then `launchctl kickstart -k gui/$(id -u)/com.tradingcompanion.server`. Migrations apply on restart.
- Stay on `@tanstack/react-table` v8 (v9 has a different API).
- Dialog forms reset in a `useEffect` keyed on `[open, record]` only. Don't add query data (lists, types) to the deps, or a refetch wipes what the user is typing.
- Restore: `apps/server/src/restore.ts` validates and stages a backup into `restore-pending/`, writes a `pre-restore` safety zip, then exits. launchd restarts the app, and `restoreApply.ts` swaps the data in before the database opens. In dev (tsx watch) you restart by hand.
- FOMC dates are a curated list in `packages/domain/src/calendar.ts` (`FOMC_MEETINGS`). Extend it each year from federalreserve.gov. Don't use FRED rid 101: it's updated daily.
