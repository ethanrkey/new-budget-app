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

### Principle 1 — one point of entry

> **Reality enters the forecast at exactly one point — the verified account
> balance and its as-of date — and nowhere else.**

This replaces the older, softer statement that forecast and reality "are
separate" (rewritten 2026-10-02). The 2026-09-24 audit proposed the change
and the argument for it is the reason it is worth having: *separate* is a
judgment call, and judgment calls get re-litigated every time someone wants
an exception. *Exactly one point* is a pass/fail test. For any write, ask
one question — **does this take something observed and let it change the
projection?** If yes, it is a violation unless it is the verified balance
and its date. There is no third answer and nothing to argue about.

**Why that one exception is sanctioned.** A forecast has to start from
something true. Rules alone give you deltas; without an anchor there is
nothing to add them to, and a projection from an invented starting figure
is worse than no projection. So the verified balance is load-bearing, and
it is allowed in on terms that keep it honest: the user supplies both the
number and the date they checked it, deliberately, through one modal. The
date is half the exception, not a detail — an observation with no date
cannot be placed in time, so it cannot legitimately anchor anything.
`buildEvents` then drops every event before `balanceAsOf`, because those
are already inside the number.

**What the test catches.** Each of these was argued about before the
principle made it mechanical:

- Logged monthly actuals used to write back into the projection — an
  observation changing the forecast. Removed 2026-09-19.
- A CSV import adopted the balance from the file and stamped it onto
  whatever as-of date was current — an observation, undated, changing the
  anchor. Removed 2026-10-02; it was also the cause of duplicate snapshot
  history.
- Mark-a-bill-paid wrote `paidOverrides` from the observation "I already
  paid this" and zeroed the event in the forecast. A violation on its face,
  and redundant besides: a paid bill is already inside the verified balance,
  and `buildEvents` drops everything before `balanceAsOf`. Deleted
  2026-10-02 (migration 8) rather than demoted — see the decision log.

The second principle — **each section is one thing** — stands as written in
§7: a tab answers one question, and a control that belongs to a different
question belongs on a different surface.

## 1a. Name, icon, PWA

