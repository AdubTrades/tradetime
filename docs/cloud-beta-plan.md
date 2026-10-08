# TradeTime community beta — Supabase + Vercel plan

**Goal:** put TradeTime online so about a dozen traders from your community can use it, each with their own private account and data, from any computer or phone, **for free**, while you decide whether to turn it into a paid product. The product features stay as they are. This is also the foundation for a later paid, two-tier product, so nothing here is throwaway.

**Status:** revised 8 Oct 2026 to run entirely on Supabase and Vercel free tiers. This replaces the 7 Oct "middle path" with a separate always-on server. **Phases 1–5 are built on the `cloud` branch** (8 Oct 2026): Postgres with per-user rows and row-level security, Supabase sign-in, and Supabase file storage, which switch on once you create the project (see `docs/supabase-setup.md`).

---

## 1. The shape of it

```
 Testers' browsers (any PC, Mac, phone)            Supabase (Sydney region)
 ┌──────────────────────────────┐                 ┌─────────────────────────────────┐
 │ TradeTime web app            │──login────────▶ │ Auth: accounts, passwords,      │
 │ (same React app, installable │                 │   email, password reset         │
 │  to the home screen)         │──upload files─▶ │ Storage: screenshots, receipts  │
 └──────────────┬───────────────┘   (direct,      │   in private per-user folders   │
                │ HTTPS + login     signed URL)   ├─────────────────────────────────┤
                ▼ token                           │ Postgres: everyone's data,      │
 ┌──────────────────────────────┐   SQL via       │   every row tagged by user,     │
 │ Vercel                       │   connection    │   row-level security            │
 │ - the website (static files) │──pooler───────▶ ├─────────────────────────────────┤
 │ - the API: the existing Hono │                 │ Scheduler (pg_cron): every      │
 │   server as Vercel functions │◀──"run jobs"────│   minute it calls the API's     │
 │ - /api/jobs/tick runs        │                 │   job endpoint                  │
 │   reminders, check-ins,      │                 └─────────────────────────────────┘
 │   renewals, FRED refresh     │──push──▶ testers' browsers / phones
 └──────────────────────────────┘
 GitHub Actions (free): nightly database backup, keep-alive ping
```

**What changes compared with the always-on server version:**
- **No server to rent.** Vercel runs the website and turns the existing Hono API into on-demand functions; Hono supports this directly. Supabase does login, the database and file storage.
- **Background jobs get a timer from outside.** On Vercel, code only runs when a request comes in, so Supabase's scheduler (`pg_cron` with `pg_net`) calls a protected `/api/jobs/tick` endpoint every minute. That endpoint does what the in-process timers do today. Vercel's own scheduled jobs are too limited on the free plan.
- **Files upload straight to Supabase.** Vercel functions only accept request bodies up to about 4.5 MB, so the browser asks the API for a signed upload link and sends screenshots straight to Supabase Storage.
- **Backups and the keep-alive run on GitHub Actions**, which is free.

## 2. Decisions (confirmed 8 Oct 2026)

| # | Decision | Confirmed |
|---|---|---|
| 1 | Hosting | **Vercel (Hobby, free)** for the website and API, and **Supabase (free, Sydney)** for login, database, storage and scheduler. |
| 2 | Who can sign up | **Invite only.** You add testers' emails, they get an invite link, and public sign-up is off. |
| 3 | Login methods | Email and password, plus a magic link. Google sign-in is optional. |
| 4 | Testers outside Australia? | The beta stays **Australia-centric**: Australian financial year, GST and ATO-style exports. Time zone and trading-day rollover become per-user settings. |
| 5 | Your own data | You become **user #1**: your current data is imported into your account. Your local installed app keeps running until the cloud version has proven itself. |
| 6 | Demo mode | A **demo account** that resets nightly instead of the separate demo server. |
| 7 | Web address | The free Vercel address to start (e.g. `tradetime.vercel.app`). Add your own domain later if you want one. |
| 8 | Code hosting | A **private GitHub repo**. Vercel deploys from it, and GitHub Actions run backups. This also gives the repo the remote it doesn't have yet. |

## 3. Phases

Estimates assume focused build sessions like the ones so far, and include testing. Each phase ends in a working state.

