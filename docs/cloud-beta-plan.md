# TradeTime community beta — Supabase "middle path" plan

**Goal:** put TradeTime online so about a dozen traders from your community can use it, each with their own private account and data, from any computer or phone, for free or close to it. The product features stay as they are. This is also the foundation for a later paid, two-tier product, so nothing here is throwaway.

**Status:** decisions confirmed (7 Oct 2026). Nothing has been built yet.

---

## 1. The shape of it

```
 Testers' browsers (any PC, Mac, phone)          Supabase (Sydney region)
 ┌──────────────────────────────┐               ┌───────────────────────────────┐
 │ TradeTime web app            │──login──────▶ │ Auth: accounts, passwords,    │
 │ (same React app, installable │               │       email, password reset   │
 │  to the home screen)         │               ├───────────────────────────────┤
 └──────────────┬───────────────┘               │ Postgres: everyone's data,    │
                │ HTTPS + login token           │   every row tagged by user,   │
                ▼                               │   row-level security          │
 ┌──────────────────────────────┐   SQL         ├───────────────────────────────┤
 │ TradeTime server (always on) │─────────────▶ │ Storage: screenshots, receipts│
 │ the existing Hono server,    │──files──────▶ │   in private per-user folders │
 │ Sydney region                │               └───────────────────────────────┘
 │ - API (checks who you are)   │
 │ - background jobs (reminders,│──push──▶ testers' browsers / phones
 │   check-ins, renewals, FRED) │
 │ - serves the web app itself  │
 └──────────────────────────────┘
```

**Why this split:**
- **Supabase does the parts that are risky to build yourself:** login, password resets and email verification; the database; private file storage.
- **The existing server stays.** It keeps its API, its background jobs (which need an always-on process) and serves the website, so there's one thing to deploy.
- **Vercel isn't needed for the beta.** The server can serve the website. Vercel stays an option later if you want the site on a CDN.

## 2. Decisions (confirmed 7 Oct 2026)

| # | Decision | Confirmed |
|---|---|---|
| 1 | Where the server runs | **Fly.io (Sydney)**, about US$5 a month and always on. (Railway is the fallback; Oracle Cloud Always Free is the free option, with more setup and less dependability.) |
| 2 | Who can sign up | **Invite only.** You add testers' emails, they get an invite link, and public sign-up is off. |
| 3 | Login methods | Email and password, plus a magic link. Google sign-in is optional. |
| 4 | Testers outside Australia? | The beta stays **Australia-centric**: Australian financial year, GST and ATO-style exports. Time zone and trading-day rollover become per-user settings, so non-Perth traders still work. |
| 5 | Your own data | You become **user #1**: your current data is imported into your account. Your local installed app keeps running until the cloud version has proven itself. |
| 6 | Demo mode | Replace the separate demo server with a **demo account** that resets nightly, which also works as a public "try it" login later. |
| 7 | Web address | Start on the host's free address (e.g. `tradetime.fly.dev`). Add your own domain later for about US$15–20 a year. |

## 3. Phases

Estimates assume focused build sessions like the ones so far, and include testing. Each phase ends in a working state.

### Phase 0 — Accounts and setup (half a day)
- Create the Supabase project (Sydney), the server host account (Fly.io or Railway), error monitoring (Sentry free tier) and an uptime monitor (Better Stack or UptimeRobot free tier).
- Work on a `cloud` branch so the local app on `main` is untouched.
- Store secrets (database URL, Supabase keys, FRED key, push keys) in the host's secret settings, never in the repo.

### Phase 1 — Move the database to Postgres (4–6 days, the biggest phase)
Today: 31 tables in SQLite, about 185 database calls written in SQLite's "instant answer" style, 23 transactions and 8 migrations.
- **Schema:** rewrite the Drizzle schema for Postgres. Money stays in integer cents, and times stay as UTC ISO strings to keep changes small.
- **Per-user data:** add a `user_id` to every table that belongs to someone, with indexes. Uniqueness rules become per user; for example, "one running session" becomes one per user.
- **Shared vs per-user tables:**
  - Shared by everyone: market events (one FRED feed for all) and the contract specs (ES, NQ, MES, MNQ).
  - Seeded into each new account: session types, check-in questions, list items (moods, mistakes, expense categories), calendar event types, and the default settings.
