# Trading Companion — Build Plan (v1)

## Context
A single-user, local-first app for a Perth-based futures scalper running trading as a business. It replaces a trading journal, time log and expenses tracker, and adds a Playbook and a combined Calendar. All screens share one data store keyed by date. The Time log, Expenses and Payouts double as ATO records, so they need accurate, auditable data that exports by financial year (FY, 1 Jul–30 Jun).

This is a greenfield project with no existing code. Spec: "Trading Companion — Product Spec v0.1" (as pasted in chat), plus the decisions below.

## Decisions confirmed in planning
| Topic | Decision |
|---|---|
| Trading day | Fixed rollover time, **default 10:00 Perth**, configurable. A 23:30–02:00 session belongs to the day it started. |
| Scaling | Scales in and out sometimes → trades are built from **fills**. |
| Copy trading | Same trade on several accounts → one **Trade** (idea) with a result per account. |
| Currency | Expenses are always AUD (bank charge). Trade P&L is in USD. |
| Income | Record prop firm **payouts**; evaluation/reset fees are **expenses**. |
| Devices | Mac-hosted. Other devices on the network later; a mobile-friendly layout is a future phase. |
| Check-in | Threshold measured from pressing **Start**; a check-in doesn't reset it. |
| Daily rules | **Deferred** (out of v1 until clarified). |
| Grades | Fixed scale **A+, A, B+, B, C+, C**. Per Play: number of missed standard criteria → grade (anything past the last step = C). Any must-have missed → **Outside plan** (no grade). |
| Backups | Zipped snapshots to a chosen folder (iCloud Drive or Google Drive Desktop path), with retention rotation. |
| Notifications | macOS notifications from the server are fine (reminders, check-in). |
| Expenses CSV | Headers and sample rows **still to be supplied**. Requested at the start of Phase 2. |

## Stack
- **TypeScript monorepo** (pnpm workspaces).
- **Web:** React + Vite + Tailwind + shadcn/ui; TanStack Router, Query and Table; ECharts for charts. Light/dark via CSS variables.
- **Server:** Node 22 + Hono; Drizzle ORM + `better-sqlite3`; versioned migrations; Zod schemas shared with the web app.
- **Time:** Luxon with IANA zones (`Australia/Perth`, `America/New_York`, `America/Chicago`). All instants stored as UTC ISO strings.
- **Recurrence:** `rrule`. **Notifications:** `node-notifier` (macOS). **Jobs:** an in-process scheduler (`croner`).
- **Run:** a `launchd` agent starts the server at login. The server binds to `127.0.0.1` by default. A setting allows LAN/Tailscale access behind a passcode (a later phase).
- **Tests:** Vitest for domain logic; Playwright smoke tests.

## Layout
- **Code:** `~/Projects/trading-companion` (git repo). The scratch workspace is temporary, so the project moves there when building starts.
- **Data:** `~/TradingCompanion/` holds `app.db`, `attachments/` (files named by the sha256 of their content), `backups-local/` and `logs/`. Data is kept apart from the code and never committed.

```
apps/web/        React UI (routes: journal, calendar, timelog, expenses, playbook, settings)
apps/server/     Hono API, jobs, adapters (economic calendar; later broker import)
packages/domain/ pure functions: tradingDay, fy, pnl, grading, stats, recurrence, money
packages/db/     Drizzle schema + migrations + seed (contracts, defaults)
packages/shared/ Zod schemas / API types
```

## Data model (v1)
Conventions:
- IDs are ULIDs.
- Every table has `createdAt`, `updatedAt` and `deletedAt` (soft delete only).
- Money is stored as integer cents with a `currency`. Prices are decimals snapped to tick size.
- Lists that records reference are their own tables with an `archived` flag.