### Phase 0 — Accounts and setup (half a day)
- **You** create accounts (I can't create accounts or handle passwords for you):
  - GitHub, with a private repo for TradeTime
  - Vercel, signed in with GitHub
  - Supabase, with a project in the Sydney region
- **Me:**
  - work on a `cloud` branch so the local app on `main` is untouched
  - set up error monitoring (Sentry free tier) and an uptime monitor (Better Stack or UptimeRobot free tier)
- **Secrets** stay in Vercel's and Supabase's settings, never in the repo: database URL, Supabase keys, FRED key, push keys and the job-endpoint secret.

### Phase 1 — Move the database to Postgres ✅ done 8 Oct 2026

**As built:**
- Per-user filtering is done by Postgres row-level security rather than by adding `user_id` checks to every query. Each request runs in one transaction as a restricted role with `app.user_id` set, and `user_id` fills itself on insert.
- Keys are `(user_id, id)`, so the seeded defaults keep their fixed ids per user, and foreign keys include `user_id`, so one user's records can't point at another's.
- Tables live in their own `tradetime` schema, outside Supabase's public API.
- Until Phase 2, every request acts as one local user.
- The file backups, restore and the separate demo process are removed and hidden in the web app. Phase 6 replaces them.

**Original plan:**
Today: 31 tables in SQLite, about 185 database calls written in SQLite's "instant answer" style, 23 transactions and 8 migrations.
- **Schema:** rewrite the Drizzle schema for Postgres. Money stays in integer cents, and times stay as UTC ISO strings to keep changes small.
- **Per-user data:** add a `user_id` to every table that belongs to someone, with indexes. Uniqueness rules become per user; for example, "one running session" becomes one per user.
- **Shared vs per-user tables:**
  - Shared by everyone: market events (one FRED feed for all) and the contract specs (ES, NQ, MES, MNQ).
  - Seeded into each new account: session types, check-in questions, list items (moods, mistakes, expense categories), calendar event types, and the default settings.
- **Async conversion:** convert every database call and transaction to the network ("async") style. This is mechanical but touches every server module.
- **Serverless-friendly connections:** connect through Supabase's **connection pooler** (transaction mode), so many short-lived Vercel functions don't run out of database connections.
- **Tests:** run the existing tests (150 today) against a real in-process Postgres (PGlite), so they stay fast and don't need Docker.
- **Fresh migration history:** start a new Postgres one and keep the SQLite migrations on `main`.

### Phase 2 — Login and per-user scoping ✅ built 8 Oct 2026 (needs your Supabase project to switch on)

**As built:** Supabase Auth with email and password, magic links, password reset and invites. The server verifies the access token (JWKS, or the legacy secret) and runs each request as that user under row-level security. Sign-in screens are styled in Calm. API tests prove that tokens are required and that users can't reach each other's records or files. Without Supabase settings the app runs as the local user. Setup steps for you are in `docs/supabase-setup.md`.

**Original plan:**
- **Web login screens:** sign in, magic link, forgot or reset password, and accept invite, using Supabase's JS client and styled in the Calm design.
- **Identity check:** the API verifies the Supabase login token on every request and passes `userId` into every service call. No request reaches data without it.
- **Row-level security as a second lock:** each request's database work runs in a transaction that sets the user's identity, and Postgres policies (`user_id = auth.uid()`) refuse other users' rows even if the app code had a bug.
- **Isolation tests:** create two users and prove neither can read, edit or delete the other's trades, sessions, expenses, files or events through any API route.
- **Invites:** you invite testers from the Supabase dashboard.

### Phase 3 — Files to Supabase Storage ✅ built 8 Oct 2026

**As built:**
- The browser hashes each file, reuses one you already have, and otherwise uploads straight to your folder in a private bucket, then the API records it.
- Viewing goes through the API, which checks the file is yours and redirects to a one-hour signed link, so existing image links work unchanged.
- Storage calls use the signed-in user's own token, and storage policies limit each user to their folder, so no secret key sits on the server.
- There's a 100 MB per-user cap.
- Local mode still keeps files on disk.

**Original plan:**
- **Private bucket:** screenshots, receipts and imports go in a private bucket under `user_id/…`, and the app shows them through short-lived signed links.
- **Direct uploads:** the browser asks the API for a signed upload URL, then uploads to Storage itself. This works around Vercel's request-size limit. The drop, paste and upload interface doesn't change.
- **Imports:** CSV imports from NinjaTrader, Tradovate and expense files stay small enough to go through the API as now. They're checked against a size limit.
- **Limits:** per-file size limits and a per-user storage cap, to stay inside the free tier.

### Phase 4 — Per-user time zone ✅ built 8 Oct 2026

**As built:**
- A Time zone setting (any zone the browser knows). A new account picks up the browser's zone, and Perth is used until then.
- The shared date maths follows the signed-in user's zone on the server (per request) and in the browser, so trading days, "today", calendar and reminder times, reports and imports all follow it.
- Changing the zone re-dates sessions, as a rollover change does.
- Labels read "Perth time" / "New York time".
- Economic events use the server's shared FRED key, and the personal key field only shows when the server has none.

**Original plan:**
- **Time zone setting:** Perth is hard-coded in 35 places, through `LOCAL_ZONE`. It becomes a user setting, defaulting to the browser's time zone, alongside the trading-day rollover time that's already a setting.
- **What it affects:** check that the trading day, financial-year boundaries, calendar times, reminders and economic-event times all follow the user's zone. The time and daylight-saving tests get extra cases for a non-Perth user.
- **Economic events:** fetched once for everyone using your FRED key and shown in each user's own time zone. The per-user FRED key setting goes away.

### Phase 5 — Background jobs and notifications ✅ built 8 Oct 2026

**As built:**
- One `runTick()` does a round of jobs for every user.
- A lease in the database stops overlapping ticks double-sending, and the reminder window is kept in the database, so it works serverless.
- Locally it runs every minute in-process. In the cloud, pg_cron calls the secret-protected `/api/jobs/tick` (`packages/db/supabase/cron.sql`, with the URL and secret in Supabase Vault).
- Notifications are Web Push to each of the user's devices, managed in Settings → Notifications, with a service worker that opens the right page when you click. Dead devices are removed automatically.
- The local Mac app also keeps its macOS notifications.

**Original plan:**
- **The tick:** a protected `POST /api/jobs/tick` endpoint, which needs a secret header, runs one round of jobs for all users:
  - "still going?" long-session alerts
  - check-ins
  - calendar reminders
  - recurring expenses
  - renewal reminders
  - nightly demo reset
  - FRED refresh, at most every 12 hours as now
- **The trigger:** Supabase's `pg_cron` calls the tick every minute through `pg_net`.
- **Short runs:** each run must finish well inside Vercel's free-plan time limit. With a dozen users this is easy, and the FRED refresh can be split over several ticks if needed.
- **Duplicate protection:** the jobs already record what they've sent, such as "renewal notified" and "long session notified". These records move to the database per user, so a repeated tick never sends a notification twice.
- **Push notifications:** macOS pop-ups become **web push**. Testers allow notifications once in their browser.
  - Works on Windows, Mac and Android.
  - On iPhone it works once the app is added to the home screen (iOS 16.4 or later).
- **Fallbacks:** the in-app check-in card and the floating timer still work without push. They already poll from the browser.

### Phase 6 — Replace the Mac-only pieces ✅ built 8 Oct 2026

**As built:**
- **Your data:** Settings → Your data → **Download my data** builds a zip in the browser: every record as `data.json` plus the screenshots and receipts. **Import an export…** replaces everything in the account with one, all or nothing, after showing what's in it. This is how your real data comes across in Phase 9. Data travels gzipped and files go straight to and from storage, so it fits Vercel's request limits.
- **Demo:** Settings → Demo mode opens a fresh copy of the fictional trader for whoever opens it, so visitors never see each other's changes. It uses its own signed token (`DEMO_SECRET`), and `DEMO_PUBLIC=1` adds a "look around the demo" link on the sign-in page. Its screenshots are drawn on request rather than stored. Notifications, uploads, imports and the FRED key are off in it. The hourly job deletes copies after a day, and at most 40 are live at once.
- **Nightly database backup:** `.github/workflows/db-backup.yml` dumps the `tradetime` schema plus the sign-in accounts, encrypts them with your passphrase, and keeps 30 days as private workflow artifacts.
- **Removed from the cloud version:** the folder backups, restore, and the demo server and its switch page, along with their settings.

**Original plan:**

| Today (on your Mac) | On Supabase + Vercel |
|---|---|
| macOS notifications (`notify.ts`, node-notifier) | Web push (Phase 5) |
| "Choose folder" for backups (AppleScript) | Removed |
| Scheduled zip backups to iCloud or Drive | **Nightly `pg_dump` by a GitHub Action**, kept as a private workflow artifact or in Cloudflare R2's free tier. Files are already in Supabase Storage. Each user can still **download a full export** of their own data. |
| Restore a backup by swapping the data folder | **Import an export into your account**, used to bring your own data across and to restore a single user |
| launchd starts the app at login | Nothing to run. Vercel serves requests and the scheduler wakes the jobs. |
| Separate demo server on port +3 | Demo account, reset nightly by the tick |
| In-process timers (croner) | `pg_cron` calling `/api/jobs/tick` |

### Phase 7 — Mobile pass ✅ built 8 Oct 2026

**As built:**
- **Installable:** a web app manifest and icons (including a maskable one for Android and an Apple touch icon). Settings → Install the app gives a one-tap install where the browser offers it, and Share → Add to Home Screen steps on iPhone. The title bar follows the light/dark theme, and installed pages respect the notch and home indicator.
- **Phone navigation:** below tablet width, a slim top bar and a bottom tab bar (Home, Journal, Calendar, Time log, More). More holds Expenses, Playbook, Settings, theme and sign out. The floating timer and check-in card sit above the tab bar.
- **Forms:** every dialog, including the trade form, opens as a full-screen sheet on phones.
- **Journal:** trades are two-line rows on phones, and filters fold behind a Filters button. The day page tiles stack.
- **Calendar:** an agenda list for the month on phones (P&L, win rate, screen time, releases and your events per day); tapping a day opens the day detail. The month grid stays on wider screens.
- **Expenses:** compact two-line rows; the payout and FY summary tables drop secondary columns on phones.
- **Touch:** buttons, tabs, menus and pickers are 40–44px tall on touch screens. Fields use 16px text there so iOS doesn't zoom in on focus.
- No page scrolls sideways at 375px wide.

**Original plan:**
- **Installable app:** add an app manifest, icons and a small service worker, which web push needs anyway, so it installs to phones and desktops.
- **Phone layouts for key screens:**
  - Dashboard: Tonight card, timer, to-dos.
  - Journal: day cards become stacked rows instead of wide columns.
  - Trade form: a full-screen sheet.
  - Calendar: an agenda list on phones instead of the month grid.
  - Expenses: compact rows.
  - Time log: timer and sessions.
- **Touch targets:** at least 44px, as the design already uses.

### Phase 8 — Deploy and operations ✅ built 8 Oct 2026 (going live needs your GitHub, Vercel and Supabase steps in `docs/deploy.md`)

**As built:**
- **Vercel build:** `pnpm vercel-build` (`scripts/vercel-build.mjs`) writes Vercel's Build Output: the web app as static files, plus the whole API bundled into one Node 22 function in Sydney (`apps/server/src/vercel.ts`). It routes `/api/*` to the function and everything else to the app, with security headers and long caching for hashed files. Tested locally: the bundle runs on its own against a real Postgres connection (sign-in, isolation, demo, export).
- **Migrations:** production builds run `db:migrate` before going live. Previews never touch the database, and the function never migrates at start-up.
- **Health:** `/api/health/ping` runs a one-line database query, for uptime monitors and the keep-alive job. The server refuses to start with a clear message if the database, sign-in or storage settings are missing.
- **Error reports:** optional Sentry via its HTTP API (no SDK) from the API, the scheduled jobs and the browser, sending the user id only.
- **GitHub Actions:** the nightly backup (Phase 6) and a keep-alive ping every 3 days that emails you if the app or database is down. The every-minute tick already keeps Supabase from pausing.
- **Uptime alerts:** UptimeRobot on `/api/health/ping`, with the steps in `docs/deploy.md`.

**Original plan:**
- **Deploys:** connect the GitHub repo to Vercel. Every push to the `cloud` branch gets a preview address, and the production branch deploys automatically.
- **Database migrations:** applied by a deploy step or a GitHub Action, never by hand against production.
- **Sentry:** catches errors in the API and the browser.
- **Uptime alert:** sent to your phone.
- **GitHub Actions:**
  - the nightly backup
  - a light keep-alive request every few days, so the free Supabase project isn't paused for inactivity (check this still works under Supabase's current rules)