The app is **Key Budget**, and the header says so, in the icon's own brass.
`#eebb4d` is the gold in `favicon.svg` and is 10:1 on the dark surface but
**1.70:1 on the light one** — unreadable — so light mode takes the same hue
(42°) stepped down to 30% lightness, `#8e670b`, 4.91:1 on gray-50. Two steps
of one hue, exactly like the category palette. `index.html` carries the title, description, the
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
  trackerCategories: [                             // the user's own savings / investment / debt buckets
    { id, name, color /* palette index */, order, kind: "asset" | "debt",
      // debt-kind only — a debt category IS a loan:
      originalPrincipal?, interestRate? /* APR % */, interestStartDate? }
  ],
  balanceSnapshots: { [categoryId]: [ { id, date, amount } ] },  // logged balances (assets) / logged outstanding (loans)
  contributionLog:  { [categoryId]: [ { id, date, amount, source, externalId? } ] }, // what you ACTUALLY put in
  accountSnapshots: { [accountId]:  [ { id, date, amount } ] },  // one per confirmed checking-balance update
  monthlyActuals:   { [itemId]: { "YYYY-MM": amount } },         // real total for a variable bill/payment that month
  overrides:        { [ruleId]: { "YYYY-MM-DD": amount } },      // ONE occurrence's amount — forecast data, see §7
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
  `schema.sql` also scopes them `to authenticated`; the live project still
  has them on PUBLIC (`polroles = {-}`, as of 2026-10-02) because that
  scoping has not been applied yet. Harmless either way — `auth.uid()` is
  null for anon, so the predicate denies — but the file and the database
  differ until `schema.sql` is re-run. There is deliberately NO delete policy — the app
  never deletes a row, so delete is denied fail-closed. `supabase/schema.sql`
  carries the reasoning and the verification queries.

  **Adversarial audit, 2026-10-02.** The repo is public and the anon key
  ships in the client, so RLS is the entire security model and a policy gap
  is a full breach. Run against the live project, not the file:

  | Probe | Result |
  |---|---|
  | anon `select *` | `[]`, `content-range: */0` |
  | anon `insert` | **42501, "new row violates row-level security policy"** |
  | anon `update` where `user_id not.is.null`, `return=representation` | `[]` — zero rows changed |
  | anon `delete` where `user_id not.is.null`, `return=representation` | `[]` — zero rows deleted |
  | tables exposed in the anon OpenAPI root | none |
  | anonymous sign-in | disabled (`anonymous_provider_disabled`) |

  The insert rejection is the one that proves **RLS is actually ON**: with
  RLS off that insert succeeds. An empty select alone would not have, since
  an empty table looks the same. Note that PostgREST answers 200/204 for an
  update/delete that matched nothing, so the success codes mean nothing on
  their own — `return=representation` is what distinguishes "denied" from
  "done", and both came back empty.

  **The policy list is the authoritative check, not the probes.** Black-box
  probing cannot be sufficient on its own, and the row above is why:
  PostgREST answers 200/204 for an update or delete that matched nothing, so
  a denied write and a successful one are indistinguishable by status code.
  Worse, probing as anon can never rule out an EXTRA permissive policy
  scoped to authenticated — policies are OR'd, so a single `using (true)`
  would open the whole table while every anon probe still came back clean.
  Only enumerating `pg_policy` settles it.

  Enumerated directly against `pg_policy` on 2026-10-02: exactly three
  rows — select (`r`), insert (`a`), update (`w`) — no extras, no `true`,
  every `using`/`with check` expression `auth.uid() = user_id`. That closes
  the cross-account question without needing a second account's JWT: with
  RLS proven on and no policy granting more than one's own row, there is no
  expression under which user B's `auth.uid()` matches user A's `user_id`.
  Re-run that query after ANY change to the table's policies.

  **Secondary finding:** that failing confirmation email means magic-link
  login — documented here as the fallback when Google OAuth is unavailable —
  is also down. It is an availability risk, not a security one.
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
- **A save that does not land says so.** `SyncNotice` has a third kind,
  `error`: a write that fails for any reason other than a conflict used to
  be `console.error` only, so the app went on looking normal while nothing
  it did reached the server — the worst shape a failure can take, because
  the user keeps working. It clears itself on the next successful save and
  offers a reload. This matters most during the storage migration, when an
  out-of-date tab is EXPECTED to be refused, but a silent save failure was
  never acceptable in any phase.
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
8. `paidOverrides` → **dropped**, not carried (2026-10-02). Mark-a-bill-paid
   was deleted; the field is stripped from `parsed` explicitly, because
   `normalize()` spreads the parsed blob and would otherwise carry a dead
   field forward in every save forever. Nothing reads it, nothing is
   reconstructed from it, and no number changes except that bills a legacy
   state called paid now count in full — which is the point: they were
   already inside the verified balance, so zeroing them double-counted the
   anchor's job.
9. `overrides` absent → `{}` (2026-10-02). A brand-new field; nothing is
   backfilled, because an override is a deliberate statement about one date
   and no prior state could imply one.
10. per-owner containers holding nothing → **dropped** (2026-10-02).
    `monthlyActuals: { itemId: {} }`, `balanceSnapshots: { catId: [] }` and
    the rest: deleting the last entry under an owner left the owner behind,
    where it rode along in every save forever. Nothing in the app enumerates
    these maps by key, so an empty container is indistinguishable from
    absence to every reader — it was only ever distinguishable to a
    byte-comparison. **Found by the entity round-trip over a real blob**:
    `splitState` emits no row for an empty container, so `assembleState`
    could not put one back. Not one of the nine fixtures before it contained
    one, which is exactly why they missed it; the golden diff for this
    migration is additions only.

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
- **A logged actual never changes a forecast number.** It is kept for the
  Spending tab's comparison and nothing else. (This bullet used to contrast
  actuals with "mark paid"; mark-paid was deleted 2026-10-02.)

## 7. Tabs and features (default order: Dashboard · Budget · Ledger · Spending)

Tabs are **underline-style**: no box, no border, the active one carrying a 2px
bottom accent and heavier weight (inactive tabs hold a transparent rail of the
same width so selecting one shifts nothing). This replaced a folder-seam
treatment — an active tab with `border-b-0` merging into a panel with a square
top-left corner — which only ever worked for three of the four tabs. Ledger,
Budget and Spending render an attached panel; the Dashboard renders free-
floating cards and so read as a boxed pill with nothing to connect to, and
needed a Dashboard-only top gap to stop the two colliding. An underline reads
the same whatever sits below it, so the special case is gone, the three panels
are now fully rounded, and the header carries one less bordered container.
`model.js` is also the wrong place to look for the tab list now — it is
`model.ts`.

