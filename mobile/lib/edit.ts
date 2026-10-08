// What a transaction edit MEANS, with no React in it.
//
// The Ledger's occurrence-date bug shipped because the form was verified
// standalone and the wiring between it and the mutators never was. The
// wiring is where the thinking is: which mutation a scope implies, what a
// draft turns into, what a ledger row id refers to. So it lives here,
// pure, and the sheet becomes a thing that collects strings and calls one
// of these.
//
// Everything returns a `(state) => state` so the caller hands it straight
// to `commit()` and nothing in a component ever touches engine internals.
import { upsertItem, deleteItem, setOverride, clearOverride, orphanedOverrideDates } from "../../src/engine/mutate.ts";
import { uid, todayISO } from "../../src/engine/model.ts";
import type { BudgetState, BudgetItem, RecurringItem, ISODate, Cadence } from "../../src/engine/types.ts";

/**
 * A ledger row id is "<itemId>@<date>". DELETE strips the date because it
 * removes the whole rule; EDIT must NOT, because the date is what lets the
 * sheet offer "just this date" as a scope. Stripping it in the wrong place
 * is the bug that let a single-month edit rewrite every month on the web
 * (2026-10-02), which is why both halves are named functions here rather
 * than an inline `.split("@")` at each call site.
 */
export const itemIdOf = (rowId: string): string => rowId.split("@")[0]!;
export const dateOf = (rowId: string): ISODate | null => rowId.split("@")[1] ?? null;

/** Scope is chosen BEFORE the sheet opens, so the sheet never has a mode. */
export type Scope = "occurrence" | "rule";

/** The strings a sheet collects. All text, because every input is text. */
export type Draft = {
  name: string;
  amount: string;
  category: string;
  recurring: boolean;
  date: ISODate;        // one-off only
  cadence: Cadence;     // recurring only
  startDate: ISODate;   // recurring only
  endDate: string;      // recurring only, "" means none
  variable: boolean;
};

export function blankDraft(today: ISODate = todayISO()): Draft {
  return {
    name: "", amount: "", category: "bill", recurring: false,
    date: today, cadence: "monthly", startDate: today, endDate: "", variable: false,
  };
}

export function draftOf(item: BudgetItem): Draft {
  const rec = "cadence" in item && item.cadence ? (item as RecurringItem) : null;
  return {
    name: item.name,
    amount: String(item.amount),
    category: item.category,
    recurring: !!rec,
    date: (rec ? null : (item as { date: ISODate }).date) ?? todayISO(),
    cadence: rec?.cadence ?? "monthly",
    startDate: rec?.startDate ?? todayISO(),
    endDate: rec?.endDate ?? "",
    variable: rec?.variable ?? false,
  };
}

const num = (s: string) => Number(String(s).trim());
const isMoney = (s: string) => s.trim() !== "" && !Number.isNaN(num(s)) && Number.isFinite(num(s));

/** Why a draft cannot be saved, or null. A string so the sheet can show it
 *  rather than only disabling a button with no explanation. */
export function draftError(d: Draft): string | null {
  if (!d.name.trim()) return "Give it a name.";
  if (!isMoney(d.amount)) return "Enter an amount.";
  if (d.recurring && d.endDate && d.endDate < d.startDate) return "The end date is before the start date.";
  return null;
}

/** Only the amount is editable for one occurrence — every other field
 *  belongs to the rule, which is the whole reason scope exists. */
export function overrideError(amount: string): string | null {
  return isMoney(amount) ? null : "Enter an amount.";
}

/**
 * The item a draft becomes. `id` is reused when editing and minted when
 * adding, so a double-tap on Save mints a second id and creates a
 * duplicate rather than silently overwriting something else.
 */
