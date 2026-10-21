// ---- The shape of everything ----
// The state blob, as PROJECT_SPEC §4 describes it, expressed so the compiler
// can hold the app to it. This file is the contract the Expo client will share
// verbatim — the engine exists to be the one implementation of the money math,
// and these are its terms.
//
// Discriminated unions are used wherever the spec already implies one. The
// prose "debt-kind only — a debt category IS a loan" is a union in disguise:
// reading `originalPrincipal` off an asset category should not compile.

import type { Role } from "./palette.ts";

// ---- Primitives ----------------------------------------------------------

/** A calendar date, "YYYY-MM-DD". Never an instant — see toISODate in model. */
export type ISODate = string;
/** A calendar month, "YYYY-MM". The key for monthlyActuals. */
export type MonthKey = string;
/** An index into CATEGORY_PALETTE, not a hex color. */
export type PaletteIndex = number;

// ---- Categories ----------------------------------------------------------

/** The three built-in categories. Everything else is a trackerCategory id. */
export type FixedCategory = "income" | "bill" | "oneoff";
/** Which way money moves. Only `income` is "in"; an unknown category is "out". */
export type Direction = "in" | "out";
/**
 * An item's category: one of the three fixed ones, or a trackerCategory id —
 * and, unavoidably, the id of a category that has since been deleted. The type
 * is `string` rather than a narrower union precisely because orphans are a
 * real state the app must keep handling.
 */
export type CategoryRef = FixedCategory | string;

export interface FixedCategoryMeta {
  label: string;
  color: string;
  direction: Direction;
}

// ---- Tracker categories (the user's own buckets) -------------------------

interface TrackerCategoryBase {
  id: string;
  name: string;
  order: number;
  /**
   * Which account hue this category owns, 0..7, or null past the limit.
   * STORED, and that is the whole point — see palette.ts. Assigned by the
   * app, never chosen; `order` cannot stand in for it because reordering
   * and deleting both move it, and a color that moves is not an identity.
   * Debt categories carry one too, harmlessly: loans all render in one
   * color, and keeping the field uniform means nothing has to ask what
   * kind a category is before it can be saved.
   */
  hue?: number | null;
}

/**
 * Is this cash you control, or value the market moves? Set by the user,
 * NEVER inferred from the name — an HSA reads like savings and can be
 * entirely in one stock, which makes it the most market-exposed thing
 * someone owns rather than the least. Absent means unanswered, and
 * unanswered renders as `investment`: see the decision log for why the
 * error has to fall that way.
 */
export type AssetKind = "savings" | "investment";

/** Something you own: savings, a Roth IRA, a brokerage. */
export interface AssetCategory extends TrackerCategoryBase {
  kind: "asset";
  assetKind?: AssetKind;
}

/**
 * Something you owe. A debt-kind category IS the loan: it carries the terms,
 * its outstanding balance is a logged snapshot, and a payment is any
 * transaction tagged to it.
 *
 * The terms are optional because a debt category exists before it is set up
 * (`isLoanConfigured` is the gate), but they exist ONLY here — asking an asset
 * for its APR is now a compile error rather than `undefined` at runtime.
 */
export interface DebtCategory extends TrackerCategoryBase {
  kind: "debt";
  /** What was borrowed. Absent until the loan is set up. */
  originalPrincipal?: number;
  /**
   * APR as a percentage, e.g. 5.8 — not a fraction. Explicitly nullable:
   * setupLoan stores `null` when a loan is set up without a rate, so `null`
   * and absent are both real states in saved data.
   */
  interestRate?: number | null;
  /** Nothing accrues before this date (a student loan's grace period). */
  interestStartDate?: ISODate | null;
}

export type TrackerCategory = AssetCategory | DebtCategory;

/** A debt category with its terms present — what the loan math requires. */
export type ConfiguredLoan = DebtCategory & { originalPrincipal: number };

// ---- Items (the forecast's inputs) ---------------------------------------

export type Cadence = "weekly" | "biweekly" | "monthly" | "yearly";

interface ItemBase {
  id: string;
  name: string;
  amount: number;
  category: CategoryRef;
  order: number;
  /** Stamped automatically; there is no picker while there is one account. */
  accountId?: string;
  /** Per-item palette override; null means "use the category's color". */
  color?: PaletteIndex | null;
}

