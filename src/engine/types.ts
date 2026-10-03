// ---- The shape of everything ----
// The state blob, as PROJECT_SPEC §4 describes it, expressed so the compiler
// can hold the app to it. This file is the contract the Expo client will share
// verbatim — the engine exists to be the one implementation of the money math,
// and these are its terms.
//
// Discriminated unions are used wherever the spec already implies one. The
// prose "debt-kind only — a debt category IS a loan" is a union in disguise:
// reading `originalPrincipal` off an asset category should not compile.

// ---- Primitives ----------------------------------------------------------

/** A calendar date, "YYYY-MM-DD". Never an instant — see toISODate in model. */
export type ISODate = string;
/** A calendar month, "YYYY-MM". The key for monthlyActuals. */
export type MonthKey = string;
/** An index into CATEGORY_PALETTE, not a hex colour. */
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
  color: PaletteIndex;
  order: number;
}

/** Something you own: savings, a Roth IRA, a brokerage. */
export interface AssetCategory extends TrackerCategoryBase {
  kind: "asset";
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
  /** Per-item palette override; null means "use the category's colour". */
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
}

// ---- The state blob ------------------------------------------------------

export interface BudgetState {
  settings: Settings;
  accounts: Account[];
  recurring: RecurringItem[];
  oneoffs: OneOffItem[];
  /** Bills ticked off as already paid, by month. */
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
  date: ISODate;
}

// ---- Budget grid (derived, never stored) ---------------------------------

/** One named row's value inside a month column. */
export interface BudgetRowValue {
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
 * them a colour, and the 8-hue palette is already fully spoken for, so
 * inventing a 9th and 10th hue would break the categorical colour rules.
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
  /** Set for `category` slices, and for `item` slices inherited from their
   *  parent category; the UI resolves it via paletteColor. */
  color: PaletteIndex | null;
  bucket: SpendingBucket;
  /** `item` slices only: which fixed bucket it came from, so the view tints
   *  off that bucket's own neutral rather than a shared one. */
  parentBucket?: "bill" | "oneoff";
  /** `item` slices only: the bucket they were broken out of, named so the
   *  slice can say "Rent · Fixed bills" rather than passing as a category. */
  parentLabel?: string;
  /** `item` slices only: position among siblings, so the UI can tint a step
   *  of the parent's colour instead of spending a fresh categorical hue. */
  shade?: number;
  shadeCount?: number;
  /** `other` slices only: the slices folded into it, in the same order they
   *  would have had, each with its own colour and its percent OF THE WINDOW.
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
