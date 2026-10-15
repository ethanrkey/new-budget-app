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
identical across both builds so it stays one key. **The mark is FLAT gold
(`#eebb4d`) — build 5's artwork, restored 2026-10-15 after builds 6-8 tried a
metallic gradient and then fillets on its concave junctions.** Lighting belongs
to iOS 26, which composites its own glass and specular pass over the `.icon`
layer; a second one underneath read as plastic, and the shape is what wants
redrawing (backlog). If a gradient is ever tried again it must use
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

**Scope, settled 2026-10-09.** Four answers that had been assumed rather
than stated, and each one closes off work:

- **iOS only. Android never matters.** The `android` block in
  `mobile/app.json` is template residue, not a plan.
- **No monetization now, and never ads.** Nothing in the data model or
  the UI is to be shaped around a future ad slot or a tracking need, and
  the privacy copy can keep saying what it says.
- **The App Store is the goal**, which makes the submission blockers real
  deadlines rather than tidiness.
- **Built so that someone who is not the author finds it useful**, with
  the door left open if it ever gains traction. This is the one with
  teeth: it promotes the copy pass and the parity audit from polish to
  requirements, it makes cold onboarding a feature rather than a
  convenience, and it means any place the app quietly assumes it is being
  used by its author is a defect. It is NOT a license to build
  multi-tenant machinery nobody has asked for.

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

  **An Apple gap, recorded 2026-10-11 before it can be forgotten.** When
  Sign in with Apple ships, deletion acquires a second obligation:
  revoking the user's Apple tokens. The purge deletes the `auth.users`
  row, which removes OUR record and leaves Apple's grant in place —
  Apple requires the revoke call, and it needs the `.p8` signing key, so
  it belongs in `purge_due_accounts()` or an edge function beside it,
  never in a client. Nothing here is wrong today, because nothing signs
  in with Apple yet. It becomes wrong the day something does.

  **No email confirmation.** Written 2026-10-02 because the project's SMTP
  was down and a confirmation that silently never arrives is worse than
  none — it would look like deletion failed while the request sat
  unconfirmed. **That reason expired on 2026-10-03**, when custom SMTP
  (Resend) started delivering; it was never revisited because nothing
  prompted a reread. The behavior has NOT changed and is not changed here:
  in-app only, type DELETE, and the copy enumerates what goes, to the same
  standard as Wipe Data. What changed is its standing — an email step is
  now a decision nobody has made rather than a constraint, and it is
  genuinely arguable in both directions (a second channel is real
  protection against a hijacked session; it is also a new way for the most
  destructive action in the app to stall silently). Left open deliberately
  rather than settled in passing.
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

## 5a. Live configuration that is not in this repo

Settings that live in a dashboard, that no test can read, and that the
code silently depends on. Each one here has already broken something or
answered a question that was open. **When one of these changes, it is
written here in the same sitting** — there is no other record of it.

**Supabase -> Authentication**

- **Email OTP Length: 6.** Was **8** until 2026-10-10. The phone's
  `CODE_LENGTH` is 6, its field caps entry at 6 and `normalizeCode`
  slices to 6, so with the dashboard at 8 every real code was truncated
  into a wrong one. Sign-in would have failed for everybody with "that
  code is wrong or has expired" as the only clue, while the code in the
  email was perfectly correct. The two numbers must agree and nothing in
  the repo can check it.
- **The "Confirm signup" template carries the code too**, added
  2026-10-11. This one is easy to miss and it broke exactly the people
  it matters most for: **Supabase uses Confirm signup, not Magic Link,
  for an address it has never seen**, so a first-time user got an email
  with a link and no code while every existing user got both. A phone
  that only takes a typed code had nothing to type. Both templates now
  carry `{{ .Token }}`.
- **Magic Link template carries BOTH** `{{ .ConfirmationURL }}` and
  "Or enter this code in the app: `{{ .Token }}`". **This settles the
  open question**: the two coexist in one template, so the web keeps its
  clickable link and the phone gets a typed code from the same send. The
  docs were not clear on it — the `signInWithOtp` reference says the
  presence of `{{ .Token }}` sends a code "instead" — and the answer came
  from a real send that arrived and signed in on the device, 2026-10-10.
- **Providers enabled: google, email.** `apple` is off, and turning it on
  is part of the Sign in with Apple work, not a separate step.
- `mailer_autoconfirm` is false.

**EAS (`@ethankey/key-budget`, project `b1d6b66c-…`)**

- **`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are
  EAS project environment variables**, set in production, preview and
  development, visibility plaintext. They are NOT read from
  `mobile/.env` in a cloud build: `.env` is gitignored and EAS uploads
  what git tracks, so the first build shipped with no backend at all and
  threw `supabaseUrl is required` before its first frame. Plaintext is
  the honest visibility for a value inlined into a bundle anyone can
  unzip; the anon key is public by design and the service role key is
  not involved.
- The `simulator` profile pins `environment: preview`, so which set a
  build reads is a decision rather than a default. Every build log
  states which environment it loaded — worth reading.
- **`ITSAppUsesNonExemptEncryption: false`** is declared in `app.json`.
  The app's only cryptography is HTTPS, which is exempt, and declaring
  it is what stops App Store Connect asking at every upload.

**Resend**

- **Custom SMTP, sending domain `keybudget.app`, Verified** since
  2026-10-03. This is what makes mail reach anyone: Supabase's built-in
  service refuses every address outside the project team, at two per
  hour. Without it there is no sign-in for a tester and no password
  reset for anybody.
- One bu.edu bounce, cause identified as BU's own receiving rules. The
  consequence to watch is the suppression list, because a suppressed
  address receives nothing ever again and says so nowhere.

**Google Cloud (project `budget-app`, number 225819918731)**

- The project and its **Web** OAuth client predate the phone — Google
  sign-in has worked on the web since September, and the web client and
  its secret were already in Supabase. Nothing about the iOS work
  changes them.
- **New iOS OAuth client** for bundle id `app.keybudget`, added
  2026-10-11. Its client ID is in `mobile/lib/google.ts` and its
  reversed form is the `iosUrlScheme` in the Google Sign-In config
  plugin. A client ID is public by nature; there is no iOS client
  secret.
- Supabase -> Providers -> Google now lists **both** client IDs,
  comma-separated. That is what lets Supabase accept a token whose
  audience is the iOS client.
- **The consent screen is PUBLISHED (In production)** as of 2026-10-11.
  It had been in Testing, which silently limited web Google sign-in to
  the test-user list — a real defect for anyone else, invisible to the
  author. Branding is filled in: app name, support email, homepage
  `https://keybudget.app`, privacy `https://keybudget.app/privacy`,
  authorized domain `keybudget.app`.
- ~~**No logo, deliberately.**~~ **Reversed 2026-10-15**, by the owner.
  The consent sheet reads "to continue to
  kjcvtpmorftjyejjskwm.supabase.co", which looks like a phishing page
  to anyone who did not build this, and brand verification is what
  replaces that string with the app's name. The cost stands — it is a
  review on Google's timeline, not ours — but it is now worth paying
  and it does not block a build.

  The logo to upload is **`public/google-branding-120.png`**, 120x120,
  opaque, generated from `public/favicon.svg` by
  `scripts/make_app_icon.mjs` like every other raster. Square and
  full-bleed rather than corner-rounded, because Google draws it in a
  circle and a rounded source leaves four transparent slivers inside
  that circle.

- **WHICH FLOW SHOWS THAT STRING, and it is not the phone's.** The two
  clients take different paths and only one of them has a redirect
  domain to show:

  - **Web** — `supabase.auth.signInWithOAuth` (`src/auth.js`). The
    browser goes to `https://<ref>.supabase.co/auth/v1/authorize`,
    which hands off to Google using the WEB client, whose authorized
    redirect URI is `https://<ref>.supabase.co/auth/v1/callback`. For
    an app Google has not verified, that redirect's host is what the
    consent screen names — hence the Supabase URL.
  - **iOS** — the NATIVE Google Sign-In SDK
    (`@react-native-google-signin/google-signin` v16,
    `mobile/lib/google.ts`), configured with `iosClientId` only.
    `GoogleSignin.signIn()` returns an ID token on the device and it
    goes straight to `supabase.auth.signInWithIdToken`. There is no
    browser redirect to catch and an iOS OAuth client has no redirect
    URI at all, so this sheet cannot name a Supabase domain. It is
    not an in-app auth session of ours and it is not
    `signInWithOAuth`.

  Verification is per PROJECT, so approving the branding fixes the web
  sheet and names the app on the phone's too.

**App Store Connect / TestFlight**

- **1.0.0 (8), 2026-10-15** — a slow, careful device pass on build 7,
  twelve items, every one of them diagnosed before it was fixed. The
  ones with a reason worth keeping:

  1. **The bills step's due day defaulted to the row above it.** The
     step's own copy says "it defaults to today", and the first row's
     did; "+ Add another bill" seeded every later row from
     `bills[0].day`, so a second bill offered whatever had just been
     typed into the first — the 8th if the first was set to the 8th,
     the 4th if it was set to the 4th. Deterministic, invisible, and
     contradicting the sentence directly above it. The web broke the
     same promise differently: a module-level
     `const defaultBillDay = new Date().getDate()` is "today" frozen
     when the bundle was evaluated, so a tab left open past midnight
     offered yesterday. One builder now (`emptyBillRow(today)`), and
     the day is an argument rather than a moment closed over.
     Separately: the field holds two digits and `maxLength` is 2, so
     tapping it and pressing a number did nothing at all — the
     keypress was swallowed. `selectTextOnFocus` makes one tap and one
     digit enough. **SUPERSEDED in build 9**, deliberately: the field
     also accepted 50, which the engine clamped to 31 without saying
     so, and the fix for that is a control that cannot express 50. The
     due day is a 1-31 picker on both clients now — a wheel on the
     phone, a select on the web — so the prefilled-field problem is
     gone rather than worked around. `clampDay` stays as the engine's
     backstop, because the CSV importers also call it.
  2. **The payday control was under the keyboard.** On a 390x844
     screen that row ends 508pt down and the decimal pad leaves 457.
     It was never reachable without scrolling and the step gave no
     sign there was anywhere to scroll to. Every field on every step
     now reports its focus and the step scrolls it clear
     (`scrollToReveal`, checked without a device); picking a frequency
     puts the keyboard away, because it is the last typed answer on
     both steps that have one; and the payday row says "Change" and
     carries a chevron.
  3. **Groceries happen on a day of the week.** The rule started on
     whatever day setup was run, so a Sunday shopper who set up on a
     Wednesday got a Wednesday series for good. Seven chips, Sunday
     default, `firstWeekdayOn` — today counts, the same call
     `firstMonthlyOn` makes.
  4. **Setup never asked what goes INTO the accounts it collected.** A
     new step after the accounts step, and the same question on the
     Dashboard after one account is added. See the long note in
     `src/engine/setup.ts` for why it is a step of its own and why a
     contribution rides on its account rather than arriving as a
     separate list.
  5. **Every user-facing date is MM/DD/YYYY**, from
     `src/shared/dates.ts`. There were NINE private formatters and the
     raw ISO string went through wherever none of them was called —
     the phone's top bar said "verified 2026-10-14". Two deliberate
     exceptions, both argued in that file: the CSV export stays ISO
     (it is re-importable, it sorts as text, and MM/DD/YYYY is what
     Excel mangles), and chart axis ticks drop the year.
  6. **The phone's checking balance says it can be tapped.** It opened
     the sheet since build 6 and looked like a line of text. Surface,
     hairline border, "Update ›" — and none of it when offline, where
     the app is read-only.
  7. **The Budget's totals read as a block on the phone**, matching
     the web: tinted TOTAL IN and TOTAL OUT, a two-point rule above
     every total. The tints are the web's, flattened, because a phone
     cell is opaque.
  8. **The web's Saving/Debt amounts are gray.** This SUPERSEDES the
     2026-10-03 "white, not red" call — still not red, but white put
     them at the same weight as the item names and louder than the
     bills. `gray-400` is #9ca3af is the phone's `T.dim`, so the two
     clients now agree by number.
  9. **The transaction form can be swiped away**, and asks first if
     anything was typed. The guard lives on the screen rather than in
     the sheet, because the scrim, the back button and the swipe are
     all the screen's and a confirm that covers only Cancel is not a
     guard.
  10. **"Continue with Google" wears Google's branding** — the
      four-color G, the light theme by its numbers, approved wording.
      It was a bordered rectangle sitting under a real
      AppleAuthenticationButton.
  11. **Appearance left Settings.** The app is dark only, and a
      setting with no choice in it reads as a broken control. The
      shared About copy described it, so `AboutOnly` exists now — the
      per-block platform variant the 2026-09-24 audit asked for, built
      for the first line that needed it.
  12. **The key's junctions are filleted.** ~~Reverted in build 9~~ —
      see band G item 24; the artwork is build 5's again and a redrawn
      key is the owner's own project. The two generator bugs this
      found are still fixed and still worth the entry.

      Three strokes unioned by
      overlap met in four unfilleted concave corners; at 60pt, with
      iOS 26 tracing its own specular pass along the silhouette, a
      highlight that stops dead at a corner reads as a cropped bevel.
      Four computed arcs, and the icon check probes each old corner
      from both sides.

      Two things that fix broke and the script now catches: a wrapping
      group truncated the generator's non-greedy capture, so the
      layer shipped with an unclosed tag that Chrome repaired and
      actool refused; and that actool failure was being reported as
      "this machine has no Xcode", because the skip branch matched
      the word "actool" anywhere in the error. The check that exists
      to catch exactly that was swallowing it.

  **The audit after it: 136 mutations, 127 renderer tests, every test
  dying to at least one.** The first run reported THIRTEEN tests that
  nothing could reach and all thirteen were written that day — the
  fourth time that lesson has been learned here, so the 23 new
  entries went in rather than the lesson being written down again.
  The one survivor was not a missing test but a weak one: the date
  picker's dismissal guard, whose test only ever fired a dismissal
  with no date. The `!d` branch catches that on its own, so deleting
  the `type === "dismissed"` check killed nothing — and that check is
  the one that matters, because an Android cancel hands back whatever
  the wheel was showing. The test fires both shapes now.

  Built and uploaded to App Store Connect the same evening, from
  commit `99e1bf0`, runtime `0e61aaac…` — a new runtime, because the
  icon changed, so build 7 is superseded rather than updated.

