# Future additions

Ideas agreed for later but not scheduled yet. Newest first. When one is picked up, move its decisions into the
relevant plan or `CLAUDE.md` and delete it here.

## Live charts in TradeTime via Interactive Brokers (to replace TradingView)
*Raised 3 Nov 2026.* The owner charts on TradingView mainly for 30-second charts (its top tiers), and dislikes
NinjaTrader's charting. Every drawing tool used live is already built for the backtester. The TradingView sub runs to the end of
December 2026, and its CME data add-on ends about a week after cancelling. Decision pending.
- **Feed:** an IBKR Australia account, at least US$500 equity, and the non-professional **US Securities Snapshot and
  Futures Value Bundle** (US$10/month plus GST; real-time top of book for CME/CBOT/COMEX/NYMEX; waived at US$30/month IB
  commissions). Skip depth (Futures Value PLUS) and the standalone CME Real-Time item. Not pro-rated.
- **Build:** IB Gateway on the Mac, plus a small local helper that streams **tick-by-tick trades** (every trade, so 30s
  candles, highs, lows and volume are exact) to the TradeTime chart on that computer, with today's earlier bars from
  IB history and older days from the stored files. A "Live" mode on the backtesting chart reuses all the drawing tools and
  templates, and shows when the feed is stale.
- **Expectations:** roughly 0.25–0.5 s behind the exchange from Perth, the same as TradingView. Mac only (Gateway must be
  running). IB streams data to one session at a time, so logging into IB mobile can cut the feed.
- **Alternative:** Databento live (Standard plan, about US$199/month), which runs anywhere but costs more than TradingView.
- **Plan:** owner opens the account and adds the bundle, Claude builds the helper and Live mode, then a week side by
  side with TradingView before cancelling.

## Broker auto-sync (Tradovate first, then Rithmic)
*Raised 20 Oct 2026.* Pull fills in automatically, the way TradeZella does, instead of exporting a CSV from NinjaTrader.
- **How TradeZella does it:** periodic sync, not live. It re-syncs every 3 hours, with a manual refresh at most every
  15 minutes. It has three kinds of connection:
  - **Tradovate API (also used for NinjaTrader accounts):** a Tradovate sign-in window (OAuth, with 2FA) on the user's
    behalf, then it reads their fills.
  - **Rithmic, DXtrade and TradeLocker:** the user's platform login, held by the journal.
  - **TopstepX/ProjectX and MetaTrader:** an API key the user pastes in.
- **Relevance:** Lucid accounts run on Tradovate/NinjaTrader or Rithmic, depending on the account type.
- **Tradovate route (preferred):**
  - The developer forum reports that OAuth app credentials are only given to approved **NinjaTrader Ecosystem**
    members, after an application and review.
  - Tradovate's personal API add-on excludes prop and evaluation accounts.
  - **Next step:** apply to the Ecosystem as a vendor, then confirm prop-firm accounts can be read through an approved app.
- **Rithmic route:**
  - Needs Rithmic's conformance approval before connecting to live or paper accounts.
  - The issuing broker or prop firm decides whether third-party connections are allowed, and some charge about $100 a month.
  - We'd store testers' platform logins, a serious security responsibility: encrypted at rest, and never logged.
- **Build notes:** sync through the existing scheduler (`runTick`), feed fills into the existing import pipeline
  (copy-trade merging, `fill.external_id` dedupe and account aliases already work), and keep the CSV import as a fallback.
  It could sync more often than every 3 hours.
- **Sources** (researched 20 Oct 2026):
  - TradeZella help: [Tradovate sync](https://help.tradezella.com/en/articles/9557659-tradovate-how-to-sync-your-tradovate-account-with-tradezella),
    [same-day trades](https://help.tradezella.com/en/articles/8542897-broker-sync-same-day-trades)
  - Tradovate: [forum: 3rd-party API access](https://community.tradovate.com/t/api-access-for-3rd-party-app-development/11941/8),
    [support: API access](https://support.tradovate.com/s/article/Tradovate-API-Access?language=en_US)
  - Rithmic: [API suite](https://www.rithmic.com/products/api-suite)

## Open positions tab on Home (Recent trades card)
*Raised 20 Oct 2026.* A second tab in the Recent trades card listing positions you're still in.
- **The catch:** TradeTime only stores finished trades (P&L, grade and stats all come from a flat position), and there are
  no live prices or broker connection.
- **Options discussed (not yet chosen):**
  - Log a trade open with just the entry, close it later by adding the exit. Open trades stay out of stats until closed.
  - Show unfinished trades from the last NinjaTrader import (fills after the last flat point).
  - Both.
- **Unrealised P&L:** probably just show the position (contract, direction, size, entry, stop/target, time open), since
  there are no live prices. The alternative is a price you type in, which goes stale quickly.

## Other instruments
- **US stocks (NYSE, Nasdaq):** sized in shares, $0.01 tick, per-share or per-order fees. The symbol list comes from
  Nasdaq's free symbol directory.
- **OANDA commodity CFDs** (XAU/USD, WTI, Brent, natural gas, grains…): sized in units, P&L converted to USD like forex.
  Each broker defines CFD sizes differently, so check OANDA's specs.

## Account currency
Accounts are assumed to be in USD. If a broker account is in AUD (common for Australian FOREX.com/OANDA accounts), add a
currency per account, so P&L for that account is stored and shown in its own currency. This touches stats and reports.

## Database tidy-ups (when there's real data)
- Supabase's performance check lists 22 links between tables without a matching index, mainly affecting deletes of
  parent records. Revisit once testers have real data.
- Leaked password protection in Supabase Auth is off (possibly a paid feature). Turn it on if the plan allows.