/** A rule that generates events forever (or until endDate). */
export interface RecurringItem extends ItemBase {
  cadence: Cadence;
  startDate: ISODate;
  endDate?: ISODate | null;
  /** Monthly rules keep their intended day when a month is short. */
  dayOfMonth?: number;
  /** Flagged "Track actual vs. budgeted" — appears on the Spending tab. */
  variable?: boolean;
}

/** A single dated transaction. */
export interface OneOffItem extends ItemBase {
  date: ISODate;
}

/**
 * The discriminant is structural, matching the runtime check the engine
 * already uses (`!!item.cadence`) rather than a tag field that would have to
 * be migrated into existing data.
 */
export type BudgetItem = RecurringItem | OneOffItem;

// ---- Logged reality ------------------------------------------------------

/** One logged balance: an asset's value, or a loan's outstanding. */
export interface BalanceSnapshot {
  id: string;
  date: ISODate;
  amount: number;
  /**
   * Where the reading came from. ABSENT MEANS MANUAL, which is every
   * snapshot written before connected checking existed, and the
   * reason nothing may treat `undefined` as unknown.
   *
   * The same pair `Contribution` already carries, deliberately: an
   * imported reading is the same shape as a typed one, not a parallel
   * system. The Ledger, the Calendar and the history chart read these
   * without ever asking which is which, and that is the whole
   * integration — there is only one kind of balance.
   *
   * IT DECIDES EXACTLY ONE THING: who wins when a pull and a manual
   * log land on the same date, since snapshots are keyed by date and
   * the two are one row. Manual wins. See `plaid_write_balance` in
   * supabase/plaid.sql, where the rule is one statement so a log
   * written in the same second cannot be lost between a read and a
   * write.
   */
  source?: "manual" | "plaid";
  /** The provider's own id for the account, so a re-pull can tell. */
  externalId?: string;
  /**
   * WHEN the reading was logged, as an instant, for a manual entry.
   *
   * `date` is the day the balance is a statement ABOUT and is the
   * key of the row. This is the moment somebody typed it, which is a
   * different fact and is only needed for one thing: the web's
   * Checking bar says "logged 10/20/2026, 9:20 PM", and a date alone
   * cannot tell you the time.
   *
   * Absent on everything written before 2026-10-20 and on pulled
   * readings, which carry the Item's `last_synced_at` instead.
   */
  loggedAt?: string;
}

/** Where a contribution came from. An importer writes its own source. */
export type ContributionSource = "manual" | (string & {});

/** Money you actually put in, logged one entry at a time. */
export interface Contribution {
  id: string;
  date: ISODate;
  amount: number;
  source: ContributionSource;
  /** An importer's own id, so a re-import can dedupe instead of doubling. */
  externalId?: string;
}

// ---- Accounts ------------------------------------------------------------

export interface Account {
  id: string;
  name: string;
  kind: "checking";
  /** The last balance VERIFIED against the bank — not a projection. */
  balance: number;
  /** When that balance was verified. The forecast starts here. */
  balanceAsOf: ISODate;
  order: number;
}

// ---- Settings ------------------------------------------------------------

export type TabId = "dashboard" | "budget" | "ledger" | "spending";