Tabs are drag-reorderable on desktop (`settings.tabOrder`, persisted; the app
opens on the first one). HTML5 drag never fires from a touch drag, so phones
get plain tabs on purpose — a stray drag mid-scroll would be worse than no
reordering. `TABS` in `model.ts` stays the authority on which tabs exist and
`sanitizeTabOrder()` repairs a stored order on every load (drops a tab that no
longer exists, appends one added since, collapses duplicates), so adding a
fifth tab never needs a migration.

- **Ledger** — every projected transaction, dated, with a running checking
  balance; month headers; optional per-category cumulative columns
  (checklist picker); per-occurrence amount overrides (below);
  multi-select delete; per-item color override; projection horizon slider.
  **The Ledger projects at most 12 months** (`LEDGER_MAX_MONTHS`), against
  the Budget's 36: nobody plans transaction-by-transaction two years out, so
  most of the old range was dead slider. The cap is applied on READ, by
  `ledgerHorizonOf()`, not by migrating stored data — shortening a cap must
  not rewrite a horizon the user saved. Every reader goes through that one
  helper (the slider, `computeLedger`, the spending chart), so they cannot
  disagree about the window, and the next drag writes a value back in range.
  **Per-occurrence overrides.** `overrides: { [ruleId]: { [ISODate]: amount } }`
  — "Electric is $112 as a rule but $180 in July." This is FORECAST data (the
  user editing the plan, not importing an observation), so principle 1 is
  untouched. `makeEvent` substitutes the amount and flags the event
  `overridden`, which the Ledger and Calendar mark `· edited`: an amount
  that disagrees with its own rule looks like a bug without a marker.

  Clicking a Ledger row opens the edit form with the scope chosen UP FRONT —
  **This date** / **Every time** — not Google Calendar's edit-then-ask. Most
  of this form's fields (name, cadence, dates) mean nothing for a single
  occurrence, so asking afterwards would let someone change the cadence and
  then be asked "only this date?". Choosing first lets the form show the
  restriction instead of springing it: in occurrence scope only the amount
  is offered, Delete is hidden (it removes the whole rule, which is not what
  that scope means), and "Remove this date's override" sits with the amount
  it affects.

  **The default is This date**, and the reason is worth keeping because a
  future pass would flip it: the two mistakes are not symmetric. Defaulting
  to the rule means someone fixing one month silently rewrites every month,
  including ones already reconciled — quiet and hard to spot. Defaulting to
  the occurrence means someone meaning the rule fixes one month and notices
  next month. **The recoverable error is the one that should happen by
  accident.** A one-off row gets no control at all; it is already a single
  occurrence.

  Overrides are keyed by DATE and never remapped. Editing the rule — amount,
  name, anything — leaves them alone, which is the whole point: an override
  is a deliberate statement about that month. But moving the rule's day
  means it no longer LANDS on an overridden date, and that date reverts.
  That is never silent: `orphanedOverrideDates()` is checked before the save
  and the form names how many dates would stop applying, with a
  "Save anyway". The overrides themselves are kept, not deleted, so moving
  the rule back restores them. Remapping into the new day was rejected — it
  guesses at intent and has no meaning at all for weekly or biweekly rules.

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
  Per-day aggregation is `groupByDay` in the engine, so a day's net and the
  running balance can never tell different stories.
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
  and it never touches `monthlyActuals` or any logged value. An actual-
  spending breakdown belongs on the Spending tab and is a different chart.

  **The fixed buckets always break out by item; tracker categories never
  do.** These are not two kinds of the same thing. A tracker category is a
  bucket the user created and named deliberately, so grouping by it is the
  whole reason it exists. `bill` is the DEFAULT bucket — where anything the
  user didn't categorise lands — so drawing it as one slice is grouping by
  "uncategorised", which carries no information at 40% any more than at
  100%. So `ALWAYS_BY_ITEM` (`bill`, `oneoff`) is replaced by its own
  transactions as slices — `bucket: "item"`, carrying `parentBucket`,
  `parentLabel` and `shade`/`shadeCount` — unconditionally. Same-named
  events inside a bucket sum, so three months of rent is one slice, not
  three.

  Unconditionally, and that word is load-bearing: there is no threshold and
  no caption, so the chart cannot change shape as the horizon slider moves.
  `Uncategorized` is deliberately NOT in the set — it is not a default
  landing place, it only holds transactions whose category was deleted, and
  seeing that lump whole is exactly what sends you off to re-file them. The
  breakout happens BEFORE the 8-slice fold, so folding still applies
  afterwards and the slices still sum to the total.

  **The fold is openable, and opens differently per view.** Past
  `MAX_SLICES` the tail still folds into "Other", but the fold now KEEPS its
  members (`children` on the slice, each with its percent of the window), so
  "Other" is no longer the one slice you can learn nothing from — the same
  complaint as a single "Fixed bills" wedge, one layer down. Clicking it:

  - **Pie: the wedge never changes.** Seventeen wedges would be unreadable
    and 1-2% slivers unhittable, so the expansion happens in the LEGEND
    beside the pie. The expanded rows carry their own colours with no wedge
    to point at, which the legend says once ("All inside the grey wedge")
    rather than per row; segmenting the wedge is more machinery than it is
    worth.
  - **Bar: the rows expand in place**, full list with amounts and
    percentages. A longer list is the bar's advantage.

  Open, the "Other" row is REPLACED by its children rather than sitting
  above them — the same $2,350 as a summary row and again as its parts read
  as double-counting — so the fold needs its own way back, a
  "Fold N back into Other" control under the expanded rows. Both views still
  show the same data; they already differ in how much of it is drawn versus
  listed. "Other" stays last in both while closed: it is a remainder, not a
  peer, which is why it keeps its position even when it outranks named
  slices by amount. The open/closed state is component state, NOT
  `devicePrefs`: it is a drill-down you open to answer a question, not a
  layout preference worth remembering. Raising `MAX_SLICES` instead was
  rejected (it makes the default pie unreadable to fix an occasional
  problem), as was a tooltip listing the contents (tooltips do not exist on
  touch, and this app is used on a phone daily).

  Two consequences for the view. Item slices are rendered as tints of their
  parent's colour, not fresh palette hues — a 9th hue would collide with a
  real category sitting in the same chart, and would lend a single
  transaction a category's identity. Steps run AWAY from the surface (darker
  on light, lighter on dark) so the quietest step still holds ≥4.7:1, and
  bills tint off a cool grey while one-offs tint off a warm one, because
  both fixed buckets are always present at once and two ramps struck off the
  same slate overlapped. Because the tints are steps of one hue, the colour
  rule above applies at its strictest: every item slice carries its parent's
  name inline ("Rent · Fixed bills") in the legend, the bars and the tooltip.

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
  horizon slider, still the full 36 months — a monthly grid two years out is
  genuinely useful where a transaction list is not.

  The grid scrolls horizontally with the month column pinned (`STICKY_COL`),
  and three separate things had to be true for that to work (2026-09-29; all
  three were broken):
  1. **The scroller carries no horizontal padding.** It used to be the card
     itself, padding and all — and that padding stays *inside* the scrollport,
     so columns slid through the strip to the left of a cell pinned at
     `left: 0`. The scroller now bleeds to the card's edges (`-mx-3 sm:-mx-4`)
     and the pinned column supplies that inset itself.
  2. **The pinned cell is opaque.** The tinted total rows used
     `dark:bg-*-950/30`, so in dark mode numbers showed straight through the
     cell that was supposed to hide them. The pinned copy of each tint is
     flattened against the dark surface (`#0d1f22`, `#21141e`); the row's own
     tint stays translucent, since nothing scrolls under a whole row.
  3. **The right edge is a pseudo-element, not a `box-shadow`.** Chrome does
     not paint `box-shadow` on a cell inside a `border-collapse: collapse`
     table — it was tried and silently dropped. `position: sticky` makes the
     cell a containing block, so an `after:` strip hangs outside its right
     edge with no extra wrapper.
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
- **Reading a round-trip failure.** A hash mismatch is alarming and usually
  is not what it looks like, so triage it by what ELSE failed:
  - Hash mismatch **with identical ledger AND budget output** = something
    semantically dead, not numerically wrong. Residue, key order, an empty
    container — the projections are computed from every number in the state,
    so if they agree, no number the user can see has moved. This diagnosed
    migration 10 in one line.
  - Hash mismatch **with the projections also differing** = a real value
    changed; find it before doing anything else.
  - Either way, diff by PATH and print paths only, never values: a real blob
    is somebody's finances and the diff output is the thing most likely to
    get pasted somewhere. One path was all it took both times.
