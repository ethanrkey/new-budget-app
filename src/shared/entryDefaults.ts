// What category a new transaction starts in, and the ONE rule for it.
//
// Three forms ask this question — the web's EventForm and QuickEntry,
// and the phone's TransactionSheet — and all three hard-coded "bill".
// On the One-Time tab that is wrong in the most ordinary case there
// is: somebody adding a one-off had to change the category every
// single time, and the one who forgot got a recurring-shaped category
// on a single-dated item.
//
// THE DEFAULT FOLLOWS THE TAB, because the tab is the clearest
// statement of intent available before anything has been typed.
// One-Time means one-off; Recurring means a fixed bill.
//
// AND IT STOPS FOLLOWING THE MOMENT THE USER DISAGREES. A default
// that keeps reasserting itself is not a default, it is an argument:
// pick Income on the Recurring tab, glance at One-Time, come back,
// and finding "Fixed bill" there again is the form overruling a
// decision that was already made.

export type EntryMode = "oneoff" | "recurring";

/** The category a form opens in, for a mode nobody has argued with yet. */
export function defaultCategoryFor(mode: EntryMode): string {
  return mode === "oneoff" ? "oneoff" : "bill";
}

/**
 * The category after switching tabs.
 *
 * `touched` is "the user has picked a category themselves at least
 * once". `presetCategory` is the Dashboard's "+ Add a loan" shortcut,
 * which has already chosen on the user's behalf and outranks the tab
 * — it is the reason the form was opened at all.
 */
export function categoryOnModeChange(
  mode: EntryMode,
  current: string,
  { touched = false, presetCategory = null }: { touched?: boolean; presetCategory?: string | null } = {},
): string {
  if (presetCategory) return current;
  if (touched) return current;
  return defaultCategoryFor(mode);
}

/**
 * The category a form OPENS with.
 *
 * Editing keeps what was saved, always — the saved category is a fact
 * about the item, not a default.
 */
export function initialCategory(
  mode: EntryMode,
  { saved = null, presetCategory = null }: { saved?: string | null; presetCategory?: string | null } = {},
): string {
  return saved ?? presetCategory ?? defaultCategoryFor(mode);
}
