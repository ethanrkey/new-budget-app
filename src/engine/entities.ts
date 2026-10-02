// ---- The state document, taken apart into entities, and put back together ----
//
// The storage model is moving from one jsonb document per user to one row per
// entity. These three functions are the whole of that change that can be
// reasoned about, tested and proved BEFORE a database is involved:
//
//   splitState(state)        the document -> the rows
//   assembleState(entities)  the rows -> the document
//   diffEntities(prev, next) which rows a save actually has to touch
//
// They are pure, they live in the engine, and the Expo client gets them for
// free. `storage.js` stays the only file that knows where bytes live: it
// calls these and writes what they return. If diffing ever drifts into
// storage.js, the split went wrong.
//
// THE SAFETY PROPERTY, asserted in tests/migrations.test.mjs over every
// golden fixture and (before any live migration) over real exported blobs:
//
//   assembleState(splitState(s)) deep-equals s
//
// One pure identity catches every dropped field, mangled key and silently
// emptied collection. It is why the migration can be proved before it runs.
import { primaryAccount } from "./model.ts";
import type {
  Account, BalanceSnapshot, BudgetState, Contribution, ISODate, MonthKey,
  OneOffItem, RawState, RecurringItem, Settings, TrackerCategory,
} from "./types.ts";

/**
 * The shape version stamped on every row. A client that reads a row carrying
 * a HIGHER number than this does not understand it and must refuse to sync,
 * going read-only rather than writing a mangled row back. That matters
 * because the web app is always the latest build but an App Store client is
 * user-controlled and can lag arbitrarily far behind.
 *
 * UNPROVEN as of 2026-10-02: the refusal path has no lagging build to test
 * against, because there is no iOS client yet. The stamp is here now because
 * retrofitting it later is a second migration; the behaviour it enables is
 * not yet verified against the scenario it exists for.
 */
export const ENTITY_SCHEMA_VERSION = 1;

/**
 * Entity kinds. These are the units of concurrent edit: two devices touching
 * different entities never conflict, which is the entire point of the change.
 */
export type EntityKind =
  | "settings"         // one blob — preferences are not money, last write wins
  | "account"          // the checking account (name/kind/order; see the anchor note)
  | "recurring"
  | "oneoff"
  | "category"         // a tracker category: savings, investment or loan
  | "accountSnapshot"  // a verified checking balance, keyed BY DATE
  | "snapshot"         // a logged category balance, keyed BY DATE
  | "contribution"     // what you actually put in — NOT date-keyed, see below
  | "actual"           // a variable bill's real monthly total
  | "override";        // one occurrence's own amount

export interface Entity {
  kind: EntityKind;
  /** Unique within (user, kind). Composite where the entity is not one object. */
  id: string;
  /** The engine's own object, stored verbatim. */
  data: unknown;
  schemaVersion: number;
}

const SETTINGS_ID = "settings";

// Composite keys. The separator is ":" and no id component may contain one;
// engine ids are uid()s or fixed strings, and dates and month keys use "-".
const key = (...parts: string[]): string => parts.join(":");

/**
 * Snapshots are keyed by DATE, not by their own uid, and that is load-bearing
 * rather than incidental. "As of the 28th the account held X" is a statement
 * ABOUT a date: two rows for one date are a contradiction, not two readings.
 * Making the date the key means the primary key enforces the invariant that
 * `upsertSnapshotByDate` enforces in memory — no mutator can be bypassed, and
 * two devices logging the same date collide on one row and resolve through
 * the ordinary version guard instead of silently both surviving.
 *
 * Contributions deliberately do NOT work this way: two deposits on one day
 * are two real events, so they keep their own uid and can coexist.
 */
const snapshotKey = (ownerId: string, date: ISODate): string => key(ownerId, date);

// ---- split -------------------------------------------------------------

/**
 * The document, taken apart. LOSSLESS on purpose: split is the direction that
 * writes to the database, so anything dropped here is unrecoverable. The
 * account entity therefore still carries `balance`/`balanceAsOf` even though
 * assembleState derives them — see the anchor note there.
 */