- `node scripts/probe_shapes.mjs` — shape-only census of every stored row:
  key names, counts, which migrations apply on load, which era it was
  written in, and the round-trip verdict, computed in memory with nothing
  written to disk. Run this BEFORE exporting anyone's blob: a row that
  round-trips has already told you everything an export would, and an
  export is somebody's complete financial history on a laptop.
- `node tests/real-blobs.test.mjs` — the pre-migration gate. Needs
  `.blobs/` from `scripts/export_blobs.mjs`; skips cleanly without it.
  Verified against synthetic blobs 2026-10-02: a clean one passes all
  checks, and one shaped like real duplicate-date snapshot data fails on
  the round-trip, the key collision, the duplicate date (named), the
  anchor, and both projections.
- UI changes get a browser pass (a throwaway harness against fixture data,
  light/dark, desktop/mobile) before commit; the harness is never committed.
  **Exercise the real entry point, not the component in isolation.** A
  per-occurrence edit shipped with its form verified standalone and its
  routing never clicked: `LedgerView` stripped the occurrence date off the
  row id before the handler saw it, so every "this date" edit silently
  rewrote the whole rule (2026-10-02). The form was flawless and the
  feature was broken. JSX wiring has no automated coverage in this repo by
  decision, which makes the browser pass the only guard there is — so it
  starts from a click on the actual surface, and the harness asserts what
  the handler RECEIVED, not just what the form renders.

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

