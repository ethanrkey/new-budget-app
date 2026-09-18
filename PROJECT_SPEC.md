# PROJECT_SPEC — new-budget-app

**This document must always match the code.** Any change that makes it wrong is
updated in the same commit (see *Maintenance rules*). Last full rewrite:
2026-09-13, from the code as it exists at that commit.

## 1. What this is

A personal cash-flow forecaster with a reality check. You describe your money
as **rules** (a paycheck every two weeks, rent on the 2nd, $500 to a Roth on
the 5th) plus **one-offs**, and the app projects your checking balance day by
day and month by month. Separately, you **log what's actually true** — your
verified checking balance, what's really in each savings/investment account,
what you really owe on each loan, what a variable bill really cost — and the
app shows how reality compares to the projection.

Two layers, deliberately kept apart:

| Layer | Tabs | Source of truth |
|---|---|---|
| **Forecast** | Ledger, Budget | rules + one-offs, computed from one event list |
| **Reality** | Dashboard, Spending | numbers you logged yourself |

Ledger and Budget never disagree because both are derived from the same event
list. The Dashboard never *projects* checking; it shows the verified balance.
The Ledger owns projection.

## 2. Status

Live, single-user-per-account, deployed on Vercel from `main`. Actively
developed. Goal: a full web app plus a connected iOS app sharing the same
engine (which is why the engine is pure JS with no UI or backend imports).

## 3. Architecture

```
src/
  engine/          pure functions, no React, no Supabase — the future iOS app reuses these
  components/      React UI (Tailwind v3, dark mode via the `dark` class)
  storage.js       the ONLY backend touchpoint (Supabase load/save, debounced)
  auth.js          Supabase auth helpers (Google OAuth, magic link, session)
  supabase.js      client from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  theme.js         per-device light/dark (localStorage; never synced)
  downloadFile.js  browser download trigger shared by export + restore
  App.jsx          state owner: loads once per user, autosaves on change, wires handlers
tests/engine.test.mjs   the engine harness (see §8)
supabase/schema.sql     the one table + RLS policies
```

**Engine / UI separation.** Everything with a number in it lives in
`src/engine/*` as pure functions of `(state, …)`. Components only render and
call mutators. This is what makes the harness possible (plain Node, no DOM)
and what will make an iOS client possible without a rewrite.

**Single state object.** All user data is one JSON blob per user. `App.jsx`
holds it in React state; every mutation is a pure function in
`engine/mutate.js` returning a new state; a debounced effect saves it.

## 4. Data model (the `state` blob)

```js
{
  settings: {
    budgetHorizon: "YYYY-MM-DD",       // Budget projects through this month
    ledgerHorizon: "YYYY-MM-DD",       // Ledger projects through this date
    theme: "light" | "dark",           // ACCOUNT default; each device overrides in localStorage (theme.js)
    visibleTrackerCategoryIds: [id],   // which savings/debt columns the Ledger shows
    tabOrder: ["dashboard", ...],      // user's tab order; sanitizeTabOrder() repairs it on load
    hasSeenOnboarding: boolean,        // welcome wizard shown once per account
  },
  accounts: [                          // exactly ONE today (kind "checking"); a list so more is additive
    { id: "checking", name, kind: "checking", balance, balanceAsOf: "YYYY-MM-DD", order }
  ],
  recurring: [ { id, name, amount, category, cadence, dayOfMonth, startDate, endDate|null,
                 order, accountId, color|null, variable? } ],
  oneoffs:   [ { id, name, amount, category, date, order, accountId, color|null } ],
  paidOverrides: { "YYYY-MM": [itemId] },          // a bill marked paid this month → zero effect on balance, still shown
  trackerCategories: [                             // the user's own savings / investment / debt buckets
    { id, name, color /* palette index */, order, kind: "asset" | "debt",
      // debt-kind only — a debt category IS a loan:
      originalPrincipal?, interestRate? /* APR % */, interestStartDate? }
  ],
  balanceSnapshots: { [categoryId]: [ { id, date, amount } ] },  // logged balances (assets) / logged outstanding (loans)
  accountSnapshots: { [accountId]:  [ { id, date, amount } ] },  // one per confirmed checking-balance update
  monthlyActuals:   { [itemId]: { "YYYY-MM": amount } },         // real total for a variable bill/payment that month
}
```

**Categories.** `income`, `bill`, `oneoff` are fixed. Any other `category`
value on an item is a `trackerCategories` id. An item's category decides its
direction (income in; everything else out) and where the Budget files it.

**Accounts.** `accounts[0]` is the checking account everything anchors to
(`primaryAccount(state)` in `model.js`). Its `balance` is the last balance you
*verified* against the bank and `balanceAsOf` is when. Events dated before
`balanceAsOf` are already inside that number and are dropped
(`generate.js buildEvents`). Transactions carry `accountId` (stamped
automatically; no picker until there is more than one account).

