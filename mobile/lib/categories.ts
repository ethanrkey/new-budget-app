import type { BudgetState, TrackerCategory } from "../../src/engine/types.ts";
import {
  countTaggedItems, setupAsset, setupLoan, addCategory, updateCategory, addBalanceSnapshot,
} from "../../src/engine/mutate.ts";

// The phone's account manager, minus the React.
//
// Until now the phone could not call addCategory, updateCategory,
// deleteCategory, moveCategory or setupAsset at all, and setupLoan only
// through the Dashboard's Edit button. So a phone-only user could not
// add a savings account, an investment or a loan, could not rename or
// remove one, and could not answer the loan card's own prompt for a
// rate and an original amount. On a client that can create accounts
// (OAuth makes that true now) that is not a gap, it is a dead end.
//
// Everything below is a decision ABOUT a form, kept out of the form so
// the plain-node harness can run it.

/** What a row in the manager is, flattened for display. */
export type CategoryRow = {
  id: string;
  name: string;
  kind: "asset" | "debt";
  assetKind: "savings" | "investment" | null;
  /** What it says under the name: the thing it is, in words. */
  sub: string;
  /** Logged readings. Zero is what makes a delete safe. */
  readings: number;
  /** Rules and one-offs still tagged to it. */
  tagged: number;
};

const KIND_WORD: Record<string, string> = {
  savings: "Savings",
  investment: "Investment",
};

export function categoryRows(state: BudgetState): CategoryRow[] {
  return [...(state.trackerCategories ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const readings = (state.balanceSnapshots?.[c.id] ?? []).length;
      const terms = c.kind === "debt" && (c.originalPrincipal != null || c.interestRate != null);
      return {
        id: c.id,
        name: c.name,
        kind: c.kind === "debt" ? "debt" : "asset",
        assetKind: c.kind === "asset" ? (c.assetKind ?? null) : null,
        sub: c.kind === "debt"
          // The loan card's own prompt, echoed here so the answer to it
          // is visibly in this screen rather than somewhere unstated.
          ? (terms ? "Loan · terms set" : "Loan · no rate or original amount yet")
          : `${KIND_WORD[c.assetKind ?? ""] ?? "Investment"}`,
        readings,
        tagged: countTaggedItems(state, c.id),
      };
    });
}

/**
 * Why deleting this is safe, or what it costs.
 *
 * The engine does not refuse: `deleteCategory` leaves tagged items
 * alone and they show as uncategorized, which is the right behavior and
 * a surprising one. So the screen says it in advance rather than
 * letting someone find out.
 */
export function deleteWarning(row: CategoryRow): string {
  const parts: string[] = [];
  if (row.readings > 0) parts.push(`${row.readings} logged ${row.readings === 1 ? "balance" : "balances"}`);
  if (row.tagged > 0) parts.push(`${row.tagged} ${row.tagged === 1 ? "transaction" : "transactions"}`);
  if (parts.length === 0) return `Delete ${row.name}? Nothing is logged against it.`;
  return `Delete ${row.name}? Its ${parts.join(" and ")} stay in your history — the ${
    row.tagged > 0 ? "transactions show as uncategorized" : "readings go with it"
  }.`;
}

export type CategoryDraft = {
  name: string;
  kind: "asset" | "debt";
  assetKind: "savings" | "investment";
  /** Debt only. */
  originalPrincipal: string;
  interestRate: string;
  interestStartDate: string;
  /** What it is worth, or what is owed, right now. Optional on an edit. */
  balance: string;
  asOf: string;
};

export function blankCategoryDraft(today: string): CategoryDraft {
  return {
    name: "", kind: "asset", assetKind: "savings",
    originalPrincipal: "", interestRate: "", interestStartDate: today,
    balance: "", asOf: today,
  };
}