**Gated decision — the storage model: DECIDED 2026-10-02.** Moving from one
`state` jsonb document per user to one row per entity, before the Expo client
rather than after, because building the mobile sync layer on whole-document
writes and then splitting means doing it twice. The ceiling the document
model hit: any two concurrent edits conflict even when unrelated, and a phone
on cell service re-uploads the entire financial history on every debounced
save. Architecture around it is settled — server-authoritative, account required,
and **offline is READ-ONLY** (cached state for viewing, writes gated on
connectivity).

**Encryption at rest: DECIDED, not pending** (2026-10-01, reaffirmed
2026-10-02). Supabase's disk-level encryption and nothing more — no
column-level keys, not end-to-end. Column-level with user-held keys means a
recovery phrase, and a user who clears their browser must not lose
everything: recoverability was chosen over secrecy deliberately, for
financial records. So `budget_entities.data` is plaintext jsonb exactly as
`budget_states.state` was, and the table design does not change. That last one is load-bearing: there is
no write queue, no replay, and therefore no merge algorithm to design.

*Landed:* `engine/entities.ts` — `splitState`, `assembleState`,
`diffEntities`, pure, with the round-trip identity
`assembleState(splitState(s)) == s` over every golden fixture, the
convergence property (a store fed only diffs still equals the document after
200 random edits), `scripts/export_blobs.mjs`, `scripts/probe_shapes.mjs`
and `tests/real-blobs.test.mjs`. 17/17 on real data; migration 10 came out
of that run.

*The one pass, in order — and the order is not cosmetic:*
1. `supabase/entities.sql` — table, RLS, policies, version trigger.
2. `scripts/backfill_entities.mjs --write` — reuses `splitState` rather than
   re-implementing it as a jsonb unnesting query, which would be a second
   untested implementation the round-trip property would never exercise.
3. `scripts/verify_entities.mjs` — **before any write switches over.** Reads
   both tables independently and compares documents, per-collection counts,
   unknown kinds, and every projected number. Switch writes first and the
   baseline it would compare against has already moved.
4. `supabase/freeze_budget_states.sql` — the trigger that makes an old tab
   fail loudly instead of forking the data.

Entities: each recurring item; each one-off; each tracker category; each
balance snapshot; each contribution; each monthly actual (item+month); each
per-occurrence override (rule+date); each account; and settings as ONE blob,
since preferences are not money and last-write-wins is fine for them.

