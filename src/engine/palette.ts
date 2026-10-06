// ---- Colour: brass for charts, cool hues for cards, red/green for direction
//
// ROLE STILL EXISTS AND STILL MATTERS — it decides whether an amount is red
// or plain, which categories can carry a cumulative column, how the Budget
// groups its sections. What it no longer does is pick a HUE. Nothing in the
// UI derives a colour from a role as of 2026-10-06.
//
// Why the role palette came out. Seven hues across two modes is seven
// things to learn before the app means anything, and a user who had lived
// with it for three days still could not read the Ledger. The failure was
// not the hues — they passed every all-pairs CVD check — it was asking
// colour to carry a taxonomy at all. A chart that is one hue says "these
// are shares of one total", which is the only thing a spending chart has to
// say; the label beside each slice already says which share.
//
// What colour does now, in three jobs that do not overlap:
//
//   BRASS      charts and brand. One hue, ranked by size. The brand's own
//              gold, so the chart reads as part of the app rather than as a
//              visitor from a palette generator.
//   COOL HUES  Dashboard account cards. DECORATION that helps scanning —
//              five cards you can tell apart at a glance — and deliberately
//              not meaning: the hue is assigned by card ORDER and says
//              nothing about the account.
//   RED/GREEN  direction, and nothing else. Green in, red out, plain for
//              money that left the account without being spent.
//
// Every value here was measured on the real surfaces and is re-measured by
// scripts/validate_palette.mjs in CI, which is a gate, not a script someone
// remembers to run. Do not hand-edit a hex without re-running it.
export type Role =
  | "income"
  | "bill"
  | "oneoff"
  | "savings"       // cash you control
  | "investment"    // market-exposed value you do not
  | "debt"
  | "uncategorized";

/** Fixed order. Nothing paints from it any more; it is the order the
 *  About page lists the roles in, and the order a role check iterates. */
export const ROLE_ORDER: Role[] = ["income", "bill", "oneoff", "savings", "investment", "debt", "uncategorized"];

// ---- Direction: the only place colour still carries meaning -------------
//
// Red is money GONE. A transfer to savings, a contribution to a brokerage
// and a loan payment all leave the checking account, and none of them is
// money gone — pricing them as expenses is the app telling you off for
// saving. The Budget has worked this way since 2026-10-03; the Ledger was
// still reddening them until 2026-10-06, so the two tabs disagreed about
// the same $300 on the same day.
export const RETAINED_ROLES: ReadonlyArray<Role> = ["savings", "investment", "debt"];

/** True when an outflow is money KEPT — savings, an investment, a payment
 *  against a loan. Such an amount is plain text, never red. */
export function isRetainedOutflow(role: Role): boolean {
  return RETAINED_ROLES.includes(role);
}

// ---- Charts: brass, one hue ---------------------------------------------
//
// BY RANK, not by what the slice is. Biggest share gets the first step.
//
// The two modes run in OPPOSITE directions, and that is not a mistake: a
// ramp has to travel AWAY from its surface or its first step disappears
// into the background. On the dark card the lightest step is the most
// visible, so dark runs light -> dark; on white it is the reverse.
export const BRASS_RAMP: Record<"light" | "dark", readonly string[]> = {
  dark:  ["#ffe294", "#edb345", "#cb882e", "#a7611b"],
  light: ["#643500", "#804d00", "#9d6800", "#b78500"],
};

/**
 * FOUR STEPS IS THE WHOLE RAMP, and the PIE's slice count follows from it
 * rather than the other way round. Measured ΔE2000 on the worst adjacent
 * pair: seven steps of brass came out 4.1-4.5 — two neighbours a reader
 * cannot separate — while four steps come out 8.1 light and 10.9 dark. So
 * the pie is top four plus Other, trading slices for legibility.
 *
 * THIS IS THE PIE'S LIMIT ONLY. The engine folds at its own, larger cap
 * (`compute.ts`), which is what the BAR renders — the bar is the full view,
 * every row sits beside its own label and its own length, and one flat
 * brass means it has no ramp to run out of. Cutting the bar to four rows
 * as well would have removed the view you go to when the pie is too
 * coarse, which is the only reason the coarse pie is acceptable.
 */
export const PIE_SLICES = 5; // 4 named + Other

/** The bar is the FULL view and keeps every row, so it cannot use a ramp —
 *  rank would be a lie past the fourth row. One brass, every named row. */
export const BAR_COLOR: Record<"light" | "dark", string> = {
  dark: "#edb345",
  light: "#804d00",
};

/** Other, and anything else that is deliberately not identified: the same
 *  grey in both modes (3.67:1 on the dark card, 4.83:1 on white). */
export const NEUTRAL_CHART = "#6b7280";

