# PROJECT_SPEC — Key Budget (repo: new-budget-app)

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

## 1a. Name, icon, PWA

The app is **Key Budget**. `index.html` carries the title, description, the
favicon set and the iOS home-screen icons; `public/manifest.webmanifest` makes
it installable (`display: standalone`, so a home-screen launch has no browser
chrome). Icons are generated, not hand-drawn — a horizontal brass key (🔑-shaped: bow
left, shaft right, teeth under the tip) on gray-900 (`#111827`), sized to about
68% of the tile so it has real padding. Full-bleed for iOS (which masks the
corners itself and fills any transparency with black), rounded for the browser
tab. The small sizes use a ONE-tooth key in flat gold because at 16px two teeth
merge into a single blob and a gradient just muddies; ring and shaft are
identical across both builds so it stays one key. Any gradient here must use
`gradientUnits="userSpaceOnUse"` — the shaft and teeth are straight lines with
zero-height/width bounding boxes, and a default objectBoundingBox gradient is
degenerate on those, so they silently do not paint at all. `theme-color` is
declared per color-scheme so the status bar matches whichever theme that device
is on. To regenerate the icons, render `public/favicon.svg`'s geometry at each
size (the last pass used headless Chrome).

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

**JavaScript / TypeScript boundary.** `src/engine` is **fully TypeScript**
(all 13 modules, completed 2026-09-25); `src/components` stays JSX and is not
scheduled to convert. That split is deliberate: the engine holds the
money math and is about to have a SECOND consumer (the Expo client), so its
exported surface is a contract between two codebases rather than an internal
detail — that is where a type is worth its keystrokes. Components are cosmetic
by comparison and typing them would be ceremony.

Mechanics, because they are load-bearing and non-obvious:
- `tsconfig.json` is type-checking only (`noEmit`). Vite transpiles for the
  browser; Node 24 strips types for the test harness. `npm run typecheck` runs
  `tsc --noEmit` and CI runs it between lint and test.
- **Intra-engine imports carry an explicit `.ts` extension**, and so do
  imports of engine files from components and tests. Plain Node does no
  TypeScript-style resolution, so `./model.js` would simply not exist once
  `model.ts` is the file; the explicit extension is the one specifier that
  resolves identically under Vite, `tsc` (`allowImportingTsExtensions`) and
  Node's stripper.
- CI runs Node 24. Node 20 cannot strip types and the harness would not start.
- `allowJs` + `checkJs: false` while the migration is in flight: converted and
  unconverted files import each other freely, and only the `.ts` ones are
  checked.

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
  contributionLog:  { [categoryId]: [ { id, date, amount, source, externalId? } ] }, // what you ACTUALLY put in
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
6. `contributionLog` absent → `{}`. Deliberately NOT backfilled from ledger
   transactions: those are a forecast, and inventing a contribution history
   from a plan is exactly the error the feature exists to correct.
7. loan terms on a payment item → moved onto its debt category; item kept as
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
- **"Contributed" is logged, never derived** (`computeLoggedContributions`,
  2026-09-18). It used to sum ledger transactions tagged to the category —
  but the ledger is a forecast, so that was *planned* contributions wearing
  the label of a fact, the same error as the projected line. Contributions are
  now logged one entry at a time and nothing else counts. An account with no
  entries reports `logged: false` and the card shows "—", never `$0.00`:
  zero-because-unrecorded and zero-because-you-contributed-nothing are
  different claims and must not look alike (a 401k deducted pre-paycheck is
  the motivating case). Entries carry `source` ("manual" today) and an
  optional `externalId`, which is the slot a Plaid/bank import drops into —
  imported contributions are the same shape, not a parallel system.
- **A deleted category orphans its transactions; it never reassigns them.**
  `generate.js` resolves an unknown category to `direction: "out"`, and the
  harness asserts a delete leaves every event, ledger row and budget column
  byte-identical. The subtle half was in the UI: a controlled `<select>` whose
  value matches no option falls back to `selectedIndex 0`, which is `Income`,
  so an orphaned OUTFLOW *displayed* as income and was one click from becoming
  it. EventForm now renders an explicit "Uncategorized (deleted)" option.
