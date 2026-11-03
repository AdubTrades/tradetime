# Backtesting page: plan

*Agreed 1 Nov 2026 (5 years, spot crypto at 1 minute).* A built-in bar-replay backtester like TradeZella's, so the TradeZella subscription can go. For the
owner only, and desktop only. Simulated trades save to the journal under the **Backtesting** account.

## Decisions
| Topic | Decision |
|---|---|
| Users | Owner only (personal use keeps data licensing simple). The page is hidden for every other account. |
| Instruments | CME futures NQ, MNQ, ES, MES and GC (MNQ, MES and MGC share NQ, ES and GC prices, so only NQ, ES and GC are stored). Spot crypto BTC, ETH and SOL. |
| History | Rolling 5 years: a monthly job adds the latest month and drops anything older than 5 years. |
| Replay | Futures: 30-second steps, timeframes 30s, 1m, 2m, 5m, 15m, 1h, 4h, 12h, 1D, 1W and 1M. Crypto: 1-minute steps, timeframes 1m, 5m, 15m, 1h, 4h, 12h, 1D, 1W and 1M. Adjustable speed. |
| Chart | TradingView Lightweight Charts (open source, no approval needed), styled to feel like TradingView. |
| Drawing tools | Horizontal lines with labels, rectangles with a midpoint line, and a long/short risk-reward (RR) tool. |
| Orders | Market, limit, stop, brackets (target and stop loss), breakeven; sizing by contracts or by risk. |
| Device | Desktop only. |

## Data
- **Futures source:** Databento, CME Globex MDP 3.0 dataset, `ohlcv-1s` schema. Front-month continuous symbols by volume
  (`NQ.v.0`, `ES.v.0`, `GC.v.0`), so only the active contract is downloaded.
- **Futures cost:** pay-as-you-go historical data, from $0.50/GB, billed on uncompressed size (1-second bar records are 56
  bytes). Estimate for 5 years of NQ, ES and GC: about $5–10 one-off. Get the exact figure with Databento's free cost check
  (`metadata.get_cost`) before buying. Monthly top-ups cost well under $1. Don't take the $199/month subscription.
- **Crypto source:** Binance public data archive (data.binance.vision), free monthly 1-minute kline files for BTCUSDT,
  ETHUSDT and SOLUSDT, with no key. Prices are in USDT (within cents of USD); label them as such. Coinbase (USD) is the
  alternative if exact USD matters.
- **Processing:** futures: 1-second bars become 30-second bars (UTC). Crypto stays as 1-minute bars. One compressed file
  per instrument per day. Estimate for 5 years: about 150 MB for futures and about 110 MB for crypto, within Supabase's
  free 1 GB.
- **Higher timeframes:** the backfill also writes 1-hour bars (one file per instrument per year) and daily bars (one file
  per instrument), so 12h, 1D, 1W and 1M charts load instantly. During replay, the bar still forming is built live from
  the 30-second or 1-minute data up to the replay time.
- **Bar boundaries (match TradingView):** CME futures use the exchange session: a day runs from 18:00 to 17:00 New York
  time (Sunday evening counts toward Monday), weeks end Friday 17:00 New York, and 12h/4h bars count from the 18:00 open.
  Crypto uses UTC: days, weeks (Monday) and months start at 00:00 UTC, and 12h bars at 00:00 and 12:00 UTC.
- **Storage:** a private Supabase Storage bucket, `market-data/<symbol>/<yyyy>/<yyyy-mm-dd>.json.gz`. The page loads the
  days it needs through signed links.
- **Updates:** a monthly GitHub Action downloads last month, writes the files and drops days older than 5 years. It uses
  `DATABENTO_API_KEY` and `SUPABASE_SECRET_KEY` as GitHub secrets; neither key is ever in the web app. The first
  backfill runs from the owner's Mac.
- **Rolls:** a volume-based continuous series switches contract at the roll, so there is a price gap on roll days. That's
  fine for intraday replay. Show the active contract (e.g. NQZ26) on the chart.

## Stages (each usable before the next)
1. **Data and replay:** backfill script, storage, and the page with the chart. Pick a date and time, step 30s at a
   time or play at 1×/2×/5×/10×, and switch timeframes. The higher-timeframe bar being built shows as it forms, like
   TradingView's replay.
2. **Simulated trading:** order panel (market/limit/stop, target and stop loss, breakeven, contracts or risk sizing) and
   fills from 30-second bars. If a bar touches both stop and target, the fill depends on which side was nearer to the
   bar's open, and the trade is flagged. Orders, open positions and closed positions tabs, with balance and realised
   P&L.
3. **Journal and sessions:** each closed trade saves to the Backtesting account (fills, times, fees, R from the stop,
   needs review). Spot crypto needs decimal sizes (e.g. 0.05 BTC); the journal currently only takes whole-number
   quantities, so this stage adds spot pairs (BTCUSDT, ETHUSDT, SOLUSDT) with fractional sizes. Named sessions (e.g. "FVGC Practice") each keep their own balance, replay time and drawings.
4. **Drawing tools:** horizontal lines with labels, rectangles with a midpoint line, and the long/short RR tool, built as
   Lightweight Charts plugins (it has no drawing tools of its own). Drawings are saved per session.

## Progress
- **Stage 1 (crypto done, futures waiting on data):** bar maths `packages/domain/src/bars.ts`; files and owner check
  `apps/server/src/marketData.ts`; route `GET /api/backtest/data/*`; backfill
  `pnpm --filter @tc/server market-data crypto [--from YYYY-MM] [--upload]`; page `/backtesting`
  (`apps/web/src/pages/backtest/`). Bucket SQL: `packages/db/supabase/market-data.sql`.