export function draftOfCategory(c: TrackerCategory, today: string): CategoryDraft {
  const debt = c.kind === "debt" ? c : null;
  return {
    name: c.name,
    kind: debt ? "debt" : "asset",
    assetKind: (c.kind === "asset" ? c.assetKind : null) ?? "investment",
    originalPrincipal: debt?.originalPrincipal != null ? String(debt.originalPrincipal) : "",
    interestRate: debt?.interestRate != null ? String(debt.interestRate) : "",
    interestStartDate: debt?.interestStartDate ?? today,
    // Blank on an edit, on purpose: pre-filling the last reading invites
    // re-logging a number that has not changed, which is a snapshot that
    // says nothing.
    balance: "",
    asOf: today,
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

/**
 * The one message to show, or null to allow the save.
 *
 * Deliberately permissive about TERMS. A loan with no rate is a real
 * loan and the app already handles it — the card says what is missing
 * and the amortization withholds itself rather than guessing. Refusing
 * to save without an APR would make this form stricter than the data
 * model, which is how a screen ends up unusable for the person whose
 * paperwork is in another room.
 */
export function categoryDraftError(d: CategoryDraft): string | null {
  if (!d.name.trim()) return "Give it a name.";
  for (const [label, raw] of [
    ["Original amount", d.originalPrincipal],
    ["Interest rate", d.interestRate],
    ["Balance", d.balance],
  ] as const) {
    if (raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isNaN(n)) return `${label} has to be a number.`;
    if (n < 0) return `${label} cannot be negative.`;
  }
  if (d.kind === "debt" && num(d.interestRate) != null && Number(d.interestRate) > 100) {
    // A rate is a percentage. 7 means 7%. Someone typing 700 has
    // almost certainly typed the payment.
    return "Interest rate looks like a percentage — 7 means 7%.";
  }
  return null;
}

/**
 * Apply a filled-in draft. Returns the next state.
 *
 * THREE ENGINE PATHS, not one, and the reason is a type that turned out
 * to be telling the truth: `SetupLoanInput.originalPrincipal` is
 * REQUIRED, because `setupLoan` means "set up a loan" and a loan
 * without a principal cannot amortize. But a debt category with only a
 * name and a balance is a real, supported state — `applySetup` creates
 * exactly that from the web wizard's last step, and `isLoanConfigured`
 * exists precisely to gate the terms.
 *
 * So the form stays permissive and the branch lives here:
 *
 *   asset            -> setupAsset
 *   debt WITH a principal   -> setupLoan, terms and all
 *   debt WITHOUT one -> addCategory / updateCategory, plus the reading
 *
 * Doing this in the component would have meant a screen deciding what
 * an engine call means, which is the thing the engine boundary exists
 * to prevent.
 */
export function applyCategoryDraft(
  state: BudgetState, d: CategoryDraft, categoryId: string | null,
): BudgetState {
  const name = d.name.trim();
  const balance = num(d.balance);
  const asOf = balance != null ? d.asOf : null;

  if (d.kind === "asset") {
    return setupAsset(state, { categoryId, name, balance, asOf, assetKind: d.assetKind });
  }

  const principal = num(d.originalPrincipal);
  if (principal != null) {
    return setupLoan(state, {
      categoryId, name,
      originalPrincipal: principal,
      interestRate: num(d.interestRate),
      interestStartDate: d.interestStartDate,
      outstanding: balance,
      asOf,
    });
  }

  // A debt with no terms yet. The card will prompt for them, and this
  // screen is where that prompt gets answered later.
  let next = state;
  let id = categoryId;
  if (!id || !next.trackerCategories.some((c) => c.id === id)) {
    next = addCategory(next, name, "debt");
    id = next.trackerCategories[next.trackerCategories.length - 1]!.id;
  }
  next = updateCategory(next, id, {
    kind: "debt", name,
    // A rate without a principal is still worth keeping — it is half an
    // answer, and discarding it would make the form lose typing.
    interestRate: num(d.interestRate),
  });
  if (balance != null && asOf) next = addBalanceSnapshot(next, id, Math.abs(balance), asOf);
  return next;
}