- **Async conversion:** convert every database call and transaction in the server to the network ("async") style. This is mechanical but touches every server module.
- **Tests:** run the existing tests (150 today) against a real in-process Postgres (PGlite), so they stay fast and don't need Docker.
- **Fresh migration history:** start a new Postgres one (`0000_init` for Postgres) and keep the SQLite migrations on `main`.

### Phase 2 — Login and per-user scoping (3–4 days)
- **Web login screens:** sign in, magic link, forgot or reset password, and accept invite, using Supabase's JS client and styled in the Calm design.
- **Server identity check:** verify the Supabase login token on every request, find the user, and pass `userId` into every service call. No request reaches data without it.
- **Row-level security as a second lock:** each request's database work runs in a transaction that sets the user's identity, and Postgres policies (`user_id = auth.uid()`) refuse other users' rows even if the app code had a bug.
- **Isolation tests:** create two users and prove neither can read, edit or delete the other's trades, sessions, expenses, files or events through any API route.
- **Invites:** you invite testers from the Supabase dashboard. A small "Admin" page for you is optional.

### Phase 3 — Files to Supabase Storage (1–2 days)
- **Private bucket:** screenshots, receipts and imports go in a private bucket under `user_id/…`, and the app shows them through short-lived signed links.
- **Unchanged behaviour:** de-duplication by content hash stays (now per user), and the drop, paste and upload interface doesn't change.
- **Limits:** per-file size limits and a per-user storage cap for the beta, to stay inside the free tier.

### Phase 4 — Per-user time zone and settings (1–2 days)
- **Time zone setting:** Perth is hard-coded in 35 places, through `LOCAL_ZONE`. It becomes a user setting, defaulting to the browser's time zone, alongside the trading-day rollover time that's already a setting.
- **What it affects:** check that the trading day, financial-year boundaries, calendar times, reminders and economic-event times all follow the user's zone. The existing time and daylight-saving tests get extra cases for a non-Perth user.
- **Economic events:** fetched once by the server using your FRED key and shown to everyone in their own time zone. The per-user FRED key setting goes away.

### Phase 5 — Background jobs and notifications (2–3 days)
- **Jobs for every user:** jobs run per user on the always-on server, as they do today but looping over accounts: long-session "still going?", check-ins, calendar reminders, recurring expenses, renewal reminders, and backups of the shared database. The FRED refresh stays one shared job.
- **Push notifications:** macOS pop-ups become **web push**. Testers allow notifications once in their browser.
  - Works on Windows, Mac and Android.
  - On iPhone it works once the app is added to the home screen (iOS 16.4 or later).
- **Fallbacks:** the in-app check-in card and the floating timer still work without push. Email reminders (via Resend, free tier) are an optional extra for renewals.

### Phase 6 — Replace the Mac-only pieces (1–2 days)

| Today (on your Mac) | In the cloud |
|---|---|
| macOS notifications (`notify.ts`, node-notifier) | Web push (Phase 5) |
| "Choose folder" for backups (AppleScript) | Removed |
| Scheduled zip backups to iCloud or Drive | Nightly dump of the whole database to cloud storage (Cloudflare R2 or Backblaze, free tier), plus Supabase's own backups. Each user can still **download a full export** of their data. |
| Restore a backup by swapping the data folder | **Import an export into your account**, used to bring your own data across and to restore a single user |
| launchd starts the app at login | The host runs and restarts the server |
| Separate demo server on port +3 | Demo account, reset nightly |

### Phase 7 — Mobile pass (2–3 days)
- **Installable app:** add an app manifest, icons and a small service worker so it can be installed from the browser on phone or desktop.
- **Phone layouts for key screens:**
  - Dashboard: Tonight card, timer, to-dos.
  - Journal: day cards become stacked rows instead of wide columns.
  - Trade form: a full-screen sheet.
  - Calendar: an agenda list on phones instead of the month grid.
  - Expenses: compact rows.
  - Time log: timer and sessions.
- **Touch targets:** at least 44px, as the design already uses.

### Phase 8 — Deploy and operations (1–2 days)
- **Container and deploy:** a Dockerfile for the server and web build, and a one-command deploy. Database migrations run on deploy.
- **Region and checks:** Sydney region, HTTPS, a health check, automatic restarts.
- **Monitoring:** Sentry for errors in the server and browser, an uptime alert to your phone, and logs you can read.
- **Staging (optional):** a second Supabase project to try changes before they reach testers.