export function splitState(state: BudgetState): Entity[] {
  const out: Entity[] = [];
  const push = (kind: EntityKind, id: string, data: unknown) =>
    out.push({ kind, id, data, schemaVersion: ENTITY_SCHEMA_VERSION });

  push("settings", SETTINGS_ID, state.settings);

  for (const a of state.accounts) push("account", a.id, a);
  for (const r of state.recurring) push("recurring", r.id, r);
  for (const o of state.oneoffs) push("oneoff", o.id, o);
  for (const c of state.trackerCategories) push("category", c.id, c);

  for (const [accountId, list] of Object.entries(state.accountSnapshots || {}))
    for (const s of list) push("accountSnapshot", snapshotKey(accountId, s.date), { accountId, ...s });

  for (const [categoryId, list] of Object.entries(state.balanceSnapshots || {}))
    for (const s of list) push("snapshot", snapshotKey(categoryId, s.date), { categoryId, ...s });

  for (const [categoryId, list] of Object.entries(state.contributionLog || {}))
    for (const c of list) push("contribution", key(categoryId, c.id), { categoryId, ...c });

  for (const [itemId, byMonth] of Object.entries(state.monthlyActuals || {}))
    for (const [month, amount] of Object.entries(byMonth))
      push("actual", key(itemId, month), { itemId, month, amount });

  for (const [ruleId, byDate] of Object.entries(state.overrides || {}))
    for (const [date, amount] of Object.entries(byDate))
      push("override", key(ruleId, date), { ruleId, date, amount });

  return out;
}

// ---- assemble ----------------------------------------------------------

/**
 * The rows, put back together into the document shape the engine, the JSON
 * backup and the recovery envelope all already speak. Nothing downstream has
 * to learn about rows: export, import and recovery are unchanged because
 * this produces exactly the shape they take.
 *
 * THE ANCHOR. An account's verified balance is NOT read from the account
 * entity — it is derived from that account's newest snapshot by date. The
 * two used to be stored separately and kept in lockstep by one mutator,
 * which made them a conflict to arbitrate across devices. Deriving deletes
 * the conflict class outright: snapshots are append-only and date-keyed, so
 * "the later as-of date wins" becomes `max(date)` for free, with no rule to
 * enforce and nothing to get wrong.
 *
 * One behaviour follows from that and is intended: correcting the NEWEST
 * snapshot now moves the anchor, where before editing any snapshot left it
 * alone. Correcting September still leaves October's anchor untouched, which
 * is the case that actually mattered.
 */
export function assembleState(entities: Entity[]): RawState {
  const byKind = <T>(kind: EntityKind): T[] =>
    entities.filter((e) => e.kind === kind).map((e) => e.data as T);

  const settings = (entities.find((e) => e.kind === "settings")?.data ?? {}) as Settings;

  const accountSnapshots: Record<string, BalanceSnapshot[]> = {};
  for (const row of byKind<{ accountId: string } & BalanceSnapshot>("accountSnapshot")) {
    const { accountId, ...snap } = row;
    (accountSnapshots[accountId] ||= []).push(snap);
  }

  const balanceSnapshots: Record<string, BalanceSnapshot[]> = {};
  for (const row of byKind<{ categoryId: string } & BalanceSnapshot>("snapshot")) {
    const { categoryId, ...snap } = row;
    (balanceSnapshots[categoryId] ||= []).push(snap);
  }

  const contributionLog: Record<string, Contribution[]> = {};
  for (const row of byKind<{ categoryId: string } & Contribution>("contribution")) {
    const { categoryId, ...c } = row;
    (contributionLog[categoryId] ||= []).push(c);
  }

  const monthlyActuals: Record<string, Record<MonthKey, number>> = {};
  for (const row of byKind<{ itemId: string; month: MonthKey; amount: number }>("actual"))
    (monthlyActuals[row.itemId] ||= {})[row.month] = row.amount;

  const overrides: Record<string, Record<ISODate, number>> = {};
  for (const row of byKind<{ ruleId: string; date: ISODate; amount: number }>("override"))
    (overrides[row.ruleId] ||= {})[row.date] = row.amount;

  const accounts = byKind<Account>("account").map((a) => {
    const newest = newestSnapshot(accountSnapshots[a.id]);
    return newest ? { ...a, balance: newest.amount, balanceAsOf: newest.date } : a;
  });

  return {
    settings,
    accounts,
    recurring: byKind<RecurringItem>("recurring"),
    oneoffs: byKind<OneOffItem>("oneoff"),
    trackerCategories: byKind<TrackerCategory>("category"),
    accountSnapshots,
    balanceSnapshots,
    contributionLog,
    monthlyActuals,
    overrides,
  } as RawState;
}

