# Trading journal redesign: implementation handoff

This folder describes a visual redesign of the app's six main screens. It is a **restyle and re-layout of existing features**. No new backend is needed, apart from the small items listed under "Data to wire up".

## What's in this folder

| File | What it is |
|---|---|
| `HANDOFF.md` | This spec. The source of truth. |
| `tokens.css` | Every colour, font, radius, shadow and spacing value as CSS variables. |
| `reference/01-dashboard.html` … `06-expenses.html` | The approved design for each screen. |

**About the reference files.** They were exported from a design tool. Read them as **annotated markup**, not as runnable pages:

- **Accurate:** all styles are inline, so every size, colour and spacing value is exact.
- **Placeholders:** `{{something}}` marks a value filled at runtime. `<sc-if>` means "show conditionally" and `<sc-for>` means "repeat for each item". The `<script data-dc-script>` block at the bottom of each file holds the sample data and the interaction logic (filters, dropdowns, timer). Use it to understand behaviour, then rebuild it in the app's own framework.
- **Do not copy:** don't paste these files into the app. Rebuild each screen with the app's existing components, routing and data.

## How to implement (suggested order)

1. **Tokens.** Add `tokens.css`, or translate it into the project's theme system (for example a Tailwind theme extension or a theme object). Load the Geist and Geist Mono fonts (Google Fonts or the `geist` npm package).
2. **Shared components.** Build these once, then use them everywhere (specs below):
   - App shell and sidebar
   - Page header
   - Card
   - Summary strip
   - Select / dropdown
   - Segmented tabs
   - Pills (grade, category, status)
   - Buttons
3. **Screens.** Dashboard, Calendar, Time log, Journal, Playbook, Expenses. Do one at a time and compare each against its reference file before moving on.
4. **Polish.** Hover and focus states, empty states, and narrow-screen behaviour.

## Global rules

- **Look:** a warm off-white page (`--bg-page`), white cards, and one near-black hero panel on the dashboard and time log. Orange (`--accent`) is used sparingly:
  - the Start button
  - the focus ring
  - high-impact market events
  - overdue items
- **Font:** Geist for everything. Geist Mono only for clocks and times (`00:00:00`, `21:15`).
- **Numbers:** use `font-variant-numeric: tabular-nums` on all of them.
- **Content width:** max 1120px, centred, page padding `32px 48px 64px`. The calendar is the exception at 1240px.
- **Sidebar:** 232px wide. It stacks above the content on narrow screens.
- **P&L colour:** green for positive, red for negative. Always show the sign (`+$322.14`, `-$33.98`).
- **Focus:** a 2px orange ring only (`box-shadow: var(--focus-ring)`). Remove the browser's default outline. Never use a double or yellow ring.
- **Spelling:** Australian English throughout.

## Shared components

**App shell / sidebar**
- Logo row: a 10px orange dot plus the app name.
- Nav items, in this order: Home, Journal, Calendar, Time log, Expenses, Playbook.
  - Each item is 44px tall, 10px radius, with an 18px stroke icon.
  - The active item has a `--bg-nav-active` background and weight 500.
- Settings and Theme sit pinned at the bottom.

**Page header**
- Left: H1 at 32px, weight 500, tight tracking, with a 14px muted description under it.
- Right: actions. A secondary outline button, then the primary dark button (`#1c1c1c`, white text).

**Card**
- White, `1px solid --border`, 12px radius, `--shadow-card`, 24px padding.
- Header: title at 16px/600 with a 13px muted description below it on the left. On the right, a small outline "View all →" style button that links to the related page.
- Every card on the dashboard has one of these links.

**Summary strip**
- One card holding 4 stats in equal columns, split by thin vertical dividers.
- Each stat has the label on top (13px, muted) and the value below (20–24px, weight 500).
- Used on Calendar, Time log, Journal and Expenses.

**Select / dropdown** (replaces every native `<select>`)
- Trigger: 40–44px tall, 10px radius, `--border`, white, shadow-card. The chevron sits at 50–60% opacity with right padding so it never touches the edge. Focus shows the orange ring only.
- Menu: white, 12px radius, `--border`, `--shadow-menu`, 4px padding.
  - Options are 36–40px tall with an 8px radius and a `--bg-hover` hover.
  - The selected option shows a ✓ on the right.