/** Pie fill for the slice at `rank` (0 = biggest). Other is grey wherever
 *  it lands, including the rows it holds when it is expanded — they came
 *  out of the tail and the tail is not ranked. */
export function pieFill(rank: number, isOther: boolean, isDark: boolean): string {
  if (isOther) return NEUTRAL_CHART;
  const ramp = BRASS_RAMP[isDark ? "dark" : "light"];
  return ramp[Math.min(Math.max(rank, 0), ramp.length - 1)]!;
}

/** Bar fill. Every named row is one brass; only Other differs. */
export function barFill(isOther: boolean, isDark: boolean): string {
  return isOther ? NEUTRAL_CHART : BAR_COLOR[isDark ? "dark" : "light"];
}

// ---- Dashboard cards: decoration, not meaning ---------------------------
//
// Assigned by card ORDER, cycling. It tells you nothing about the account —
// it is there so five cards on one screen are five distinguishable objects
// and your eye can return to the one it was reading. The list alternates
// light and dark steps so two neighbours never sit close.
//
// LOANS TAKE NO CARD COLOUR: grey line, no dot. Five loan cards therefore
// look alike, which is acceptable because the Debt section collapses to a
// single card by default and every card inside it is labelled — the colour
// would be decorating a list you have to open on purpose.
export const CARD_COLORS: Record<"light" | "dark", readonly string[]> = {
  dark:  ["#8bd4ff", "#8f68cc", "#a1b3c7", "#009393", "#86a6ff"],
  light: ["#0085b9", "#512685", "#58697b", "#004d4d", "#3e5ab7"],
};

export function cardColor(index: number, isDark: boolean): string {
  const set = CARD_COLORS[isDark ? "dark" : "light"];
  return set[((index % set.length) + set.length) % set.length]!;
}

/** The checking account and every loan: no hue. Checking has been neutral
 *  since the card was built (cash has no category), and loans join it. */
export const NEUTRAL_LINE: Record<"light" | "dark", string> = {
  light: "#111827",
  dark: "#e5e7eb",
};
export const LOAN_LINE = NEUTRAL_CHART;

/** Human-readable role names. A role system needs its mapping VISIBLE —
 *  otherwise it is a private language only the code understands. */
export const ROLE_LABEL: Record<Role, string> = {
  income: "Income",
  bill: "Fixed bill",
  oneoff: "One-off",
  savings: "Savings",
  investment: "Investment",
  debt: "Debt",
  uncategorized: "Uncategorized",
};

/**
 * The role suffix a card shows after a category's name — or null when the
 * name already says it. "SAVINGS · Savings" is not a legend, it is a
 * stutter, and it is the DEFAULT state of a new account: the three seeded
 * categories are named Savings, Investments and Debt, which are the role
 * labels verbatim. Plural and case are ignored so "Investments" matches
 * "Investment"; anything the user actually named ("Roth IRA", "Car loan")
 * still gets its role spelled out, which is the whole point of the suffix.
 */
export function roleSuffix(name: string, role: Role): string | null {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  return fold(name) === fold(ROLE_LABEL[role]) ? null : ROLE_LABEL[role];
}

/**
 * An asset category is cash you control or value the market moves, and only
 * the user knows which. NEVER inferred from the name: an HSA reads like
 * savings and can be entirely in one stock, which makes it the most
 * market-exposed thing someone owns rather than the least. Not interacting
 * with an account is not the same as not being exposed by it.
 *
 * Unset renders as `investment`, which is the conservative direction: an
 * investment gets no projected line, so a wrong guess withholds a
 * projection rather than inventing one over market-exposed value.
 */
export type AssetKind = "savings" | "investment";
export function assetRole(assetKind: AssetKind | null | undefined): Role {
  return assetKind === "savings" ? "savings" : "investment";
}

// ---- Resolving a role ----------------------------------------------------

/**
 * What is this money doing? The one place the question is answered, so the
 * web and the phone cannot drift apart on it.
 */
export function roleOfCategory(
  categoryId: string,
  categories: ReadonlyArray<{ id: string; kind: "asset" | "debt"; assetKind?: AssetKind }>
): Role {
  if (categoryId === "income") return "income";
  if (categoryId === "bill") return "bill";
  if (categoryId === "oneoff") return "oneoff";
  const cat = categories.find((c) => c.id === categoryId);
  // An orphan — a category that was deleted out from under a transaction —
  // is genuinely uncategorised, which is why that bucket keeps grey.
  if (!cat) return "uncategorized";
  return cat.kind === "debt" ? "debt" : assetRole(cat.assetKind);
}

/** The role of a tracker category you already hold — no list lookup. */
export function roleOfTrackerCategory(cat: { kind: "asset" | "debt"; assetKind?: AssetKind }): Role {
  return cat.kind === "debt" ? "debt" : assetRole(cat.assetKind);
}