/** Latest by date. Ties cannot happen — the date IS the key. */
function newestSnapshot(list: BalanceSnapshot[] | undefined): BalanceSnapshot | null {
  if (!list || list.length === 0) return null;
  return list.reduce((best, s) => (s.date > best.date ? s : best));
}

/**
 * Does this state's stored anchor already agree with its newest snapshot?
 * Run before migrating real data: where it does not, assembleState will
 * deliberately prefer the snapshot, so the round-trip identity will not hold
 * for that state and the difference should be looked at rather than
 * discovered afterwards.
 */
export function anchorMatchesNewestSnapshot(state: BudgetState): boolean {
  const account = primaryAccount(state);
  const newest = newestSnapshot(state.accountSnapshots?.[account.id]);
  if (!newest) return true;
  return newest.amount === account.balance && newest.date === account.balanceAsOf;
}

// ---- diff --------------------------------------------------------------

export interface EntityRef { kind: EntityKind; id: string }
export interface EntityDiff {
  /** Created or changed since `prev`. */
  upserts: Entity[];
  /** Present in `prev`, gone in `next` — these become tombstones, never
   *  hard deletes: a delete has to win across devices, and a row that is
   *  simply absent cannot outrank a stale device's copy of it. */
  tombstones: EntityRef[];
}

/**
 * What a save actually has to send. `prev` is ALWAYS the last assembled-and-
 * normalized state, never the raw rows: normalize() seeds a snapshot for an
 * account that has none and mints default categories for a new account, so
 * diffing against raw rows would make every load write phantom rows it never
 * had.
 */
export function diffEntities(prev: Entity[], next: Entity[]): EntityDiff {
  const index = (list: Entity[]) => {
    const m = new Map<string, Entity>();
    for (const e of list) m.set(`${e.kind}:${e.id}`, e);
    return m;
  };
  const before = index(prev);
  const after = index(next);

  const upserts: Entity[] = [];
  for (const [k, e] of after) {
    const old = before.get(k);
    if (!old || !same(old, e)) upserts.push(e);
  }

  const tombstones: EntityRef[] = [];
  for (const [k, e] of before) if (!after.has(k)) tombstones.push({ kind: e.kind, id: e.id });

  return { upserts, tombstones };
}

// Structural equality over the stored payload. JSON is the right comparison
// here precisely because JSON is what gets stored: two entities that
// serialize identically are the same row, whatever their object identity.
function same(a: Entity, b: Entity): boolean {
  return a.schemaVersion === b.schemaVersion && JSON.stringify(a.data) === JSON.stringify(b.data);
}

/**
 * The entity-level replacement for the old whole-document "saving an empty
 * state over a non-empty one" alarm. That check could not be ported: there
 * is no document to be empty any more. The equivalent danger is a single
 * sync tombstoning most of what the user has, so that is what this measures.
 * Deliberately a ratio and a floor — deleting both of your two items is
 * legitimate; deleting 40 of 50 is not something a user did by accident.
 */
export function tombstoneAlarm(prev: Entity[], diff: EntityDiff, floor = 5, ratio = 0.5): boolean {
  if (diff.tombstones.length < floor) return false;
  return prev.length > 0 && diff.tombstones.length / prev.length >= ratio;
}