- **1.0.0 (7) was built and submitted 2026-10-15.** The Sunday-priority
  setup fixes plus the ledger, form and Budget-order work, and two
  things from testing build 6 on a device: the icon's key back to
  build 5's size, and the scrub snapping back to the present on
  release.

  **THE SETUP BUGS ARE THE ones that mattered**, because every tester
  meets them first and two of them corrupted the forecast rather than
  just annoying somebody:

  1. Monthly bills from setup all charged on the day setup was run.
     `occurrenceDates` emits a rule's `startDate` verbatim as its
     first occurrence and only applies `dayOfMonth` from the second
     one, and `billRules` passed today. A bill whose day had already
     passed was therefore counted twice — once inside the balance
     setup asks for, once as a fresh charge. Rent had a quieter
     version of the same bug, hidden only because the anchor swallowed
     it.
  2. The first paycheck was assumed to be today. Paid this morning and
     the money is already in the balance, so the forecast runs a whole
     paycheck high; paid next week and every date is wrong. Setup asks
     now.
  3. Groceries were saved as a fixed bill despite the step asking for
     "a rough estimate". They carry `variable: true` now, which is
     what the Spending tab's whole comparison needs.

- **1.0.0 (6) was built and submitted 2026-10-14**, runtime version
  `957dfd71…`. It is the first build with the layered iOS 26 icon, and
  it carries every JS change from the same day in the binary — the
  rebuilt chart scrub, the Dashboard's three debt states and its add
  cards — so **no over-the-air update was published for it**: an
  update would have been byte-for-byte what is already inside.
  Build 5 stays on `cf6120cc…` and is superseded rather than updated,
  because the icon is a native change and native changes are exactly
  what the runtime version exists to keep apart.

- **1.0.0 (5) WAS TESTED ON A DEVICE, 2026-10-14.** Working, in the
  author's words: the native tab bar ("10/10"), haptics, the anchor on
  all four tabs, the read-only Budget, contributions with the right
  noun, the whole account manager (add, rename, reorder, delete, loan
  terms, asset kind, synced to the web), export, the six-screen setup
  flow with Back ("excellent"), the keyboards, and **both Google and
  Sign in with Apple on the device**. The fill/no-fill icon split
  "reads fine on glass" — keep it.

  Seven things came back, all fixed the same day and shipped over the
  air (no native change in any of them):

  1. **An ENGINE bug, so the web had it too**: deleting the newest
     checking reading left the deleted number as the anchor until a
     reload. Mutations now re-derive the anchor from the newest
     snapshot, which is what `assembleState` has always done. Two more
     paths had the same hole. A second bug fell out of it — a $0 seed
     dated today outranking a real back-dated reading. Both in the
     engine, both tested.
  2. Apple's signing key had **no services enabled** (see mobile item
     14), and a failed token exchange was invisible. Settings says so
     now.
  3. `apple_tokens` RLS confirmed, with the proving queries written
     into the SQL file.
  4. The web code box (ranked item 11).
  5. The anchor strip opens the Update balance sheet, from any tab.
  6. The accounts form asks for a balance on CREATE only.
  7. Sparklines 68pt -> 170pt, range still fitted.

- **1.0.0 (5) was built and submitted to App Store Connect 2026-10-13**,
  from this machine, non-interactively except for the one step that
  could not be. It is the first build with Sign in with Apple, the
  six-step setup flow, native tabs, haptics and `expo-updates`.
  Processing at Apple takes five to ten minutes; after that it appears
  in TestFlight for the internal group and **nothing about it has been
  seen on a device yet** — Liquid Glass, the tab icons, the setup flow
  on a real keyboard and the Apple sheet are all first looks.
- **Build numbers 3 and 4 are burned.** 3 failed at code signing (the
  App ID capability, above) and 4 was canceled once it was clear it
  would fail the same way. `autoIncrement` with `appVersionSource:
  remote` counts attempts, not successes.
- **The ASC App ID is `6822133130`, and it is deliberately NOT in
  `eas.json`.** Pinning it there makes `eas submit --non-interactive`
  work in one command — and it also **breaks over-the-air updates for
  every build that already exists**, which is a trap worth the space
  it takes to explain.

  The fingerprint runtime version hashes `eas.json` as a whole, submit
  profile included. Adding one bookkeeping field no native build has
  ever read moved the runtime version from `cf6120cc…` to
  `017b46f3…`, and build 5 — the only build in TestFlight — stopped
  being eligible for its own updates. Measured, by reverting the file
  and watching the hash come back.

  So the rule is: **submit config goes in at the same moment as a
  native change, never on its own.** A commit that already moves the
  fingerprint can carry it for free; a commit that does not, must not.

  **`EXPO_ASC_APP_ID` DOES NOT WORK — tested 2026-10-14.** With it
  set, `eas submit --non-interactive` still answers "Set ascAppId in
  the submit profile (eas.json) or re-run this command in interactive
  mode." So there are exactly two ways to submit:

  - **a pty with the cached Apple session**, which is what has been
    used for builds 5 and 6 and keeps `eas.json` clean. The only
    prompt is "Apple ID:", prefilled; one Enter, and the session in
    `~/.app-store` answers the rest with no password and no 2FA; or
  - **`ascAppId: "6822133130"` in `eas.json`**, which makes it one
    non-interactive command and moves the fingerprint — so it may
    only be added in a commit that is already producing a build, and
    the build produced must be the one that goes out.
- **1.0.0 (2) was installed on a real iPhone via TestFlight**, internal
  group "Team (Expo)", 2026-10-12. Google sign-in verified on the
  device with the native account sheet, and the emailed code verified
  on the same build.
- **EAS holds the credentials**: the distribution certificate and
  provisioning profile from the first interactive build, plus an App
  Store Connect API key named "[Expo] EAS Submit", Key ID
  **H69S428989**. So `eas build` and `eas submit` run non-interactively
  — with one exception, learned the hard way 2026-10-13.

  **An entitlement change needs an Apple login, once.** `eas build
  --non-interactive` does NOT sync capabilities: it printed "All
  credentials are ready" and built against a profile that predated
  Sign in with Apple, and Xcode rejected it. The fix is
  `eas credentials:configure-build -p ios -e production`, which logs
  into the Apple account (the cached session in `~/.app-store` was
  still good, so no password and no 2FA), syncs the capability onto
  the App ID and regenerates the profile. After that the build is
  non-interactive again. Budget one interactive step per native
  entitlement, not per build.
- **That key has Admin access and App Manager would do.** Low priority,
  and worth a note rather than a fix: the key can do considerably more
  than submit builds, and the blast radius of a leaked Admin key is the
  whole account. Narrow it when something else takes you into that
  screen.
- **Internal testers need an App Store Connect user account.** Family
  and friends therefore go in an EXTERNAL group, whose first build
  needs Beta App Review.

  **Test Information, ready to paste when that group is made:**
  Beta App Description — "Key Budget projects your checking balance
  forward from the rules you describe — your paycheck, your rent, your
  bills — and keeps that forecast separate from the balances you
  actually log, so the app never quietly blends what you planned with
  what happened." Feedback email: `support@keybudget.app`. Marketing
  URL and Privacy Policy URL: `https://keybudget.app` and
  `https://keybudget.app/privacy`.

  **Review notes, which are the part that prevents a rejection.**
  UPDATED 2026-10-13, because Sign in with Apple now actually ships
  and the setup flow replaced the guide as what a new account meets.
  Paste as is for build 3 and later:

  > No demo account is needed. Sign in with Apple, with Google, or
  > with a six-digit code emailed to any address you choose — all
  > three create or reach an account directly on the device. A new
  > account is taken through a six-step setup (pay, rent, bills,
  > groceries, checking balance, other accounts) and can skip it for a
  > three-step guide that does the same work one control at a time, so
  > the app's full function is available on the phone without visiting
  > the website. Account deletion is in Settings, at the root rather
  > than behind a submenu.

  The standing rule that produced the old version still applies and is
  worth keeping: do not name a sign-in method before the build has it.
  A review note describing something the binary cannot do is a
  rejection of its own. Up to and including build 2 this note named
  only Google and the emailed code, correctly.

**Cloudflare**

- **`support@keybudget.app` is live**, routed to the author's Gmail by
  Cloudflare Email Routing, 2026-10-11. This is the App Store listing's
  support address and, later, the Google consent screen's. Worth
  knowing it is a forward and not a mailbox: replies come from the
  Gmail address unless something is configured to send as it.

**Platform behavior that is nobody's setting**

- **iOS one-time-code autofill DOES work with Gmail** — measured on the
  device 2026-10-11, the code appeared above the keyboard. This entry
  previously said the opposite, on the common belief that Apple only
  reads Mail.app; that was wrong and is corrected rather than deleted,
  because it is the kind of claim that gets re-asserted. The field still
  accepts a paste and strips whatever comes with it, which costs nothing
  and covers the cases autofill misses.

**Running Metro: `npm run mobile` from the repo root.**

`npx expo start` only works from `mobile/` — the root has no Expo in
it, and the error it gives is about a missing package rather than about
being in the wrong directory. Added 2026-10-11 after exactly that,
alongside `npm run mobile:ios`. Neither does anything `cd mobile` would
not; they exist so the wrong guess from the root is impossible rather
than merely documented.

**Vercel**