- **Assets have no projection, deliberately** (removed 2026-09-18). They used
  to carry "last snapshot + contributions since" as a dashed line and a
  "vs. projected" stat. For a cash account that's arithmetic the user can do
  in their head; for anything market-exposed it conflates market movement
  with transactions that were never recorded, so the variance described
  neither. The balance history already answers "is this growing the way I
  expect", and `computeContributionsByYear` is the honest companion stat.
  `computeCategoryHistory` is now just the sorted balance history — the
  removal went all the way into the engine so a card can't render a
  projection that no longer means anything.

  **The old asymmetry note no longer describes the UI.** It used to read
  "loans keep their projected line, don't tidy up by stripping both."
  Neither card draws a projection now: the amortization chart was removed
  from the loan card on the user's call (2026-09-28), because they didn't
  want it — not because the math stopped being sound. The asymmetry that
  remains is at the ENGINE level, and it is still intentional:
  `computeCategoryHistory` genuinely no longer computes a projection for
  assets, while `computeLoanHistory` still computes `expected` for loans and
  the harness still asserts it. That is deliberate — amortization is real
  math about a known quantity, the loan card's history list still shows
  `expected` per entry, and restoring the chart is a render change rather
  than a re-derivation. So: don't delete the loan-side math to "match" the
  asset side, and don't reintroduce an asset-side projection to "match" the
  loan side.
- **Nothing logged anywhere changes a forecast number** (2026-09-19). A
  variable item's logged monthly actual used to substitute into the event
  stream, split across that month's instances — so a $150 biweekly rule with
  $150 logged for a two-instance month rendered as two $75 rows, and editing
  the rule appeared to do nothing for that month. Removed: `makeEvent` always
  uses the rule's amount, and the even-split machinery went with it. The
  Ledger and Budget are the forecast and are built from rules alone, exactly
  like logged balances and logged contributions never write back either.
  `monthlyActuals` is untouched and is what the Spending tab compares against
  `computeMonthVariance`'s rule-derived expected. One consequence worth
  knowing: loan amortization reads payments from `buildAllEvents`, so it now
  amortizes the PLANNED payment rather than the logged one — reality for a
  loan comes from its logged balance, which is the anchor anyway.
- **The Budget grid's starting-balance row is labeled with the account's
  name**, but the CSV export writes the fixed label `Checking` because
  `parseBudgetCSV` keys that number off the label. It also accepts the older
  `TD checking`, so exports taken before the rename still import.
- **Display preferences are per device, never in `state`** — the theme
  (`theme.js`) and the collapsed/expanded hero and debt section
  (`devicePrefs.js`: `hero-collapsed`, `debts-expanded`) live in
  localStorage. They never sync, never conflict between devices, and never
  count as a change worth writing to Supabase.
