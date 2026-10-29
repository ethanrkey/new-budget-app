// The words the transaction form uses when you try to leave it.
//
// Same rule as the other files here: this is data, not a component.
// The phone shows it in a native alert; nothing else shows it yet,
// and when the web's form grows the same guard it will show this
// rather than a second sentence that means almost the same thing.
export const DISCARD = {
  title: "Discard changes?",
  // Named, not implied. "Are you sure?" makes somebody reconstruct
  // what they are being asked about; this says what is on the table.
  body: "This transaction hasn't been saved. Leaving now throws away what you typed.",
  keep: "Keep editing",
  discard: "Discard",
} as const;

/**
 * What the web's Ledger asks before a delete (2026-10-29).
 *
 * The row's ✕ deleted on the first click, and on a recurring row it
 * deletes the RULE — every date it generates, not the one row the ✕
 * sits on. That is the most destructive single click in the app and
 * it was the only delete with no second step.
 *
 * Takes the items about to go, not ids, so the words are a pure
 * function of what is on the table. A rule is anything with a
 * cadence. One item is named; several are counted, and the count says
 * how many of them are rules, because "Delete 4 items?" hides the one
 * fact that makes it worse than it sounds.
 */
export function deletePrompt(items: { name: string; cadence?: string | null }[]): { title: string; body: string | null } {
  const rules = items.filter((i) => !!i.cadence).length;
  if (items.length === 1) {
    return {
      title: `Delete ${items[0].name || "this item"}?`,
      body: rules ? "This removes every date it generates." : null,
    };
  }
  return {
    title: `Delete ${items.length} items?`,
    body: rules === 0 ? null
      : rules === items.length ? "All of them are recurring rules. This removes every date they generate."
      : rules === 1 ? "One of them is a recurring rule. This removes every date it generates."
      : `${rules} of them are recurring rules. This removes every date they generate.`,
  };
}

export const DELETE_CONFIRM = { delete: "Delete", cancel: "Cancel" } as const;