### Phase 9 — Bring your data across (half a day)
- **Import script:** reads your local `~/TradingCompanion` SQLite database and attachments, writes them into your cloud account, and uploads files to Storage.
- **Checks:** compare counts and totals between old and new (trades, P&L per day, sessions and hours, expenses per FY, examples and screenshots).
- **Rehearse first:** run it against a copy, never the live folder, until the numbers match.

### Phase 10 — Beta launch (1 day)
- **Onboarding:** first-run setup for time zone and rollover, the first prop firm account, the first Play, and the notification permission prompt (with the iPhone "Add to Home Screen" tip).
- **In-app feedback:** a "Send feedback" link (email or your Discord) and a short "known issues" note.
- **Simple privacy and terms page:** what's stored, who can see it (only the user, plus you as admin for support), how to export or delete data, and a clear "journal, not financial or tax advice" disclaimer.
- **Account deletion:** a "Delete my account and data" control.
- **Invite emails** to the testers.

## 4. Time and cost

**Build time:** roughly **3–4 weeks** of sessions in total, about the same as the server version. The work moves around rather than shrinking: there's no server to set up, but jobs, uploads and backups each need a serverless-friendly approach.

**Running cost for the beta: US$0 a month.** Free tiers change, so check them when we start.

| Item | Free tier (approximate) | Watch out for |
|---|---|---|
| Vercel Hobby | Website and API functions, generous monthly function allowance | **Personal, non-commercial use only.** Fine for a free beta, but a paid product needs Vercel Pro (about US$20 a month). There are function time limits per request, and request bodies are limited to about 4.5 MB (handled by direct uploads). |
| Supabase Free | About 500 MB database, 1 GB storage, 50k monthly users | **Pauses after about a week with no activity**, which the keep-alive covers. No automatic backups on free, which the GitHub Action covers. Two free projects per account. |
| Supabase scheduler | `pg_cron` and `pg_net` included | One call a minute is about 43,000 function calls a month. Confirm that fits Vercel Hobby's allowance; if not, run the tick every 2–5 minutes. Reminders would then be up to that much late. |
| GitHub | Private repo and Actions minutes | The nightly backup and keep-alive use a few minutes a day. |
| Sentry and uptime monitor | Free | |
| Domain (optional) | About US$15–20 a year | |