export function itemFrom(d: Draft, existing?: BudgetItem | null, canTrack = false): BudgetItem {
  const base = {
    id: existing?.id ?? uid(),
    name: d.name.trim(),
    amount: Math.abs(num(d.amount)),
    category: d.category,
    order: existing?.order,
  } as BudgetItem;
  if (!d.recurring) return { ...base, date: d.date } as BudgetItem;
  return {
    ...base,
    cadence: d.cadence,
    startDate: d.startDate,
    endDate: d.endDate || null,
    dayOfMonth: new Date(d.startDate + "T00:00:00Z").getUTCDate(),
    // Only a bill or a loan payment can be tracked against an actual;
    // carrying the flag on anything else would put it on the Spending tab
    // with nothing to compare. `canTrack` is resolved against the live
    // category list by `canTrackActuals`, never guessed from the id.
    variable: canTrack ? d.variable : false,
  } as BudgetItem;
}

// ---- The mutations, one per thing the scope sheet can offer --------------

/** Can this category carry a logged actual? A fixed bill, or a loan —
 *  resolved against the real category list, because "is this a debt
 *  category" is not a thing an id can be asked on its own. */
export function canTrackActuals(s: BudgetState, category: string): boolean {
  if (category === "bill") return true;
  return (s.trackerCategories ?? []).some((c) => c.id === category && c.kind === "debt");
}

export const saveItem = (d: Draft, existing?: BudgetItem | null) =>
  (s: BudgetState): BudgetState =>
    upsertItem(s, itemFrom(d, existing, d.recurring && canTrackActuals(s, d.category)));

export const saveOccurrence = (ruleId: string, date: ISODate, amount: string) =>
  (s: BudgetState): BudgetState => setOverride(s, ruleId, date, Math.abs(num(amount)));

export const resetOccurrence = (ruleId: string, date: ISODate) =>
  (s: BudgetState): BudgetState => clearOverride(s, ruleId, date);

export const removeItem = (itemId: string) =>
  (s: BudgetState): BudgetState => deleteItem(s, itemId);

/**
 * Moving a rule's day leaves its date-keyed overrides behind — an override
 * is a statement about a DATE and is never remapped. The sheet has to say
 * how many before it saves, never after.
 */
export function orphansIfSaved(s: BudgetState, d: Draft, existing: BudgetItem | null, horizon: ISODate): ISODate[] {
  if (!existing || !d.recurring) return [];
  const next = itemFrom(d, existing, true);
  if (!("cadence" in next)) return [];
  return orphanedOverrideDates(s, next as RecurringItem, horizon);
}

/** Whether this exact date already carries an override, so the sheet can
 *  offer "reset to the rule's amount" only when there is one to reset. */
export function overrideAt(s: BudgetState, ruleId: string, date: ISODate): number | null {
  return s.overrides?.[ruleId]?.[date] ?? null;
}

// ---- What the scope sheet offers ----------------------------------------

export type ScopeAction =
  | { kind: "edit-occurrence"; date: ISODate }
  | { kind: "edit-rule" }
  | { kind: "reset-occurrence"; date: ISODate }
  | { kind: "delete-rule" };

/**
 * The menu for one tapped ledger row.
 *
 * DELETE CARRIES THE SAME AMBIGUITY AS EDIT and is answered the same way —
 * by naming what it removes. "Delete every Rent" cannot be misread as
 * "delete Oct 12". There is deliberately no "delete just this date":
 * the engine has no concept of a skipped occurrence, only an override of
 * its amount, so offering it would be a button for a thing that does not
 * exist. The nearest real action is resetting a date's own amount back to
 * the rule's, and that is offered — but only on a date that has one.
 *
 * A ONE-OFF HAS NO SCOPE. It is already a single occurrence, so it skips
 * the sheet entirely and opens straight into the editor.
 */
export function scopeActions(
  state: BudgetState,
  rowId: string,
  isRecurring: boolean
): ScopeAction[] {
  if (!isRecurring) return [{ kind: "edit-rule" }, { kind: "delete-rule" }];
  const date = dateOf(rowId);
  const id = itemIdOf(rowId);
  const out: ScopeAction[] = [];
  if (date) out.push({ kind: "edit-occurrence", date });
  out.push({ kind: "edit-rule" });
  if (date && overrideAt(state, id, date) != null) out.push({ kind: "reset-occurrence", date });
  out.push({ kind: "delete-rule" });
  return out;
}
