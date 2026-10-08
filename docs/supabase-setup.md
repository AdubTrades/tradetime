# Setting up Supabase for the TradeTime beta

This turns on sign-in. The steps are yours to do: they involve creating an account and handling keys. The dashboard wording below is from late 2026, so a few labels may differ slightly.

## 1. Create the project
1. Sign up or log in at **supabase.com**.
2. Click **New project**:
   - **Name:** `tradetime-beta` (anything is fine).
   - **Database password:** use *Generate a password*, then save it in your password manager. You'll need it later for the database connection.
   - **Region:** **Asia-Pacific (Sydney)**.
   - **Plan:** Free.
3. Wait a minute or two for it to start.

## 2. Sign-in settings
In **Authentication**:
1. **Sign In / Providers → Email**:
   - Leave **Email** enabled.
   - Turn **Allow new users to sign up** **off**. The beta is invite-only, so nobody can create an account from the sign-in page.
   - Leave **Confirm email** on.
2. **URL Configuration**:
   - **Site URL:** `http://localhost:5173` for now. Change it to the Vercel address when we deploy (Phase 8).
   - **Redirect URLs:** add `http://localhost:5173/**`.
3. **Emails:** the built-in sender only allows a few emails per hour. That's fine for trying it yourself. Before inviting the community we'll connect a free email service (Resend) under **Authentication → Emails → SMTP Settings** (Phase 10).

## 3. Copy the settings into the app
In **Project Settings → API Keys** (and **Data API** for the URL), you need:
- the **Project URL**, like `https://abcdefgh.supabase.co`
- the **Publishable key**, which starts `sb_publishable_…`. Older projects call it the *anon* key.

Both are safe to have in the browser: the data is protected by sign-in and row-level security. **Don't** copy the *secret* or *service_role* key anywhere; the app doesn't use it.

Create these two git-ignored files yourself, based on the `.env.example` files next to them:

**`apps/web/.env.local`**
```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

**`apps/server/.env.local`**
```
SUPABASE_URL=https://<your-project>.supabase.co
```

Leave `DATABASE_URL` empty for now. Local development keeps using the built-in PGlite database, and only sign-in goes through Supabase. We point the app at Supabase's database when we deploy.

Then restart the dev server:
```bash
pnpm dev
```

## 4. Invite yourself
1. Go to **Authentication → Users → Add user → Send invitation**, and enter your email.
2. Open the email and click the link. TradeTime opens on **Welcome to TradeTime**: choose a password.
3. You're in, with a fresh, empty account: default lists only, no trades.

To try it with sample data, find your user id (the UUID on the **Users** page), then run:
```bash
pnpm --filter @tc/server seed:demo <your-user-id>
```

Your real data comes across in Phase 9.

## How sign-in works (for reference)
- The web app signs in with Supabase and sends the access token on every request. The server checks it against your project's public signing keys and works out who you are.
- Each request then runs in the database as that user only, enforced by row-level security.
- Signing out, or a session expiring, returns you to the sign-in screen and clears anything cached in the browser.
- Without the two `.env.local` files, the app runs as before, as a single local user with no sign-in.