- **One table, not nine.** `budget_entities(user_id, kind, entity_id, data
  jsonb, version, schema_version, deleted_at, updated_at)`. RLS is the entire
  security model, policies are OR'd, and the failure mode is a full breach —
  nine policy sets is nine chances for a future `using (true)`. The cost is
  no foreign keys, so referential integrity stays the engine's job; it
  already is, because orphaned ids are a supported state by design.
- **Snapshots are keyed BY DATE**, not by their own uid, and this is
  STRUCTURAL rather than a convention — do not "fix" it into a uid later.
  "As of the 28th the account held X" is a statement about a date, so two
  rows for one date are a contradiction, not two readings. One balance per
  date was application logic (`upsertSnapshotByDate` in `mutate.ts`) and
  becomes a PRIMARY KEY: a mutator can be bypassed, added alongside, or
  forgotten by a second client, and a primary key cannot. Two devices
  logging one date then collide on one row and resolve through the ordinary
  version guard instead of both surviving. Contributions deliberately keep
  uid keys: two deposits in a day are two real events, and a date key would
  lose money.
- **The verified balance is DERIVED from the newest snapshot**, not stored
  alongside it. That deletes a conflict class rather than solving one: "the
  later as-of date wins" becomes `max(date)` over append-only rows, with no
  rule to enforce. One intended behaviour change — correcting the NEWEST
  snapshot now moves the anchor, where correcting September still leaves
  October alone.
- **Deletes are tombstones**, never absences, so a delete outranks a stale
  device's copy. No client DELETE policy: purging runs server-side only.
  Retention is 90 days for forensics, but **read-only offline is what sets
  the real floor** — with no write queue there is nothing for a long-dark
  device to replay, so the window only has to outlive online devices
  refetching, which is seconds. Do not design for long-offline replay.
- **Per-entity version counter**, not a timestamp: a counter has no clock in
  it, which suits a codebase that already refuses to trust device clocks.
  Same-entity conflicts adopt remote and stash local, extending the existing
  guard rather than inventing a second one.
- **`schema_version` is stamped per row** and a client reading a higher
  number than it understands must refuse to sync and go read-only rather
  than write back a mangled row — App Store builds lag, the web app never
  does. **This path is UNPROVEN:** the stamp is in place because retrofitting
  it would be a second migration, but there is no lagging build to test the
  refusal against, and it must not be read as verified.
- **The diff baseline is `normalize(assemble(rows))`, never the raw rows.**
  `normalize()` seeds a snapshot for an account with none and mints default
  categories for a new account, so diffing against raw rows would make every
  load write phantom rows.
- **The empty-state alarm is rewritten, not ported.** There is no document to
  be empty; the equivalent danger is one sync tombstoning most of a user's
  rows, so `tombstoneAlarm` measures that as a ratio plus a floor.
- `storage.js` stays the single backend touchpoint, and this strengthens the
  property rather than straining it: split/assemble/diff are pure engine
  functions, so `storage.js` keeps doing transport only. Export, import and
  the recovery envelope are unchanged, because `assembleState` produces
  exactly the document shape they already speak.
- **Rollout collapsed to one pass (2026-10-02).** The phased version was
  sized for a divergence window that does not exist here: three testers who
  signed in once and never returned, one real user, and a JSON backup on
  disk. What the dual-write soak uniquely caught was CONVERGENCE — the
  round-trip identity proves split/assemble is lossless for a given state
  and says nothing about whether a store updated only by diffs still equals
  the document after a sequence of edits. That is now a property test
  (`a diff-fed store converges`, 5 runs × 40 random mutations), which is
  better coverage than a soak: it walks hundreds of orderings in
  milliseconds instead of sampling whatever one user clicked in a week.
  Two conditions on the single pass: **verify the backfill against the
  frozen jsonb BEFORE switching writes** (switch first and the comparison
  baseline has already moved), and know that rollback after cutover loses
  post-cutover edits, where the phased version's rollback was lossless. An **out-of-date tab must be told to reload** — a save failure is
  currently `console.error` only, which is silent, and that lands before the
  dual-write phase, not before cutover.


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
- **A dominance threshold for the spending chart was tried and removed**
  (2026-09-28, removed 2026-09-29). The first cut broke a bucket out into
  its transactions only when it passed 70% of the window's outflow, on the
  reasoning that the failure was the degenerate one-wedge-at-100% shape.
  That reasoning was wrong, and a future pass should not re-derive the
  threshold as a clever idea. The fixed buckets are not categories in the
  same sense as the others: `bill` is where uncategorised money lands by
  default, so grouping by it says nothing at ANY share — 62% of a real
  window was the biggest slice and the least informative one — not merely at
  100%. A threshold also makes the chart change shape as the horizon slider
  moves, which is a worse property than any grouping it could pick. The rule
  is now unconditional and needs no explanatory caption, because nothing is
  conditional to explain.