**If it becomes a paid product:** expect about US$45 a month to start (Vercel Pro and Supabase Pro, with no pausing and daily backups), plus Stripe fees. No re-platforming is needed, because the architecture is the same.

## 5. Security checklist (beta level)
- Every API route requires a valid login, and every query is filtered by `user_id`, **and** Postgres row-level security enforces the same.
- Automated tests prove two users can't see each other's data, including files.
- Files are in a private bucket and only served through short-lived signed links. Uploads use one-time signed URLs.
- The job endpoint rejects any call without the secret.
- Secrets live only in Vercel and Supabase settings and never in git. The Supabase service key is used only by the API and never sent to the browser.
- HTTPS only (Vercel default), with rate limits on login (Supabase) and uploads.
- Nightly off-site database backups, with a restore that has been tested once.
- You (admin) can see data in the Supabase dashboard. Testers should know that, so it's on the privacy page.

## 6. What stays the same
- Every screen, the Calm design, and all features: Journal, Playbook, Calendar, Time log, Expenses, Payouts, check-ins, imports and reports.
- The domain logic in `packages/domain`: P&L from fills, grading, stats, recurrence and financial-year maths, with its tests.
- The Hono API routes. They move from an always-on process to Vercel functions with the same code.
- Your local app on `main` keeps working throughout.

