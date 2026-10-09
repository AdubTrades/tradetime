# Putting TradeTime online (Vercel + Supabase)

These steps are yours to do: they involve creating accounts and handling keys. Where a step needs a command run in this
repo, say so and I'll do it. Allow about an hour. Dashboard wording is from late 2026, so a few labels may differ.

**Before you start:** finish [`supabase-setup.md`](supabase-setup.md) sections 1–4 (project in Sydney, sign-in
settings, storage SQL, and inviting yourself).

**How it fits together:**
- **Vercel** serves the web app and runs the API as one function in Sydney, next to the database.
- **Supabase** holds the database, sign-in and files, and calls the API every minute for reminders.
- **GitHub** holds the code. Every push to the `cloud` branch deploys, and production deploys apply database
  migrations first.

## 1. GitHub
1. Create a **private** repository at github.com/new, for example `tradetime`, with no README, licence or .gitignore.
2. Tell me the repository URL. I'll add it as the remote and push `main` (the Mac app) and `cloud`.
3. In the repository, go to **Settings → General → Default branch** and switch to **`cloud`**. GitHub only runs
   scheduled workflows (the nightly backup and keep-alive) from the default branch.

## 2. Vercel
1. Sign up at vercel.com **with your GitHub account**, on the free **Hobby** plan.
2. Go to **Add New → Project** and import the repository. Leave **Framework Preset: Other** and the root directory as is.
   The build and install commands come from `vercel.json`.
3. Before the first deploy, open **Environment Variables** and add the values below for the **Production** environment
   only. Preview deployments then show a "not configured" message instead of using your live data.

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase → **Connect → Transaction pooler** (port 6543), with your database password filled in |
| `DATABASE_MIGRATION_URL` | Supabase → **Connect → Session pooler** (port 5432), same password. Used only by the deploy's migration step. |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `VITE_SUPABASE_URL` | same as `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same as `SUPABASE_PUBLISHABLE_KEY` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | from `pnpm --filter @tc/server vapid-keys` (supabase-setup §5). Keep them forever. |
| `JOBS_SECRET` | a new value from `openssl rand -hex 32` |
| `DEMO_SECRET` | another new value from `openssl rand -hex 32` |
| `DEMO_PUBLIC` | `1` to offer the demo on the sign-in page, otherwise leave it out |
| `FRED_API_KEY` | your FRED key |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (makes Vercel use the repo's pnpm version) |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | optional, see step 7 |

   Never add `SUPABASE_SECRET_KEY` to Vercel. The app doesn't need it.
4. Go to **Settings → Git → Production Branch** and set it to **`cloud`**.
5. Click **Deploy**, or push to `cloud`. When it finishes, open `https://<your-project>.vercel.app/api/health/ping`. It
   should say `{"ok":true,"db":"up",…}`.

## 3. Point sign-in at the live address
In Supabase, go to **Authentication → URL Configuration**:
- **Site URL:** `https://<your-project>.vercel.app`
- **Redirect URLs:** add `https://<your-project>.vercel.app/**`. Keep the localhost one for development.

Then sign in at the live address with the account you invited in supabase-setup §4.

## 4. Turn on scheduled jobs
In Supabase's **SQL Editor**, run [`packages/db/supabase/cron.sql`](../packages/db/supabase/cron.sql) with
`<APP_URL>` replaced by your Vercel address and `<JOBS_SECRET>` by the same value you gave Vercel. Check it's working
with the query at the bottom of that file: you should see a successful run each minute.

## 5. Backups and keep-alive (GitHub Actions)
In the repository, go to **Settings → Secrets and variables → Actions**.
- **Secrets:**
  - `SUPABASE_DB_URL`: the Session pooler string (port 5432).
  - `BACKUP_PASSPHRASE`: a long random passphrase. Keep it in your password manager, because a backup can't be opened
    without it.
- **Variables:** `APP_URL`, your Vercel address with no trailing slash.

Then, under **Actions**, run **Database backup** and **Keep alive** once each with **Run workflow** to check they work.
GitHub emails you if either fails later.

## 6. Uptime alert on your phone
1. Sign up for **UptimeRobot**, which is free, and install its phone app.
2. Add an **HTTP(s) monitor** for `https://<your-project>.vercel.app/api/health/ping`, checked every 5 minutes.
3. Turn on push alerts in the app. You'll hear about it within minutes if the site or the database goes down.

## 7. Error reports (optional)
1. Create a free **Sentry** account and a project of type **Browser JavaScript**.
2. Copy its DSN into both `SENTRY_DSN` and `VITE_SENTRY_DSN` on Vercel, then redeploy.
3. Errors in the API, the scheduled jobs and the browser then appear in Sentry, with the user's id but no email or data.

## 8. On your phone
Open the Vercel address and sign in.
- **iPhone (Safari):** tap **Share → Add to Home Screen**, then open TradeTime from the home screen.
- **Android (Chrome):** go to **Settings → Install the app**.

Then go to **Settings → Notifications → Turn on notifications** and send yourself a test.

## 9. Bring your Mac data across
Do this once you're signed in on the live site. Until you've checked the result, keep using the Mac app as normal.
1. In the **Mac app**, go to **Settings → Backups → Back up now**. The zip lands in your backup folder.
2. Convert it (or ask me to):
   ```bash
   pnpm --filter @tc/server convert:mac "/path/to/tradetime-backup-….zip"
   ```
   This first rehearses the import in a throwaway database and prints the Mac figures beside the cloud figures:
   trades and days, net P&L, sessions and hours, expenses per financial year, payouts and files. It only writes the
   export (to `~/Downloads/tradetime-from-mac-….zip`) if every record comes back unchanged.
3. On the **live site**, go to **Settings → Your data → Import an export…**, choose that file and confirm. This replaces
   the empty account with your data, screenshots included.
4. Spot-check a few screens against the Mac app: the journal, last month's calendar, the time log FY total and the
   expenses FY summary.
5. From then on, use the cloud version only. Anything logged in the Mac app afterwards won't come across unless you
   repeat these steps, which would replace the cloud data again. The Mac app can keep running, but quit it from the
   menu bar if you don't want reminders twice.

Each account can store 100 MB of files during the beta. If your screenshots come to more, the converter warns you;
raise `TC_STORAGE_CAP_MB` on Vercel before importing.

## Day to day
- **Updates:** I push to `cloud` and Vercel deploys in about a minute. Production deploys apply any new database
  migrations before the new version goes live.
- **Rolling back:** in Vercel, go to **Deployments**, pick an earlier one, and choose **Promote**. Database migrations
  only go forward, so tell me before rolling back across one.
- **Logs:** Vercel → **Logs** shows API errors, and Supabase → **Logs** shows database and sign-in activity.
- **Limits:** Vercel's Hobby plan is for non-commercial use. That's fine for a free beta, but it needs the Pro plan if
  TradeTime becomes paid. The Supabase free tier gives 500 MB of database and 1 GB of files; with a dozen traders,
  we're far inside both.