export interface Settings {
  budgetHorizon: ISODate;
  ledgerHorizon: ISODate;
  /** The ACCOUNT default. Each device overrides it in localStorage. */
  theme: "light" | "dark";
  visibleTrackerCategoryIds: string[];
  tabOrder: TabId[];
  hasSeenOnboarding: boolean;
  /** The guided tour has run itself once for this account.
   *
   *  ON THE ACCOUNT, not the device, and that is the whole point of
   *  it: the tour used to be started by "setup just finished" with
   *  nothing remembering it, so re-running Setup from the header
   *  replayed it — and anything device-local would have replayed it
   *  on a new phone or a second browser instead. Added 2026-10-16.
   *
   *  Set when a setup COMPLETES, not when the tour is dismissed: the
   *  question it answers is "has this account been offered the tour",
   *  and someone who skips it on the first screen has been. The tour
   *  stays reachable by hand afterwards — About on both clients. */
  hasSeenTour: boolean;
  /** Setup has asked whether there is any regular income.
   *
   *  WRITTEN BY A COMPLETED SETUP, and it is the answer to a question
   *  nothing else in the data can answer: an account with no income
   *  rule has either not got round to it or has not got one, and
   *  those two want opposite things from the app. The Ledger's "Start
   *  here" guide asked for a paycheck forever, because an absence is
   *  all it could see.
   *
   *  Not a claim that there IS no income — the person may have one
   *  and skipped the step. It means the question has been put, which
   *  is the thing that makes asking again rude. Added 2026-10-18;
   *  see the migration in stateShape.ts for what existing accounts
   *  inherit. */
  askedAboutIncome: boolean;
  /**
   * Connected checking is switched on for this account.
   *
   * OFF BY DEFAULT, and the default is the product: manual entry is
   * complete on its own and connecting a bank is an optional extra.
   * While this is false there is no Connect entry point anywhere, and
   * no Plaid code is loaded — no Link script on the web, no browser
   * opened on the phone. "Not loaded" rather than "hidden", because a
   * hidden feature still ships its third party's JavaScript.
   *
   * PER ACCOUNT, NOT PER DEVICE. It is a decision somebody made about
   * their own bank, and it has to mean the same thing on their phone
   * as in their browser.
   */
  connectedFeatures: boolean;
  /** "Want this automatic?" on the Log balance sheet, dismissed for good. */
  hideConnectHint: boolean;
}

// ---- The state blob ------------------------------------------------------

export interface BudgetState {
  settings: Settings;
  accounts: Account[];
  recurring: RecurringItem[];
  oneoffs: OneOffItem[];
  /** The user's own buckets: savings, investments, loans. */
  trackerCategories: TrackerCategory[];
  balanceSnapshots: Record<string, BalanceSnapshot[]>;
  contributionLog: Record<string, Contribution[]>;
  accountSnapshots: Record<string, BalanceSnapshot[]>;
  monthlyActuals: Record<string, Record<MonthKey, number>>;
  /**
   * Per-occurrence amount overrides: `{ [ruleId]: { [ISODate]: amount } }`.
   * "Electric is $112 as a rule but $180 in July." This is FORECAST data —
   * the user editing the plan, not importing an observation — so it is
   * legal under principle 1 without argument. Keyed by date, never remapped
   * when a rule's schedule moves: an override is a statement about a date.
   */
  overrides: Record<string, Record<ISODate, number>>;
}

/**
 * State as it arrives from storage or a restored backup: any shape at all,
 * including shapes from builds that predate half these fields. Only
 * `normalize()` turns this into a BudgetState, which is the point of it.
 */
export type RawState = Record<string, unknown>;

// ---- Derived (never stored) ----------------------------------------------

/** One occurrence of an item on one date. Generated, never persisted. */
export interface BudgetEvent {
  /** `${itemId}@${date}` — only the item half is ever parsed back out. */
  id: string;
  /** The rule or one-off this came from. THE IDENTITY OF THE ROW, and the
   *  reason it exists as its own field: the Budget grid used to key its
   *  rows by `name`, so a one-off and a recurring bill both called
   *  "Discover Bill" were one row shown twice, each printing the other's
   *  figures. A name is a label; this is who the money is. */
  srcId: string;
  name: string;
  amount: number;
  direction: Direction;
  category: CategoryRef;
  color: PaletteIndex | null;
  order: number;
  /** True when this occurrence's amount came from an override rather than
   *  from the rule. The Ledger marks it: an amount that disagrees with its
   *  own rule looks like a bug without one. */
  overridden: boolean;
  /** This occurrence came from a RECURRING RULE rather than a one-off.
   *  Carried on the event because it is the only thing that can tell
   *  the Budget's take-home row from its "other in" row: recurring
   *  income is what you can count on arriving again, and a one-time
   *  payment is not, whatever either of them is called. The split used
   *  to be a regex over the item's name. */
  recurring: boolean;
  /** The rule's amount is an estimate — "this bill varies". Carried on
   *  the event so anything rendering a row can call it a Variable bill
   *  without going back to the item; only recurring bills can be one. */
  variable: boolean;
  date: ISODate;
}