### Phase 9 — Bring your data across (half a day)
- **Import script:** reads your local `~/TradingCompanion` SQLite database and attachments, writes them into your cloud account, and uploads files to Storage.
- **Checks:** compare counts and totals between old and new (trades, P&L per day, sessions and hours, expenses per FY, examples and screenshots).
- **Rehearse first:** run it against a copy, never the live folder, until the numbers match.

### Phase 10 — Beta launch (1 day)
- **Onboarding:** first-run setup for time zone and rollover, the first prop firm account, the first Play, and the notification permission prompt.
- **In-app feedback:** a "Send feedback" link (email or your Discord) and a short "known issues" note.
- **Simple privacy and terms page:** what's stored, who can see it (only the user, plus you as admin for support), how to export or delete data, and a clear "journal, not financial or tax advice" disclaimer.
- **Account deletion:** a "Delete my account and data" control.
- **Invite emails** to the testers.

## 4. Time and cost

**Build time:** roughly **3–4 weeks** of sessions in total. Phase 1 is the bulk of it, and phases 2, 3 and 7 could overlap.

**Running cost for the beta.** Free tiers change, so check them when we start:

| Item | Beta (about 12 users) | Notes |
|---|---|---|
| Supabase | Free | Roughly 500 MB database, 1 GB file storage, 50k monthly users. **Free projects pause after about a week with no activity**, so an active community is fine, but a quiet week means a short wake-up. |
| Server (Fly.io or Railway) | About US$5 a month | Free with Oracle Cloud Always Free, at the cost of more setup and less reliability. |
| Backups (R2 or Backblaze) | Free | Within the free allowance. |
| Email (Resend) | Free | Only needed for email reminders. |
| Sentry and uptime monitor | Free | |
| Domain (optional) | About US$15–20 a year | |
| **Total** | **About US$0–5 a month** | |

When it becomes a paid product, expect Supabase Pro (about US$25 a month, no pausing, daily backups), plus a bigger server and Stripe fees.

## 5. Security checklist (beta level)
- Every API route requires a valid login, and every query is filtered by `user_id`, **and** Postgres row-level security enforces the same.
- Automated tests prove two users can't see each other's data, including files.
- Files are in a private bucket and only served through short-lived signed links.
- Secrets live only in the host's settings and never in git. The Supabase service key never goes to the browser.
- HTTPS only, secure cookies or tokens, rate limiting on login and uploads (Supabase handles login limits).
- Nightly off-site database backups, with a restore that has been tested once.
- You (admin) can see data in the Supabase dashboard. Testers should know that, so it's on the privacy page.

## 6. What stays the same
- Every screen, the Calm design, and all features: Journal, Playbook, Calendar, Time log, Expenses, Payouts, check-ins, imports and reports.
- The domain logic in `packages/domain`: P&L from fills, grading, stats, recurrence and financial-year maths, with its tests.
- Your local app on `main` keeps working throughout.

## 7. Risks and open questions
- **Phase 1 is the riskiest part.** Converting about 185 database calls can introduce subtle bugs, so the existing tests are run against Postgres before anything else moves.
- **Supabase free-tier pausing** could annoy testers in a quiet week. If it does, the fix is Supabase Pro or a small scheduled "keep-alive".
- **iPhone push** only works after "Add to Home Screen". The onboarding needs to explain this.
- **Reports:** the printable PDF reports use the browser's print-to-PDF, so they work anywhere, but they need a quick check on phones.
- **Tax features for non-Australian testers** won't make sense. They can ignore Expenses for the beta.
- **Hard-coded Perth time:** anything still assuming Perth after Phase 4 is a bug. The tests should catch these.

## 8. Suggested order of work
1. ~~Confirm the decisions in section 2.~~ Done.
2. Phase 0, then Phase 1 with all tests green on Postgres.
3. Phases 2 and 3: login, scoping and files, with the isolation tests passing.
4. Phases 4 and 5: time zones, jobs and push.
5. Phases 6 and 8: replace the Mac-only pieces and deploy to a staging address. You use it yourself for a few days.
6. Phase 9: import your real data, then compare.
7. Phase 7: the mobile pass, informed by using it on your own phone.
8. Phase 10: invite the community.
