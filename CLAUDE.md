# Notes for Claude Code

- The build plan and confirmed product decisions are in `docs/plan.md`. Follow its phase order.
- pnpm lives at `~/.local/bin/pnpm` (`export PATH="$HOME/.local/bin:$PATH"`).
- Dev ports: web 5173 → API 4318 (`data-dev/`). The installed app uses 4317 and `~/TradingCompanion` — never point dev or tests at the real data folder.
- Zod 4: `.partial()` still applies `.default()` values, so patch schemas must not have defaults (see `apps/server/src/settings.ts`).
- archiver v8 has no published types; `apps/server/src/types/archiver.d.ts` covers the subset in use.