## 7. Risks and open questions
- **Phase 1 is the riskiest part.** Converting about 185 database calls can introduce subtle bugs, so the existing tests are run against Postgres before anything else moves.
- **Free-tier limits** could change or prove tight:
  - Supabase pausing is covered by the keep-alive.
  - Vercel's function allowance is affected by the per-minute tick.
  - Function time limits matter for big exports or imports.
  - The fallback is to slow the tick or move to a paid tier.
- **Reminder timing:** jobs run once a minute at best, so reminders and check-ins can be up to a minute late. Slower if the tick has to be slowed.
- **Cold starts:** the first request after a quiet spell can take a second or two longer on Vercel.
- **iPhone push** only works after "Add to Home Screen". The onboarding explains this.
- **Exports:** large full-data export zips may hit function time or memory limits. A dozen users' data should be fine, but this needs testing with your real data.
- **Tax features for non-Australian testers** won't make sense. They can ignore Expenses for the beta.
- **Hard-coded Perth time:** anything still assuming Perth after Phase 4 is a bug. The tests should catch these.

## 8. Suggested order of work
1. ~~Confirm the decisions in section 2.~~ Done (8 Oct 2026).
2. Phase 1 on the `cloud` branch, with all tests green on Postgres. No accounts are needed yet.
3. Phase 0: you create the GitHub, Vercel and Supabase accounts, then I wire them up.
4. Phases 2 and 3: login, scoping and files, with the isolation tests passing.
5. Phases 4 and 5: time zones, the job tick and push.
6. Phases 6 and 8: replace the Mac-only pieces and deploy to a Vercel preview address. You use it yourself for a few days.
7. Phase 9: import your real data, then compare.
8. Phase 7: the mobile pass, informed by using it on your own phone.
9. Phase 10: invite the community.