- **Horizontal lines (pulled forward from stage 4):** ray or full line, drawn from the left toolbar (Alt+J / Alt+H),
  magnet to OHLC, drag to move (handle moves the start), double-click for settings (Style, Text, Coordinates,
  Visibility, live preview, Cancel reverts), right-click for templates, Delete to remove. Templates ("Save as…",
  "Apply defaults") and lines per instrument are saved to the account (`state.backtest.*` settings rows). New lines
  take the last look used. Lines stay hidden while the replay is before their start bar.
- **Stage 2 (simulated trading):** engine `packages/domain/src/sim.ts` (netted position per contract, brackets,
  limit/stop orders, fills from base bars, ambiguity flag, R from the first stop); order ticket and the Positions /
  Orders / History panel in `pages/backtest/SimTrading.tsx`; account per instrument saved via `/api/backtest/sim/:id`.
  Futures fees per side come from the user's contracts; crypto uses a % fee per side (default 0.1%). Going back in the
  replay is off while a position or order is open. Market orders fill at the last closed base bar's close.
- **Draggable levels:** a position's SL/TP, a working order (its SL/TP move with it) and an order's own SL/TP can be
  dragged on the chart; labels show the dollar result at that price (e.g. "SL −$300.00").
- **Stage 3 (journal and sessions):** named sessions (`apps/server/src/backtestSessions.ts`), each with one
  instrument (trades always go to the Backtesting account, created if missing), its own practice account, replay time,
  timeframe and lines. Saving the practice account journals each newly closed trade once (`source: 'backtest'`,
  needs review, fees and first stop/target carried over, note "Backtest: <session>"); `backtest.journaled.<id>`
  remembers which, so deleting one in the journal doesn't bring it back. Spot pairs (BTCUSDT, ETHUSDT, SOLUSDT) are in
  the contract catalogue with fractional sizes (migration 0007 makes fill and max sizes decimals; `fractionalSizes`
  allows them only for spot crypto).
- **Stage 4 (drawing tools):** rectangles (drag or click two corners; middle line, fill/opacity, border, label,
  extend right; corners resize, body moves) and long/short position tools (click to place; entry, stop, target and
  width handles; size from a dollar risk on the chosen contract; shows "Target hit"/"Stop hit" as the replay reaches
  them; right-click "Place order from this" puts a limit or stop order with that bracket). Saved with the session's
  lines (`shapes` in the drawings doc). Rectangle look and RR risk carry over to the next one.
- **Fib retracement:** TradingView-style (level 1 at the first point, 0 at the second; 24 levels with value, colour
  and on/off; trend line, level line, extend, one colour, background, reverse, prices, levels as values or %, label
  position, text, font size). New Fibs take the last levels and look (`fibLast`).
- **Trend line:** colour, thickness, dash, arrow ends, extend, middle point, price labels on the axis, stats (price
  range, % change, ticks, bars, date/time range, angle; position; always or only when selected), a label along the
  line, templates (Alt+T). TradingView's "Distance" stat is left out (it overlaps bars and date/time range).
- **Templates:** lines, rectangles, Fibs and trend lines each have their own (Save as / Apply defaults / remove in
  settings, one-click apply from the right-click menu), stored in the line-tools document.
- **Session description and strategy:** sessions have a description and a Playbook Play (strategy, "Create new
  strategy" makes one from a name); every trade journaled from the session gets that Play. Editable later with
  "Edit session…".
- **Chart snapshots:** camera button (top right, Alt+S) captures the chart with a caption band (session, replay time,
  symbol, timeframe, OHLC) as a JPEG; it attaches to the open position (or the latest closed trade) and is linked to the
  journal trade's Screenshots when the trade is saved, or straight away if it already was. Automatic snapshots at entry
  and exit are on by default (toggle in the camera's ▾ menu, `autoSnapshots`). Snapshots count towards the storage cap.
- **Daily NQ top-up (3 Nov 2026):** GitHub Action `.github/workflows/market-data.yml` runs
  `market-data futures --daily --buy --upload` at 09:00 UTC Tue–Sat: each CME session after the last stored one
  (read from the bucket's daily summary), merged into the day files and summaries; stops if a run would cost more than
  US$2 (a session is about US$0.20). Secrets: DATABENTO_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY. The monthly backfill skips months the daily job filled and merges summaries before uploading.
  The same Action then runs `market-data crypto --daily --upload` (free): each new UTC day for BTC, ETH and SOL, and
  drops days older than 5 years from the summaries and the bucket.
- **Data bought (1 Nov 2026):** NQ 1-second, Nov 2025 to Oct 2026, US$48.33 from Databento
  (`market-data futures --buy`; raw files cached in market-data/raw so they're never paid for twice). ES and GC were
  left out for now and removed from the instrument list. Crypto stays (free).

## Owner steps
1. Futures data: a Databento account needs a card at sign-up (a Visa/Mastercard debit card should do). The other route
   is exporting history from NinjaTrader. Put a Databento key in `apps/server/.env.local` as `DATABENTO_API_KEY`;
   never in chat or the web app.
2. Approve the backfill cost once the cost check gives the exact quote.
3. For the live app: run `market-data.sql` in the Supabase SQL Editor, add `SUPABASE_SECRET_KEY` to
   `apps/server/.env.local`, run the backfill with `--upload`, and set `BACKTEST_OWNER_IDS` on Vercel.