- **Firm**, **Account** (firm, name, type: eval/funded/live/sim, status, start/end dates, starting balance, currency USD). **AccountGroup** + members (default size multiplier) for copy trading.
- **Contract** (root symbol, tick size, point value, currency). Seeded with ES/NQ/MES/MNQ; values verified against CME before seeding.
- **Trade** (the idea): tradingDay, contract, direction, Play, criteria-check snapshot, grade | outsidePlan, risk plan (stop, target, risk $/pts, planned R:R), notes, behaviour tags, confidence, sessionId (auto-matched by time, can be overridden), stateReadingId + overridden flag.
- **TradeAccount** (the per-account result): tradeId, accountId, fees, plus a snapshot of point value and tick size. Gross/net P&L, actual R, open/close times and average prices are **derived from fills** and stored as a cache.
- **Fill**: tradeAccountId, time, side, qty, price. Quick entry (one entry, one exit) creates two fills per account; account-group entry replicates fills using each account's multiplier.
- **TradeCriterionCheck**: criterionId, label snapshot, mustHave snapshot, ticked.
- **Play** (title, order, archived, gradeMap JSON `[{maxMissed, grade}]`), **PlayCriterion** (label, mustHave, order, archived), **PlayExample** (playId, grade, attachmentId, caption, date, resultLabel, sourceTradeId?).
- **Session** (type, start, end?, source: timer/manual, tradingDay, startedFromCalendarEventId?).
- **SessionType**, **Question** (prompt, kind: mood/scale/yesPartlyNo/text, appliesTo: start/checkin/both, order, archived), **MoodOption**.
- **StateReading** (sessionId, kind: start/checkin, at, answers JSON with question snapshots, decision, freeText, startExtras).
- **DailyReview** (tradingDay, notes).
- **Expense** (name, vendor, date, description, category, type, paymentMethod, exGst, gst, incGst (derived), businessUsePct, claimable (derived), recurringTemplateId?, importBatchId?, accountId? for eval fees). **RecurringExpense** template (rrule + defaults) creates real Expense rows. Lookup tables: **ExpenseCategory**, **ExpenseType**, **PaymentMethod**.
- **Payout** (accountId, requestedAt, receivedDate, grossUsd?, audReceived, notes, attachment).
- **MarketEvent** (provider, providerId, title, at UTC, allDay/tentative, impact, country/currency, actual/forecast/previous). Upserted on (provider, providerId).
- **CalendarEvent** (type, title, start/end or allDay date, rrule?, reminderMinutes?, link, notes, isTask, done) + **CalendarEventException** (occurrence date, skip or override fields). **CalendarEventType** (colour, layer).
- **Attachment** (sha256, mime, bytes, originalName) + **AttachmentLink** (attachmentId, ownerType, ownerId, role).
- **AuditLog** (entity, entityId, field, old, new, at, reason). Written for Session, Expense, Payout and Trade edits.
- **Setting** (key → JSON): rollover time, check-in thresholds, theme, filters, backup folder/schedule/retention.

## Key domain rules (packages/domain, fully unit-tested)
- `tradingDay(instant)`: Perth local time minus the rollover → date. Used by trades, sessions, readings and reviews. Expenses, payouts and calendar events use the plain local date. The FY is based on the local date.
- `pnlFromFills(fills, spec)`: FIFO matching across scale-in/scale-out, giving gross P&L, net (less fees), average entry/exit and an R multiple against the planned risk.
- `grade(checks, gradeMap)`: any must-have missed → outsidePlan; otherwise the count of missed standard criteria → grade.
- Stats count **per Trade (idea)** for win rate, expectancy and grade/Play breakdowns, and **per TradeAccount** for P&L by account. The equity curve can be viewed either way. Sample size (n) is returned with every metric.
- Session safeguards: timer state is a persisted `start` with `end = null`. A "still going?" notification fires at a configurable cap (default 6h). Manual entries that overlap another session get a warning.
- Check-in: the server job notifies when (now − session.start) crosses threshold 1 or 2. Snooze and disable are supported.

## Phases
0. **Foundations:** monorepo, DB and migrations, app shell with left nav, settings, themes, time and tradingDay utilities, attachment store (paste and drag-drop), audit log, one-click full export (zip), scheduled zipped backups to the chosen folder, launchd install script.
1. **Time log:** timer, manual entry, edit with history, overlap warning, long-session prompt, session types, totals by day/week/month/FY, CSV + PDF export.
2. **Expenses + Payouts:** CRUD with receipts, business-use %, recurring templates, CSV import (column mapper; inc-GST recalculated; categories seeded from the file), FY summary by category, CSV/PDF export. Payouts with an FY income summary.
3. **Playbook + Journal:** Plays, criteria and grade maps, gallery by grade. Fast batch trade entry (carry forward day, session and account group), checklist placed before the result fields, fills editor for scaling, risk plan. Trade list, detail and Send to Playbook. Core stats.
4. **Session-start checklist + check-ins:** question editor, start and check-in flows, macOS notifications, auto-attaching state to trades, daily review with timeline.
5. **Calendar:** month grid, weekly column, stats bar, layers, day detail. Market events adapter (provider chosen after checking terms; fallback is a curated US release list from official schedules) stored locally. Upcoming panel. My events, recurrence, exceptions, tasks, reminders, schedule vs actual, start a session from an event. No-trade days.
6. **Hardening:** deeper stats (by state, discipline, mistake costs), restore-from-backup flow, PDF polish.

Later phases: mobile-friendly layout + LAN/Tailscale access, daily rules, broker/CSV trade import, prop firm rules, Google Calendar sync, week view and FY heatmap.

## Verification
- `pnpm test`: Vitest across domain functions with fixed cases. Covers the rollover at 09:59/10:00, US DST transitions (March/November) for event times in Perth, FY boundaries (30 Jun / 1 Jul), FIFO P&L for scale-in/out against hand-calculated ES/MNQ examples, grade maps (including the must-have → outside plan rule), and GST/claimable maths.
- Playwright smoke test per phase: start/stop timer → session appears with the correct tradingDay; batch-enter 3 trades across an account group → per-account P&L and grade shown; import a sample expenses CSV → FY summary totals match.
- Manual check in the in-app browser after each phase. Restore a backup zip into an empty data folder and confirm everything (including attachments) round-trips.