- Same look as a shadcn/ui Select. If the project uses shadcn or Radix, use theirs and restyle it.
- On the dark panel the trigger is dark (`--dark-bg` with `--dark-border`); the menu stays white.
- An active (non-default) filter gets the `--border-strong` border and a `--bg-hover` fill.

**Segmented tabs**
- Track: `--bg-tabs-track`, 10px radius, 3px padding.
- The active tab is white with a subtle shadow; inactive tabs use muted text.
- Used for Journal (Trades / Stats) and Expenses (Expenses / Recurring / Payouts / FY summary).

**Pills**
- Grade pills:
  - A+ is filled near-black.
  - A is filled dark grey.
  - B+ and below are white with a border.
  - All are fully rounded, 12px text, weight 600.
- Category pills (Expenses): soft tinted background with darker text in the same hue (tokens `--cat-*`). No dots.
- Status pills ("Manual", "Monthly", counts): white with a `--border` outline, 12px, muted text.

## Screens

### 1. Dashboard (`01-dashboard.html`)
Order from top to bottom:

1. **Header.** Date, then "Good evening, {name}". Right side: an "Add" dropdown (Event, Expense) and the primary "Log trades" button.
2. **Tonight card (full width, dark).**
   - Left column:
     - A segmented toggle: Tonight / Last session.
     - A **vertical agenda**. A "Now 19:42" line sits at the top. Each event row has a mono time, a 3px coloured bar (orange for a high-impact release, light grey for the session) and a title with a muted subline ("High impact · in 48 min").
     - The next scheduled item (Weekly review) shows muted.
     - At the bottom: a one-line overdue nudge ("1 overdue to-do: … View →") that jumps to the To do card.
   - Right column: the timer on a slightly lighter surface (`--dark-bg-raised`):
     - Status, then the clock in mono at 48px.
     - The activity select, then an orange Start button.
     - A "Time log →" link.
   - "Last session" mode shows the previous session's P&L (green), trade count, win rate and average R, plus a link to the journal.
3. **Performance + Discipline** (2:1 row).
   - Performance:
     - The financial-year P&L at 48px.
     - A 30-day cumulative P&L line chart with a light fill and a dashed zero line.
     - A row of This week / This month / Streak.
   - Discipline:
     - % followed plan at 48px, with a progress bar.
     - Two muted tiles: Outside plan and With mistakes.
     - The check-in status.
4. **Recent trades + Business** (2:1 row).
   - Trades: rows with date, play, side, grade pill and P&L.
   - Business:
     - Each metric is its own muted row card with an icon, label and subline on the left, the value on the right, and a chevron.
     - The rows are Expenses, Claimable, GST paid and Hours logged.
     - Each row links to its page.
5. **To do** (full width, last; lowest priority).
   - A checkbox list showing the first 4 items, then "Show N more". Overdue items show orange meta text.
   - An empty state reads "Nothing due. Clear head for the open."

### 2. Calendar (`02-calendar.html`)
- **Header row:** month navigation (‹ › and Today) on the left. Layer filter pills on the right: P&L, Screen time, Market events, Journal, My events, Expenses. Each one toggles that layer on the grid.
- **Summary strip:** Net P&L (USD), Days traded "20 of 22", Trading hours, Other business hours.
- **Month grid** (in a card):
  - 7 day columns plus a Week total column.
  - Day cells are white, with a very light green or red tint on traded days.
  - Each cell shows:
    - the date (today gets an orange filled circle and an orange border)
    - a market-event dot (orange for high impact, amber for medium)
    - a small pen icon if journaled
    - P&L, plus "N trades · win%"
    - screen time in mono
    - event tags (short, for example "21:15 NY open")
    - to-do tags with an orange outline
  - Days outside the month sit at 50% opacity.
  - A legend sits under the grid.
- **Right panel (dark):** "Next 7 days", grouped by day.
  - Today is labelled in orange, with the overdue to-do as a checkbox row.
  - Recurring events ("NY open session, 21:15 every weekday") are listed **once** as a note rather than repeated on every day.
  - The FRED attribution sits at the bottom.

### 3. Time log (`03-time-log.html`)
- **Header:** title and description. "Add manually" is an outline button.
- **Dark timer card:** status dot and text, the clock in 56px mono, the activity select and the Start button.
  - While running, the dot turns green, the text reads "Running · {activity}" and the button becomes a light "Stop".
