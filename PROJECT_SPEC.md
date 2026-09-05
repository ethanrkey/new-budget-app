# Budget App — Project Spec & Handoff (v2)

This document is the single source of truth for the project. If you are an AI
assistant (e.g. Claude Code) picking this up, READ THIS FIRST, then read the
existing files under `src/`. Continue the work from "KNOWN BUGS" and
"To build next".

---

## What this is

A personal budgeting web app (eventually web + iOS) for one primary user
(Ethan) that will later support multiple users. It replaces a spreadsheet that
had two synced tabs: a **Ledger** (day-by-day transaction log with a running
bank balance) and a **Budget** (monthly summary grid). The point is to forecast
committed money forward and never lose sync between the two views.

---

## Tech stack (locked)

- **Vite + React** (JavaScript, not TypeScript)
- **Tailwind CSS v3** (`darkMode: "class"`)
- **Browser localStorage** for persistence (v1), isolated to ONE file
  (`src/storage.js`) so it can later be swapped for Supabase (auth + Postgres)
  WITHOUT touching engine or components.
- Dev machine now on Node 22 (upgraded from 20.11 because Claude Code needs >=22).

### Architecture principle
The "brain" (data model + calculation engine, in `src/engine/`) is deliberately
separated from the UI so a future iOS app can reuse the exact same logic. Keep
engine code free of any React/DOM dependencies.

---

## Core design principle: ONE shared dataset

Everything derives from a single state object:

```
state = {
  settings: {
    checkInBalance,   // real current bank (TD) balance, a number
    checkInDate,      // "YYYY-MM-DD"
    budgetHorizon,    // "YYYY-MM-DD" how far the Budget projects
    ledgerHorizon,    // "YYYY-MM-DD" how far the Ledger projects (independent!)
    theme,            // "light" | "dark"
    showCumulative,   // bool — toggle the 4 savings columns on the ledger
  },
  recurring: [ RecurringRule ],  // rules that auto-generate dated events
  oneoffs:   [ OneOff ],         // individual dated events
  paidOverrides: { "YYYY-MM": [ ruleId, ... ] },  // bills marked paid (feature 9)
}
```

- **RecurringRule**: `{ id, name, amount, category, cadence, dayOfMonth, startDate, endDate|null, order }`
  - cadence ∈ `weekly | biweekly | monthly | yearly`
- **OneOff**: `{ id, name, amount, category, date, order }`

The **Ledger** = every event expanded + sorted, with a running balance.
The **Budget** = the same events bucketed into months.
Both derive from the same event list, so they can never desync (the key
improvement over the old spreadsheet). Nothing computed is ever stored — always
recomputed from state. Money rounds to cents.

---

## Categories (IMPLEMENT THIS REFACTOR)

Replace the old `savings` category with four real buckets. Final set:

| key        | label       | direction | color    | notes                          |
|------------|-------------|-----------|----------|--------------------------------|
| income     | Income      | in        | green    |                                |
| bill       | Fixed Bill  | out       | purple   |                                |
| oneoff     | One-off     | out       | red      |                                |
| roth       | Roth        | out       | #6A1B9A  | feeds Roth cumulative col      |
| saved      | Saved       | out       | #0B7A0B  | feeds Saved cumulative col     |
| brokerage  | Brokerage   | out       | #1565C0  | feeds Brokerage cumulative col |
| loans      | Loans       | out       | #B36A00  | feeds Loans cumulative col     |

- The four Ledger cumulative columns map DIRECTLY to the roth/saved/brokerage/
  loans categories. DROP the old separate `tracker` field — category IS the
  tracker now. Any event in one of those four categories increments that
  column's running total; show the value ONLY on rows where it changes (stepped
  display), blank elsewhere.
- Future (NOT v1): user-defined custom categories with color + section mapping,
  and logic to remap rows when categories change. Build the fixed set cleanly
  first, structured so custom categories can be added later.

---

## Budget view format (match the spreadsheet)

Columns = months. Rows grouped into sections with subtotals:

```
MONTH                | Sep 2026 | Oct 2026 | ...
INCOME (green header)
  Starting point     |   0.00   | (prev month CUMULATIVE NET) ...
  Take-home          |  = SUM OF ALL PAYCHECKS THAT MONTH  (see bug 1)
  TD checking        |  (real balance, first/live month only)
  <other income, e.g. Money from Poppy>   (its own row)
  TOTAL IN (green fill)
FIXED / RECURRING
  <each bill row>
SAVING / DEBT
  <roth rows, then saved, then brokerage, then loans>
ONE-OFF / SEASONAL
  <one-off rows>
TOTAL OUT (red fill)
MONTHLY NET (green/red by sign)
CUMULATIVE NET (dark bold row)
```

- First column sticky (stays visible scrolling across months).
- "Take-home" = SUM of every paycheck landing in that month. Convention: income
  item whose name matches /pay|salary|take.?home/i is take-home; other income
  (Poppy) shows as its own row.
- Starting point: month 0 = 0; later months = prior month's CUMULATIVE NET.
- TD checking: real check-in balance, first/live month only.