**A loan is a debt-kind category.** It carries its terms; its outstanding
balance is a logged snapshot; a *payment* is any transaction tagged to it —
one-off, recurring, or both. Setting up a loan never creates a transaction.

**Every logged value is editable and deletable** (snapshots, monthly actuals,
balance updates). Nothing is append-only.

## 5. Storage, auth, security

- **Supabase Postgres**, one table `budget_states (user_id uuid PK → auth.users, state jsonb, updated_at)`.
  RLS enabled; select/insert/update policies are `auth.uid() = user_id`.
  Verified empirically with the anon key: unfiltered select returns 0 rows,
  a write to another user_id is rejected (42501).
- **Auth:** Google OAuth and magic link, `persistSession` + `autoRefreshToken`.
  `redirectTo` is `window.location.origin` (works on localhost and prod).
- **Every write is conditional on the version we loaded.** `loadState`
  returns the row's `updated_at` alongside the state, and `writeState` does an
  `update ... .eq("updated_at", <that version>)` — never an upsert, because an
  upsert can't say "only if unchanged". A device holding a stale copy (a phone
  open since before you changed something on a laptop) matches zero rows and
  is told `conflict` instead of overwriting newer data with its whole stale
  document. Conflicts are never retried: this device's document IS the stale
  one. Versions are compared as opaque tokens, never ordered, so clock skew
  between devices can't be misread (`engine/syncGuard.js isStale`).
- **Nothing in memory is discarded without a recovery copy first.**
  `stashRecoveryCopy()` writes the about-to-be-replaced state to
  `localStorage["budget-app-recovery-v1"]` in a self-describing envelope
  before any server copy is adopted — on a conflict and on a focus refresh
  alike. `SyncNotice` then says what happened and offers the copy as a
  download in the same JSON shape Import → Restore accepts. `readRecoveryCopy`
  validates through `isPlausibleBackup` so a corrupt entry is never handed
  back as the user's data.
- **Staleness self-corrects on return.** On `visibilitychange`/`focus` the app
  re-reads just `updated_at`; if it moved, it adopts the server copy (after
  stashing). Skipped while one of our own debounced writes is still pending,
  which would otherwise discard that edit. There is still no push-based sync —
  an open tab learns nothing until it is focused (see roadmap).
- **Load-then-save discipline (a real incident drove this):** `loadState`
  THROWS on any query error and never fabricates state; `App.jsx` shows a
  dead-end error screen and the autosave effect cannot run until a load
  succeeds. "No row yet" (`maybeSingle` → null) is the only case that yields
  a blank state. `saveState` is debounced 500 ms and keyed on the user id, not
  the session object (token refreshes must not reload/clobber).
- The anon (publishable) key is in the deployed bundle by design; RLS is the
  boundary. No secrets are in git (history swept 2026-09-13).
- Financial CSVs are gitignored (`*.csv`). Never commit user data.

## 6. Migrations and conventions

All shape changes go through `engine/stateShape.js normalize()`, which runs on
every load and is **idempotent and deterministic** (fixed seed ids, never
`uid()`), asserted in the harness. Current migrations, oldest first:

1. item `tracker` field / preset `savings` → category.
2. `hasSeenOnboarding` absent + real data → treated as seen.
3. `trackerCategories` absent → legacy `roth/saved/brokerage/loans` seeded
   under the SAME ids (no item rewritten) for existing users; 3 fresh
   defaults for new accounts.
4. category `kind` absent → inferred (`loans` id / debt-sounding name → debt).
5. `accounts` absent → one checking account built from legacy
   `settings.checkInBalance/checkInDate`; items stamped with `accountId`;
   `accountSnapshots` seeded with that balance. (The Phase 1 mirror back
   into settings was retired in Phase 2; the legacy fields are stripped.)
6. loan terms on a payment item → moved onto its debt category; item kept as
   a payment; a second configured item in the same category spawns its own
   category (`loan-<itemId>`); balance anchor seeded as `originalPrincipal`
   as of the payment's start only if the user never logged one.

Conventions worth knowing before touching numbers:

- **Dates are LOCAL calendar dates, never instants.** Every `YYYY-MM-DD` in
  the app goes through `toISODate(d)` (`model.js`), which reads the Date's
  local components. `toISOString().slice(0, 10)` converts to UTC first and is
  always wrong here: west of UTC it rolls "today" over in the evening (after
  8pm Eastern the app believed it was tomorrow — wrong current month, wrong
  Dashboard "now", wrong projection endpoint), east of UTC it shifts a
  local-midnight date back a day. The harness asserts this timezone-
  independently and the suite is run across UTC−5 … UTC+14.