- **RULE: any view that orders categories by value must not rest identity on
  colour alone.** The relief is inline labels — the category's name next to
  its mark, not only in a legend.

  Why this is a rule and not a note about one chart: the 8-colour palette
  passes the validator on ADJACENT pairs (how it was originally checked —
  worst ΔE 8.7 deutan) but FAILS on all pairs (Cyan↔Teal 6.9 normal-vision,
  Pink↔Teal 3.8 deutan, measured 2026-09-28). Everywhere the app renders
  categories in a FIXED order — the Ledger's columns, the Budget's clusters,
  Settings → Categories, the Dashboard's cards — only neighbours are ever
  compared, so adjacent-pair validation is the right standard and the palette
  meets it. The moment a view sorts by amount, rank, or anything data-driven,
  any two categories can land side by side and the all-pairs numbers are what
  apply. That covers the spending pie and bar, and equally a ranked list, a
  sorted table, a treemap, or a heat map — anything built later that orders by
  value.

  Re-stepping the palette is NOT the fix: the colours are stored as indices on
  the user's own categories, so changing them repaints categories people have
  already chosen and named. Carry the relief in the view instead.

  A related case, same rule: a mark too small to hold a label (a dot, a
  sparkline point) must not be the only place a fact is stated. Such a mark
  may indicate presence or density, but the identity behind it has to be
  reachable as text — a tooltip, a detail panel, an adjacent list. The
  calendar's day dots are the worked example: each carries a title/aria-label
  naming its category, item and amount, and the day detail lists every
  transaction with its category spelled out in words. The dot claims only
  "something happened here".

  **The two fixed buckets are NEUTRAL on purpose.** Slices for the user's own
  categories use `paletteColor`; Fixed bills, One-off, Uncategorized and Other
  use grey steps. A 9th and 10th hue would break the categorical colour rules
  outright, and grey is immune to colour-vision deficiency, which is the right
  property for "you never named this" — it also lets the user's own colours
  dominate.
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
  The **Savings columns** picker sits directly above the table rather than in
  the toolbar: it is list-only and does nothing to the Planned spending panel,
  so placing it over that panel implied a relationship that isn't there. The
  horizon slider stays in the toolbar because it genuinely drives both.
  A **List / Calendar** toggle switches the rendering (`CalendarView.jsx`,
  per device via `devicePrefs`, `ledger-calendar`). The calendar is a month
  grid over the same rows: category-coloured dots plus the day's net, click a
  day for its transactions. **The running balance is list-only** — a
  7-column grid has nowhere to put it, and it is the list's whole reason to
  exist; a faked or omitted-but-implied balance would have two views
  disagreeing about the app's most important number. Savings columns and
  multi-select hide in calendar mode, being list-only concepts.
  Per-day aggregation is `groupByDay` in the engine, and a paid-marked row
  contributes 0 to the day's net exactly as it does to the running balance.
  Dot overflow is CAPPED (`+N`), not wrapped: grid cells share a row height,
  so wrapping makes the whole row taller and gives quiet neighbours
  whitespace — it flattens the busy/quiet contrast instead of sharpening it.
  Caps are 3 below `sm`, 5 above; below `sm` the cell also drops the net,
  which does not fit a ~45px cell, and shows it in the day detail instead.
  A **Planned spending** panel sits above the table (`SpendingMix.jsx`,
  collapsed by default, remembered per device): the window's projected
  outflow broken down by category, as a pie or a horizontal bar — same data
  (`computeSpendingByCategory`), two renderings, the choice also per device.
  It reads `buildEvents`, the list the table renders, so it follows the
  horizon slider. Forecast only, and the panel says so: income is excluded,
  paid-marked instances are excluded (they contribute 0 to the projection),
  and it never touches `monthlyActuals` or any logged value. An actual-
  spending breakdown belongs on the Spending tab and is a different chart.
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
  with hover. Card order is Checking → "+ Add account" → asset cards → the
  debt section. Asset cards show ONE line — the balances you logged — plus
  contributions (this year / all time). Loan cards show logged outstanding,
  percent-paid-off bar, terms, planned vs. paid this month, and keep their
  dashed amortization line. Both card kinds carry "Edit", which is also where
  delete lives — a primary action shouldn't be buried in Settings → Categories
  (that path still works). Deleting is confirmed with the number of
  transactions tagged to the category (`countTaggedItems`), because those are
  SCHEDULED transactions in a forecast: they survive, uncategorized, and
  silently removing them would change the forecast without saying so.
  **The debt section collapses to a single card** (`DebtSection`, collapsed by
  default, remembered per device). Collapsed, one root card carries both the
  overview — total owed from `computeDebtSummary`, then every loan as a
  compact scrolling list — and "+ Add loan", top-right. Expanded, that same
  root card swaps its content for the add card and the loan cards fan out
  after it with a staggered enter/exit. The expand/collapse control sits
  bottom-RIGHT in both states ("Show N loans ›" / "‹ Minimize"), so it never
  moves between them, and its chevron points the way the cards travel. The root card is always first
  in the debt run and never moves, so toggling doesn't shuffle the grid under
  the cursor. "+ Add loan" while collapsed expands the section too — a new
  category takes `max(order)+1`, so it lands last. With no debt categories at
  all the root card is simply the add card, no expand control. "+ Add account" and "+ Add loan" cards create an asset or
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
5. Data-shape changes are migration-safe: **idempotent always**,
   **deterministic for any state that carries data**, asserted before/after
   on legacy-shaped fixtures, never fabricating values the user didn't enter.
   `tests/migrations.test.mjs` is the standing guard — every migration path
   with a golden snapshot; a new migration adds a fixture there in the same
   commit.

   The determinism guarantee is scoped on purpose. A state with NO items is
   not deterministic across processes, and correctly so: `normalize()` seeds
   a brand-new account with `defaultTrackerCategories()`, which mints fresh
   `uid()`s. That is seeding, not migrating — there is no prior data whose
   identity must be preserved. Migrations proper use fixed ids
   (`seed-checking`, `seed-loan-<catId>`, `loan-<itemId>`) precisely so two
   devices migrating the same legacy state produce byte-identical results.
   Don't "fix" the seeding path to be deterministic and don't chase it as a
   failure: the harness asserts idempotency everywhere and determinism only
   where it is a real guarantee.

   **A new migration will diff the golden file for every item-bearing
   fixture. That is the harness working, not breaking.** The response is to
   read the diff, confirm every change is what the new migration intends and
   nothing else moved, then regenerate with
   `node tests/migrations.test.mjs --update` and commit the new golden file
   alongside the migration. Never regenerate first and read after — the whole
   value of the snapshot is that you had to look.

   **The harness pins BOTH `Math.random` and the clock. Do not simplify
   either back out.** `uid()` is random, so a freshly seeded account would
   get new category ids every run; `blankState()` derives both horizons from
   `todayISO()`, and a state with no `checkInDate` gets an account dated
   today. Unpinned, the golden file expires on its own — it went red three
   days after being written, with no code change (fixed 2026-09-28). That
   failure mode is worse than having no snapshot at all: a test that cries
   wolf on the calendar teaches everyone to run `--update` without reading
   the diff, which is exactly the habit this guard exists to prevent. Only
   `new Date()` with no arguments is frozen, so every date string in the
   fixtures still parses normally.