- `key-budget-app.vercel.app` is still a live origin and still in the
  Supabase redirect allow-list. Removing it is on the list: a second
  origin that can complete an auth redirect is a second thing to get
  wrong.

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
  saving and debt rows in a MUTED GRAY: it answers where the month's money
  WENT, and "saved" and "spent" are genuinely different answers to that
  question. One rule was tried across both from 2026-10-06 and the Ledger
  half was reverted on 2026-10-08 after living with it — a plain $300
  beside a red $112 made the plain one look like it was not coming out.
  `isRetainedOutflow` is the Budget's rule only, and says so.

  The gray **supersedes the 2026-10-03 call of "white, not red"**
  (2026-10-15, after a device pass). Still not red. But white put those
  rows at the same weight as the item names beside them and louder than
  the bills, which is the opposite of what the distinction is for. The
  phone had drawn them in `T.dim` (#9ca3af) all along, and Tailwind's
  `gray-400` is the same value, so the two clients now agree by number.
  Light mode uses `gray-500`, because `gray-400` on white is not
  readable.

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

### A harness landmine: two `fireEvent.changeText` calls destroy the renderer

Found 2026-10-10 while adding auto-submit to the sign-in code field.

**The rule: in `mobile/__tests__`, drive every text field with
`userEvent.type`, `userEvent.paste` or `userEvent.clear`, never with
`fireEvent.changeText`.**

The second `fireEvent.changeText` against a controlled `TextInput`
detaches the tree. Nothing fails at that moment — the test doing it
passes. The NEXT test's `render()` returns null, and every query in it
fails with "unable to find an element", so the failures all land in
tests that are correct and the broken one is green. Eight failures were
attributed to a feature that worked.

Reproduced on a four-line component with a `useState` and a `TextInput`
and no app code in it, so it is the harness — some interaction of
React 19, `@testing-library/react-native` 14 and `jest-expo` — and not
any screen. `userEvent.type` types key by key and survives it;
`userEvent.paste` is the single-event case.

Why it had never bitten: nothing in `ledger.test.tsx` or
`sheets.test.tsx` types twice in one test. Audited on the day — zero
`fireEvent.changeText` calls in either file.

This is the third instance of the standing shape in this repo, and the
worst of them: **a verification tool that fails somewhere other than the
fault.** The fixture server that reported a working Vite as down, the
mutation runner that called every mutation a survivor, and now a test
harness that blames the next test. In each case the tool was trusted
because it was green, and in each case the fix was to reproduce the
tool's own behavior on something with a known answer.

### A harness landmine: a synthetic PanResponder drag that measures zero

Found 2026-10-15 while testing swipe-to-dismiss on the sheet.

PanResponder does not read the gesture off the event. It keeps its own
state and accumulates `dy` as a running sum of
`currentCentroidY − previousCentroidY`, both read out of
`event.touchHistory.touchBank`. So a synthetic touch whose `previousPageY`
equals its `currentPageY` reports a gesture that went nowhere: the first
version of the drag helper moved the finger 200 points across three
moves and `gestureState.dy` came back 0, and the dismissal never fired.

Two things a synthetic touch needs, and both are easy to get wrong:

- `previousPageY` must be the PREVIOUS move's position, not this one's.
  The sparkline's helper gets away with repeating the current position
  because that component reads `nativeEvent.locationX` directly and
  never looks at `gestureState`.
- `mostRecentTimeStamp` must increase. PanResponder ignores a move it
  has already accounted for, so a fixed clock makes every move after
  the grant a no-op — which is the same landmine recorded for the
  scrub test on 2026-10-14, hit again from the other direction.

The shape is the standing one: **a verification tool that fails
somewhere other than the fault.** The helper was wrong and the
component looked broken.

### A harness landmine: `JSON.stringify(screen.toJSON())` can be circular

Found 2026-10-15, the first time a rendered tree held a React element
inside a prop — `SymbolView`'s `fallback`, on the sign-in screen's
Apple mark.

A tree snapshot is plain data until a prop value is itself an element.
That element carries `_owner`, a FiberNode, and the fiber graph loops
straight back, so `JSON.stringify` throws **"Converting circular
structure to JSON"**. The test that broke was asserting Google's four
hues by searching the serialized tree, and nothing about Google's
button had changed.

The fix is a replacer that drops `_owner`. Worth knowing because the
failure names a test that is still correct and a component that is
still fine.

### The gap under the sheet: a percentage that lost its reference

Reported from a device on build 8 and MEASURED here on 2026-10-15, by
rendering both trees with `react-native-web` (React Native's own style
semantics compiled to CSS) at 390x844 and reading the card's rect.

Build 8 wrapped the hosted sheet in an `Animated.View` so the whole
thing could be dragged. The card inside it is `maxHeight: "88%"`, and
a percentage resolves against the OWNER's height:

- Before: the owner was the scrim — the full screen — so the cap was
  88% of 844 and it clipped the card from the TOP. Its bottom stayed
  pinned to the screen's bottom. Gap below: **0**.
- After: the owner was the wrapper, which has no height of its own.
  The wrapper sized itself from the card's UNCONSTRAINED height, then
  the card was capped at 88% OF THAT — and shrank inside a parent
  that kept the space. The missing 12% became empty scrim at the
  bottom, with the tab bar showing through it.

Measured gap below the card, by content height:

| content | no wrapper | with wrapper |
|---|---|---|
| 400pt | 0 | **34pt** |
| 700pt | 0 | **70pt** |
| 1200pt | 0 | **130pt** |

The rule in general: **a percentage dimension is only as good as its
owner's.** The failure is silent, it does not look like a layout
error, and it gets worse the more content there is.

Build 9 removes the structure rather than the wrapper: the transaction
form is a system page sheet (`presentationStyle="pageSheet"`), so
there is no scrim, no card inside a card, and no percentage to
resolve.

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

**Encryption at rest: the 2026-10-09 contradiction is CLOSED.** A handoff
from the auditing chat recorded "encrypted at rest with the user holding
the keys" as the chosen direction, which read as a reversal of the entry
below. It was not one. The author's account, 2026-10-09: end-to-end was
what he WANTED, he and the chat worked through it, and they concluded it
was not fully feasible — which is the same conclusion, and the same
reason, as the entry below. The handoff recorded the aspiration and
dropped the verdict. Nothing changes; the entry below stands as written
and is the one to trust. Recorded only so the next reader who finds that
handoff does not reopen it.

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


### The whole list, ranked (2026-10-09)

One place to look. Every line points at a fuller entry below or in the
*Later* list; nothing here repeats the reasoning. Ranked by what stops
what, not by size.

**A. Stops a TestFlight build existing at all**

1. ~~Sign-in on the phone.~~ **CLEARED 2026-10-11.** Option D (emailed
   six-digit code) shipped 2026-10-09 and has signed real accounts in on
   a real phone. Both open questions are closed: one magic-link template
   carries `{{ .ConfirmationURL }}` and `{{ .Token }}` and serves both
   clients, and **a code does reach a Google-created account** — the
   author's own row shows providers `google, email` and was signed into
   on the phone with a code on 2026-10-10. So identity linking by email
   is on in this project, as the docs describe, and the
   "reachable only by social login" state the `signInWithOtp` reference
   warns about does not apply here. Google sign-in is now wired on the
   phone too (mobile item 13); Sign in with Apple waits on the paid
   account, and 4.8 means Google must not ship to the App Store without
   it.
2. **No iOS build exists.** `mobile/app.json` is no longer the template —
   name, slug, scheme, bundle identifier and icon are all real as of
   2026-10-09. The first `npx expo run:ios` on 2026-10-11 got through
   prebuild and CocoaPods and was stopped by Xcode: SDK 57 needs Xcode
   26.4+ and 16.4 is installed. `mobile/eas.json` has a cloud
   `simulator` profile as the way around it. See mobile item 12.

**B. Stops it surviving review, or surviving contact with a tester**

3. ~~Account deletion / Settings, built but never pressed.~~ **CLEARED
   2026-10-11.** Pressed, and in the hardest place to get right: a real
   account was deleted through it. 5.1.1(v) is satisfied in fact. What
   remains is cosmetic — item 10.
4. ~~The rest of the nav.~~ **CLEARED 2026-10-11.** All of it is
   confirmed on a real phone now: the tour, Budget cumulative net
   white, the underline gone, the rebuilt loan card, the About tab fix,
   and Export writing a properly named .csv whose numbers check out
   (October — in 5541.85, out 3367.19, net 1566.81, cumulative
   2174.66).
6. **Google sign-in on a real device.** Proven on the simulator, which
   cannot show the native account sheet because it has no Google
   account signed in. The first device build is the test.
5. ~~Watch the purge actually delete something.~~ **PASSED 2026-10-11**,
   end to end on a real account: `auth.users` 0, `budget_entities` 0
   from a baseline of 9, `account_deletions` 0. The cascade was the
   half that had never run. Kept here, struck, because this list is
   where someone looks to ask what is still dangerous, and the answer
   changing is worth seeing. Full account in *Later* item 2.

**C. "Useful to someone who is not the author" — now requirements, not polish**

6. Copy pass in the author's voice, web and mobile — *Later* item 6,
   which absorbs the two deferred copy items (*Later* item 0) and the
   nine web-only lines enumerated below.

   **`src/content/about.ts` is shared by both clients and nine of its
   lines describe a web you cannot do on a phone.** Found 2026-10-11 by
   reading the About screen on the device. Listed by line so the voice
   pass does not have to find them again:

   - **:42** "On a computer you can drag the four tabs into whatever
     order you like" — tab reorder is deliberately not ported.
   - **:62** "+ Add transaction opens the editor" — the phone's control
     is not called that.
   - **:74** "⚡ Quick entry is the same form without the modal closing"
     — the phone has no quick entry at all. It is mobile backlog item 3.
   - **:86** "Click any item name" — tap.
   - **:90** "a click on any day for the detail" — tap.
   - **:93** "Click it to see what's in there — the bar chart opens the
     rows in place, and the pie lists them beside the chart" — **this
     one is wrong on the WEB too. There is no pie.** It was dropped
     2026-10-09 and the copy describing it was not. The only doc rot in
     this list that is not a platform difference, and the standing rule
     it breaks — grep for a feature's name before you commit its
     deletion — is already written down one section up.
   - **:107** "Rows can be dragged or arrow-moved within their section.
     Click a row name" — drag is not ported, arrow-move is web-only.
   - ~~**:194** "Appearance — Light or dark, remembered PER DEVICE"~~ —
     **FIXED 2026-10-15.** The phone's Settings row was removed the
     same day (a setting with no choice in it reads as a broken
     control, not as a decision), and this line is now marked `"web"`
     via `AboutOnly` — the per-block platform variant this list asked
     for, built for the first line that needed it. The other eight
     below are untouched and still want the voice pass.
   - **:212** "It's one click and it has saved this project before."

   **Outside the repo, same pass:** the Supabase email templates still
   say "sign-in link" in the subject and the heading, when most people
   now use the code in the body. Noted 2026-10-12; the author edits
   those himself, and nothing here can check them.

   **The mechanism to prefer, when the pass happens:** a per-block
   platform variant inside `about.ts` rather than a second file. One
   file still holds both clients' words, so neither can go stale without
   the other being looked at — which is the whole reason the copy was
   shared in the first place. A second mobile copy would re-create the
   problem that moving it here solved.
7. ~~Capability parity audit, enumerate without fixing.~~ **RUN
   2026-10-12**, in its own section below the roadmap. Four real gaps,
   two of them arguably decisions. Nothing built from it until picked.
8. ~~Onboarding that works cold on a phone.~~ **CLOSED 2026-10-13. The
   phone now has BOTH** — the full six-step flow in front of a new
   account, and the three-step guide behind it for anyone who skips.
   The entry below records the state on 2026-10-11, when the guide was
   all there was and the wizard was deliberately unported; the decision
   that overrode it ("most App Store users will never touch the web, so
   the phone's setup cannot be the lesser version") and what was built
   from it are in mobile item 15. The one sentence below that is now
   wrong is kept rather than edited, because the reasoning it records
   is why the answer to drift ended up being shared logic instead of no
   wizard.

   **SHIPPED 2026-10-11 as a signpost, not a wizard.** Google sign-in made it urgent rather than
   eventual: OAuth provisions a user on first sign-in, so an account
   can now be born on the phone. The scope collapsed once it was clear
   the phone ALREADY had every control — `+ Add` opens the editor in
   add mode, `LogBalance` logs the anchor — so this is three steps
   pointing at them, in the order that makes a forecast work. Mobile
   item 7's full wizard stays unported, deliberately: a second way to
   create the same things is a second thing to keep correct. See
   `lib/firstRun.ts` for why detecting "new" is harder than it looks.
9. Sweep for places the app assumes its author is the one using it. New,
   from the 2026-10-09 scope decision; no entry yet.
10. **Settings needs a polish pass.** Pressed for the first time
    2026-10-11 during the deletion test. It works — account facts,
    sign-out, the danger zone, and a real deletion all did what they
    claim — and it looks like a screen nobody has looked at. No entry
    beyond this one yet; the fault list comes from a second pass on the
    device.
11. ~~**A code box on the web sign-in**, low priority, raised
    2026-10-11.~~ **SHIPPED 2026-10-14, and it was not low priority by
    then.** The reason it was promoted, from the device test: the
    "Confirm signup" template hands a NEW web user six digits with
    nowhere on the site to type them. The original reason stands too —
    a magic link opens in whatever browser the mail app chooses, which
    is routinely not the one that asked, and the session lands there.

    It is the phone's two-step flow, and the logic moved to
    `src/signin.ts` so there is one definition rather than two:
    `codeReady`, `normalizeCode`, `resendIn`, `sendFailureMessage`,
    `verifyFailureMessage`. The native message mappers stayed in
    `mobile/lib/signin.ts`, which re-exports the rest so no caller
    changed. `tests/mobile-signin.test.mjs` became
    `tests/signin.test.mjs`.

**D. Mobile feature gaps, in build order**

10. ~~Quick entry — mobile item 3.~~ **DECIDED AGAINST on the phone,
    2026-10-12, and now load-bearing.** `+ Add` on the Ledger already
    opens the editor in add mode, and Quick Entry's whole point on the
    web is not closing the modal between entries — which a full-screen
    sheet on a phone does not have to solve. The decision has a visible
    consequence as of 2026-10-13: the setup wizard's paycheck note
    named Quick Entry, so that string is the one platform variant in
    `src/content/setup.ts` and the phone's version names `+ Add` on the
    Ledger instead.
11. Loan and asset setup / edit terms — mobile item 5. Without it the
    loan card's own prompt has nowhere to go.
12. Horizon control: device-local chip or synced setting — mobile item 10.

**E. Debt, paid down when it is in the way**

13. The nine audit findings from 2026-09-24 — *Later* item 4.
14. `storage.js` under `// @ts-check` — *Later* item 3.
15. Count orphans live on the web, one press everywhere — *Later* item 8.
16. Tombstone retention / purge job — *Later* item 9.
17. Retired palette machinery still exported — *Later* item 12.
18. Favicon, leading zero in numeric inputs.

**G. Non-code App Store work — parallel to everything above**

Needs no build and no TestFlight, so none of it is blocked by band A.

23. **Apple Developer Program enrollment — 2026-10-13, $99.** The one
    item on the critical path that nobody here controls the timing of.
    Not gated on the app being finished; start it regardless of state.
24. ~~**The iOS app icon is still the Expo template.**~~ **DONE
    2026-10-09, and LAYERED 2026-10-14.**

    The key is struck metal now — a warm highlight top-left falling to
    a deeper gold bottom-right — and on iOS 26 it is its own layer
    over a navy fill, so the system supplies the glass, the specular
    highlight, the parallax and the dark and tinted variants.

    **SDK 57 takes an Icon Composer `.icon` directly**: `ios.icon`
    pointing at one makes prebuild set
    `ASSETCATALOG_COMPILER_APPICON_NAME` and add the bundle to the
    Xcode project (`@expo/prebuild-config/.../withIosIcons.js`). No
    plugin and no patch. The bundle at
    `mobile/assets/images/KeyBudget.icon` is hand-authored — the
    format is undocumented, and the schema came from
    IconComposerFoundation's own symbol table plus Apple's template
    under Xcode's file templates — but it is **verified, not hoped
    for**: `actool` compiles it, emits `Assets.car` and the legacy
    60x60@2x and 76x76@2x~ipad slots rendered from the same layer,
    and writes a partial plist naming `KeyBudget` as
    `CFBundleIconName`. That also answers what older iOS gets.

    **Two bugs, both caught by measuring pixels rather than looking at
    a thumbnail**, and the second is the better lesson:

    - The first gradient used SVG's default `objectBoundingBox`
      units. Two of the key's three shapes are straight lines, whose
      bounding boxes have zero height or zero width, and SVG says
      such an element is NOT RENDERED — so the shaft and the tooth
      silently vanished and the icon became a ring on navy.
      `userSpaceOnUse` across the whole mark fixes it and is the
      better answer anyway: metal is lit as one object.
    - The check written to catch that then PASSED the broken icon,
      because the area floor was 6% and a ring alone is 8.9%. The
      numbers are measured now — the key is 13.1% of the square and
      spans 69% of its width, the ring alone 8.9% and 29% — and the
      SPAN is the sharp test, since only the shaft makes the mark
      wide.

    `public/favicon.svg` is finally the single source: the generator
    parses its optional defs and its mark group rather than restating
    the geometry, and the web rasters — hand-exported once and stale
    ever since — are generated from it too, including the 120x120
    `public/google-branding-120.png` that Google's OAuth consent
    screen shows.

    **REVERTED 2026-10-15, to build 5's artwork exactly.** The
    gradient and the fillets are gone; the mark is flat `#eebb4d`
    again. Owner's call from a device pass on build 8: a redrawn key
    is his own future project, so the drawing holds at the last
    composition that looked right. What stayed is the pipeline — one
    source, actool compiling the `.icon` locally, and the size check,
    which is now an EQUALITY against build 5's 68.8% span with 1.5
    points of slack rather than a floor. A floor passes a key that
    grew; build 6's key was a third of the tile, and build 8's
    fillets widened the silhouette. `<defs>` is optional now, since
    requiring one made removing the gradient a failing build.

    *The original entry:* **DONE 2026-10-09.** It was the blue chevron on pale blue with the layout
    guides still visible, found by looking at the file after a handoff
    note recorded the icon as done. Now generated from
    `public/favicon.svg` — the one definition of the mark — by
    `scripts/make_app_icon.mjs`, so the phone cannot drift from the web.
    Square rather than pre-rounded, because iOS masks it itself and a
    rounded source gets rounded twice; opaque, because Apple rejects an
    alpha channel; 1024x1024, asserted by the script rather than
    assumed. The splash mark came from the same pass, and the splash
    background went from the template's white to `#111827`, which was a
    white flash on launch in a dark-only app.
25. **App Privacy questionnaire.** The item that takes real thought —
    this app holds a user's complete financial state and Apple asks
    about exactly that.
26. Privacy policy at a public URL (`/privacy` exists and is live),
    support URL, store description, age rating. Export compliance is
    **done** — `ITSAppUsesNonExemptEncryption: false` in `app.json`.
28. **App Store screenshots, as its own session.** Made from a DEMO
    ACCOUNT with realistic invented data, never the author's real
    finances — the same rule the landing-page screenshots already
    follow, for the same reason, now with a second audience. Needs one
    device class's worth per claimed size.
29. **The voice pass, as one long session and not a sprinkle.** Every
    string, web and phone, rewritten in the author's voice for
    personality rather than correctness. It absorbs the two deferred
    copy items and the nine web-only About lines enumerated in band C,
    and it is the right moment to add the per-block platform variants
    rather than doing them twice.
27. **Remove `key-budget-app.vercel.app`** from the Vercel domains and
    the Supabase redirect allow-list. A second origin that can complete
    an auth redirect is a second thing to get wrong.

30. **Universal Links**, after Apple approval. A magic link tapped on
    the phone opens Safari, not the app — the one place the emailed
    link and the emailed code disagree about which is the better
    credential. Needs the `associated domains` entitlement (so: a paid
    account) and an `apple-app-site-association` file served from
    keybudget.app. Raised 2026-10-11.

**F. Product, further out and deliberately vague**

18a. **Link Apple and Google sign-ins to one account, from Settings.**
    Asked for 2026-10-15. Two accounts with the SAME email already
    auto-link — that is Supabase identity linking, and it is what lets
    a Google-created account receive an emailed code (see A1). Hide My
    Email defeats it: Apple hands over a
    `...@privaterelay.appleid.com` address, which is a different email,
    so the same person gets a second account with an empty budget in
    it. Nothing is lost and nothing is corrupted; it just looks like
    the app forgot them. The fix is `linkIdentity` from a signed-in
    session, offered in Settings beside the provider list that is
    already there. Not urgent: it needs somebody to have hit it, and
    the first external testers will say whether anyone does.

18b. **Redraw the key.** Raised 2026-10-15, and it is the OWNER'S
    project, not an agent's. Builds 6-8 tried to make the mark read as
    struck metal with a gradient and then with filleted junctions, and
    the device pass on each said the same thing: the lighting is not
    the problem, the shape is. Build 9 reverts to build 5's flat
    artwork and holds there. Whatever replaces it goes through
    `public/favicon.svg` and nowhere else, and the generator's
    `BUILD_5_SPAN` check is the thing to update deliberately when it
    does.

18c. **A "Schedule contributions" link on a new account's Dashboard
    card**, as an alternative to the post-add prompt. Raised
    2026-10-15, UNDER CONSIDERATION — the prompt that exists is
    dismissible and only appears once, so the link would be the way
    back to it afterwards. The current post-add prompt stays as it is
    until this is decided.

19. Multi-account model (payment method per transaction, credit cards
    with limits). The one deliberate architectural step still ahead.
20. Live multi-device sync over Realtime.
21. Goal-based savings; tying one-offs to a recurring item by name.
22. Bank linking. Much later, if ever.

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

1. **NO ACCOUNT CREATED THROUGH THIS APP CAN SIGN IN ON THE PHONE** [D]
   — **THE TOP BLOCKER. It outranks item 2.** First reported
   2026-10-08 as "Google OAuth is missing on mobile", which is the small
   version of it.

   The web creates accounts two ways and neither one produces a
   password: `src/auth.js:12` is `signInWithOAuth({ provider: "google" })`
   and `src/auth.js:23` is `signInWithOtp`, the magic link. The phone
   makes exactly one call, `signInWithPassword`
   (`mobile/components/SignIn.tsx:24`). `signUp` and
   `resetPasswordForEmail` appear nowhere in the repo. So the set of
   accounts that can sign in on the phone is the set of accounts whose
   password was set from outside the app — which is one account, the
   author's, set by hand through the admin API. Every Google user and
   every magic-link user is locked out, and between them that is
   everybody. The two TestFlight testers cannot log in.

   That is why it sits above account deletion: 5.1.1(v) stops the build
   at review, this stops the build from being usable by the people it
   would be sent to.

   **The email gate: CLEARED, and it was never actually shut.** Custom
   SMTP is configured on this project through **Resend**, and nothing in
   this repo said so — the only record here, until 2026-10-09, was the
   2026-10-02 claim that "the project's SMTP is down", written the day
   before the first successful send and never reread. Evidence, from the
   Resend dashboard on 2026-10-09: four "Your sign-in link" messages in
   the last fifteen days, the oldest three about 2026-10-03 and the
   newest the probe sent from this session, which shows **Delivered**.
   So the mailer is not merely accepting mail — it is landing it.

   That retires the Supabase restriction this entry was built around.
   "Supabase Auth will refuse to deliver messages to addresses that are
   not part of the project's team" and the two-per-hour ceiling apply to
   the BUILT-IN service only; with custom SMTP, Supabase is out of the
   recipient business entirely and Resend's rules are the ones that
   matter. Two caveats, both checkable in the Resend dashboard and
   neither verifiable from here:

   - **A verified sending domain: CONFIRMED 2026-10-09.** Resend ->
     Domains lists `keybudget.app`, status Verified, created the same day
     sending began. Resend's no-verified-domain restriction (send only to
     the account's own address) therefore does not apply, and mail can
     reach anyone. Both halves of the gate are open: Supabase is out of
     the way because SMTP is custom, and Resend is out of the way because
     the domain is verified.
   - **The one bounce was bu.edu**, whose receiving rules are stricter
     than most, per the author. That explains the cause and does not
     clear the consequence: a bounced address can land on Resend ->
     Suppressions, and a suppressed address receives nothing ever again
     with no error anywhere that says so — which for a sign-in link is an
     account that cannot log in for reasons invisible from inside the
     app. Worth one look, and worth remembering that the author's own
     bu.edu address is the one used to test everything, so it is the
     likeliest address to be silently unreachable. A personal address is
     the better test target.

   Also recorded from `GET /auth/v1/settings` on the live project:
   `google: true`, `email: true`, `apple: false`, `mailer_autoconfirm:
   false`.

   **The options. 4.8 is quoted in full at item 11; the test it applies
   is "does the iOS app use a third-party login service".**

   - **A. Google + Sign in with Apple on iOS.** Compliant, and the
     largest build: a Google iOS client and its reversed-client-id URL
     scheme, `expo-apple-authentication`, an Apple Service ID and
     signing key, both providers enabled in Supabase (`apple` is
     `false` today), and a third identity to link on accounts that
     already carry two. Needs `ios.bundleIdentifier`, absent from
     `app.json`, and a real `expo.scheme`, still the template's
     `"mobile"`.
   - **B. Google alone on iOS.** Fails 4.8 on the plain reading, and
     the way you learn that is a rejection in review.
   - **C. Give every account a password.** No third-party login on iOS,
     so 4.8 never applies. Needs a set-password / reset flow.
   - **D. Magic link / email OTP on the phone — the same
     `signInWithOtp` the web already calls. PREFERRED.** Proposed
     2026-10-08. Evaluated against C below, point by point, because it
     is the option this entry was first written without.

   **D versus C.**

   1. **4.8 does not trigger.** Correct, and for the same reason C
      relies on: an email OTP against this project's own user table is
      not "a third-party or social login service", so the guideline's
      trigger clause is never met and the "exclusively uses your
      company's own account setup and sign-in systems" exception covers
      it besides.
   2. **No password anywhere.** Correct, and it is worth more than it
      sounds. With no password there is nothing to store, nothing to
      rotate, no reset flow, no strength rule, and no second credential
      that can drift out of sync with the identity that owns the
      account.
   3. **Does it reach accounts created via Google? UNRESOLVED, and it
      is the one point that is not safely assumable.** The docs say
      automatic linking is the behavior rather than a setting — there is
      no per-project switch for it to be "on" or "off" (the only
      linking toggle, `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`, is the
      separate manual-linking beta), and the condition it names is a
      verified address: "It would also be an insecure practice to
      automatically link an identity to a user with an unverified email
      address since that could lead to pre-account takeover attacks."
      Google verifies the address, so a Google-created user here is
      confirmed and an OTP for that address should find the existing
      row. AGAINST that, the `signInWithOtp` reference says the error
      "will not distinguish between the cases where the account does
      not exist or, that the account can only be accessed via social
      login" — which only makes sense if "reachable only by social
      login" is a real state an account can be in. The live identity
      table would settle it immediately and is a production read that
      was refused, so the check is either the dashboard
      (Authentication -> Users; a single row showing both `email` and
      `google` is linking having happened in this project) or a real
      OTP against a Google-only account, comparing the returned
      `user.id` with the web's. **This risk is identical under C**: a
      reset email for a social-only account faces the same question, so
      it is not a reason to prefer C.
   4. **The six-digit code avoids deep linking entirely.** Confirmed,
      and not plan-gated — it is an email-template edit, not a feature
      tier. `{{ .Token }}` is documented as "a 6-digit
      One-Time-Password (OTP) that can be used instead of the
      `{{ .ConfirmationURL }}`", and the client call is "the 'verify
      OTP' method ... with the user's email address, the code, and a
      type of `email`". So: no URL scheme, no bundle identifier, no
      associated-domains file, no redirect that has to survive the Expo
      Go sandbox — which is the exact cost that kept OAuth off the
      phone in the first place.

   **Verdict: D is strictly smaller than C, and C contains D.** Any
   set-a-password flow for a user who has no password must first prove
   the address — which is an OTP send and verify — and only then call
   `updateUser({ password })`. So C is D plus a password form plus a
   stored credential, and the extra is the part that buys nothing. D
   also fixes the magic-link users the moment it ships, where C asks
   every one of them to invent a password to reach an app they were
   using without one.

   **One wrinkle D has and C does not, flagged rather than solved:
   there is one email template for both clients.** The web wants a
   clickable `{{ .ConfirmationURL }}`; the phone wants a typed
   `{{ .Token }}`. The variables are two renderings of one credential —
   `{{ .TokenHash }}` is documented as "a hashed version of the
   `{{ .Token }}`" and is what the confirmation URL is built from — so a
   template carrying both ought to serve both clients from one send.
   The `signInWithOtp` reference is less comfortable than that, saying
   the presence of `{{ .Token }}` means an OTP sends "instead", and the
   templates page does not address the pair at all. UNTESTED. Resolve
   it with one real send before building the screen, because if the two
   cannot coexist then D costs the web's magic link, and that changes
   the trade.

   **Build order.** Custom SMTP was the first step and it is already
   done, which is why this entry is now smaller than it looked. What
   remains: confirm the verified domain and the suppression list, then
   send to a tester's address and watch it land, then the Google-only
   reach test (point 3 above, the one real unknown), then the template
   question, then the screen. Nothing here needs an Apple Developer
   account, which is the whole argument for D.

2. **Account deletion + a Settings screen** [P] — **BUILT 2026-10-08,
   NOT YET PRESSED ON A DEVICE.** This was the App Store submission
   blocker: Apple's guideline 5.1.1(v) requires an app that creates an
   account to let the user delete it from inside the app, and the phone
   had no such screen. `mobile/components/Settings.tsx` now carries the
   account facts, sign-out (previously stranded on the Dashboard), and
   the danger zone at the Settings root as decided. It typechecks and it
   bundles. **Pressed for the first time 2026-10-11, and in the hardest
   place to get right: a real account was deleted through it and the
   purge destroyed the account and all nine of its rows.** So 5.1.1(v)
   is satisfied in fact and not only in code. What is left is cosmetic
   and is item 10 — the screen works and looks like one nobody has
   looked at.
3. **Quick entry** [D]. Arguably worth MORE on a phone than on the web —
   entering a cash spend while standing in a shop is the case. Decision:
   whether it is the same keep-going-until-closed surface the web has,
   or a single-shot sheet.
4. ~~**Spending tab** [P].~~ **SHIPPED 2026-10-08.** The fourth tab, with
   the dead-month filter and the untrack nudge.
5. ~~**Loan and asset setup / edit terms** [P].~~ **SHIPPED
   2026-10-12 as a full account manager.** Settings -> Accounts you
   track: add, rename, reorder, delete, set a loan's terms, change an
   asset's kind. Same engine functions as the web — `setupAsset`,
   `setupLoan`, `addCategory`, `updateCategory`, `deleteCategory`,
   `moveCategory` — none of which the phone called before.

   **One form for all three kinds**, where the web has two modals and
   a third screen. The fields follow the kind picker, so an asset is
   never asked for an APR.

   **Three engine paths behind one form, and the reason is a type that
   was telling the truth.** `SetupLoanInput.originalPrincipal` is
   REQUIRED, correctly: `setupLoan` means set up a loan and a loan
   without a principal cannot amortize. But a debt with only a name
   and a balance is a real supported state — `applySetup` creates
   exactly that from the wizard's last step, and `isLoanConfigured`
   exists to gate the terms. So the form stays permissive and the
   branch lives in `lib/categories.ts` where a test can reach it:
   asset -> `setupAsset`; debt with a principal -> `setupLoan`; debt
   without -> `addCategory`/`updateCategory` plus the reading. A screen
   deciding what an engine call means is what the engine boundary
   exists to prevent.

   **No drag-to-reorder**, same reason the web disables it on touch:
   arrows move one row and cannot be ambiguous.
6. ~~**Log a contribution** [P].~~ **SHIPPED 2026-10-08** — the
   "Contributed" figure had implied a control that did not exist.
7. ~~**Onboarding + guided tour** [D].~~ **COMPLETE 2026-10-13, both
   halves.** It shipped twice, and the second time reversed the first:

   - 2026-10-11, the signpost. "Port the wizard, or say setup is a web
     task" was answered with neither — the phone already had every
     control, so `components/FirstRun.tsx` said so and handed you to
     them. The wizard stayed unported on the grounds that a second way
     to create a rule is a second thing to keep correct.
   - 2026-10-13, the wizard, because that reasoning was answering the
     wrong question. Most App Store users will never open the web, so
     the phone's setup cannot be the lesser version — and the drift
     the first decision was avoiding is avoidable without crippling
     the phone, by sharing the LOGIC rather than the screen. Nothing
     in `components/Setup.tsx` decides what a setup answer means; the
     words are `src/content/setup.ts` and the rules are
     `src/engine/setup.ts`, both of which the web calls too.

   Both survive, and they answer different questions: the flow says
   "set me up", the guide says "here is what is still missing". A new
   account gets the flow and Skip lands on the guide. The tour ships
   inside About and now also opens straight after setup, as it does on
   the web. Mobile item 15 has the detail.
8. ~~**The recovery copy** [D].~~ **SHIPPED 2026-10-08** alongside
   transaction editing, which is what "ships with item 1" meant.
   `lib/stash.ts`, awaited before the optimistic apply, reported and
   discarded on relaunch — never replayed.

9. ~~**Export** [D].~~ **SHIPPED, and corrected 2026-10-11.** Tested on
   a device: the numbers are right (October — in 5541.85, out 3367.19,
   net 1566.81, cumulative 2174.66). The file was not: it went to the
   share sheet as a bare string, so iOS saved it as `text` with no
   extension and no spreadsheet would open it. RN's `Share.share`
   `title` is Android-only and did nothing. Now the CSV is written to
   the cache as a real file — `key-budget-ledger-2026-10-11.csv` — and
   shared by uri with its mime type and UTI. Import stays off the phone
   deliberately.
10. **Horizon control** [D]. The phone has a device-local date chip
    where the web has a synced slider. The chip is arguably the better
    phone control; the decision is whether it should write
    `settings.ledgerHorizon` like the web does, or stay local.

11. **Apple guideline 4.8 as it actually reads** — the citation item 1
    depends on, kept separate so it is quoted once and not
    paraphrased twice.

    **What Apple requires, checked 2026-10-08 against the live
    guidelines page (App Review Guidelines, "Last Updated: June 8,
    2026") rather than from memory.** Guideline 4.8, Login Services,
    verbatim:

    > Apps that use a third-party or social login service (such as
    > Facebook Login, Google Sign-In, Log in with X, Sign In with
    > LinkedIn, Login with Amazon, or WeChat Login) to set up or
    > authenticate the user's primary account with the app must also
    > offer as an equivalent option another login service with the
    > following features:
    >
    > - the login service limits data collection to the user's name and
    >   email address;
    > - the login service allows users to keep their email address
    >   private as part of setting up their account; and
    > - the login service does not collect interactions with your app
    >   for advertising purposes without consent.
    >
    > A user's primary account is the account they establish with your
    > app for the purposes of identifying themselves, signing in, and
    > accessing your features and associated services.
    >
    > Another login service is not required if:
    >
    > - Your app exclusively uses your company's own account setup and
    >   sign-in systems.
    > - Your app is an alternative app marketplace, or an app
    >   distributed from an alternative app marketplace, that uses a
    >   marketplace-specific login for account, download, and commerce
    >   features.
    > - Your app is an education, enterprise, or business app that
    >   requires the user to sign in with an existing education or
    >   enterprise account.
    > - Your app uses a government or industry-backed citizen
    >   identification system or electronic ID to authenticate users.
    > - Your app is a client for a specific third-party service and
    >   users are required to sign in to their mail, social media, or
    >   other third-party account directly to access their content.

    Three things follow, and the first two are the guideline's own
    words while the third is an inference, marked as one:

    1. 4.8 is triggered by the app USING a third-party login service.
       An iOS build that offers none never reaches the requirement —
       that is the "exclusively uses your company's own account setup
       and sign-in systems" exception, and it is the cheapest compliant
       shape available here.
    2. The guideline never names Sign in with Apple. It asks for
       "another login service" with three features, and any service
       with them qualifies.
    3. INFERENCE, not quoted: this app's own email login cannot be that
       second option, because it fails the second feature. Keeping an
       address private "as part of setting up their account" means a
       relay; an app that authenticates against its own user table
       receives the real address and has nowhere to hide it. In
       practice Sign in with Apple is the only service that meets all
       three, so "offer Google on iOS" and "offer Sign in with Apple"
       are the same decision.


12. **App identity: FIXED 2026-10-09. The build itself still does not
    exist.** `mobile/app.json` was the untouched Expo template — named
    `mobile`, slug `mobile`, scheme `mobile`, no `ios.bundleIdentifier`
    at all, template icons, and an `android` block for a platform that
    will never ship. Now: name **Key Budget**, slug `key-budget`, scheme
    `keybudget`, `ios.bundleIdentifier` **`app.keybudget`** (the domain
    reversed), the android block deleted, `supportsTablet` false because
    the layout is a phone layout and claiming iPad means iPad
    screenshots and an iPad review, and `userInterfaceStyle` **dark**
    rather than `automatic`, which simply applies the dark-only decision
    that was already made.

    **The bundle identifier is reversible right now and stops being so
    the moment it is registered with Apple** — it is what App Store
    Connect, the provisioning profile and any future associated-domains
    entitlement key off. Enrollment is 2026-10-13, so there is a window
    and it is this one.

    **What remains is the thing itself: no iOS build has ever been
    produced from this project** — not a simulator build, not an EAS
    build, not a TestFlight upload. Expo Go is a generic host app that
    loads a JS bundle; it is not this app, and every item in band A
    assumes a binary exists to put them in. Two routes, both open:
    `eas build -p ios --profile development` with `ios.simulator` true,
    which needs a free Expo account and **no** Apple Developer
    membership and runs in the cloud; or `npx expo run:ios` locally,
    which needs CocoaPods installed (Xcode 16.4 is present; `pod` is
    not, and system Ruby is 2.6).

    **The local route hit an architecture trap worth recording, 2026-10-11.**
    The Mac is an M4, but the Homebrew in `/usr/local` is an **Intel
    build running under Rosetta** — almost certainly carried across by
    Migration Assistant — which is why `brew install cocoapods` warned
    about an unsupported Tier 3 configuration. The fix is a native
    install at `/opt/homebrew` and CocoaPods from there. It matters
    beyond one warning: a native build links against whatever
    architecture the toolchain hands it, and `node -p process.arch`
    reporting `x64` on an M4 means the JS toolchain is in the emulated
    world too. Check that before blaming a build failure on Expo.

    **CLEARED 2026-10-14: Xcode 27.0 (27A266a) ships Swift 6.4, and
    the whole native project compiles.** Every pod built, expo-modules-jsi
    included — the package that was the blocker. Three things came out
    of the attempt and all three outlive it:

    - **A dead Intel Homebrew is the real obstacle now**, not Xcode.
      `/usr/local/bin/git` is a symlink into an x86_64 Cellar left by
      Migration Assistant, and it comes first on the PATH that
      `/bin/sh` hands a CHILD process — so the interactive shell finds
      the working system git while everything that spawns one does
      not. It broke `pod install` ("Bad CPU type in executable"),
      `eas build` ("git found, but git --help exited with status
      undefined") and `npm test` (check_spelling shells out to
      `git ls-files`, so the chain died before jest ran, silently,
      for who knows how long). **Remove that Homebrew, or at least
      that symlink.** Everything here was run with
      `PATH=/usr/bin:/bin:$PATH` as a stopgap.
    - **The remaining local failure is macOS, not Expo.** With a
      working git the build reaches codesign and dies on
      `ExpoModulesJSI.framework: resource fork, Finder information, or
      similar detritus not allowed`. The detritus is
      `com.apple.provenance`, a system xattr macOS 26 applies and
      `xattr -rc` does not remove. It does not affect EAS, whose
      images are clean.
    - **No iOS 26 simulator runtime is installed** — Xcode 27
      downloads platform runtimes separately, and the newest here is
      18.6. So even a working local build cannot show Liquid Glass or
      the layered icon. A device over TestFlight remains the only
      honest look at either.

    *The blocker as it stood, kept because the diagnosis is the useful
    part:*

    **THE LOCAL BUILD IS BLOCKED ON XCODE, measured 2026-10-11.** The
    first `npx expo run:ios` got as far as a clean CocoaPods install and
    then `xcodebuild` failed with code 65:

    > `package 'apple' is using Swift tools version 6.2.0 but the
    > installed version is 6.1.0`

    The package is `node_modules/expo-modules-jsi/apple`, whose
    `Package.swift` opens with `// swift-tools-version: 6.2`, as does
    `@expo/expo-modules-macros-plugin/apple`. Swift 6.1.2 is what Xcode
    16.4 ships. Expo's own SDK 57 requirements say **"Xcode version
    26.4+"**, so this is a major-version gap and not a flag, a cache or
    a Rosetta problem — the native toolchain was already confirmed arm64
    before this ran. Nothing in the repo can work around it; editing a
    dependency's `Package.swift` would only move the failure into the
    compiler.

    So the order is: **EAS first, Xcode when it finishes downloading.**
    `mobile/eas.json` exists with a `simulator` profile — cloud build,
    an image that has the right Xcode, no Apple Developer membership,
    and the one interactive step is `eas login` with a free Expo
    account. Updating Xcode is still worth starting, because local
    iteration on native code is far faster than a cloud round trip and
    the update is time rather than work.

    `developmentClient` is deliberately **false** in that profile. A
    dev client is the better iteration loop, but it needs
    `expo-dev-client` installed, and that changes what `expo start`
    serves by default — which would disrupt the Expo Go testing running
    on the phone right now. The simulator build embeds its bundle
    instead: slower to iterate, and sufficient to prove the pipeline and
    to exercise Google's redirect against a real registered scheme.

    `mobile/ios/` now exists (1.2 GB, gitignored by both ignore files).
    It is generated — `npx expo prebuild --clean` regenerates it, and it
    must never be edited by hand, since every native setting belongs in
    `app.json`.

    **A dev build is also the only way to find out what Expo Go hides** —
    the launch screen, the permission strings, the privacy manifest, and
    any native module Expo Go does not already bundle. None of those
    appear in the client being used to test today.

    **Google OAuth can be built and tested before 2026-10-13.** It needs
    the custom scheme, which needs a build, but not the paid account —
    only Sign in with Apple needs that, for its Service ID and key.
    Guideline 4.8 governs what SHIPS, not what is built, so the two can
    be developed apart and released together.

13. **Google sign-in on the phone — WIRED 2026-10-11, untested on a
    device.** `signInWithIdToken`, native: Google issues the ID token on
    the device and Supabase takes it directly. No browser, no redirect,
    no URL scheme round trip. The button is drawn only outside Expo Go,
    checked with `executionEnvironment` from expo-constants rather than
    discovered by crashing when pressed, so the phone's Expo Go workflow
    is untouched.

    **WORKS, 2026-10-11.** Tested on the simulator build: tapped
    Continue with Google, got Google's web sign-in (the simulator has no
    Google account signed in, which is a simulator artifact and not the
    real flow), and landed in the author's real account with his real
    data. The native account sheet is what a device shows, and that test
    comes with the first device build.

    **THE NONCE: "Skip nonce checks" is ON as of 2026-10-11, and here
    is the evidence rather than an opinion.** The library cannot produce one.
    `SignInParams` in
    `@react-native-google-signin/google-signin@16.1.5` has exactly one
    field, `loginHint`, and the string "nonce" appears in **zero** files
    anywhere in that package. So the ID token carries no nonce claim and
    `signInWithIdToken` has nothing to pass. This is why Supabase ships
    the toggle at all — it exists for native SDKs that do not expose a
    nonce.

    **What is given up, stated plainly.** A nonce binds the ID token to
    one specific sign-in attempt, so a token captured elsewhere cannot
    be replayed. Without it, Supabase still checks the signature, the
    issuer, the expiry, and the audience against the registered client
    IDs — so a replay needs a live, unexpired token minted for THIS
    app's client IDs. On iOS that token goes from Google's SDK to
    Supabase over TLS and never touches a browser, a URL bar or a log,
    so the window is small. Small is not zero, and it is a real trade.

    **The alternative, if that trade is refused:** the browser PKCE
    flow, which supports a nonce, at the cost of a web view instead of
    the system sheet, a registered redirect scheme, and the redirect
    allow-list this path avoids entirely. Not recommended — the UX cost
    is paid by every user on every sign-in, and the risk avoided is a
    narrow one.

14. **Sign in with Apple — BUILT 2026-10-13. The sign-in half is
    finished and in the build; the revocation half is written and waits
    on one thing only, the `.p8` going into Supabase secrets.** What
    follows the next two paragraphs is the plan as it stood before it
    was executed, kept because the two corrections in it are the
    expensive part and they are still what someone needs to read.

    **What shipped:**

    - `mobile/lib/apple.ts` — `APPLE_POSSIBLE` (iOS, not Expo Go),
      `appleAvailable()` which ASKS the OS rather than assuming, and
      `signInWithApple`, mirroring `lib/google.ts`. Scopes FULL_NAME
      and EMAIL, because they come back only on the very first
      authorization ever and there is no second chance to ask. No
      nonce, same as Google, same reason.
    - `appleFailureMessage` in `lib/signin.ts`, pure and tested, with
      a cancel mapping to **null** — say nothing. Apple's sheet is
      dismissed far more often than Google's, because it appears
      without a tap on an account first.
    - `SignIn.tsx` draws Apple's OWN `AppleAuthenticationButton`, white
      on the dark app, ABOVE Google. An option listed last reads as the
      lesser one, and 4.8 asks for an equivalent. Nine renderer tests
      and nine more node checks.
    - `app.json`: `ios.usesAppleSignIn: true` and the
      `expo-apple-authentication` plugin. **Both are native, so this
      needs a new build — it cannot go out over the air.**
    - The deletion half: `supabase/apple_tokens.sql` (two tables and a
      rewritten `purge_due_accounts`), `supabase/functions/apple-link`
      (exchange the authorization code at sign-in) and
      `supabase/functions/apple-revoke` (drain the queue). The client
      secret JWT is hand-rolled over Web Crypto, with no dependency
      anywhere near a signing key, and `tests/apple-secret.test.mjs`
      signs with a generated P-256 key and VERIFIES the result — the
      half a hand-rolled JWS gets wrong, since a DER signature would
      pass every other assertion.
    - `Privacy.jsx` now says that signing in with Apple leaves a token,
      what it is for, and that it dies with the account. It did not
      before, and "no third-party services" was no longer true.

    **A THIRD CORRECTION, 2026-10-14, and it cost an afternoon: a
    signing key can exist and be enabled for NOTHING.** The token
    exchange failed with `invalid_client` for days. The cause was not
    the code, the secrets, the bundle id or the JWT — it was that key
    `B58KDZ42WV` had **no services enabled**, because it was created
    before the App ID's Sign in with Apple capability existed (which
    itself had not been enabled; see the correction above — the two
    failures are the same root). Fixed in the portal by editing the
    key: *Sign In with Apple*, configured to
    `9WJSHTF3EB.app.keybudget`.

    **Confirmed working after that**: re-signing in with Apple put a
    row in `apple_tokens` (count 1), and **Key Budget now appears in
    the iPhone's Passwords app and on account.apple.com → Sign in with
    Apple**, which is the user-visible proof that the grant exists and
    is ours to revoke.

    Worth generalizing: *three* separate pieces of Apple configuration
    were recorded in this spec as done, and all three were partly or
    wholly undone — the App ID capability, the key's services, and
    (earlier) the provisioning profile. None of them fails loudly. A
    configuration fact nobody has watched a machine confirm is a
    claim.

    **A FAILED EXCHANGE IS NO LONGER SILENT**, which is the other half
    of why this took an afternoon: the only record was the edge
    function's log. `linkAppleAuthorization` now writes an
    `appleLinkFailed` device preference either way, and Settings says
    so under the account facts — that the user IS signed in, that what
    did not finish is the deletion link, and that signing in with
    Apple again retries it. A success clears the flag, so the notice
    cannot outlive the problem.

    **RLS on `apple_tokens` is proven, not assumed.**
    `supabase/apple_tokens.sql` enables RLS, creates **no policies at
    all** and revokes every grant from `anon` and `authenticated`, so
    the service role is the only thing that can read a refresh token —
    the owner of the row included. The file ends with the two queries
    that check it (`pg_policies` count must be 0, grants must be
    empty), because "no policies I remember writing" is not the same
    statement as "no policies".

    **THE ONE THING THAT NEEDS THE AUTHOR — the `.p8`.** Nothing above
    writes the key anywhere; it is set once, by hand, in the Supabase
    dashboard, and never lands on this disk or in this repo.

    Supabase Dashboard -> Project `kjcvtpmorftjyejjskwm` -> Edge
    Functions -> Secrets -> Add new secret, four times:

    | Name | Value |
    |---|---|
    | `APPLE_TEAM_ID` | `9WJSHTF3EB` |
    | `APPLE_KEY_ID` | `B58KDZ42WV` |
    | `APPLE_BUNDLE_ID` | `app.keybudget` |
    | `APPLE_PRIVATE_KEY` | the whole contents of `AuthKey_B58KDZ42WV.p8`, `-----BEGIN PRIVATE KEY-----` line and all |

    **Before any of that, check the KEY ITSELF has services enabled**
    (Certificates, Identifiers & Profiles -> Keys -> the key -> Sign In
    with Apple -> Configure -> primary App ID). A key with no services
    signs a JWT that Apple rejects as `invalid_client`, and nothing
    about the error says so. Done 2026-10-14 for `B58KDZ42WV`.

    Paste the key as it is. If the form flattens the newlines into
    literal `\n`, that is handled — `readConfig` repairs it, and there
    is a test for exactly that, because the failure otherwise is an
    ASN.1 error that says nothing about newlines.

    Then, from the repo root:

        npx supabase login
        npx supabase functions deploy apple-link   --project-ref kjcvtpmorftjyejjskwm
        npx supabase functions deploy apple-revoke --project-ref kjcvtpmorftjyejjskwm

    and run `supabase/apple_tokens.sql` in the SQL editor. It replaces
    `purge_due_accounts()` with a version that queues the token before
    deleting the user — the order matters, because the delete cascades
    the token away.

    Verify, without needing a deletion:

        select count(*) from apple_tokens;          -- 1 after one Apple sign-in
        select * from apple_revocations;            -- empty until a purge

    **Until the secrets are set, Apple sign-in still works.** The
    `apple-link` call is deliberately not awaited and its failure is
    not shown; the only consequence is that nothing is stored to revoke
    later. Every Apple sign-in sends a fresh code, so the moment the
    secrets exist it heals itself on the next sign-in.

    Enrollment was paid 2026-10-11 (Individual); approval arrived
    2026-10-11. The plan as written before the build:

    **A correction to what this spec said twice before: the native flow
    does NOT need a Services ID or a signing key.** Those belong to
    Apple's WEB OAuth flow, which this app does not use — the web signs
    in with Google and magic links. For native, per Supabase's own
    guide, "the bundle identifier serves as the client ID", so the
    whole Apple-side configuration is one App ID with one capability.
    That makes this materially smaller than it was written up as.

    1. **Apple Developer portal:** register the App ID `app.keybudget`
       and enable the *Sign in with Apple* capability on it.
       **CORRECTION, 2026-10-13: this had NOT been done, despite being
       recorded as done.** Build 3 failed at code signing —
       "Provisioning profile … doesn't include the Sign In with Apple
       capability" — and `eas credentials:configure-build` then
       printed `Synced capabilities: Enabled: Sign In with Apple`,
       which is EAS turning it on for the first time. It also
       regenerated the profile, which the capability change
       invalidated. Two things worth keeping from that:

       - **EAS does not sync capabilities during a `--non-interactive`
         build.** It prints "All credentials are ready" and builds
         against the stale profile. The sync happens in
         `credentials:configure-build`, which needs an Apple login —
         so the first build after any entitlement change is the one
         that cannot be fully automated.
       - A configuration fact nobody has watched a machine confirm is
         a claim, not a fact. This one sat in the spec for two days.
    2. **Supabase -> Authentication -> Providers -> Apple:** enable, and
       add **`app.keybudget`** to Client IDs. Nothing else. If anyone
       ever tests this in Expo Go, `host.exp.Exponent` has to go in that
       list too — but it cannot be tested there, because the module is
       native.
    3. `npx expo install expo-apple-authentication` and add its config
       plugin, which is what writes the entitlement into the build.
    4. Code, mirroring `lib/google.ts`:
       `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME,
       EMAIL] })`, then `signInWithIdToken({ provider: "apple", token:
       credential.identityToken })`. **No nonce** — Supabase's native
       Expo example does not generate one, same as Google.
    5. **Use `AppleAuthenticationButton` from that package, not a
       hand-drawn button.** Apple's guidelines govern the mark, the
       wording and the corner radius, and a custom one is a rejection
       risk for no gain.
    6. Gate it on `AppleAuthentication.isAvailableAsync()` rather than
       on the execution environment, since that is the API's own answer
       and it is iOS-version-dependent as well as build-dependent.

    **The one behavior that surprises people:** Apple returns the user's
    name and email **only on the very first authorization**. Every later
    sign-in returns null for both. Anything that wants a display name
    has to capture it the first time or never get it. This app shows no
    display name today, so it costs nothing now and would cost a
    migration later.

    **4.8 ties this to Google:** Google is wired and working on the
    phone, and it must not reach the App Store before this does.

    **A SECOND CORRECTION, and this one restores the key.** "No Services
    ID, no signing key" is right for SIGNING IN and wrong for DELETING.
    Apple requires an app offering Sign in with Apple to **revoke the
    user's Apple tokens when the account is deleted** — and the
    revocation endpoint is authenticated with a client secret JWT
    signed by the `.p8` key, so it needs the key, the Team ID and the
    Key ID after all. The native sign-in flow needs none of that; the
    deletion flow does.

    What that means in this app, where deletion is already built and
    already verified end to end:

    - `signInAsync` returns an `authorizationCode` that **expires in
      five minutes and can be used once**. "Capture it at sign-in" is
      therefore not a plan — storing the code and exchanging it at
      deletion, possibly months later, exchanges nothing. It has to go
      to the server **immediately**, be exchanged there for an Apple
      refresh token, and the REFRESH TOKEN is what gets stored and what
      is revoked later. The native flow never hands Supabase a provider
      refresh token on its own, so nothing captures any of this today.
    - The revoke call belongs with `purge_due_accounts()`, server-side,
      because it needs the signing key and a key in a client is not a
      key. That is an edge function with the `.p8` in its secrets.
    - It is **not** optional and it is **not** covered by the existing
      purge: deleting the `auth.users` row removes our record of the
      user and leaves Apple's grant standing.

    Sized honestly, this is the largest remaining piece of the Apple
    work — bigger than sign-in itself — and it only exists if Sign in
    with Apple ships. Its own item, not a line in the sign-in one.

15. **Full setup on the phone, at web parity — DECIDED 2026-10-11,
    PLANNED, NOT STARTED. Lands before App Store submission.** The
    reasoning is not mine and is worth keeping in his words: most App
    Store users will never touch the web, so the phone's setup cannot
    be the lesser version. That overrides the "signpost, not a wizard"
    call made earlier the same day, and it should — that call was
    about avoiding DRIFT, and drift is avoidable without crippling the
    phone.

    **The answer to drift is to share the logic, not the screens.**

    **Phase 1 — DONE 2026-10-12.** `src/engine/setup.ts` holds
    `applySetup(state, answers, today)`, pure, and `App.jsx`'s
    `completeOnboarding` is now four lines that call it. `today` is a
    parameter rather than a `todayISO()` call so the harness can pin
    it. 29 checks in `tests/setup.test.mjs` — the first time this logic
    has been reachable by a test at all, which is half the point of the
    move. They cover each of the three decisions, the forecast actually
    running afterward, and the junk-anchor cases. One assertion found a
    mistake in the test rather than the code: `computeLedger` returns
    `{ rows, endingBalance }`, not an array.

    **Phase 1 — extract what setup CREATES (half a day).** The web's
    wizard is 460 lines of questions over about fifty lines of real
    logic, and that logic lives in `completeOnboarding` inside
    `App.jsx` — a React component. It encodes decisions a second
    implementation would get wrong by omission:

    - a wizard row named "Savings" must REUSE the seeded category of
      that name rather than making a second one, but only when nothing
      is logged against it, because reusing one that has history means
      writing into somebody's real data on a name collision;
    - debt is created with a balance and NO terms, deliberately, because
      asking for principal, APR and a start date during setup is where
      people give up;
    - the accounts step runs last so that someone who quits before it
      still leaves with a working forecast.

    So: move it to `src/engine/setup.ts` as a pure
    `applySetup(state, answers) -> state`. Web calls it, phone calls
    it, and "one definition of what setup creates" is a fact about the
    code rather than a promise. Behavior parity is provable rather
    than hoped for: the golden harness already round-trips normalize
    over real fixtures, and this is a move, so the output must be
    byte-identical.

    **Phase 2 — DONE 2026-10-13.** `mobile/components/Setup.tsx`, six
    steps, same questions and same order as the web. It was built in
    two commits because the first one had nothing to do with the
    phone:

    - `src/content/setup.ts` now holds every string, the way
      `about.ts` and `tour.ts` already hold theirs, and
      `src/engine/setup.ts` gained the other half of the shared
      definition — `paycheckRule`, `rentRule`, `billRules`,
      `groceryRule`, `balanceAnswer`, `blankAccountRows`,
      `startedAccountRows`, `incompleteAccountRows`,
      `collectAccounts`. The WEB CALLS ALL OF IT, so this is a move,
      not a second implementation. 87 checks in
      `tests/setup.test.mjs`, up from 29.
    - Each builder returns `null` for "nothing to add", which is what
      makes a client's Continue and its Skip differ by one line.
      "Skip discards what was typed" is therefore true on both
      clients without either having to remember it.

    **What the phone has that the web does not: Back.** A 390pt screen
    shows one question at a time, so a typo two steps ago is
    unreachable without it — which is why the phone holds the whole
    draft at once instead of committing step by step, and why
    collected rules are keyed BY STEP. A list would have added a
    second paycheck to anyone who walked back and forward, and there
    is a test that does exactly that.

    **The two steps that gate, for opposite reasons.** The balance step
    has no Skip at all and says why on screen; zero is an answer and an
    empty field is not. The accounts step can be empty but not
    half-filled — an amount with no name blocks Finish and names the
    missing half, which is the bug a real user found.

    40 checks in `tests/mobile-setup.test.mjs` (in `npm test` and in the
    mutation runner's `NODE_SUITES`), 8 renderer tests in
    `mobile/__tests__/setupflow.test.tsx`, 4 more in `chrome.test.tsx`.

    **Phase 3 — DONE 2026-10-13, as recommended.** A new account gets
    the flow; Skip lands on the three-step guide, which already
    computes exactly what is outstanding and is therefore the resume
    state for free. Finishing every step leaves the guide with nothing
    to say, so it hides itself.

    Who is met with it, from `mobile/lib/setup.ts`:

    - `settings.hasSeenOnboarding` is ACCOUNT data, so setup done on
      the WEB counts on the phone. It is the web's own gate and it
      already means "completed or skipped".
    - `isNewAccount` as well, for an account predating the flag.
      Asking a two-year user to set up their budget would be worse
      than not asking a new one.
    - a per-device `setupDismissed` pref, for the offline case: Skip
      writes the account flag, and a write that cannot land must not
      leave somebody stuck in a wizard they already closed.

    Finishing is ONE commit — `markSetupSeen(applySetup(state, answers))`
    — so a half-applied setup is not a state this app can be in, and
    the tour opens afterward exactly as it does on the web. Settings
    gained a "Set up your budget" row, matching the web's header
    button, for someone who skipped or who wiped their data.

    **The three things to settle first, all settled:**

    - Quick Entry: not built on the phone (ranked item 10), so the
      paycheck note is a `{web, mobile}` pair in `src/content/setup.ts`
      and the phone's version names `+ Add` on the Ledger. It is the
      only platform variant in the file.
    - The strings are in `src/content/`, so the voice pass touches one
      file rather than two. `Onboarding.jsx`'s "Draft copy — expected
      to be edited" banner went with them.
    - Loan TERMS stay out of setup on both clients. Not reversed on the
      bigger screen: the accounts step still asks for a name and what
      is owed now, and the Dashboard card still prompts for the rate.

16. **Native tabs — BUILT 2026-10-13.** `app/(tabs)/_layout.tsx` is
    `NativeTabs` from `expo-router/unstable-native-tabs`, with
    `ThemeProvider value={DarkTheme}` at the root. Verified as far as
    it can be here: `expo export --platform ios` bundles, and swapping
    in the SDK 58 import path fails to resolve, so the bundle is a
    real check rather than a ritual.

    Two things the plan below did not anticipate:

    - **The per-tab header is gone.** expo-router's JS `Tabs` drew one
      with the screen's title; native tabs do not, and giving them one
      means a `Stack` inside every tab. The bar already names the tab
      you are on, so the header was saying it twice and charging 44
      points for it. Chrome owns the top of the screen anyway — the
      safe-area inset, the anchor strip, the settings button — so
      nothing moved under the notch.
    - **The fill variants are not uniform, and the SF catalog is why.**
      `tablecells`/`tablecells.fill` and `chart.bar`/`chart.bar.fill`
      are true pairs. `list.bullet` and `chart.line.uptrend.xyaxis`
      have no `.fill`; the nearest candidates add a rectangle and a
      circle, which reads as a different icon rather than a selected
      one. Those two are marked by the tint alone, which is iOS's own
      default. Worth overruling if it looks wrong on the device — it
      cannot be judged from here.

    Dashboard's icon is `chart.line.uptrend.xyaxis`, resolving the one
    the plan said was worth arguing about: the pie was removed from
    this app, so a pie icon for the tab that no longer has one would
    be a small lie.

    *The plan, which is still the reference for the API:*

16. **Native tabs — the ThemeProvider question is SETTLED, 2026-10-12,
    from Expo's own page rather than from memory.** Decided to build;
    scheduled after the setup flow.

    - **The import path is `expo-router/unstable-native-tabs` on this
      SDK.** The stable `expo-router/native-tabs` is SDK 58 and later;
      54 through 57 use the unstable path. Getting this wrong is a
      module-not-found, not a subtle bug, but it is the first thing to
      get right.
    - **`ThemeProvider` is a recommendation, not a requirement, and the
      reason is narrow:** the default theme has a white background, so
      switching tabs on iOS 26 flashes white. For a dark-only app the
      fix is `DarkTheme`, and on SDK 56+ `ThemeProvider` comes from
      `expo-router` itself. So: wrap the root, one import, no
      architectural change. The spec previously implied something
      larger.
    - **Selected tint** is `tintColor` on `NativeTabs`. Expo recommends
      `DynamicColorIOS` so it adapts between light and dark; this app
      is dark only, so a flat brass is correct and the wrapper is not
      needed.
    - **Liquid Glass is automatic on iOS 26** and the background props
      (`backgroundColor`, `blurEffect`, `shadowColor`) only affect iOS
      18 and earlier. There is no callback for the glass recoloring
      itself against content, so icon colors want `PlatformColor` or
      `DynamicColorIOS` if this ever stops being dark-only.
    - **Expo Go: the page does not say.** The only stated build
      requirement is `getImageSourceSync` for vector icons, which the
      SF Symbols path does not use, so native tabs with `sf` icons
      plausibly render in Expo Go. Unverified — and worth verifying by
      trying rather than by reasoning, which is the standing rule here.
    - **Nothing can be SEEN until the OS catches up.** Liquid Glass is
      iOS 26 and the installed simulators are iOS 17, so the first
      honest look at this is after the macOS and Xcode updates.
    - **Proposed SF Symbols**, one per tab, default and selected:
      Ledger `list.bullet` / `list.bullet.indent`; Dashboard
      `chart.pie` / `chart.pie.fill` — or `circle.circle` to echo the
      current ◎; Budget `tablecells` / `tablecells.fill`; Spending
      `chart.bar` / `chart.bar.fill`. Dashboard is the one worth
      arguing about: the pie was removed from the app, and a pie icon
      for the tab that no longer has one is a small lie.

18. **EAS Update (over-the-air JS) — DONE 2026-10-13, and the runtime
    version is PROVEN rather than configured and hoped for.**

    `app.json` now carries `runtimeVersion: { policy: "fingerprint" }`
    and the update URL; `eas.json` puts `simulator` and `preview` on
    the `preview` channel and `production` on `production`.

    **The gate was tested by moving things and looking**, because
    "a native change bumps it" is the entire safety property and a
    policy name is not evidence:

    | change | runtime version |
    |---|---|
    | baseline | `cf6120cc…` |
    | a line added to `components/HistoryList.tsx` | `cf6120cc…` — unmoved |
    | `ios.supportsTablet` flipped in `app.json` | `a435666a…` — moved |
    | reverted | `cf6120cc…` |

    So JS ships over the air to the builds it was written against, and
    a native change makes a runtime version that no installed build
    has — which means those builds are never offered it. That is the
    trap below, closed: an OTA update is JS running against a binary
    that may be older than it, and JS calling a native module the
    binary does not have crashes on launch, with no way to push a fix
    to a device that cannot start.

    Build 1.0.0 (2) does not contain `expo-updates`, so the first
    OTA-capable build is a new one. There is no way to add OTA over
    the air.

    **THE PUBLISH COMMAND, with the two things that bite:**

        cd mobile && npx eas-cli update \
          --channel production --environment production --platform ios \
          --message "..." --non-interactive

    - **`--platform ios` is not optional.** `eas update` defaults to
      exporting EVERY platform, and the web export fails outright:
      `expo-router`'s native-tabs has a web variant that imports
      `@radix-ui/react-tabs`, which is not installed and should not
      be. The app is iOS only. Without the flag the whole publish
      aborts after a full bundle.
    - **`--environment` is required in `--non-interactive`.** It picks
      which EAS environment's variables are baked in, and the CLI
      refuses to guess.

    **First update published 2026-10-14**: group
    `bc3f32ef-35cf-4b50-b6c5-5c3ebbd8dc15`, runtime version
    `cf6120cc…`, which is build 5's — the seven device-test fixes,
    none of them native.

    *The planning entry, kept for the lists of what can and cannot go
    this way:*

18. **EAS Update (over-the-air JS) — planned 2026-10-12, folds into
    the next native batch.** Build 1.0.0 (2) does not contain
    `expo-updates`, so the first OTA-capable build has to be a new one
    regardless; there is no way to add OTA over the air.

    **What can go OTA, once it is in:** anything that is only
    JavaScript, which is almost everything this project does — screens,
    copy, engine logic, validation, charts, the setup flow, the parity
    gaps, the voice pass. A JS change reaches an installed TestFlight
    build without App Review and without a new build.

    **What always needs a new build**, because it changes the binary:
    every native module (`expo-haptics`, `expo-apple-authentication`,
    `expo-updates` itself), native tabs (a native view), anything
    touching `app.json`'s native surface — the icon, the splash, the
    bundle identifier, URL schemes, entitlements, Info.plist keys — and
    an Expo SDK upgrade.

    **The trap worth writing down now:** an OTA update is JS shipped
    against a binary that may be older than it. Ship JS that calls a
    native module the installed build does not have and it crashes on
    launch, with no way to push a fix to a device that cannot start.
    `expo-updates` has a runtime version for exactly this, and it has
    to be set up so that a native change bumps it rather than being
    allowed to land OTA.

17. **Haptics — BUILT 2026-10-13, exactly to the list below.**
    `mobile/lib/haptics.ts` is five named feelings; success and
    failure live in `StateProvider.commit` so there is one place
    rather than twenty-three call sites, and the reorder arrows pass
    `"selection"` because a control you can press five times must not
    thump five times.

    **Three tests record the calls**, which is the only way to check
    the one thing in this app that leaves no trace on a screen: the
    warning lands BEFORE the alert, six typed digits produce one buzz
    rather than six, and one write is felt once however many screens
    it took. Removing the warning fails the first.

    Account deletion has no alert to precede — the confirmation is a
    field you type DELETE into — so the moment marked is the one where
    the button goes live. That case was not in the list and had to be
    decided.

    *The list, as agreed:*

17. **Haptics (`expo-haptics`) — planned 2026-10-12, after native
    tabs.** On outcomes, not touches. The rule that keeps it subtle is
    that a haptic answers a question the screen cannot answer fast
    enough: did that land?

    - **Success** — any balance logged (checking, savings, investment,
      loan), a transaction saved, a sign-in code accepted, setup
      finished. The balance one is deliberate reward: filling the
      Dashboard is the habit the whole app depends on.
    - **Warning** — immediately BEFORE a destructive confirm appears:
      delete a transaction, delete the account, wipe data. Before, not
      after, so it is a hand on the arm rather than a commiseration.
    - **Error** — a save that did not land, a wrong code.
    - **Selection** — tab switch, and one tick per point while
      scrubbing a chart.

    **Three more worth adding, all the same shape.** A pull-to-refresh
    that actually fetched (light, on completion — the one case where
    nothing visibly changes when the data was already current); the
    scope sheet opening on a ledger row, since that is a modal
    appearing under your thumb; and reaching either END of a chart
    scrub, which is how a slider tells you it has stopped without you
    looking.

    **Two to leave alone.** Every keystroke in the code field — the
    system keyboard already does that and doubling it feels broken —
    and the auto-submit on the sixth digit, which is immediately
    followed by the success tick and would read as a stutter.

    **One rule worth writing down:** haptics are silent for a user with
    them switched off, so nothing may be ONLY a haptic. Every one of
    these has to sit beside a visible change.

Not built, and not yet decided either way:

**Deliberate differences, decided 2026-10-13 and revisitable.**

- **The Budget is READ-ONLY on the phone.** The grid is two scrollers —
  a pinned label column beside a horizontal run of months — so a finger
  crossing it constantly starts gestures on row labels. An accidental
  hit opened an editor over a RULE, and one mistaken save there changes
  every month the rule generates: the most expensive accident available
  in this app. Reported from the phone after exactly that. The web keeps
  the tap, correctly, because a mouse does not scroll by touching what
  it points at. All editing goes through the Ledger, where a row is one
  dated occurrence and the scope sheet makes you say what you meant.
  The screen says so rather than going quiet: "A view of the plan. Edit
  anything on the Ledger." A read-only screen that does not admit it is
  how someone taps twice and concludes the app is broken.
- **The Ledger's "Cumulative columns" picker stays off the phone.** A
  column picker at 390pt is a design problem rather than a port, and
  the Budget already carries cumulative net. Revisitable.
- **Multi-select delete stays web-only.** A laptop gesture; the phone's
  per-row confirm is the safer answer to the same question.

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
1. **The mobile backlog above, item 1** — no account created through
   this app can sign in on the phone, because the web never sets a
   password and the phone accepts nothing else. That is the top
   blocker, above account deletion, now that transaction editing and
   the Settings screen are both built. Custom SMTP gates every fix for
   it.
2. ~~**Verify the pg_cron purge actually ran.**~~ **CLOSED 2026-10-11.
   PASSED, end to end, on a real account.** It was the oldest honest
   worry in this document — a deletion feature nobody has watched
   execute is a claim, not a feature, and this one was a claim for nine
   days while the app told users their data would be destroyed in seven.

   What was done, in order: a throwaway account
   (`ethanrkey23+kbtest@gmail.com`) created on the web by magic link and
   taken through the setup wizard; signed into on the phone with an
   emailed code; deleted from mobile Settings, which returned "deletion
   scheduled"; `purge_after` backdated to 2026-10-11 00:14 UTC and
   confirmed in `account_deletions`; then the 03:17 UTC run watched.

   What it proved, measured after the run against a baseline of 9 rows:

   - `auth.users` for `242a171d-db90-4d30-bc57-85b8f82dde64` — **0**.
   - `budget_entities` under that id — **0**, down from 9. **The cascade
     is the half that had never been exercised**, and it is the half
     that matters: a purge reports `succeeded` whether it destroyed an
     account or found nothing due, so six clean nights had proved only
     that the schedule exists.
   - `account_deletions` for that id — **0**. The request row goes with
     the user, so a purged account leaves nothing behind anywhere.

   It also happened to be the first real press of the mobile Settings
   screen and of in-app deletion, both of which had shipped untapped.
   They worked; Settings still wants a polish pass, which is its own
   item.

   **What it did NOT prove, and should be said plainly:** the seven-day
   wait, because the date was backdated, and the cancel path, because
   nothing was canceled. Neither is load-bearing in the way the cascade
   was — a delay that fires early is a scheduling bug, not a data-loss
   bug — but neither has been watched either.
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
6. **Copy pass, in the author's voice, across web and mobile.** The
   words have accreted over weeks of sessions and were written by me,
   not by him. Before publish.
7. **Capability parity audit: enumerate, do not fix.** Does the phone do
   everything the web does, everywhere we want it to? The answer today
   is no and the list is not written down — which is exactly how the
   date picker went unreported twice and the chart-scrub fix went
   missing from a batch. Produce the list; decide what is deliberate
   (import, first-run setup) and what is a gap. Before publish.
8. **Count orphans live on the WEB, then one press everywhere.** The
   phone's editor counts the dated amounts a schedule change would orphan
   as you type, shows the number beside the button, and saves on one
   press — the warning has already been read. The web needs two presses
   ("Save", then "Save anyway") only because it does not learn the count
   until submit. That is a limitation, not a decision: move the count to
   render time and the second press goes away. Small, and it ends a
   difference between the clients that nobody chose.
9. **Tombstone retention / purge job.** 90 days is documented but no
   purge is scheduled; the rows accumulate. Read-only offline means the
   window only has to outlive online devices refetching, so this is
   housekeeping, not correctness.
10. ~~**The Ledger prints saving and debt amounts in red, the Budget does
   not.**~~ **CLOSED 2026-10-08, as intended behavior.** Unified on
   2026-10-06, reverted on the Ledger side two days later after using it:
   the tabs ask different questions and the difference in treatment
   follows from that. Recorded as a decision rather than an inconsistency.
11. ~~**Color customization / role hue schemes.**~~ **RETIRED 2026-10-06,
   moot.** The question was whether per-category recolor should return or
   whether the user should pick each ROLE's hue. Neither survives the
   rework: roles no longer have hues to pick. What is left to customize is
   one brass ramp and five decorative card colors, and a scheme picker for
   decoration is a settings screen that buys nothing. Worth keeping from
   that entry, because it turned out to be the right instinct pointing at
   the wrong fix: the complaint read as "wrong hue" and was actually "this
   tab is unreadable", and the answer was fewer colors rather than
   different ones.

12. **Retired palette machinery still exported from the engine.**
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

  **Read-only, deliberately** — *as of 2026-10-02, when this was written.
  No longer true: the phone has had a real write path since 2026-10-08.
  Kept as the record of why it shipped read-only first.* The per-entity
  write path with its version guards is real work, and shipping it the
  same night production data moved would risk the phone writing bad rows
  to answer a question — "does this feel like an app" — that writing does
  not help answer. Email+password auth only: Google OAuth needs a
  redirect that survives the Expo Go sandbox, and the magic-link fallback
  is down behind the broken confirmation email. *That last clause was
  wrong within a day — Resend has been delivering since 2026-10-03 — and
  it is the third copy of the same stale claim found on 2026-10-09. The
  live version of this question is mobile backlog item 1.* `mobile/tsconfig.json` sets
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
- Bank linking (Plaid-style) — much later. **Shaped 2026-10-12 as a
  future IDEA, explicitly not planned and not in v1.** Worth writing
  down because the shape is unusually good and would be easy to get
  wrong later: **the primary checking account ONLY**, where the bank's
  available balance and its date become the verified-balance snapshot
  automatically. That is the whole integration. It fits principle 1
  exactly as written — reality still enters the forecast at one point,
  the verified balance and its as-of date — so nothing else in the app
  changes, which is the opposite of how bank linking usually arrives.

  Open questions for whenever it is picked up: aggregator cost per
  connected account; Plaid production approval, which is a review with
  its own timeline; the privacy policy, which would have to change
  because a third party would hold read access to an account; and the
  fact that "available balance" at some banks is inflated by overdraft
  room, which would silently anchor the forecast above reality.

  **Not to be mentioned in the App Store listing or anywhere in the
  app.** Listing a feature that does not exist is a review problem and
  a trust problem.
- ~~iOS client sharing `src/engine`.~~ **DONE 2026-10-02**, and the phone
  has had a write path since 2026-10-08. What is left of it is the
  mobile backlog above, not this line.

### Capability parity audit (2026-10-12)

*Later* item 7, run. **Enumerate, do not fix** — nothing here is built
until it is picked.

**How it was built, because the method is the trustworthy part.** Not
from this document, which has been wrong about capability twice in a
week. Every exported mutator in `engine/mutate.ts` was cross-referenced
against both clients' call sites mechanically, and the UI-only
capabilities (views, pickers, filters, pages) were read off the web's
component tree. Thirty mutators, four tabs, fifteen web components.

Marked **PRESENT**, **MISSING**, or **WEB-ONLY** where the absence is a
decision already made and recorded.

#### Writes — from the mutator cross-reference

| Capability | Engine call | Phone |
|---|---|---|
| Add / edit / delete a transaction | `upsertItem`, `deleteItem` | PRESENT |
| Edit one occurrence; reset it | `setOverride`, `clearOverride` | PRESENT |
| Orphan count before a schedule change | `orphanedOverrideDates` | PRESENT |
| Log / edit / delete a checking balance | `updateAccountBalance`, `updateAccountSnapshot`, `deleteAccountSnapshot` | PRESENT |
| Log / edit / delete a category balance | `addBalanceSnapshot`, `updateBalanceSnapshot`, `deleteBalanceSnapshot` | PRESENT |
| Log a contribution | `addContribution` | PRESENT |
| **Edit or delete a contribution** | `updateContribution`, `deleteContribution` | **MISSING** |
| Log / clear a monthly actual | `setMonthlyActual`, `deleteMonthlyActual` | PRESENT |
| Add / rename / delete / reorder an account | `addCategory`, `updateCategory`, `deleteCategory`, `moveCategory` | PRESENT (2026-10-12) |
| Set up a loan or an asset | `setupLoan`, `setupAsset` | PRESENT (2026-10-12) |
| Wipe data | `wipeToNewAccount` | PRESENT |
| **Multi-select delete** | `deleteItems` | **MISSING** |
| Reorder rows by hand | `reorderList`, `swapOrder` | WEB-ONLY |
| Reorder the tabs | `moveTab` | WEB-ONLY |

#### Reads and surfaces

| Capability | Phone |
|---|---|
| Ledger list, running balance, month headers | PRESENT |
| Calendar view of the same transactions | PRESENT |
| **Ledger "Cumulative columns" picker** | **MISSING** |
| Budget grid, monthly and cumulative net | PRESENT |
| Dashboard net position, asset and loan cards, history, charts | PRESENT |
| Spending tab, variance, untrack nudge, dead-month filter | PRESENT |
| **Account balance visible on every tab** (web's `AccountStrip`) | **PARTIAL** — Ledger and Dashboard only |
| Horizon control | PRESENT, different by design: a device-local date chip, not a synced slider |
| Export (Ledger CSV, Budget CSV, JSON backup) | PRESENT |
| About, and the guided tour inside it | PRESENT |
| Settings, account facts, sign-out, danger zone | PRESENT |
| In-app account deletion, with the 7-day window | PRESENT |
| New-account first-run guide | **PHONE-ONLY** |
| Sign in with an emailed code | **PHONE-ONLY** — the web has the link only (*Later* item 11) |
| Sign in with Google | PRESENT, device-verified 2026-10-12 |
| CSV import | WEB-ONLY |
| Quick entry | WEB-ONLY, decided 2026-10-12 |
| Light / dark theme toggle | WEB-ONLY — the phone is dark by decision |
| Full setup wizard | WEB-ONLY today; mobile item 15 is building it |
| Landing page, privacy page | WEB-ONLY by nature |

#### The four real gaps, with a view on each

1. ~~**Edit or delete a contribution.**~~ **BUILT 2026-10-13.** The phone logs one and cannot
   correct it. A mistyped contribution is then permanent on the device
   that made it, which is the shape of bug this project treats as
   serious — every other logged number here is correctable. The history
   list already has edit and delete for snapshots; this is the same
   affordance pointed at a different list. **Smallest and most clearly
   wrong. Recommended first.**
2. ~~**The Ledger's "Cumulative columns" picker.**~~ **SKIPPED
   2026-10-13**, recorded as a deliberate difference. On the web you can
   show a running total per tracked account beside the rows. On a 390pt
   screen a column picker is a real design question rather than a port,
   and the Budget already carries cumulative net. **Worth deciding, not
   assuming.**
3. ~~**Multi-select delete.**~~ **WEB-ONLY, confirmed 2026-10-13.** Web has checkboxes and a bulk delete. The
   phone deletes one at a time through the scope sheet. Honest
   assessment: this is a laptop gesture, and the phone's per-row
   confirm is arguably safer for the same job. **A candidate for
   WEB-ONLY rather than a gap, if that is the call.**
4. ~~**The balance on every tab.**~~ **BUILT 2026-10-13.** The web keeps the anchor visible
   everywhere because every number is built from it. The phone shows it
   on two tabs of four. **Cheap to fix, and it is the number the whole
   forecast rests on.**

#### Where the phone is ahead

Worth recording so parity is not read as one-directional: the emailed
code, which the web cannot do at all, and the first-run guide, which
the web does not need because its wizard is always one click away.

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

  Two things came out of it. The app now banners which backend it is
  talking to, so a harness left running announces itself instead of
  looking like a broken app. And the teardown is written down here,
  because "delete the env file" is the obvious wrong answer and I gave
  it.

  **The banner's first version was itself a lie**, caught on review
  before anyone saw it: it inferred "fixture data" from "not https",
  which is equally true of a local Supabase stack on
  `http://localhost:54321` — the user's own REAL data, labeled fake. A
  warning that cries wolf teaches people to ignore the one that matters.
  Fixture is now DECLARED (`EXPO_PUBLIC_FIXTURE=1`, set by the harness
  and nothing else), with one bounded fallback on the harness's own port
  for when the flag is forgotten; plain http that is not the harness gets
  a quieter and different message that does not claim the data is fake.
  `lib/backend.ts` is pure so the classification is tested rather than
  eyeballed.

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

- **The input is the headline, not the output** (2026-10-09, the
  phone's Ledger). It opened with a large "Ending balance" and showed
  the verified checking balance nowhere at all — the one number every
  row below is computed forward from was absent, while a projection
  derived from it was the biggest thing on the screen. A forecast
  printed larger than the fact it rests on teaches the wrong thing
  about which of the two to trust. The web has always had this the
  right way round; only the phone was inverted.

- **The copy lives in one place, not two** (2026-10-09,
  `src/content/`). Giving the phone an About page and a tour meant
  either duplicating thirteen sections and four stops, or extracting
  them. They are extracted: pure data, no React, no platform, imported
  by both clients, which render them differently — the web as a sidebar
  beside a panel, the phone as a chip row above a full screen. The
  swatches in the color legend stay live values from palette.ts rather
  than copy, so the page cannot describe a color the app does not use.
  Two copies of an explanation is how one goes stale, and this project
  has already paid that bill twice with screenshots and a README.

- **Five header items, one corner button** (2026-10-09,
  `components/Chrome.tsx`). The web header holds Setup, About, Import,
  Export and Settings. Five do not fit at 390px and the tab bar belongs
  to the four things you DO, so everything you configure or read once
  sits behind one control in the corner — where iOS has trained people
  to look — and the tabs stay navigation rather than administration.

  **The danger zone is on the Settings root, not behind Account.**
  Apple looks for in-app account deletion specifically, and three taps
  deep is three chances to conclude it is not there.

  Import is deliberately absent: picking a CSV on a phone is awkward,
  and import is where the duplicate-snapshot bug lived. Setup folds
  into onboarding, which is its own backlog item. Export is present and
  is the SHARE SHEET, not a download — a browser download has nowhere
  to land on iOS, and the share sheet is the platform's answer for
  moving data off a device.

- **Loans show what is, not what was projected** (2026-10-09). The
  per-reading "projected $X" and the loan card's "planned" figure are
  gone from both clients, and the phone's loan chart with them. The
  ENGINE is untouched: `computeLoanHistory` still annotates every
  reading with what amortization expected at that moment and
  `computeLoanProgress` still returns `expectedNow`. Forecast accuracy
  is deferred, not canceled, and loan projections are the cleanest
  signal to come back to — nothing outside those two display sites ever
  read them, which was checked before removing anything: not the ledger,
  not net position, not CSV or the JSON backup.

  What stays on the card is fact: percent paid off, the accrued-interest
  line when you owe more than you borrowed, the terms, and what you
  actually paid this month. A projected number printed beside a logged
  one invites a comparison the app is not yet good enough to stand
  behind.

  The phone's loan card is now the web card in one column, including the
  Log balance and Edit it never had — a loan balance could previously
  only be corrected from a laptop. Edit needed somewhere to go, so
  `LoanSheet` exists: terms only, no delete and no opening balance,
  because a button that does nothing is worse than no button.

- **Color maps to the ACCOUNT, and the index is STORED** (2026-10-09).
  A hue is an identity now: your Roth IRA is one color on its Dashboard
  card, its chart line and its slice of planned spending, and it keeps
  that color when another account is added or deleted. Loans all share
  one color, spending is slate, Other stays gray.

  **Why the index is stored, and why that is NOT a reversal of migration
  13.** Thirteen removed a stored color index from these same entities.
  That index was a USER'S ARBITRARY CHOICE, and an arbitrary choice
  carries no information — it said what a category was called, which its
  name already said. This one is an APP-ASSIGNED IDENTITY, and an
  identity that does not persist is not an identity: assignment by
  position was measured reshuffling three accounts' colors when the
  first of four was deleted, which is survivable for decoration and
  fatal for identity. Same field shape, opposite reason. Do not "clean
  this up" by deriving it again.

  Assignment is the lowest free index at creation, so a deleted
  account's color is reusable and no existing account's ever moves;
  backfilled in display order so nothing changes on upgrade. `order`
  cannot stand in — reordering rewrites it.

  **Eight hues, measured, then degrade.** Eight is what clears the gate's
  own floor all-pairs under four vision types with the loan, spending,
  Other and degraded colors reserved. The ninth account does NOT wrap
  onto someone else's color, which would break the guarantee silently:
  a bar draws an OUTLINE, because no fill can collide with a fill.

  **The pie is gone.** Measured on real data before dropping it: under
  this system a pie is 45%, 61% and 98% one slate wedge across the three
  accounts with data, because spending is most of every window by
  definition. The sorted bar it leaves behind needs no legend and no
  color-matching, reads identically under every vision type, and — the
  part that buys something — is no longer capped by how many colors a
  ramp can carry, so `foldForPie` and the second fold went with it.

  Three things the gate caught while picking the colors, each recorded
  because each was a plausible choice: a blue-gray loan color sat ΔE2000
  4.3 from Other's gray under protanopia (two grays for two meanings);
  a magenta account hue sat 8.6 from the expense red under tritanopia;
  and the gate itself was checking only the WEB's red, so a candidate
  came within 1.7 of the phone's. It now checks each client's red
  against the modes that client renders, which is accurate rather than
  merely strict — the phone is dark-only, so holding light colors to its
  red would be inventing a constraint.

- **`kind` decides a SIGN, so normalize validates it** (2026-10-09,
  `inferCategoryKind`). It was `if (cat.kind) return cat.kind` — a
  truthiness test, not an enum check — so any non-empty junk survived
  normalization and read as an asset everywhere downstream.

  That is not a display concern. An asset's latest snapshot is ADDED to
  net position and a debt's is SUBTRACTED, so a $4,000 loan filed as an
  asset moves the number by $8,000 in the wrong direction and silently
  loses amortization, payoff and accrued interest with it, because
  `isLoanConfigured` reads `kind` too. Measured, and now asserted in the
  harness as arithmetic rather than described as a risk. The FORECAST is
  untouched: a transaction's direction comes from the fixed category
  table and never consults `kind`, so the ledger and every projected
  balance were always right.

  The Category Manager wrote `kind: 0` for two days after migration 13
  dropped a parameter. The only reason that window did not corrupt
  anyone's net worth is that zero is FALSY and so hit the inference
  path; `1` or `"savings"` would have sailed through. Luck, not design.

  Two changes. The enum is checked by value, and **loan terms now beat
  the name**: only the loan setup form writes `originalPrincipal`, so a
  category carrying it is a loan whatever it is called — which catches
  the loan someone named "Discover", where word-matching does not.

  `scripts/audit_kinds.mjs` answers the question against live data and
  prints what net position would be if each misfiled row were refiled.
  Run 2026-10-09 across all four accounts: **nothing misfiled, no
  invalid kinds**. Every loan had been created through the loan setup
  form, which passes a literal, rather than through the generic add.

- **A surface with no exit, reported twice** (2026-10-08,
  `mobile/components/DatePicker.tsx`). The Ledger's "through <date>" chip
  opened a date picker that could not be closed — not by choosing a date,
  not by tapping outside. Shipped in the very first Expo commit and
  untouched since.

  **Why the one-modal fix did not cover it, which is the part worth
  keeping.** That fix was about `Modal` presentation races. This picker
  is not a Modal at all: on iOS `display="inline"` renders it straight
  into the component tree, so the single host never saw it. And it was
  not a race but a missing dismissal — `setPicking(Platform.OS === "ios")`
  evaluates to `setPicking(true)`, so choosing a date RE-OPENED it, and
  with no modal there was no scrim to tap. A second dismissal path, with
  nothing on it.

  Two things, because fixing the one screen would have left the pattern.
  Every date picker in the app is now one component that owns all three
  exits — pick, Done, and Android's own cancel — so a caller cannot
  create a pickerless-exit surface. And the Ledger's picker goes through
  the same `BottomSheet` as its sheets, which is what makes "tap outside
  to dismiss" true of every transient surface on that screen rather than
  of the ones someone remembered.

  The test opens it and closes it. "The chip exists" would have passed
  for the entire time it was broken.

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
