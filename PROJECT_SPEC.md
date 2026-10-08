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
chrome).

**`start_url` and `scope` are `/app`, and `id` stays `/`.** Once the root
became a marketing page, a home-screen launch opened it instead of the app.
`id` must NOT be changed to match: it is the install identity, and changing
it makes this a different app to the browser, orphaning every existing
install. The manifest alone is also not enough — **iOS only honors
`start_url` from 16.4, and before that Add to Home Screen bookmarks whatever
page you were on**, so an install made from the landing page launches there
for ever, as does any install created before this shipped. `main.jsx`
therefore also redirects `/` to `/app` when
`matchMedia("(display-mode: standalone)")` matches, which costs one media
query and fixes the stale installs the manifest cannot reach. Icons are generated, not hand-drawn — a horizontal brass key (🔑-shaped: bow
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

## 1b. Public pages and routing

Three URLs, one bundle, **no router dependency** — the app has exactly three
paths and none of them nest, so `main.jsx` switches on `location.pathname`.
react-router would be a dependency, a provider and a rendering model bought
for one `if`. Unknown paths fall through to the app, because the only way to
reach one is a stale link to a tab. `vercel.json` rewrites everything that
is not a file or an asset to `index.html`, so these resolve on a hard load
and not only on client navigation.

| Path | What |
|---|---|
| `/` | Landing page. Fixture-data screenshots, never real finances. |
| `/privacy` | Privacy policy, the user's copy verbatim. |
| `/app` | The app. |

**`auth.js` redirects to `/app`, not to `window.location.origin`** — that
origin is now a marketing page, and a user who just signed in would land on
a Try button.

**The privacy page makes claims the code has to keep true.** "If you delete
your account, your data is deleted with it" is account deletion, which
shipped BEFORE this page did, deliberately: a privacy page claiming a
feature that does not exist is the worst kind of wrong. "No analytics, no
tracking, no third-party services" is a constraint on what may be added
later, not a description of today only. The copy is verbatim and stays
that way — paraphrasing a privacy policy is how a claim quietly stops
being true, and "I have the capability to read users' self-entered data"
is a deliberate admission that follows from choosing recoverability over
end-to-end encryption.

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
scripts/                migration, verification, the palette gate, the screenshots
mobile/                 the Expo client; imports src/engine directly, never a copy
supabase/entities.sql   the one table + RLS policies (schema.sql is the retired one)
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

- **Supabase Postgres**, one table
  `budget_entities (user_id uuid → auth.users, kind text, entity_id text,
  data jsonb, version int, schema_version int, deleted_at timestamptz,
  updated_at timestamptz)`, primary key `(user_id, kind, entity_id)`. One
  row per rule, one-off, category, logged balance or contribution — see §10
  for why, and for the migration off the single-document table.
  `budget_states` (one `jsonb` document per user) was the model until
  2026-10-03 and is **frozen**, not dropped: `supabase/schema.sql` still
  describes it so the migration history reads, and nothing writes to it.
  RLS enabled on `budget_entities`; select/insert/update policies are
  `auth.uid() = user_id`. There is deliberately NO delete policy — the
  client never removes a row, it writes a tombstone (`deleted_at`), so
  delete is denied fail-closed. `supabase/entities.sql` carries the
  reasoning and the verification queries.

  **Adversarial audit, 2026-10-02 against `budget_states`, re-run against
  `budget_entities` on 2026-10-03** (three policies, exactly as specified —
  select, insert, update, no extras). The repo is public and the anon key
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
  `redirectTo` is `${window.location.origin}/app`, NOT the origin: since
  2026-10-02 the origin is the public landing page, and someone who had just
  signed in would land on a marketing page with a Try button.
- **Every write is conditional on the version we loaded, PER ROW.** Each
  entity carries its own `version` counter, and an update is
  `.eq("version", <the one we hold>)` — never an upsert, because an upsert
  cannot say "only if unchanged". A device holding a stale copy of that one
  entity matches zero rows and is told `conflict`; a device editing a
  DIFFERENT entity does not conflict at all, which is the whole reason the
  storage model changed. Conflicts are never retried: this device's copy IS
  the stale one.

  The plan — which rows, which guard, in which order, when to stop — is
  computed by `engine/entityStore.ts planWrite()`, pure and shared, because
  the web and the phone drifting apart on write ordering would be a
  data-loss bug that only reproduced on one device. **Upserts go before
  tombstones** and the caller aborts on the first refusal, so a conflict
  part-way stops before anything is REMOVED. An insert that hits 23505 must
  try to REVIVE before calling it a conflict: a tombstoned row still
  occupies the primary key (see the decision log).

  The whole-account sync token is still a single opaque `updated_at`, the
  max over ALL rows including tombstones, and both places that compute it
  call the same function. Versions are compared as opaque tokens, never
  ordered, so clock skew between devices cannot be misread
  (`engine/syncGuard.ts isStale`).
- **Account deletion: 7-day soft delete, then a hard delete.** A request is
  a row in `account_deletions`; the purge is `purge_due_accounts()`,
  SECURITY DEFINER, which deletes the `auth.users` row — everything else
  cascades from it, so there is one statement and no way to half-delete
  someone. Two triggers for it, because either alone has a hole: pg_cron
  daily (the only thing that purges an account whose owner never returns,
  which is most of them), and a call at sign-in from `storage.js` (so the
  purge still happens if cron is unavailable — but it cannot be the only
  mechanism, for the reason just given).

  **The DELETE policy went on `account_deletions`, not on
  `budget_entities`,** and that is the warning in `schema.sql` being heeded
  rather than ignored. The client never deletes an entity row: requesting
  is an INSERT, canceling is a DELETE *of the request*, and the purge
  cannot run as the user at all, since removing an `auth.users` row needs
  privileges no client has. Granting DELETE on `budget_entities` would
  widen the only thing standing between a public anon key and everyone's
  financial history, to enable nothing. There is also deliberately no
  UPDATE policy on `account_deletions`: it would let a client push its own
  purge date back for ever, which is a deletion that never happens wearing
  the costume of one that does.

  **No email confirmation**, because the project's SMTP is down and a
  confirmation that silently never arrives is worse than none — it would
  look like deletion failed while the request sat unconfirmed. In-app
  only: type DELETE, and the copy enumerates what goes, to the same
  standard as Wipe Data.
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
  succeeds. "No rows at all" — confirmed by a successful query returning an
  empty set, never inferred from an error — is the only case that yields a
  blank state. `saveState` is debounced 500 ms and keyed on the user id, not
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
11. snapshots sharing a date → **collapsed, later wins** (2026-10-02).
    Not a new rule: `upsertSnapshotByDate` in `mutate.ts` has enforced one
    balance per date on every write since that morning, and this applies it
    retroactively to data written before it existed. **An invariant living
    in a mutator can always be bypassed by data that predates the mutator.**
    Found by the entity backfill, not by the round-trip property, and the
    reason is worth keeping: duplicate keys survive happily in an in-memory
    array, so `assembleState` puts both back and the identity holds. Only a
    database primary key rejects them (Postgres 21000). This is the single
    best argument for the date-keyed entity id — it moves the invariant
    somewhere it cannot be bypassed at all.
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
- **Color does three jobs and they do not overlap** (2026-10-06,
  `engine/palette.ts`). This REPLACES the role palette of 2026-10-03, which
  derived a hue from what the money was doing. Roles still exist and still
  decide things — red versus plain, which categories can carry a cumulative
  column, how the Budget sections — but **nothing derives a hue from a role
  any more.**

  | Job | Color | Means something? |
  |---|---|---|
  | Charts and brand | brass, one hue | no — rank, in the pie only |
  | Dashboard account cards | five cool hues by card POSITION | **no** — decoration that helps scanning |
  | Direction | green in, red out, plain for money kept | **yes**, and it is the only one |

  **Why the role palette came out, when it passed every check it was given.**
  It did pass: seven hues, all-pairs ΔE across four vision types, a CI gate.
  The failure was upstream of the numbers — asking color to carry a
  TAXONOMY at all. Seven hues is seven things to learn before the app means
  anything, and three days in, the person who commissioned it still could
  not read the Ledger. A chart in one hue says "these are shares of one
  total", which is the only claim a spending chart has to make; the label
  beside each slice already says which share. Note the shape of this one for
  later: a system can be internally correct and still be the wrong system,
  and no amount of validating the hues would ever have surfaced it.

  **THE PIE IS TOP FOUR PLUS OTHER, and that is a trade made on purpose.**
  Brass holds four distinguishable steps: measured ΔE2000 on the worst
  adjacent pair, seven steps came out 4.1–4.5 and four steps 8.1–10.9. On
  the author's own data that folds Groceries, Gas and Discover Bill into
  Other — a real loss of detail in the pie, accepted because four wedges
  you can tell apart beat seven you cannot. Bills and one-offs still break
  out by item, and Other still opens in the legend.

  **TWO FOLDS, NOT ONE, and getting this wrong was caught by looking at
  the rendered bar rather than the diff.** The engine folds at 8, which is
  the BAR's row count and is unchanged — the bar is the full view, every
  row sits beside its own label and its own length, and one flat brass has
  no ramp to run out of. The pie folds AGAIN, in the view (`foldForPie`),
  to four plus Other. Moving the single cap to 5 would have cut the bar to
  four rows as well, removing the view you turn to when the pie is too
  coarse — which is the only reason a coarse pie is acceptable. A chart
  toggle must change how much is DRAWN, never the data. `foldForPie`
  flattens any Other it is handed rather than nesting, so `children` is
  always one level deep and "Other (n)" counts real slices.

  **Card color is decoration, stated as such.** Assigned by card order,
  cycling, alternating light and dark steps so neighbors never sit close.
  It says nothing about the account. Loans take NO card color — gray line,
  no dot — so five loan cards look alike; acceptable because the Debt
  section collapses to one card by default and each card inside is
  labeled. Checking has never had a hue and still does not.

  **Red is money GONE — and the two tabs answer that differently on
  purpose.** The LEDGER reds every outflow, savings transfers and loan
  payments included: it is a running balance read down a column, and what
  matters there is that the money left the account. The BUDGET prints
  saving and debt rows plain: it answers where the month's money WENT, and
  "saved" and "spent" are genuinely different answers to that question.
  One rule was tried across both from 2026-10-06 and the Ledger half was
  reverted on 2026-10-08 after living with it — a plain $300 beside a red
  $112 made the plain one look like it was not coming out.
  `isRetainedOutflow` is the Budget's rule only, and says so.

  **The gate enforces the thresholds under every vision type, with no
  exemptions.** Adjacent steps of the brass ramp >= 8.0, every pair of card
  colors >= 9.0, measured in ΔE2000 under normal, protan, deutan and
  tritan; every chart, card and direction color >= 3:1 on both surfaces it
  can land on. Monotonic L* on the ramp is asserted ON TOP of the ΔE floor,
  not instead of it: lightness is the one channel no dichromacy touches, so
  it is what guarantees the ORDER survives, which a ΔE number does not say.

  Measured 2026-10-06: brass ramp worst adjacent pair 10.9 dark / 8.1
  light; card set worst of ALL pairs 9.2 dark / 10.7 light; lowest contrast
  3.16:1. Direction measures 5.5 under deuteranopia, which is the classic
  red/green collapse and is legal only because color never carries it
  alone — the sign, the column and the label all repeat it.

  **The gate's instrument is itself under test.** `tests/cvd-reference.test.mjs`
  checks every pair the gate measures against coloraide 8.13 — three
  simulation models, and exact agreement with Viénot — and runs in
  `npm test`. It exists because the simulation was silently wrong for a
  day; see the decision log.

- **Where color appears at all.** Chart marks, the Dashboard's account
  lines and their label dot, and amounts (red/green). NOT on the hero,
  section headers, chrome, the tab bar, ledger row names, ledger column
  headers, calendar dots, the category manager, or the Budget's rows —
  every one of those carried a role hue until 2026-10-06 and none of them
  needed one.

- **RULE: any view that orders categories by value must not rest identity on
  color alone.** The relief is inline labels — the category's name next to
  its mark, not only in a legend. With one hue in the charts this is no
  longer a near miss to be managed but the load-bearing mechanism: the pie's
  ramp says rank and nothing else, so the label IS the identity.

  A related case, same rule: a mark too small to hold a label (a dot, a
  sparkline point) must not be the only place a fact is stated. Such a mark
  may indicate presence or density, but the identity behind it has to be
  reachable as text — a tooltip, a detail panel, an adjacent list. The
  calendar's day dots are the worked example, and since 2026-10-06 they are
  honest about it: they are secondary-text gray and claim only "something
  happened here", with each carrying a title naming its category, item and
  amount, and the day detail listing every transaction in words.

- **Colors are inline styles** (`pieFill`, `barFill`, `cardColor`), never
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

  Rows carry no mark of their own: the role dot added 2026-10-05 came out
  again on 2026-10-06 with the rest of the role palette, and the column
  headers lost their hue at the same time. What role still decides on this
  tab is whether the Out amount is red. The **Cumulative columns** picker offers
  only categories this window actually steps, plus any already switched on
  — see the decision log. It sits directly above the table rather than in
  the toolbar: it is list-only and does nothing to the Planned spending panel,
  so placing it over that panel implied a relationship that isn't there. The
  horizon slider stays in the toolbar because it genuinely drives both.
  A **List / Calendar** toggle switches the rendering (`CalendarView.jsx`,
  per device via `devicePrefs`, `ledger-calendar`). The calendar is a month
  grid over the same rows: category-colored dots plus the day's net, click a
  day for its transactions. **The running balance is list-only** — a
  7-column grid has nowhere to put it, and it is the list's whole reason to
  exist; a faked or omitted-but-implied balance would have two views
  disagreeing about the app's most important number. Cumulative columns and
  multi-select hide in calendar mode, being list-only concepts.
  Per-day aggregation is `groupByDay` in the engine, so a day's net and the
  running balance can never tell different stories.
  Dot overflow is CAPPED (`+N`), not wrapped: grid cells share a row height,
  so wrapping makes the whole row taller and gives quiet neighbors
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
  user didn't categorize lands — so drawing it as one slice is grouping by
  "uncategorized", which carries no information at 40% any more than at
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
    beside the pie. The expanded rows carry their own colors with no wedge
    to point at, which the legend says once ("All inside the gray wedge")
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

  Color in this panel is brass and nothing else (2026-10-06). The PIE
  ramps by RANK over four wedges plus a gray Other; the BAR gives every
  named row the same brass, because the bar keeps every row and a ramp
  would start lying at the fifth. The ramp runs AWAY from the surface in
  each mode — light steps on the dark card, dark steps on the white one —
  which is why the two arrays run in opposite directions. Item slices are
  no longer tints of anything, so the color rule applies at its strictest:
  every item slice carries its parent's name inline ("Rent · Fixed bills")
  in the legend, the bars and the tooltip, because that label is now the
  only thing distinguishing it.

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
  Quick Setup wizard (once per account, reopenable), **About** (a 12-section
  walkthrough of every feature — still `components/Tutorial.jsx` on disk,
  sidebar on desktop, chip row + full screen on mobile) with the guided
  tour launched from it, account strip
  (read-only balance + Confirm-gated update that also snapshots), Settings
  (a short list of SECTIONS, each with a Manage button opening its own
  screen with "← Back to Settings": per-device theme inline, the category
  manager, Account — address, provider, member-since, sign out — and last,
  visually separated, the danger zone: wipe and delete, both with full
  confirmation), Import (Budget-grid CSV, per-transaction
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

   **DELETING a feature is the half that gets missed, so it gets its own
   step: grep for its name across the docs and the copy BEFORE you commit,
   not after.** Adding a feature makes you write about it, so the doc
   update rides along for free. Removing one makes you delete code, and the
   sentences describing it live in four other files that go on reading as
   though they were maintained. Grep the removed noun and the removed verb
   (the British spelling of "color", "color picker", "Savings columns",
   "mark paid") across
   `PROJECT_SPEC.md`, `README.md`, `src/components`, `src/engine` comments
   and `mobile/`. Every stale line the 2026-10-05 sweep found was a
   removal or a rename; not one was an addition.
1a. **American spelling everywhere** — UI copy, comments, this file, commit
   messages. Not a style preference: the code already says `color`,
   `normalize`, `gray-500`, so British prose beside it meant the same word
   was spelled two ways in one file, and a reader could not tell which was
   the identifier. Swept 2026-10-08 (124 instances of the British spelling
   of "color", plus eleven other forms, across 32 files); it had never been
   done before, because nothing had ever said to do it. Enforced since by
   `scripts/check_spelling.mjs`, which runs in `npm test` — the sweep had
   started decaying within the week, in prose written the same day.

   One trap, hit on the first pass: a blind stem replacement rewrote
   a real package name inside `mobile/package-lock.json`
   and would have broken the install. Generated files are out of scope, and
   a sweep like this gets read before it gets committed.

2. **README.md stays current** for a public audience. Its screenshots are
   the SAME generated set the landing page uses (`public/screenshots/`,
   `npm run screenshots`) — there is no second hand-made set to forget. The
   old `docs/screenshots/` was exactly that second set, and it sat eight
   months stale behind a README that looked maintained.
3. **Engine behavior gets harness coverage** in the same commit; the harness
   lives in `tests/` and runs in CI.
4. **The in-app About page matches shipped features**
   (`src/components/Tutorial.jsx` — the file kept its old name, the UI did
   not); update it in the same commit as any feature change. A stale
   explanation is worse than none. This rule covers in-app copy generally,
   not just that file: a feature that is REMOVED has to be swept out of the
   sentences describing it, which is the half that keeps being missed.
5. **Verify the thing the USER touches, not the thing you built.** Three
   failures in one week were the same failure wearing different clothes:
   a form verified standalone while its routing was never clicked, so the
   feature was broken and the component perfect; a scripted edit asserted
   as text but never as behavior, so it shipped looking applied; and an
   end-to-end check that only ever supplied well-formed input, so it
   proved the arithmetic while the form was unusable. The rule that covers
   all three:
   - **Start from the real entry point.** A click on the actual surface,
     not the component in isolation.
   - **Assert every replacement**, and when the edit is behavioral assert
     the behavior — `grep` proves the text changed, never that the code
     does what the text says.
   - **Feed it the wrong input too.** Blank fields, half-filled rows,
     values in the wrong box. A harness that only supplies correct input
     is testing arithmetic, not the product.
   - **Look at the output.** For anything visual, render it and read what
     is actually there. Describing a palette from its inputs is how
     "bills gold, savings blue" shipped as brown and navy.
   - **An in-memory replay cannot model a database.** A save was
     "verified" against a synthetic commit and shipped broken, because
     the one thing the replay could not reproduce was that a DATABASE
     REMEMBERS DELETED KEYS. If the thing under test persists, test it
     against something that persists — a fake server enforcing the same
     constraints is enough, and it reproduced the bug in one run.
   - **Prove the check can fail.** The first attempt at type-checking the
     JS files reported zero errors because those files were not in
     `include` at all. A green result from a check that never ran is
     worse than no check: introduce a known-bad case and watch it go
     red before believing a green.
   - **Then check that the number is the RIGHT number.** A check that can
     fail and a check that is correct are two different claims, and the
     second one is the one that got skipped: the palette gate's dichromat
     simulation was driven red on purpose, passed that, and had been
     reporting values three to four times too severe the whole time. Any
     check that MEASURES rather than merely asserts needs a known answer
     from somewhere else — an independent implementation, a published
     value, a hand calculation — and that comparison belongs in the test
     suite, not in the afternoon it was written.

   `scripts/fakeSupabase.mjs` is the phone's version of the same idea: a
   recording stand-in the simulator is pointed at with
   `EXPO_PUBLIC_SUPABASE_URL`, so the app runs completely unmodified —
   real sign-in, real store, real `planWrite` — and every write that
   leaves the device is readable at `/__log`. Stubbing the provider
   instead would replace the wiring, which is the thing under test.
   **Known gap, 2026-10-08:** there is no way to drive a TAP on the
   simulator from here — `osascript` lacks assistive access and neither
   `idb` nor `cliclick` is installed — so the last mile is a human
   finger. Granting Accessibility to the terminal, or installing
   `idb-companion`, would close it.

   `scripts/fixtureApp.mjs` exists so the first bullet costs nothing:
   `openFixtureApp()` boots the real bundle through the real auth gate
   and the real `loadState`, holding an invented account, and hands back
   a page you can click. Use it rather than reaching for the author's
   signed-in browser.

6. Data-shape changes are migration-safe: **idempotent always**,
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

*Run 2026-10-02.* 131 rows across four accounts; verification 62/62. The
backfill found three things the round-trip property could not, all recorded
as migrations or script fixes: same-date snapshots (migration 11); a
backfill that upserted on the primary key and therefore was NOT idempotent
for a seeded account, because `normalize()` mints fresh category uids every
call — it now REPLACES a user's rows rather than merging; and two false
alarms ruled out rather than assumed, the seeding nondeterminism in the
verifier itself (category ids now compared by position, only where the blob
had none, with an added assertion that nothing references a seeded id) and
a key-order-only difference, which is meaningless here because `jsonb` does
not preserve key order.

An earlier claim that one tester's checking balance would shift at
migration was **retracted**: the apparent anchor disagreement was the old
"newest snapshot" reduce breaking a tie between two same-date rows by
keeping the first. Migration 11 removes the tie. No user-visible number
moves for anyone.

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
  rule to enforce. One intended behavior change — correcting the NEWEST
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


### Mobile backlog (audited 2026-10-03)

Audited when the phone could WRITE exactly two things — the verified
checking balance and a category balance snapshot. Transaction editing and
the recovery stash landed 2026-10-08 and are struck through below; the
rest stands. In build order; **[D]** needs a design decision, **[P]** is
a port.

0. ~~**Add / edit / delete a transaction**, and the recovery copy with
   it.~~ **SHIPPED 2026-10-08.** The phone can change the forecast. Scope
   is chosen BEFORE the editor opens (`ScopeSheet`), the editor therefore
   has no mode, and delete is in the same sheet because it carries the
   same ambiguity. The stash ships in the same commit, as decided. See
   the decision log.

2. **Account deletion + a Settings screen** [P] — **APP STORE
   SUBMISSION BLOCKER.** Apple's guideline 5.1.1(v) requires an app
   that creates an account to let the user delete it from inside the
   app. The web has it; the phone does not, so the build cannot be
   submitted as it stands. This is not a nicety and not a "later". The screen also wants sign-out (currently stranded on
   the Dashboard), the account facts, and Wipe Data.
3. **Quick entry** [D]. Arguably worth MORE on a phone than on the web —
   entering a cash spend while standing in a shop is the case. Decision:
   whether it is the same keep-going-until-closed surface the web has,
   or a single-shot sheet.
4. ~~**Spending tab** [P].~~ **SHIPPED 2026-10-08.** The fourth tab, with
   the dead-month filter and the untrack nudge.
5. **Loan and asset setup / edit terms** [P]. Without it the loan card's
   "Add the rate and original amount" prompt has nowhere to go, and
   `assetKind` cannot be changed on the phone.
6. ~~**Log a contribution** [P].~~ **SHIPPED 2026-10-08** — the
   "Contributed" figure had implied a control that did not exist.
7. **Onboarding + guided tour** [D]. A user who signs up ON the phone
   currently lands in an empty app. Decision: port the wizard, or state
   that first-time setup is a web task and say so at the empty state.
8. ~~**The recovery copy** [D].~~ **SHIPPED 2026-10-08** alongside
   transaction editing, which is what "ships with item 1" meant.
   `lib/stash.ts`, awaited before the optimistic apply, reported and
   discarded on relaunch — never replayed.

9. **Export** [D]. A JSON/CSV download means the iOS share sheet, not a
   file download. Import probably does not belong on a phone at all.
10. **Horizon control** [D]. The phone has a device-local date chip
    where the web has a synced slider. The chip is arguably the better
    phone control; the decision is whether it should write
    `settings.ledgerHorizon` like the web does, or stay local.

Deliberately NOT ported: drag-to-reorder (HTML5 drag never fires from
touch, and the web already disables it on phones), and the Budget's
pinned-column grid, which is already reshaped to one card per month.


Later, in rough order:

0. **Two deferred copy items, both noticed 2026-10-03 and both left
   alone on purpose.** (a) The guided tour's Spending stop does not
   explain the tab — it names it. Spending is the hardest of the four to
   describe, because the thing it does (compare a logged actual against
   a rule's amount without ever changing the forecast) is the whole of
   principle 1 in one sentence. (b) The empty history caption, "One
   point so far (Oct 3). This is where you stand. Log it again next
   month and this becomes a line.", reads as three short sentences
   fighting each other. Neither is a bug; both want writing rather than
   coding, which is why they are not fixed in passing.
1. **The mobile backlog above**, items 1-2 especially — the phone cannot
   edit a transaction, and in-app account deletion is an App Store
   submission blocker.
2. **Verify the pg_cron purge actually ran.** `cron.job` is scheduled;
   `cron.job_run_details` has not been read since. A deletion feature
   nobody has watched execute is a claim, not a feature.
3. **`storage.js` under `// @ts-check`** — measured at 25 implicit-any
   complaints under `strict`, so a contained afternoon rather than a
   rewrite, and it is the file that touches the typed engine most.
   `App.jsx` stays out; the runtime enum guard covers it instead.
4. **The nine audit findings** from 2026-09-24 remain parked, minus the
   two that mark-paid's deletion closed (#1 and #6).
5. ~~**Light-mode pie shades** run close to navy at the fourth step.~~
   **CLOSED 2026-10-06, superseded.** There are no role shades: the pie is
   a four-step brass ramp, gated on adjacent ΔE2000 and on monotonic
   lightness. Nothing in it can run near navy.
6. **Count orphans live on the WEB, then one press everywhere.** The
   phone's editor counts the dated amounts a schedule change would orphan
   as you type, shows the number beside the button, and saves on one
   press — the warning has already been read. The web needs two presses
   ("Save", then "Save anyway") only because it does not learn the count
   until submit. That is a limitation, not a decision: move the count to
   render time and the second press goes away. Small, and it ends a
   difference between the clients that nobody chose.
7. **Tombstone retention / purge job.** 90 days is documented but no
   purge is scheduled; the rows accumulate. Read-only offline means the
   window only has to outlive online devices refetching, so this is
   housekeeping, not correctness.
8. ~~**The Ledger prints saving and debt amounts in red, the Budget does
   not.**~~ **CLOSED 2026-10-08, as intended behavior.** Unified on
   2026-10-06, reverted on the Ledger side two days later after using it:
   the tabs ask different questions and the difference in treatment
   follows from that. Recorded as a decision rather than an inconsistency.
9. ~~**Color customization / role hue schemes.**~~ **RETIRED 2026-10-06,
   moot.** The question was whether per-category recolor should return or
   whether the user should pick each ROLE's hue. Neither survives the
   rework: roles no longer have hues to pick. What is left to customize is
   one brass ramp and five decorative card colors, and a scheme picker for
   decoration is a settings screen that buys nothing. Worth keeping from
   that entry, because it turned out to be the right instinct pointing at
   the wrong fix: the complaint read as "wrong hue" and was actually "this
   tab is unreadable", and the answer was fewer colors rather than
   different ones.

10. **Retired palette machinery still exported from the engine.**
   `CATEGORY_PALETTE`, `paletteColor` and the `PaletteIndex` type survive
   in `model.ts`/`types.ts` with no renderer left to use them —
   `ColorSwatches` was the last one and is gone. Deleting them reaches
   `ProjectedEvent.color` and the golden fixtures, so it is a small
   migration rather than a delete, and it is not worth doing at the end
   of a day. They are inert in the meantime: nothing reads them.

Further out:
- iOS client: **`mobile/` exists as of 2026-10-02** — Expo SDK 57 /
  RN 0.86 / expo-router, reusing `src/engine` verbatim rather than
  reimplementing the money math. Three lines of `metro.config.js` do it:
  `watchFolders` (Metro only watches its own project root, so a file above
  it is invisible), `nodeModulesPaths` + `disableHierarchicalLookup`
  (resolve every package from `mobile/node_modules` and never the web
  app's — two copies of React in one bundle is the classic failure), and
  the explicit `.ts` specifiers the engine already uses. Verified by
  bundling: 1181 modules, and engine string literals ("Fixed bills",
  "Uncategorized") are present in the output, so the engine is genuinely
  linked rather than silently dropped. The engine's purity is what makes
  this config rather than a build step.

  **Feature parity pass, 2026-10-02.** Ledger with the List/Calendar
  toggle and the Planned spending panel (pie/bar, Other expansion);
  Dashboard with a collapsible hero, per-card history charts, Show
  history, logged balances, contribution totals and loan progress; Budget
  as the real monthly grid with a pinned category column. Four things were
  reshaped on purpose, and none of them is a cut feature:

  - **The pinned column is PARALLEL COLUMNS, not a sticky cell.** RN has no
    `position: sticky`. An outer vertical scroller holds the fixed label
    column beside a horizontal scroller of months: only the right side
    moves sideways, so there is no scroll syncing and no jitter. The cost
    is that both halves must agree on row height, so `ROW_H` is a constant
    and lives in exactly one place — table layout gave the web that for
    free, and getting it wrong drifts labels out of line with their
    numbers.
  - **Charts are hand-rolled on `react-native-svg`**, not a chart library.
    The shapes are a donut, a sparkline and a horizontal bar;
    victory-native XL wants Skia and a lot of surface area, gifted-charts
    has layout opinions that fight a dense dark design, and three svg
    primitives is less code than configuring either. Works in Expo Go with
    no native build.
  - **The calendar pages ONE MONTH at a time** with ‹ › rather than
    scrolling continuously, and the day detail is a panel under the grid
    rather than a popover. A phone is narrow and tall; popovers on touch
    need dismiss affordances and cover what you tapped.
  - **`spendingSliceColor` moved into `engine/model.ts`.** Two clients
    render that chart now, and a tint ramp reimplemented per client is a
    drift waiting to happen — the web and the phone would slowly disagree
    about what color a slice is. The web imports it from there now.

  Kept verbatim because they are rules, not layout: every slice carries its
  label inline, item slices carry their parent's name, the pie never
  re-shapes (Other expands in the legend only) while the bar expands rows
  in place, calendar dots are capped rather than wrapped, the day detail
  names the category in words, and the running balance stays list-only.

  **Read-only, deliberately.** The per-entity write path with its version
  guards is real work, and shipping it the same night production data
  moved would risk the phone writing bad rows to answer a question —
  "does this feel like an app" — that writing does not help answer.
  Email+password auth only: Google OAuth needs a redirect that survives
  the Expo Go sandbox, and the magic-link fallback is down behind the
  broken confirmation email. `mobile/tsconfig.json` sets
  `allowImportingTsExtensions` and includes `../src/engine`; the root
  ESLint ignores `mobile` because it is a separate project whose Metro
  config is legitimately CommonJS. **Metro resolves the explicit `.ts`
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
  same sense as the others: `bill` is where uncategorized money lands by
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
- **The Update balance copy warns before it explains** (2026-10-03). It used
  to describe the mechanism — "everything dated before that is already
  inside this number; the forecast builds forward from it" — which is true
  and says nothing about what it costs you. Setting an as-of date makes
  every earlier transaction drop out of the ledger, so a user with an
  unpaid bill dated before the cutoff watches it vanish from the forecast
  while still owing it. The warning is the point and the mechanics are
  secondary, so the warning goes first. Two things the copy has to keep
  exactly right: the cutoff is `balanceAsOf`, NOT today — a date set in the
  past drops everything before THAT — and `buildEvents` filters
  `e.date >= balanceAsOf`, so same-day transactions are kept and "before
  that date" is exact rather than approximate.
- **Settings is a list of SECTIONS, each behind Manage** (2026-10-05).
  This REVERSES the 2026-10-03 call that Account should be inline, and the
  reversal is worth keeping because the original reasoning was not wrong,
  it was aimed at the wrong thing. It argued about the CONTENT — three
  read-only facts behind a tap is navigation for nothing — and that is
  still true of those three facts in isolation. What it missed is the
  CONTAINER: Settings reads either as a short scannable list of sections or
  as one long scroll, and every section that prints itself inline makes the
  ones below it harder to find. Account is also the section that grows —
  changing an email, changing a password, sessions — so inline was a shape
  that only fit on the day it was measured.

  The pattern is the category manager's, exactly: its own modal, "← Back to
  Settings" top-left, "Done" top-right, and subscreens are SIBLINGS of
  Settings rather than children, so there is never a second scrim stacked
  over the first. The email stays on the Settings row itself, because that
  one fact IS what people open Settings to check — the subscreen is for the
  rest, and for what lands there next. `providers` comes from
  `app_metadata.providers` and deliberately does not try to tell a magic
  link from a password — they are one credential to the database, and
  claiming otherwise would be inventing a distinction.
- **An unanswered `assetKind` renders as `investment`** (2026-10-03), and
  the direction is the whole point. Both defaults look defensible until you
  notice which way the error falls: an investment gets no projected line,
  so defaulting to investment WITHHOLDS a projection on an unanswered
  account, while defaulting to savings DRAWS one over market-exposed value.
  Withholding is recoverable by answering; a fabricated forecast over a
  balance the market moves is the error the no-projected-line rule exists
  to prevent.

  Never inferred from the name. An HSA reads like savings and can be
  entirely in one stock, which makes it the most market-exposed thing
  someone owns rather than the least — **not interacting with an account is
  not the same as not being exposed by it**. Migration 12 therefore adds
  the field ABSENT and guesses nothing; a user stating their own answers is
  data entry, which is `scripts/set_asset_kinds.mjs`, deliberately not a
  migration (maintenance rule 6).
- **The setup wizard commits its own result** (2026-10-03). It used to
  hand `{ recurring, oneoffs, checkInBalance }` to `importCSV`, and that
  coupling broke it silently: when `importCSV` stopped adopting a balance
  on 2026-10-02 — correctly, because a CSV carries no verification date —
  the wizard lost its balance with it, and a new account's first ledger
  projected from zero. It survived because it only shows on a fresh
  account. The wizard is NOT an import: the user is sitting in front of
  the app typing the number, so today genuinely is the verification date
  and principle 1 holds, with both the balance and its date coming from
  them. The balance step also has no Skip and no disabled path to Finish,
  and `finishNow` re-reads the input rather than trusting that state has
  landed — this is the one value the entire forecast is built from.
- **About is the reference, the guided tour is the walkthrough**
  (2026-10-03). The old "Tutorial" was an explanation, which is valuable
  when you are confused and useless as a first experience: reading about
  four tabs is not being taken to them. So it is renamed About and sits in
  the header with the other read-and-leave controls, and `GuidedTour`
  fires once after the wizard, switching to each tab and saying what it is
  for while you look at it. Deliberately not a true spotlight with
  cut-outs and element measuring: that needs every target to expose a ref
  and breaks whenever a layout moves. Quick Setup left the action row for
  the same reason About did — the action row is what you DO with your
  data, and neither of those is that.
- **Chrome headless enforces a 500px minimum viewport**, whatever
  `--window-size` says. A "390px" screenshot from the verification harness
  is a 500px layout cropped to 390, so a card that looks clipped at phone
  width may be fine. Shoot at >= 500 and read the real width out of the
  page before believing a narrow-screen bug.
- **The wizard's last step is ONE screen, not three** (2026-10-03).
  Savings, investments and debt as three compact groups of name + amount.
  The obvious version takes the wizard from five questions to eight and
  people leave; someone with nothing to add passes this in a second. It
  sits AFTER the balance because everything before that is what a working
  Ledger needs and this only fills the Dashboard — a quitter still leaves
  with the forecast working, which is what makes the app worth reopening.

  **Debt is created without terms, deliberately.** Name and what you owe
  now is enough for the category, the card and the net position; asking
  for principal, APR and a start date per loan during setup is exactly
  where someone gives up. `isLoanConfigured` stays false and the card
  prompts for terms later, when there is something to point at.
  `assetKind` is NOT asked here either — one more concept at the worst
  moment, and the unanswered default already withholds a projection
  rather than inventing one.

  Who this is for, which decided the above: people with a paycheck, some
  bills, a couple of accounts and some debt, who want one place to see
  the whole picture. Not someone with land and property holdings — that
  is why manual entry works at all, because the dataset stays small
  enough to maintain.
- **Semantic families constrain hue BEFORE the gate optimizes lightness**
  (2026-10-03). The order of operations was wrong and produced a system
  its own designer could not read. Hues were picked without a semantic
  rule and the search was left to separate them, which put bills at 255°
  and savings at 215° — the same blue family for two opposites, an
  obligation leaving versus money you keep. Separable by measurement,
  wrong by meaning.

  Families now: **out** (bill, one-off, debt) warm, **keep** (savings,
  investment) cool, **in** (income) green, and gray for no category. Every
  same-family pair is a semantic SIBLING, so splitting them by lightness
  reinforces the meaning rather than fighting it. The gate enforces this
  first: cross-family roles must be >= 60° apart in hue, checked before any
  ΔE maths, so a future edit cannot quietly recreate two blues.

- **The mapping is stated, in three places.** A role system that never
  says what its colors mean is a private language only the code
  understands. Dashboard cards name the role beside the category
  ("Roth IRA · Investment"), About carries a legend of all seven, and the
  spending chart already labels every slice inline.

- **Budget: direction owns the amounts, role owns a dot** (2026-10-03).
  Role color used to override the red/green on every saving/debt cell,
  putting two color systems in the same text. The amounts are direction
  only. (The dot this entry originally moved the role onto is gone too —
  2026-10-06 — and the rule survives it: one signal per element, and on
  these cells the signal is direction.)
- **The extras step: both fields labeled, no row silently dropped**
  (2026-10-03). `collectAccounts` filtered on a non-empty NAME, so a row
  with an amount and a blank name vanished without a word. A real user hit
  exactly that: the name box had no label, only a placeholder, under a
  section heading that already said "Savings", so they typed the amount
  and reasonably assumed the row was named. Both fields now carry visible
  labels, a half-filled row is flagged in place, and Finish is disabled
  until every started row is complete. Inventing a name from the section
  heading was rejected: quietly creating a category the user never named
  is the same class of error as quietly dropping one.
- **The wizard reuses, then prunes, the seeded defaults** (2026-10-03). A
  new account is seeded with Savings / Investments / Debt
  (`defaultTrackerCategories`). A wizard row called "Savings" used to make
  a SECOND one, and the untouched remainder sat on the Dashboard looking
  like something the wizard had created — which is how it was read. Now a
  row reuses a same-named category that has nothing logged (never one
  that does: that would be writing into real history on a name
  collision), and any seeded default still empty at the end is deleted,
  gated on no snapshots, no tagged items and no contributions.
- **Verification has to drive the real surface AND the degenerate input.**
  The end-to-end check for this step filled both fields on every row and
  then ran a synthetic commit, so it proved the happy path through
  well-formed input and nothing else. It passed while the form was
  unusable. A harness that only ever supplies correct input is testing the
  code's arithmetic, not the product.
- **Saving and debt amounts in the Budget are NOT red** (2026-10-03).
  They render in the default text color while bills and one-offs stay
  red, and that asymmetry is deliberate rather than an oversight: money
  moved into savings or investments, or put against a loan, is not money
  you lost. It left checking, which the running balance already shows.
  Painting it the same red as a bill would say you are worse off for
  having saved. Do not "fix" this for consistency with other outflows.
- **A palette is described from its RENDERED output, never its inputs**
  (2026-10-03). OKLCH hue is not HSL hue and the two diverge badly: the
  palette documented as "bills gold, savings blue" rendered brown and
  navy, and debt specified at OKLCH 20° came out HSL 346° — lipstick,
  not red. The hues are now chosen by checking what each OKLCH value
  actually produces (at L .55: 30 → red, 58 → orange, 80 → amber,
  150 → green, 240 → blue, 300 → purple), and `ROLE_HUE` records the
  input while the swatch sheet is what any claim about appearance has to
  be read off.
- **Hue specified in one color space, described in another, is a trap**
  (2026-10-03). OKLCH hue and HSL hue are different numbers for the same
  wheel and they diverge hard: OKLCH 20° is HSL 346° (lipstick pink), not
  red. The palette was specified in OKLCH, described in ordinary color
  words, and shipped as brown-and-navy while its own documentation said
  gold-and-blue. `ROLE_HUE` records the OKLCH input because that is what
  the search optimizes; **every claim about what a color LOOKS like must
  be read off a rendered swatch**, never off the number. At L .55 the
  mapping is 30 → red, 58 → orange, 80 → amber, 150 → green, 240 → blue,
  300 → purple, and that table is in `palette.ts` so the next person does
  not have to rediscover it.
- **The write PLAN is shared; only the transport is per client**
  (2026-10-03, `engine/entityStore.ts`). `planWrite` decides which rows a
  save touches, which version guard each carries, and in what order —
  upserts before tombstones, caller aborts on the first refusal. Two
  clients write `budget_entities` now and the rules must not exist twice:
  web and phone disagreeing about write order is a data-loss bug that
  presents as "works on my laptop". Pure, so the ordering rule is a
  harness assertion rather than a comment in two files.
- **A tombstoned row still occupies the primary key** (2026-10-03), and
  missing that aborted saves mid-plan. The client loads only
  `deleted_at is null`, so it holds no version for a tombstone, so
  `planWrite` plans an INSERT — and Postgres answers 23505. Treating that
  as a conflict was wrong: upserts run before tombstones, so the rows
  already inserted stayed, every row after the collision was dropped, and
  every tombstone was skipped. The user then saw "this device was out of
  date" on an account seconds old.

  The transport now handles 23505 by trying to REVIVE —
  `update ... where deleted_at is not null` — and only treats it as a
  conflict when that matches nothing, i.e. a real collision with a live
  row. Date-keyed snapshots make this near-certain to recur: wipe, log a
  balance, and the key `accountSnapshot:<account>:<today>` is already
  taken by this morning's tombstone. Reproduced against a fake server
  enforcing the same guard Postgres does, before and after the fix.
- **Closing the JS call-site gap, measured rather than guessed**
  (2026-10-03). `App.jsx` is JS, so `tsc` cannot see its calls into the
  typed engine — which is how `addCategory(s, name, 0, kind)` survived
  migration 13 removing the `color` parameter and created every
  manager-added category with `kind === 0`. Three things were measured:
  the five non-JSX JS files cost **12 JSDoc annotations** to put under
  `// @ts-check`, so they are in `tsconfig.include` now and a bad call
  from them is a compile error; `storage.js` costs **25** implicit-any
  complaints under `strict` and is deliberately still out; `App.jsx` is
  the big one and is not worth converting for this.
  
  What covers the two that remain is a **runtime guard on enum-ish
  arguments in the engine** — `addCategory` throws on a kind that is not
  "asset" or "debt". A type is not a guard when half the callers are
  untyped. It paid for itself on the first run by catching two more stale
  callers in the harness.
- **DEFERRED, deliberately: forecast accuracy as a single number.** The
  question worth answering is not "was electric $112 or $108" but
  "across everything I track, how far off is my forecast, and in which
  direction" — the number that says whether to believe your own projected
  balance, and one no other budget app can show because they have no
  forecast to validate. **Not designed yet, on purpose: there is one
  month of data.** Four or five are needed to see whether the aggregate
  gap is stable and informative or just noise, and designing the
  aggregation before knowing which it is means building on a guess.
- **One definition of the sync token, in one place** (2026-10-03).
  `loadState` took the max `updated_at` over the rows it had just
  selected — the LIVE ones — while `fetchVersion` took the max over ALL
  rows, tombstones included. After any save whose last operation is a
  tombstone (the wizard's seeded-default prune is exactly that), the two
  disagreed from the moment the page loaded, so the next focus event
  judged the device stale, stashed a recovery copy, replaced the
  in-memory state, and showed "your data had already been updated
  somewhere else" on an account nobody else had touched. `loadState` now
  calls `fetchVersion`. **There is no service worker in this project**,
  so a stale build surviving a deploy is not a thing that can happen —
  that hypothesis was checked and ruled out rather than assumed.
- **The landing-page screenshots are generated, not taken**
  (2026-10-03, `scripts/screenshots.mjs` + `scripts/fixture.mjs`). The
  first set was captured by hand on 2026-10-02 and was wrong by the next
  afternoon: the role palette shipped, and the public page went on
  advertising eight retired hues and a "Savings columns" label the app
  no longer had. A screenshot is DERIVED from the UI. It rots exactly
  like a generated file, so it has to be regenerable like one — `npm run
  screenshots` and the three images are current again.

  The account in them is invented and dated RELATIVE TO TODAY, so a
  regeneration months from now shows a current-looking account rather
  than one whose newest reading is stale. It is also the only version of
  this that is safe to re-run without thinking: a public page is the
  last place a real balance should appear, and "remember to use fixture
  data" is not a safeguard.

- **A fixture-backed browser harness, because rule 5 needs one**
  (2026-10-03, `scripts/fixtureApp.mjs`). Verifying from the real entry
  point used to mean driving the author's own signed-in account, which
  is slow, destructive, and impossible to leave behind in a script. The
  harness boots the real bundle through the real auth gate and the real
  `loadState`, with a seeded session and the Supabase origin
  intercepted, so a check can click an actual button and read what
  actually rendered. Production code is untouched: there is no demo mode
  that can be left switched on by accident, and the entire deception
  lives in one file nothing ships. The screenshots are one caller; the
  loan-editor check below was the second, within the hour.

- **A control that discards what you type is worse than no control**
  (2026-10-03). The role palette removed per-category color, and
  `LoanSetupModal` kept rendering a swatch row for several hours after
  `setupLoan()` stopped writing the value — the function still ACCEPTED
  a `color` argument and dropped it on the floor, which is why nothing
  failed and nothing warned. Found while reading a screenshot, not while
  testing. A dead parameter on a mutator is not harmless: it is the one
  shape of dead code that can keep a live UI alive on top of it.

- **A card does not say "SAVINGS · Savings"** (2026-10-03,
  `roleSuffix`). Naming the role beside a category is what makes the
  color system readable instead of a private language — but the three
  seeded categories are named Savings, Investments and Debt, which ARE
  the role labels, so the stutter was the DEFAULT state of every new
  account rather than an edge case. The suffix is dropped when the name
  already carries it, matching on case and plural; anything the user
  named themselves ("Roth IRA", "Car loan") still gets its role spelled
  out, which is the entire point of the suffix. Note the shape of this
  one: the general rule was right and its most common instance was the
  exception.

- ~~**The Ledger gets role dots.**~~ **REVERSED after one day**
  (added 2026-10-05, removed 2026-10-06), and the reversal is the useful
  part. The dots were the right answer to the question asked — the Ledger
  was the one surface the color system never reached — and the question
  was wrong. The tab was not unreadable for want of color; it was
  unreadable because seven hues meant seven things to learn, and adding an
  eighth surface to learn them on made the system bigger, not clearer. A
  day of living with it is what showed that, which is the argument for
  shipping a small change and waiting rather than reasoning about it
  longer.

- **The Cumulative columns picker offers only what this window steps**
  (2026-10-05). It listed every category you own, which on an account with
  fourteen of them is thirteen ways to widen the table and learn nothing,
  because a category with no scheduled transactions produces an EMPTY
  column. The filter is `stepped.key` over the rows actually in the
  window, which is the same signal the column itself renders from, so the
  picker and the table can never disagree about whether a column would
  have content.

  The one subtlety: the list is `stepped OR already visible`. Filtering on
  stepped alone would make a category whose last transaction just fell out
  of the horizon disappear from the picker WHILE ITS COLUMN WAS STILL
  OPEN, leaving an empty column and no control to close it. A filter that
  can hide the only way to undo its own effect is a trap, not a tidy-up.
  The count of what was left out is stated rather than silently dropped.

- **A system can be internally correct and still be the wrong system**
  (2026-10-06, the color rework). The role palette passed everything it
  was ever asked: seven hues, all-pairs ΔE across four vision types, a
  3:1 contrast floor per surface, a CI gate that had already caught nine
  bad candidates. Every measurement said it was good. Three days in, the
  person it was built for still could not read the Ledger.

  The error was a level above the numbers. Color was being asked to
  carry a TAXONOMY — seven categories of money, each a hue — and a
  taxonomy in color is a key you have to memorize before the app means
  anything. No amount of validating the hues could have surfaced that,
  because the hues were not the problem; the job they had been given was.
  Worth remembering the next time a check suite is green and the thing
  still does not work: ask what the check cannot see.

  What replaced it is smaller in every direction. One hue for charts, so
  a chart says "shares of one total" and the labels say which. Five
  decorative hues on the Dashboard, explicitly meaning nothing. Red and
  green for direction, which is the one place color was always pulling
  its weight. The validator shrank with it, and that is a feature: the
  old gate's all-pairs CVD rule existed because hue meant something, and
  keeping it on decoration would have been importing a constraint from a
  system that no longer exists.

- **A harness is torn down by killing the SERVER, not by deleting the
  file** (2026-10-08). `scripts/fakeSupabase.mjs` is pointed at with
  `EXPO_PUBLIC_SUPABASE_URL`, and Expo reads env once at METRO START and
  inlines every `EXPO_PUBLIC_*` into the bundle as a string literal.
  Removing `mobile/.env.local` afterwards changes nothing at all: the
  running server keeps serving a bundle with `http://localhost:5199`
  baked in, which on a physical phone resolves to the phone, and the app
  fails to connect with no clue why. An hour went into that.

  Verified rather than reasoned about, which is the only reason the
  answer is trustworthy: the served bundle was fetched from Metro and
  grepped. One occurrence of `localhost:5199`, zero of the real host.
  After killing and restarting Metro: zero and one.

  Two things came out of it. The app now shows a banner whenever its
  backend URL is not https (`IS_LOCAL_BACKEND`), so a harness left
  running announces itself instead of looking like a broken app. And the
  teardown is written down here, because "delete the env file" is the
  obvious wrong answer and I gave it.

- **"Has an expect()" is not coverage; mutation is** (2026-10-08,
  `mobile/scripts/mutate.mjs`). Three times in one week the finding was
  that a passing count implied coverage it did not have — a form verified
  standalone while its routing was not, 57 green assertions on a scope
  sheet whose editor never opened, and a test written for an unexported
  component that asserted literally nothing and was only caught because
  it failed to compile.

  So the renderer suite was audited by breaking things. 22 mutations, one
  per claim the suite makes: drop the occurrence option, let `rowTarget`
  return the wrong item, skip the delete confirm, make validation always
  pass, ignore `busy`, hand the history row's editor the wrong entry,
  rest the sparkline on the first reading instead of the last. **All 22
  were caught, and all 17 tests die to at least one** — which is the
  direction that matters, because a test nothing can kill is decoration.
  The runner reports both and exits non-zero on either.

  Its limit is worth stating with the result: it only covers what someone
  thought to break. It replaces nothing about reading a test and asking
  what it would miss; it catches the case where the answer is
  "everything".

  The plain-node suites were scanned the same day for one-line
  tautologies — an assertion whose expected side is computed the same way
  as its actual side. None found.

- **The phone is DARK ONLY, and that is a decision** (2026-10-08). The
  web carries both themes and will keep doing so. The phone will not:
  this phone is used in dark mode and nowhere else, and a second theme is
  not one switch — it is a second set of values to pick, check against
  every surface, and keep correct on every screen added afterwards,
  forever. `lib/theme.ts` is a flat object of hex values with no mode in
  it, and that is the shape to keep until someone asks. If a user asks,
  it becomes a real piece of work rather than a thing half-carried.

- **A renderer for the phone, after the same bug twice** (2026-10-08,
  `mobile/__tests__`). jest-expo + @testing-library/react-native, 17
  tests, in `npm test`. It exists because a passing count implied
  coverage it did not have — twice in two days: a form verified
  standalone while its routing was not, then 57 green assertions on a
  scope sheet whose editor never opened.

  **It is deliberately not a second place to test logic.** Anything
  assertable without a renderer stays in `tests/mobile-edit.test.mjs`,
  which runs in milliseconds and has no framework. What belongs here is
  only what needs mounting: does pressing the thing open the thing, is
  the control disabled when it should be, does the handler receive what
  the screen was showing. The first test in the file is the bug —
  pressing "Edit just Dec 1" and asserting the editor is on screen — and
  the suite was checked against a deliberately broken host before being
  believed.

  Two notes for whoever maintains it. `render` is ASYNC in RNTL 14 and
  silently returns a promise with no query methods if you forget to await
  it, which looks exactly like a broken component. And the shared engine
  lives above this package, so `moduleNameMapper` points `@babel/runtime`
  at `mobile/node_modules` — the jest equivalent of what
  `metro.config.js` does with `nodeModulesPaths`.

- **Scrub, because a phone has no hover** (2026-10-08, `lib/charts.tsx`).
  The Dashboard's history lines were pictures of data: the one question
  they exist to answer, "what was it in August?", could not be asked,
  because the web gets that from a Recharts tooltip and a cursor. Drag
  across one and it snaps to the nearest reading and names it; release
  and it returns to the newest, which is the figure printed on the card.
  The whole plot is the touch target rather than the dots, PanResponder
  rather than a gesture library (one axis, no composition), and the
  responder claims a gesture only once it is more horizontal than
  vertical so a flick still scrolls the page under it.

- **One modal per screen; a sheet changes its CONTENT, never presents a
  second** (2026-10-08, `mobile/components/BottomSheet.tsx`). Picking
  "Edit just this date" from the scope sheet did nothing at all: the
  scope sheet's `Modal` unmounted and the editor's `Modal` mounted in one
  React commit, and iOS will not present a modal while another is
  dismissing, so the second presentation was swallowed. Delete kept
  working, which is the tell — an `Alert` is not a `Modal`.

  The usual fix is to present the editor from the first sheet's
  `onDismiss`. It was not taken. `Modal.onDismiss` is **iOS-only**, so
  Android would never open the editor at all, and sequencing leaves the
  two-modal structure in place for the next pair of sheets to rediscover.
  One host, with the body swapped, means there is no race to sequence
  around. The same reasoning then caught a second instance before it
  shipped: reset and delete used to close the sheet and then write, so a
  fast failure would present the failure modal into a dismissing sheet —
  they now hold the sheet open until the write lands.

  **The 57 assertions on `mobile/lib/edit.ts` all passed while this was
  broken**, and that is the finding worth keeping rather than the fix.
  That file has no React in it on purpose, which is what makes it
  testable in plain node — and is exactly why it cannot see a
  presentation bug. It is the standalone-form failure one layer up:
  the logic was verified, the thing the logic was wired into was not.
  Covering it needs a renderer the phone's test setup does not have
  (jest + the RN preset + testing-library), which is a real gap and is
  named as one here rather than implied to be covered.

- **The tapped row is resolved ONCE** (2026-10-08, `rowTarget`). The
  sheet's heading, its button labels and the mutation its buttons run all
  come from one lookup. They used to come from two — a `rowsById` in the
  view for the name and a `findItem` in the handler for the item — which
  is a sheet that can say "Delete Paycheck" while deleting something
  else. The two agreed; the point is that nothing made them.

- **Scope is chosen BEFORE the editor opens, on the phone** (2026-10-08,
  `mobile/components/ScopeSheet.tsx`). The web asks inside the form, with
  a segmented "This date / Every time" that hides the rule's fields in
  occurrence scope. The reasoning carries over — scope up front rather
  than on save, because the fields mean different things in each — but
  the control does not: a form whose fields appear and disappear as you
  flip a toggle at the top is much harder to follow at 390px than on a
  laptop, and iOS already has an answer everyone knows, which is that
  tapping a repeating event in Calendar asks first. Taking the platform's
  pattern costs zero learning and leaves an editor with no mode at all.

  ORDER IS THE DEFAULT. "Edit just Oct 12" is first because the two
  mistakes are not symmetric, which is the same argument that made
  "This date" the web's default: someone meaning the rule who changes one
  date notices next month, while someone meaning one date who rewrites
  the rule silently changes months already reconciled.

  **Delete carries the same ambiguity and is answered the same way.** It
  lives in the same sheet, labeled by what it removes — "Delete Rent",
  with "Removes the rule and every date it generates" under it — so it
  cannot be read as "delete Oct 12", and it goes through a native
  destructive `Alert`. There is deliberately NO "delete just this date":
  the engine has no concept of a skipped occurrence, only an override of
  one's amount, so the button would be for a thing that does not exist.
  The nearest real action, resetting a date back to the rule's amount, IS
  offered — and only on a date that has its own amount to reset. Adding a
  true per-occurrence skip is a data-model change (a new exception list,
  a migration, `generate.ts`, both clients) and is not in this.

- **The phone's stash is reported, never replayed** (2026-10-08,
  `mobile/lib/stash.ts`). It ships in the same commit as transaction
  editing, because shipping bulk editing onto a client with no stash is
  shipping the gap rather than approaching it. It is awaited before the
  optimistic apply, so the copy exists before the thing it copies is at
  risk; AsyncStorage has no synchronous write, so a hard kill inside that
  window still loses the write. That is the right side to fail on —
  missing is recoverable, wrong is corruption.

  The designed-looking option was rejected and the rejection is the
  interesting part. Fingerprint the state the stash was built on, and on
  relaunch offer to re-apply when the fingerprint still matches: careful,
  conservative, and **it runs when an app is killed inside a few hundred
  milliseconds, perhaps once a year per user.** Nothing real would ever
  exercise that branch — which is precisely how this week's four worst
  bugs survived (the tombstone collision, the `@ts-check` false positive,
  a form verified standalone while its wiring was not, and a simulation
  nobody checked against a known answer). A rare branch that WRITES is
  the worst kind to get wrong, and the failure mode is a silent bad
  write. So the stash names what was lost and discards it. The cost is
  retyping one transaction almost never.

- **A measuring instrument nobody measured** (2026-10-06). The palette
  gate reported that two Dashboard colors were ΔE2000 **2.3** apart under
  deuteranopia — indistinguishable. The real answer is about **10.4**. Its
  dichromat simulation was applying a set of RGB→RGB coefficients that are
  specified for GAMMA-ENCODED sRGB to linearized values, which exaggerated
  every collapse by three to four times.

  The damage was not the wrong number, it was what got built on it. Within
  the hour the gate had been *relaxed* — the ramp and the card set exempted
  from their CVD floors — on an argument constructed to accommodate the
  bug, and the spec had gained a finding ("this card set cannot carry
  meaning under CVD") that was simply false. The reasoning was coherent.
  It was reasoning about a fiction.

  This is the same failure as every other one in this log, wearing its
  most dangerous costume: **the thing that was never verified was the
  verifier.** Rule 5 says prove a check can fail before believing it
  passed, and that was done — each arm of the gate was driven red on
  purpose. What was never done is check that a passing number was the
  RIGHT number. A test that can fail and a test that is correct are two
  different claims.

  The fix is structural, not a patched function. The color maths moved to
  `scripts/colorMath.mjs` so it can be imported without running the gate;
  `tests/cvd-reference.test.mjs` compares every pair the gate measures
  against coloraide 8.13 under three published models, and runs in CI.
  Agreement with Viénot is exact to 0.00 across 141 comparisons — the last
  residual was the instrument rounding simulated colors to 8-bit hex
  before measuring them, which is right for a pixel and wrong for a
  measurement. The reference file records how it was generated. With the
  simulation fixed, the palette passes the originally specified thresholds
  unchanged; the relaxation and the false finding are both gone.

  Two cheap habits that would have caught it, now in the test: compare
  against an independent implementation, and keep one spot value with a
  known answer (a protanope and a deuteranope both see pure red as a dark
  yellow with R and G equal — the broken version got that visibly wrong
  and nobody looked).

- **Removing a feature is a documentation change, and that is the half
  that gets missed** (2026-10-05, from a full sweep of the spec, the
  README, the About page and in-app copy). Rule 1 held for everything
  ADDED; every stale sentence found was about something taken away or
  renamed. Adding a feature makes you write about it, so the doc update
  rides along; removing one makes you delete code, and the sentences
  describing it sit somewhere else entirely and go on reading as though
  they were maintained.

  The sweep's worst find was not copy at all. `README.md` told a new
  contributor to run `supabase/schema.sql`, which creates `budget_states`
  — the single-document table frozen two days earlier. Following the
  README exactly would have produced a database the app cannot use, with
  no error pointing at the cause. Next to that: the README still described
  storage as "a single JSON document per user, stored as jsonb", and §5
  still documented the whole-document `updated_at` guard as the write
  model, four days after per-entity versions replaced it.

  The structural fix is the one already applied to the screenshots:
  **delete the second copy rather than promise to keep it in sync.**
  `docs/screenshots/` was a hand-made set the README displayed; it was
  eight months stale behind a README that looked maintained. There is now
  one generated set, in `public/screenshots/`, used by both the README and
  the landing page. A second copy of anything is a copy that will rot.

- **The untrack nudge is an observation, not a warning** (2026-10-03).
  A fixed $150 payment flagged "track actual vs budgeted" has no
  variance to measure, but the app does not argue at the moment of
  flagging: `fixedSoFar` waits until at least three logged months have
  matched their expectation exactly, then offers one line — "$300 every
  month across 3 months. Nothing to track here. Untrack it." A warning
  about what might happen is a guess; a statement about what did happen
  is not, and it also catches the bill that genuinely was variable and
  has become fixed, which a warning at flag-time never would.