- **"Today" is the clock; the balance chain is anchored to the verified
  date.** Current month, Dashboard "now", contribution years, the variable
  spending window, and horizon labels use the real date. Which events count
  toward the checking projection is anchored to `accounts[0].balanceAsOf`.
- **Budget columns are whole calendar months**; event generation for the
  Budget runs to the end of the horizon's month (`endOfMonthISO`), so a bill
  due late in the last month isn't dropped.
- **Snapshot day semantics differ by kind, on purpose:** an *asset* snapshot
  is end-of-day (a same-day deposit is already in it; `progress.js` uses `>`);
  a *loan* snapshot is start-of-day (a same-day payment still counts;
  `loans.js`). The loan convention is what lets a migrated origination seed
  reproduce the previous projection to the cent.
- **Loan progress has two cases** (`computeLoanProgress`). Never above
  principal: `1 − owed/original`, unchanged. Ever above principal (interest
  outran payments, which an unsubsidized loan does from day one): the
  denominator becomes `peak` — the most that loan has ever been worth owing —
  and the numerator is measured from `bestOwed`, the lowest balance ever
  logged, which is what keeps the bar monotonic (a no-payment month of
  interest can't walk it backwards; min-so-far only falls). The branch keys
  off `peak`, not today's balance, so crossing back under the original
  principal can't jump the bar backwards by swapping denominators. While
  owed > borrowed the card replaces "of $X" with `owed · borrowed · accrued
  interest`; that third figure is `owed − borrowed`, i.e. interest net of
  anything already paid, since payments made before the earliest logged
  balance aren't knowable.
- **Loan projections anchor to the last logged value** (+ interest − payments
  since) and self-correct on every log. Nothing invents a "today" snapshot.
- **Assets have no projection, deliberately** (removed 2026-09-18). They used
  to carry "last snapshot + contributions since" as a dashed line and a
  "vs. projected" stat. For a cash account that's arithmetic the user can do
  in their head; for anything market-exposed it conflates market movement
  with transactions that were never recorded, so the variance described
  neither. The balance history already answers "is this growing the way I
  expect", and `computeContributionsByYear` is the honest companion stat.
  `computeCategoryHistory` is now just the sorted balance history — the
  removal went all the way into the engine so a card can't render a
  projection that no longer means anything. **The asymmetry with loans is
  intentional:** amortization is real math about a known quantity. Don't
  "tidy up" by stripping both; the harness asserts loan history still
  carries `expected`.
- **A variable item's logged monthly actual replaces the estimate** in the
  event stream for that month (split evenly across multiple same-month
  instances), so Ledger/Budget/amortization all see the real number.
- **The Budget grid's starting-balance row is labeled with the account's
  name**, but the CSV export writes the fixed label `Checking` because
  `parseBudgetCSV` keys that number off the label. It also accepts the older
  `TD checking`, so exports taken before the rename still import.
- **Display preferences are per device, never in `state`** — the theme
  (`theme.js`) and the collapsed/expanded hero (`devicePrefs.js`) live in
  localStorage. They never sync, never conflict between devices, and never
  count as a change worth writing to Supabase.
- **Colors are inline styles** (`paletteColor(index, isDark)`), never
  runtime-built Tailwind class names — the JIT scanner can't see those.
- **Variable actuals and "mark paid" are different things:** paid zeroes an
  instance's effect (already reflected in the verified balance); an actual
  substitutes a real amount that still counts.

## 7. Tabs and features (default order: Dashboard · Budget · Ledger · Spending)

Tabs are drag-reorderable on desktop (`settings.tabOrder`, persisted; the app
opens on the first one). HTML5 drag never fires from a touch drag, so phones
get plain tabs on purpose — a stray drag mid-scroll would be worse than no
reordering. `TABS` in `model.js` stays the authority on which tabs exist and
`sanitizeTabOrder()` repairs a stored order on every load (drops a tab that no
longer exists, appends one added since, collapses duplicates), so adding a
fifth tab never needs a migration.

- **Ledger** — every projected transaction, dated, with a running checking
  balance; month headers; optional per-category cumulative columns
  (checklist picker); mark-a-bill-paid checkbox for current-month bills;
  multi-select delete; per-item color override; projection horizon slider.
  A cumulative column opens to fit its own category name (`colVars` in
  LedgerView drives `--col-w`): the column is `nowrap` + `overflow:hidden` so
  it can animate open from zero width, and a fixed width silently clipped
  "Student Loan AA" and "Student Loan AB" to an identical "Student Loan".
  `text-overflow: ellipsis` is the backstop so a future overflow is visible
  rather than silent. The item column shows the transaction's own name and
  nothing else.
- **Budget** — monthly grid: income (starting point, take-home = every
  paycheck landing that month, checking, other income), fixed/recurring,
  saving/debt clustered by category, one-offs, totals, cumulative net.
  Reorder rows by arrows or drag (never across a section/cluster). Its own
  horizon slider.
- **Dashboard** — the reality layer: hero net position (verified checking +
  last logged asset balances − last logged loan balances, with an explicit
  "N not logged yet" count), collapsible and remembered per device; a card
  per checking account, asset category, and loan; Recharts history charts
  with hover. Asset cards show ONE line — the balances you logged — plus
  contributions (this year / all time). Loan cards show logged outstanding,
  percent-paid-off bar, terms, planned vs. paid this month, and keep their
  dashed amortization line. "+ Add account" and "+ Add loan" cards create an asset or
  debt category through their own setup form (`setupAsset` / `setupLoan`) —
  never the transaction editor, and setup never creates a transaction. An
  opening balance entered there is logged as the category's first snapshot.
  Settings → Categories still creates the same categories, minus the balance.
- **Spending** — actual vs. budgeted per month for items flagged
  "Track actual vs. budgeted" (any cadence; loans too).
- **Global:** + Add transaction (modal), Quick entry (inline, keeps going),
  Quick Setup wizard (once per account, reopenable), Tutorial (a 12-section
  walkthrough of every feature — `components/Tutorial.jsx`, sidebar on
  desktop, chip row + full screen on mobile), account strip
  (read-only balance + Confirm-gated update that also snapshots), Settings
  (per-device theme, category manager with asset/debt kinds and colors, sign
  out, wipe with full confirmation), Import (Budget-grid CSV, per-transaction
  CSV with tolerant recurrence detection, or a full JSON backup restore that
  downloads a safety copy first), Export (Ledger/Budget CSV, full JSON backup).

## 8. Verification

- `npm test` — `tests/engine.test.mjs`: ~250 assertions over the engine,
  including every migration (before/after identical ledger and budget
  output, idempotency, determinism), amortization, budget math, CSV
  round-trips, backup validation. Pure Node; no framework.
- `npm run lint` — ESLint (flat config). `react/prop-types` is off by
  decision (JS project, no PropTypes); everything else is signal.
- **CI** (`.github/workflows/ci.yml`) runs lint → test → build on every push
  and pull request. Vercel deploys `main`.
- UI changes get a browser pass (a throwaway Puppeteer harness against
  fixture data, light/dark, desktop/mobile) before commit; the harness is
  never committed.

## 9. Maintenance rules (standing — apply to every commit)

1. **This spec matches the code.** A change that makes it wrong updates it in
   the same commit.
2. **README.md stays current** for a public audience; screenshots in
   `docs/screenshots/` are regenerated from fixture data when a view changes.
3. **Engine behavior gets harness coverage** in the same commit; the harness
   lives in `tests/` and runs in CI.
4. **The in-app Tutorial matches shipped features** (`src/components/Tutorial.jsx`);
   update it in the same commit as any feature change. A stale tutorial is
   worse than none.
5. Data-shape changes are migration-safe: idempotent, deterministic,
   asserted before/after on a legacy-shaped fixture, never fabricating
   values the user didn't enter.

## 10. Roadmap

Later:
- Live multi-device sync (Supabase Realtime). Today staleness is *safe and
  self-correcting* — a stale device can't overwrite, and refocusing fixes it —
  but two tabs open side by side still don't update each other live.
- Goal-based savings (target → per-paycheck contribution).
- Tie one-offs to a recurring item by name.
- Small fixes: favicon, leading-zero in numeric inputs.
- Multi-account model (payment method per transaction, credit cards with
  limits, full initial setup wizard) — the account list is already shaped
  for it; this is the one deliberate architectural step still ahead.
- Bank linking (Plaid-style) — much later.
- iOS client sharing `src/engine`.

## 11. Decision log (why things are the way they are)

- Categories are user-defined with a validated 8-color palette because the
  old fixed four clashed with income-green / bill-purple.
- Bills get no automatic color or bold; only a user-picked color
  distinguishes a row.
- The old editable "check-in bar" was replaced by a Confirm-gated modal
  because a half-typed number used to be live state.
- The Dashboard shows the *verified* checking balance, not the projected
  one — the Dashboard is reality, the Ledger is projection.
- Loans were split from loan payments (2026-09-13) because a loan exists
  whether or not you're paying on it, exactly like an asset category.
- Asset cards show what you logged and what you contributed — never a
  projection. See the conventions above; the user's framing was that
  contributions-only is the honest stat.
- "Expected remaining vs. actual remaining" is never shown for a loan; it
  only scolds. Percent paid off is the motivating framing.
- A loan owed above its principal reports 0% rather than a clamped negative,
  and says why in plain numbers. The peak-based, never-backwards bar was a
  deliberate user choice (2026-09-13) over "fill against owed today", which
  would tick down in a month with no payment: it can overstate where you
  stand today, and that trade was made knowingly.