- **A logged balance is one number per date** (2026-10-02). `updateAccountBalance`
  and `addBalanceSnapshot` upsert by date: a second entry for a date already
  present corrects it in place, keeping the row's id, because "as of the
  28th the account held X" is a statement about that date and two answers
  are a contradiction, not two observations. Contributions deliberately do
  NOT work this way — two deposits on one day are two real events, and
  collapsing them would lose money.
- **A CSV import never touches the verified balance** (2026-10-02). It used
  to adopt the balance out of a Budget-grid CSV and stamp it onto the
  account's existing as-of date, because the file carries no date of its
  own. Round-tripping your own export therefore logged a snapshot identical
  to the one already there; that was the cause of the duplicate history
  found in real data, not the submit guard, which was tested and holds. An
  import brings in forecast items. The verified balance has exactly one
  entry point and it is the Update balance modal, where the user supplies
  the date.
- **Mark-a-bill-paid was deleted, not demoted** (2026-10-02). The checkbox
  zeroed a current-month bill's effect on the projection. It was a second
  mechanism doing a job one mechanism already does: a bill you have paid is
  inside the verified balance, and `buildEvents` already drops every event
  before `balanceAsOf`. It also carried two defects — it rendered only for
  the current month, and an override left on a past month could not be
  un-ticked because the checkbox was gone. Under principle 1 it is a flat
  violation: an observation ("I paid this") writing a forecast number.
  Display-only was considered and rejected; a flag nothing acts on is just
  a second place to maintain. Closes audit items #1 and #6.
- **Deleting a rule deletes its overrides** (2026-10-02) — the opposite of
  an orphaned transaction, which deliberately keeps its dead category id.
  The distinction is reachability, and a future pass should not "fix" this
  into a tombstone: an orphaned transaction is still visible in the Ledger
  and can be re-filed, while an override keyed by a `ruleId` that no longer
  exists can never be seen, edited or reached again. It is unreachable
  garbage, not a record.
- **Wipe Data leaves a genuine new account** (2026-10-02). It used to clear
  only items and monthly actuals, deliberately sparing logged balances on
  the grounds that they are real-world data you cannot get back. That was
  the wrong trade for an action called "wipe all data": `hasSeenOnboarding`
  survived with everything else, so a wiped account came back looking used,
  with no welcome wizard, which is not what anyone means by the word. It is
  now exactly `blankState()` — `wipeToNewAccount()` in `mutate.ts`, one
  tested definition — and the confirmation enumerates what goes, because
  understating a destructive action is the app lying. Export sits one click
  away in the same modal. The only first-run flag is `hasSeenOnboarding`;
  per-device prefs (theme, collapse states) are not account data and
  deliberately survive, and the legacy `budget-app-state-v1` import cannot
  resurrect wiped data because it only runs when no row exists at all.
- **`splitState` is lossless even though the anchor is derived**
  (2026-10-02). `assembleState` ignores the account entity's stored
  `balance`/`balanceAsOf` and reads the newest snapshot instead — so it
  would be tempting to stop writing them at all. Split keeps them anyway,
  and the reason is direction: **split is the write path.** Anything it
  drops is gone from the database and unrecoverable, while anything
  assemble ignores is merely unused and can be read again the moment that
  turns out to be wrong. An asymmetric risk gets the asymmetric answer —
  lossless going down, opinionated coming up.
  `anchorMatchesNewestSnapshot()` exists for the gap between the two: where
  a stored anchor disagrees with the newest snapshot, assemble will
  deliberately move it, and that is reported before a migration rather than
  discovered after one.