- **Summary strip:** Today, This week, This month, FY.
- **Sessions card:**
  - Month arrows sit in the card header.
  - Each day gets a muted header row (date and total).
  - Session rows show the activity, a mono time range, the duration, a "Manual" pill if entered manually, and a ⋯ menu.
  - Grammar fix: "1 session", not "1 sessions".
- **Records for your accountant card:** the FY select, a CSV button (outline) and a "PDF report" button (primary).

### 4. Journal (`04-journal.html`)
- **Header:** description "P&L in USD, after fees, summed across copied accounts." Primary button: "Log trades".
- **Segmented tabs:** Trades / Stats.
- **Filter row:** six selects for Date range, Play, Grade, Contract, Account and Outcome. A "Clear filters" link appears when any filter is active.
- **Summary strip:** Net P&L, Trades, Win rate and Avg R, **recalculated from the filtered trades**.
- **One card per trading day:**
  - Header: date and trade count on the left, the day's total on the right (coloured).
  - Rows:
    - mono time and contract
    - side with a small arrow (up-right for Long, down-right for Short)
    - play and grade pill
    - accounts, shortened ("Summit 50K · Funded #1, #2")
    - R and P&L
  - Rows highlight on hover and link to the trade.
- **Empty state:** a dashed card with "No trades match these filters" and a Clear button.

### 5. Playbook (`05-playbook.html`)
- **Grid of play cards** (auto-fill, min 320px). Each card has:
  - An example-screenshot area at the top: a collage of 1–3 tiles depending on how many examples exist, plus "+N".
  - The name (16px/600) and description.
  - Pills: "N criteria", "N must-have" (soft orange) and "N examples".
  - A muted stats panel: Trades, Win rate and Net P&L for that play.
- Cards lift on hover (stronger border and shadow) and link to the play.
- The last tile is a dashed "Add a play" card with a hint line.

### 6. Expenses (`06-expenses.html`)
- **Header right:** FY select, "Import CSV" (outline) and "Add expense" (primary).
- **Segmented tabs:** Expenses / Recurring / Payouts / FY summary.
- **Summary strip:** Total inc GST, Claimable (green), GST paid, Expenses count. It recalculates from filters.
- **Filters:** a search input (name or vendor) and a category select. The category options show the category pills. A "Clear" link appears when filtered.
- **Column labels:** shown once above the cards: Date, Expense, Category, Paid with, ex GST, GST, inc GST, Business %, Claimable.
- **One card per month**, in the same pattern as the Journal day cards:
  - Header: month name and count on the left, the month total on the right.
  - Rows:
    - The vendor sits **under** the expense name instead of in its own column, which stops rows wrapping.
    - Recurring items get a "Monthly" pill.
    - The category shows as a tinted pill.
    - Money columns are right-aligned. A GST of zero shows "–".

## Data to wire up (placeholders in the mockups)

| Placeholder in design | Replace with |
|---|---|
| `[App name]` in the sidebar | The real product name and logo |
| "19:42", "in 48 min", "in 1 h 33 min" | The live current time and countdowns to the next events |
| "Usual session window" | Typical session length from the time log, or remove it |
| Sample to-dos (Renew TradingView, Request Summit payout, etc.) | The user's real to-dos. Only "Send receipts to accountant" is real. |
| Activity options "Research", "Admin" | The app's real time-log activity types |
| FY options | The financial years the user has data for |
| Playbook per-play stats | Computed from all journal trades for each play (the mockup only used 11 visible trades) |
| Journal "Date range" and "Account" filters | Real filtering (the mockup only had data for one range and both accounts) |
| Stats / Recurring / Payouts / FY summary tabs | Existing views restyled to this system (not designed yet) |

**Known bug in the current app:** the old dashboard showed "Next high-impact release: None in the next 7 days" while Non-Farm Payrolls was on the same day. The new agenda should read from the same events source as the calendar.

## Done checklist (per screen)

- [ ] Matches the reference for spacing, type sizes and colours (compare side by side)
- [ ] Uses the shared components, not one-off styles
- [ ] All selects are the custom dropdown with an orange focus ring only
- [ ] Every card that summarises another page links to it
- [ ] Hover, focus and empty states are present
- [ ] Works at phone width: sidebar stacks, wide rows scroll inside their card, no page-level horizontal scroll
- [ ] Real data, no placeholder text left