## 10. Roadmap

**Gated decision — the storage model, decided BEFORE Expo work starts.**
The single `state` jsonb document is a known ceiling, deliberately unaddressed:
it is why this shipped fast and it is correct for one user on the web. Every
roadmap item leans on it, though. Realtime means diffing whole documents;
multi-account and credit cards grow the blob monotonically; Plaid imports are
bulk appends to `contributionLog`; and mobile is the worst case — a phone on
cell service re-uploading the entire document on every debounced save. The
conflict guard is honest, but the unit of write is *everything*, so two devices
editing different categories is a merge that could be won and currently cannot
be. Options: (a) stay whole-document and add Supabase Realtime for push;
(b) split the hot collections (transactions, snapshots, contributions) into
real tables and keep settings as a blob; (c) a hybrid. Any of them stays cheap
because `storage.js` is the only backend touchpoint. **This is decided before
the mobile sync layer is built, not after** — building on whole-document writes
and then splitting the schema means doing the work twice.

Later:
- iOS client: Expo / React Native, reusing `src/engine` verbatim rather than
  reimplementing the money math. **Metro resolves the explicit `.ts`
  specifiers** this codebase uses — verified 2026-09-25 by bundling a
  `.js → .jsx → .ts → .ts` chain through Metro 0.87 (it executed correctly)
  and by resolving those specifiers through `@expo/metro-config` 57's own
  resolver. **Re-check the Node support matrix when this work starts:** the
  repo requires Node >= 24 for the harness's type stripping, and Expo/Metro
  keep their own supported-Node range that may not yet include it. Protecting that reuse is why the engine has
  no React, no network and no DOM in it, and why it is the part being typed.
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
- The debt section's collapse is NOT a shared `<CollapsibleSection>` yet
  (2026-09-18). Assets keep their flat layout deliberately, so the pattern
  can be lived with on one section before it's generalized — one concrete
  implementation is easier to change or delete than a premature abstraction.
- Asset cards show what you logged and what you contributed — never a
  projection, and never a plan restyled as a fact. See the conventions above; the user's framing was that
  contributions-only is the honest stat.
- "Expected remaining vs. actual remaining" is never shown for a loan; it
  only scolds. Percent paid off is the motivating framing.
- **`CategoryRef` is `string`, and `CATEGORIES` is keyed by `string` — do not
  narrow either into a union.** An item's category may be one of the three
  fixed ids, a tracker category id, or the id of a category that has since
  been DELETED. Orphans are a supported state, not an error case: the engine
  keeps their direction ("out"), the Budget clusters them under
  Uncategorized, and EventForm renders them as "Uncategorized (deleted)". A
  union type would make the orphan unrepresentable and the first "fix" would
  be to coerce it to something — which is precisely the silent reassignment
  the orphan handling exists to prevent. `noUncheckedIndexedAccess` already
  gives the real safety here: a lookup miss is typed `undefined`, matching
  the `?? "out"` every caller uses.
- **Known gap: test fixtures can construct states production cannot.**
  `primaryAccount()` falls back to legacy `settings.checkInBalance/checkInDate`
  and can therefore return `balanceAsOf: undefined` — surfaced by typing it
  (2026-09-25). Every real load goes through `normalize()`, which guarantees
  an account, so this is unreachable in production; raw engine-test fixtures
  skip normalize and can hit it. Documented rather than coerced, because a
  default here would be a behavior change. The durable fix is a fixture helper
  that runs `normalize()`, which would also stop the harness asserting against
  shapes the app can never actually hold.
- A loan owed above its principal reports 0% rather than a clamped negative,
  and says why in plain numbers. The peak-based, never-backwards bar was a
  deliberate user choice (2026-09-13) over "fill against owed today", which
  would tick down in a month with no payment: it can overstate where you
  stand today, and that trade was made knowingly.