### SAVING / DEBT section layout (clarified)
The four savings categories (roth/saved/brokerage/loans) all appear under ONE
"SAVING / DEBT" section header as normal item rows, grouped in that category
order. Do NOT create four separate section headers — one header, rows grouped by
category within it.

### Current-month convention (important)
When today's date is inside a month, that month is "live":
- Starting point = 0
- TD checking = real check-in balance (already includes any paycheck received)
- Take-home = only paychecks NOT YET received this month
- Bills already paid this month = 0 (see mark-paid feature)

---

## KNOWN BUGS TO FIX (do these first)

1. **Take-home only shows one paycheck.** Must be the SUM of all paychecks in
   the month (2 biweekly = 2×; 3-payday month = 3×). This also causes CUMULATIVE
   NET to drift wildly negative — fixing take-home fixes the cascade.

2. **Cumulative savings columns don't accumulate.** They were keyed to a
   separate `tracker` field the user never set. FIX: key them to the new
   roth/saved/brokerage/loans CATEGORIES. Stepped display (value only on rows
   where it changes).

---

## To build next (the batch, in priority order)

### MUST-HAVE (do first)
1. **Category refactor** — replace `savings` with roth/saved/brokerage/loans
   across model, EventForm, Budget grouping, Ledger cumulative columns.
   Cumulative columns derive from category.
2. **Fix take-home** = sum of all paychecks per month.
3. **Fix cumulative columns** = derive from the four categories, stepped.
4. **Single Add button ABOVE the Ledger/Budget tabs.** Remove the add button
   currently inside LedgerView; keep exactly one global add button in App,
   positioned just above the tab navigation.
5. **Full CRUD:**
   - Click any Ledger row's item name (e.g. "Internet", "Paycheck") → opens the
     edit form, pre-filled.
   - Edit works for both one-offs and recurring rules; editing a recurring rule
     edits all its instances.
   - Delete from within the edit form (and optionally a hover ✕).
   - Reach edit/delete from Budget rows too where practical.

### NEXT
6. **Manual row reordering WITHIN each section** (Income, Fixed/Recurring,
   Saving/Debt, One-off) on the Budget. Persist an `order` field per item; sort
   by it within its section. Reorder only within a section, never across.
   Up/down arrows are fine (simpler than drag-and-drop).
7. **Projection sliders** — two INDEPENDENT controls: Budget horizon and Ledger
   horizon, letting the user pick how many months out each view projects (e.g.
   Budget → May 2027, Ledger → Dec 2027, independently). Wire to
   settings.budgetHorizon / settings.ledgerHorizon.
8. **Ledger cumulative columns animation** — keep the show/hide toggle; when
   toggled on, the 4 columns slide out from the right of the TD Balance column
   with a smooth CSS transition. Default hidden.

### LAST (nice-to-have, user unsure how necessary)
9. **Mark bill paid this month (Ledger).** On hovering a Ledger row, show a
   small checkbox next to the date (e.g. beside "Sep 10"). Checking it zeroes
   THAT bill for the CURRENT month only; both Ledger and Budget update. Store via
   `paidOverrides` (`{ "YYYY-MM": [ruleId,...] }`). Current month only to start.
   Lowest priority.

---

## Future roadmap (NOT v1, but design toward it)

- **Supabase auth (Google sign-in) + Postgres** so data persists across devices
  and the app is usable for real without the spreadsheet. `src/storage.js` is
  the ONLY file that should change. Do UI/format polish FIRST, then migrate
  storage — don't do DB migrations while the data shape is still moving.
- **iOS app** reusing the same engine (why the engine is UI-free).
- **User-defined categories** with custom colors + section mapping.
- Multi-user; each user starts blank.

---

## File map (current)

```
src/
  engine/
    model.js      — categories, cadences, blankState(), date helpers, uid()
    generate.js   — buildEvents(state, horizonISO): expand recurring + oneoffs, sort
    compute.js    — computeLedger(), groupByMonth(), computeBudget()
  components/
    LedgerView.jsx  — ledger table, color coding, cumulative toggle, add/delete
    BudgetView.jsx  — sectioned monthly grid (spreadsheet-style)
    EventForm.jsx   — add/edit modal (one-off vs recurring)
  storage.js    — loadState()/saveState() to localStorage (SWAP POINT for backend)
  App.jsx       — hub: state, autosave, theme, check-in bar, tabs, global add
  index.css     — tailwind directives + base
tailwind.config.js — darkMode class, semantic colors
```

NOTE: current code still uses the OLD category set and a separate `tracker`
field. The batch above changes that. Update model.js first, then propagate to
EventForm, compute.js, LedgerView, BudgetView.

---

## Conventions / preferences (from the user)
- Numbers-first, accurate, no drift. Verify the math.
- Clean, modern, professional look. Light/dark toggle. Not ultra-minimal.
- Income green, bills purple, expenses red, negative balances red.
- Start BLANK (no seeded data) — user enters their own.
- Build for exactly how the primary user uses it now; generalize later once the
  base is clean.
- User wants to ration back-and-forth: show a short plan before large edits,
  then implement; work in focused chunks; let the user review diffs.

## Dev commands
```
npm run dev     # start dev server (localhost:5173)
```