// ---- Budget grid (derived, never stored) ---------------------------------

/** One row's value inside a month column.
 *
 * KEYED BY THE ITEM'S ID, not by its name — so the name has to ride
 * along, because the key is no longer readable. Two items may share a
 * name (a one-off "Discover Bill" and a monthly one); they are two
 * rows, and before 2026-10-19 they were one row rendered twice with
 * whichever figure the lookup happened to find. */
export interface BudgetRowValue {
  /** What to print in the label column. Not unique, and not the key. */
  name: string;
  val: number;
  order: number;
}
export interface BudgetExpenseValue extends BudgetRowValue {
  /** May be an orphaned id — see CategoryRef. */
  category: CategoryRef;
}

/** One month column of the Budget grid. */
export interface BudgetColumn {
  key: MonthKey;
  label: string;
  /** Carried in from the previous month; 0 for the first column. */
  startingPoint: number;
  /** Every paycheck landing this month, summed — 2 or 3 in a biweekly month. */
  takeHome: number;
  payCount: number;
  otherIn: number;
  otherInItems: Record<string, BudgetRowValue>;
  /** The verified account balance, seeded into the first column only. */
  tdChecking: number;
  totalIn: number;
  totalOut: number;
  net: number;
  cumulative: number;
  expenseItems: Record<string, BudgetExpenseValue>;
}

/** A ledger row: an event plus the running balance after it. */
export interface LedgerRow extends BudgetEvent {
  balance: number;
  negative: boolean;
  /** Set only on rows that advance a tracker column. */
  stepped: { key: string; value: number } | null;
}

export interface Ledger {
  rows: LedgerRow[];
  endingBalance: number;
}

// ---- Spending mix (derived, never stored) --------------------------------

/**
 * Which bucket a slice represents. `category` slices carry a palette index
 * the user chose; the rest are deliberately NEUTRAL — the user never assigned
 * them a color, and the 8-hue palette is already fully spoken for, so
 * inventing a 9th and 10th hue would break the categorical color rules.
 */
// `item` is one transaction broken out of a fixed bucket — always, not on a
// threshold. See ALWAYS_BY_ITEM in compute.ts for why the fixed buckets and
// the tracker categories are treated differently.
export type SpendingBucket = "category" | "bill" | "oneoff" | "uncategorized" | "other" | "item";

export interface SpendingSlice {
  /** Category id, or a synthetic key for the folded buckets. */
  key: string;
  label: string;
  amount: number;
  /** 0-100, of the window's total planned outflow. */
  percent: number;
  bucket: SpendingBucket;
  /** What the money is DOING. Decides whether an amount is red, and
   *  which of the four chart fills a slice takes. */
  role: Role;
  /** `category` slices belonging to an ACCOUNT: that account's stored hue
   *  index, carried here so a view never looks a category up to paint a
   *  slice. Null for loans, spending and Other, and for an account past
   *  the eighth hue, which draws degraded. */
  hue?: number | null;
  /** `item` slices only: which fixed bucket it came from, so the view tints
   *  off that bucket's own neutral rather than a shared one. */
  parentBucket?: "bill" | "oneoff";
  /** `item` slices only: the bucket they were broken out of, named so the
   *  slice can say "Rent · Fixed bill" rather than passing as a category.
   *  SINGULAR — a slice is one item, and the plural was reading as a
   *  claim about a group. */
  parentLabel?: string;
  /** `other` slices only: the slices folded into it, in the order they
   *  would have had, each with its percent OF THE WINDOW.
   *  The view can list them without re-deriving anything. */
  children?: SpendingSlice[];
}

export interface SpendingMix {
  slices: SpendingSlice[];
  total: number;
  /** The window this covers — the same one the Ledger is showing. */
  from: ISODate;
  to: ISODate;
}

// ---- Calendar grouping (derived, never stored) ---------------------------

/** One day's worth of ledger rows, for the Ledger's calendar view. */
export interface DayGroup {
  date: ISODate;
  rows: LedgerRow[];
  /** Money in minus money out for the day. Paid-marked rows contribute 0,
   *  exactly as they do to the running balance. */
  net: number;
  inflow: number;
  outflow: number;
}
