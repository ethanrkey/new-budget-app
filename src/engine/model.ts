// ---- Data model: the single source of truth ----
// Everything (ledger rows, budget totals, balances) is COMPUTED from this.
import type {
  Account, BudgetState, FixedCategoryMeta, ISODate, PaletteIndex,
  Settings, TabId, TrackerCategory,
} from "./types.ts";

// Fixed categories — not user-customizable. Any OTHER category value is a
// user-defined tracker category (see trackerCategories below): a savings,
// debt, or investment bucket, always direction "out" by definition.
// Keyed by `string`, not by the FixedCategory union, because that is how it
// is actually used: an item's category may be a tracker id or an ORPHANED id
// from a deleted category, and both are looked up here. With
// noUncheckedIndexedAccess a miss is typed `undefined`, which is exactly the
// `CATEGORIES[cat]?.direction ?? "out"` shape every caller already uses.
export const CATEGORIES: Readonly<Record<string, FixedCategoryMeta>> = {
    income: { label: "Income",     color: "#0B7A0B", direction: "in"  },
    bill:   { label: "Fixed Bill", color: "#7030A0", direction: "out" },
    oneoff: { label: "One-off",    color: "#C0392B", direction: "out" },
  };

  // A curated, validated set of 8 colors for user-defined tracker categories
  // (savings/debt/investment) and optional per-item color overrides. Chosen
  // and checked (see scripts/validate_palette.js in the dataviz skill) to be
  // distinct from each other AND from the fixed semantic colors above
  // (income green, bill purple, expense red) — that overlap was the actual
  // bug this palette replaces. Each category stores an INDEX into this array
  // (not a raw hex), so the right light/dark step is always used automatically.
  export const CATEGORY_PALETTE: ReadonlyArray<{ name: string; light: string; dark: string }> = [
    { name: "Blue",     light: "#2a78d6", dark: "#3987e5" },
    { name: "Orange",   light: "#eb6834", dark: "#d95926" },
    { name: "Teal",     light: "#0d9488", dark: "#199e70" },
    { name: "Gold",     light: "#a16207", dark: "#c98500" },
    { name: "Magenta",  light: "#be185d", dark: "#d55181" },
    { name: "Indigo",   light: "#4f46e5", dark: "#6366f1" },
    { name: "Cyan",     light: "#0891b2", dark: "#0891b2" },
    { name: "Pink",     light: "#db2777", dark: "#ec4899" },
  ];

  // Resolve a palette index (possibly out of range/undefined, e.g. an
  // orphaned category) to a hex for the current theme. Falls back to a
  // neutral gray rather than crashing.
  export function paletteColor(index: PaletteIndex | null | undefined, isDark: boolean): string {
    // `CATEGORY_PALETTE[undefined]` was legal JS and returned undefined; TS
    // will not index with undefined, so the nullish case is made explicit.
    // Same result, same fallback.
    const entry = index == null ? undefined : CATEGORY_PALETTE[index];
    if (!entry) return isDark ? "#9ca3af" : "#6b7280"; // gray-400 / gray-500
    return isDark ? entry.dark : entry.light;
  }

  // A tracker category shape (for reference):
  // { id, name, color, order, kind, originalPrincipal?, interestRate?, interestStartDate? }
  // `color` is an index into CATEGORY_PALETTE. `id` is what an item's
  // `category` field holds for a savings/debt/investment item. `kind` is
  // "asset" (default — Savings, Investments: balance accumulates from
  // contributions) or "debt". A debt-kind category IS a loan: it carries the
  // loan's terms (originalPrincipal, interestRate as APR %, optional
  // interestStartDate), its outstanding balance is a logged snapshot in
  // balanceSnapshots exactly like an asset, and a payment is any
  // transaction tagged to it (engine/loans.ts). A payment REDUCES what's
  // owed, it doesn't accumulate like a deposit. A debt category with no
  // originalPrincipal is simply "not set up yet."

  // The 3 starting categories for a brand-new account (no prior data) — see
  // stateShape.ts for the migration that instead seeds an EXISTING user's
  // legacy roth/saved/brokerage/loans as their own editable categories.
  export function defaultTrackerCategories(): TrackerCategory[] {
    return [
      { id: uid(), name: "Savings",     color: 2, order: 0, kind: "asset" }, // Teal
      { id: uid(), name: "Investments", color: 5, order: 1, kind: "asset" }, // Indigo
      { id: uid(), name: "Debt",        color: 1, order: 2, kind: "debt"  }, // Orange
    ];
  }

  // ---- Accounts ----
  // An account shape: { id, name, kind, balance, balanceAsOf, order }
  // `balance` is the last balance you VERIFIED against the real bank, and
  // `balanceAsOf` is when you verified it — together they anchor the whole
  // ledger/budget balance chain (everything dated before balanceAsOf is
  // already inside that number, so generate.ts drops it). There is exactly
  // ONE account today (kind "checking"); the shape is a list so adding more
  // is additive later, not a rewrite. Transactions carry an `accountId`.
  export const PRIMARY_ACCOUNT_ID = "checking"; // stable, like the legacy category ids

  export function defaultAccounts(balance: number = 0, balanceAsOf: ISODate = todayISO()): Account[] {
    return [{ id: PRIMARY_ACCOUNT_ID, name: "Checking", kind: "checking", balance, balanceAsOf, order: 0 }];
  }

  // The one account everything anchors to. Falls back to the legacy
  // settings.checkInBalance/checkInDate fields when `accounts` is absent —
  // a pre-migration state, or a raw engine-test fixture — so every existing
  // consumer keeps working unchanged through the migration.
  export function primaryAccount(state: AnchorSource): Account {
    const acct = state.accounts?.[0];
    if (acct) return acct;
    return {
      id: PRIMARY_ACCOUNT_ID, name: "Checking", kind: "checking", order: 0,
      balance: Number(state.settings?.checkInBalance) || 0,
      // Asserted, not proven: a never-migrated state (or a raw engine-test
      // fixture) can genuinely lack this. normalize() guarantees it for every
      // real load, and coercing a default here would change behavior, so the
      // hole is documented rather than papered over.
      balanceAsOf: state.settings?.checkInDate as ISODate,
    };
  }

  // Cadences a recurring rule can use.
  export const CADENCES = ["weekly", "biweekly", "monthly", "yearly"] as const;

  // The tabs, in the order a new account gets them: reality first, then the
  // forecast. A user can drag them into any order (settings.tabOrder); this
  // list stays the authority on which tabs EXIST, so sanitizeTabOrder() below
  // can drop a tab that's gone and append one that's new.
  export const TABS: readonly TabId[] = ["dashboard", "budget", "ledger", "spending"];

  // A stored order is user data and can be stale (an old tab that no longer
  // exists, a new tab added since it was saved, a duplicate from a bad write).
  // Take the valid entries in the user's order, then append anything missing
  // in TABS order — never drop a tab, never invent one.
  export function sanitizeTabOrder(order: unknown): TabId[] {
    const seen = new Set<string>();
    const kept = (Array.isArray(order) ? order : []).filter((t): t is TabId => {
      if (!(TABS as readonly unknown[]).includes(t) || seen.has(t)) return false;
      seen.add(t);
      return true;
    });
    return [...kept, ...TABS.filter((t) => !seen.has(t))];
  }

  // A fresh, blank app state.
  export function blankState(): BudgetState {
    return {
      settings: {
        // (checkInBalance/checkInDate used to live here — now accounts[0].
        // stateShape.ts still READS them from a never-migrated state.)
        budgetHorizon: addMonthsISO(todayISO(), 9),  // default: ~9 months out
        ledgerHorizon: addMonthsISO(todayISO(), 12), // default: ~12 months out
        theme: "light",
        visibleTrackerCategoryIds: [], // which savings/debt columns show on the Ledger; default none
        tabOrder: [...TABS],           // drag-reorderable on desktop; see sanitizeTabOrder()
        hasSeenOnboarding: false, // one-time welcome wizard; see storage.js's migration
      },
      // primaryAccount() is the single source of truth for the anchor
      // balance/date. (Phase 1 briefly mirrored it back into settings as a
      // rollback net; retired in Phase 2.)
      accounts: defaultAccounts(0, todayISO()),
      recurring: [], // rules that auto-generate events (each carries accountId)
      oneoffs: [],   // individual dated events (each carries accountId)
      trackerCategories: defaultTrackerCategories(),
      // Every confirmed balance update on an account also records a snapshot
      // here — same { id, date, amount } entries as balanceSnapshots below,
      // so a history chart can treat account and category history alike.
      accountSnapshots: {}, // { [accountId]: [{ id, date, amount }, ...] }
      // Contributions you actually made, logged one by one — NOT derived from
      // the ledger (which is a forecast; summing it would be planned
      // contributions wearing the label of a fact). `source` marks where an
      // entry came from: "manual" today, and the slot a Plaid/bank import
      // drops into later, alongside an optional `externalId` for dedupe —
      // imported contributions are the same shape, not a parallel system.
      contributionLog: {}, // { [categoryId]: [{ id, date, amount, source, externalId? }] }
      // Real, actual-world numbers you log yourself — never generated from
      // transactions — used to reconcile the forecast against reality (the
      // Dashboard tab). See engine/progress.ts for how these are used.
      balanceSnapshots: {}, // { [trackerCategoryId]: [{ id, date, amount }, ...] } — actual balance check-ins
      monthlyActuals: {},   // { [itemId]: { "YYYY-MM": amount } } — real spend for a variable bill's month
    };
  }

  // A recurring rule shape (for reference):
  // { id, name, amount, category, cadence, dayOfMonth, startDate, endDate|null, order,
  //   color|null, variable|undefined, interestRate|null, originalPrincipal|null }
  // `variable` (bill-category rules only) marks the amount as an estimate
  // rather than a fixed number — enables logging a real monthly total in
  // monthlyActuals from the Dashboard (electric, groceries, gas: the
  // estimate is never exact, unlike rent). Any cadence works — a biweekly
  // variable bill's logged total splits evenly across however many
  // instances land in that month (see generate.ts).
  // `interestRate` (APR, as a percent e.g. 5.5) and `originalPrincipal`
  // (the loan's starting balance) apply only to a recurring rule tagged
  // with a DEBT-kind tracker category — together they let engine/loans.ts
  // amortize this specific loan's expected remaining balance. Either can be
  // left null/unset; an unconfigured loan is simply skipped in the
  // category's cumulative debt total until both are filled in.
  // `interestStartDate` (optional, ISO) — interest accrues only from the
  // LATER of this and startDate (a student loan with no interest until a
  // set date). Absent = accrues from startDate, exactly as before.

  // A one-off shape:
  // { id, name, amount, category, date, order, color|null }
  // `color` (both shapes) is an optional palette index overriding the
  // default category color for just that one item, e.g. in the Ledger.
  
  // ---- small date helpers (ISO strings "YYYY-MM-DD") ----
  // A Date's LOCAL calendar date. Everything in this app is a calendar date,
  // never an instant, so `toISOString().slice(0, 10)` is always wrong here: it
  // converts to UTC first. West of UTC that makes "today" roll over in the
  // evening (after 8pm Eastern the app thought it was tomorrow — wrong current
  // month, wrong Dashboard "now", wrong projection endpoint); east of UTC it
  // shifts a local-midnight date back a whole day. Use this everywhere a Date
  // becomes a "YYYY-MM-DD".
  export function toISODate(d: Date): ISODate {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  export function todayISO(): ISODate {
    return toISODate(new Date());
  }
  export function addMonthsISO(iso: ISODate, n: number): ISODate {
    const d = new Date(iso + "T00:00:00");
    d.setMonth(d.getMonth() + n);
    return toISODate(d);
  }
  // whole months between two ISO dates, by calendar month (not day-precise)
  export function monthsDiff(aISO: ISODate, bISO: ISODate): number {
    const a = new Date(aISO.slice(0, 7) + "-01T00:00:00");
    const b = new Date(bISO.slice(0, 7) + "-01T00:00:00");
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }
  // The Ledger projects at most a year. It is a near-term guide — nobody
  // plans transaction-by-transaction two years out — so most of a 36-month
  // range was dead slider. The BUDGET's horizon is deliberately not capped
  // this way: a long projection is genuinely useful on a monthly grid.
  export const LEDGER_MAX_MONTHS = 12;

  // The Ledger's EFFECTIVE horizon. A state saved when the cap was longer
  // keeps its stored value untouched — shortening a cap must not rewrite
  // user data — but every reader goes through here, so the slider, the
  // table and the spending chart can never disagree about the window. The
  // next drag of the slider writes a value back inside the range.
  export function ledgerHorizonOf(state: { settings: { ledgerHorizon: ISODate } }): ISODate {
    const cap = addMonthsISO(todayISO(), LEDGER_MAX_MONTHS);
    return state.settings.ledgerHorizon > cap ? cap : state.settings.ledgerHorizon;
  }

  export function uid(): string {
    return Math.random().toString(36).slice(2, 10);
  }
  // The last real calendar day of `iso`'s month — used where a horizon
  // needs to cover a WHOLE month rather than stop at a specific day (see
  // computeBudget in compute.ts: its horizon always shares checkInDate's
  // day-of-month, e.g. always the "8th," so truncating event generation at
  // the exact horizon date silently drops any bill due later in that final
  // month — this is what a full calendar-month column should NOT do).
  export function endOfMonthISO(iso: ISODate): ISODate {
    const [y, m] = iso.slice(0, 7).split("-").map(Number);
    // Non-null assertions, not defaults: a "YYYY-MM" slice always yields two
    // parts, and substituting a fallback would CHANGE behavior on malformed
    // input (year 0 instead of the Invalid Date it produces today).
    const d = new Date(y!, m!, 0); // day 0 of next month = last day of this one
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // What primaryAccount() can read an anchor out of: a normalized state, or a
  // pre-migration one that still keeps the anchor in `settings`. Deliberately
  // permissive — this is the compatibility seam, and typing it narrowly would
  // just push casts onto every caller.
  export interface LegacyAnchorSettings {
    checkInBalance?: unknown;
    checkInDate?: ISODate;
  }
  export interface AnchorSource {
    accounts?: Account[] | undefined;
    settings?: (Partial<Settings> & LegacyAnchorSettings) | undefined;
  }
