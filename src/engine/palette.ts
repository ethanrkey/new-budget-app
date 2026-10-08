// ---- Color: brass for charts, cool hues for cards, red/green for direction
//
// ROLE STILL EXISTS AND STILL MATTERS — it decides whether an amount is red
// or plain, which categories can carry a cumulative column, how the Budget
// groups its sections. What it no longer does is pick a HUE. Nothing in the
// UI derives a color from a role as of 2026-10-06.
//
// Why the role palette came out. Seven hues across two modes is seven
// things to learn before the app means anything, and a user who had lived
// with it for three days still could not read the Ledger. The failure was
// not the hues — they passed every all-pairs CVD check — it was asking
// color to carry a taxonomy at all. A chart that is one hue says "these
// are shares of one total", which is the only thing a spending chart has to
// say; the label beside each slice already says which share.
//
// What color does now, in three jobs that do not overlap:
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

// ---- Direction: the only place color still carries meaning -------------
//
// Red is money GONE, green is money in — and the two tabs answer that
// question differently ON PURPOSE.
//
//   LEDGER   every outflow is red, savings and loan payments included. It
//            is a running balance read down a column, and what matters
//            there is that the money left the account. A plain $300 beside
//            a red $112 made the plain one look like it was not coming out.
//   BUDGET   saving and debt rows are plain. It answers a different
//            question — where the month's money WENT — and "saved" and
//            "spent" are genuinely different answers to that one.
//
// This was one rule for three days (2026-10-06 to 2026-10-08) and the
// Ledger half was reverted after living with it. The asymmetry is
// deliberate; `isRetainedOutflow` is the Budget's rule only.
export const RETAINED_ROLES: ReadonlyArray<Role> = ["savings", "investment", "debt"];

/** True when an outflow is money KEPT — savings, an investment, a payment
 *  against a loan. Used by the BUDGET, which groups by where money went.
 *  The Ledger deliberately does not ask: see above. */
export function isRetainedOutflow(role: Role): boolean {
  return RETAINED_ROLES.includes(role);
}


// ---- Chart fills ---------------------------------------------------------
//
// THERE IS NO PIE ANY MORE and no ramp with it. The ramp existed to rank
// four wedges; with color meaning an ACCOUNT, rank is not what a fill has
// to say. Measured on real data before dropping it: a pie under this
// system is 45%, 61% and 98% one slate wedge for the three accounts that
// have any data, because spending is most of every window by definition.
// That is not a chart. The sorted bar list it leaves behind needs no
// legend and no color-matching, reads identically under every vision
// type, and — the part that actually buys something — is no longer capped
// by how many colors a ramp can carry.
//
// Four fills, and only the first is an identity:
//   ACCOUNT   its own hue, the same one that account wears everywhere
//   LOAN      one color for all of them
//   SPENDING  slate — bills, one-offs, anything uncategorized
//   OTHER     gray, the deliberately unranked tail
export const NEUTRAL_CHART = "#6b7280";

/** What a slice is, from fields the engine already assigns. */
export type SliceLike = {
  bucket: string;
  role: Role;
  /** Set only for a category slice belonging to an account. */
  hue?: number | null;
};

/**
 * The fill for one slice, or null when it must be drawn DEGRADED — an
 * account past the eighth hue. A bar draws that as an outline; anything
 * that needs a solid uses DEGRADED_SOLID.
 */
export function sliceFill(s: SliceLike, isDark: boolean): string | null {
  if (s.bucket === "other") return NEUTRAL_CHART;
  if (s.bucket === "category") {
    if (s.role === "debt") return LOAN_COLOR[isDark ? "dark" : "light"];
    return accountColor(s.hue, isDark);      // null past the limit
  }
  return SPENDING_COLOR[isDark ? "dark" : "light"];
}

// ---- Color maps to the ACCOUNT ------------------------------------------
//
// Replaces the 2026-10-06 card colors, which were assigned by position and
// explicitly meant nothing. They now mean something precise: a hue IS an
// account, the same hue everywhere that account appears — its Dashboard
// card, its chart line, its slice of planned spending.
//
// That promotion is why the index is STORED on the category rather than
// derived from its position (see `hue` in types.ts). Position reshuffles:
// delete the first of four accounts and the other three each take someone
// else's color, which is survivable for decoration and fatal for identity.
//
// NOT A REVERSAL OF MIGRATION 13, which removed a stored color index from
// these same entities. That index was a USER'S ARBITRARY CHOICE, and an
// arbitrary choice carries no information — it said what a category was
// called, which its name already said. This one is an APP-ASSIGNED
// IDENTITY, and an identity that does not persist is not an identity. The
// field looks the same; the reason is the opposite. Do not "clean this up"
// by deriving it again.
//
// Three fixed roles share the chart with them and so share the budget:
// loans are all ONE color (not red — red is direction, and every outflow
// is already red), spending is slate, and Other stays gray.
export const ACCOUNT_HUES: Record<"light" | "dark", readonly string[]> = {
  dark:  ["#5cb2eb", "#fcb07e", "#a85ceb", "#95e4b5", "#5a91af", "#eaf91a", "#1aeaf9", "#8e43d0"],
  light: ["#159ea8", "#e55006", "#8805b8", "#1e7653", "#900433", "#371084", "#761e5f", "#c706e5"],
};

/**
 * Every loan, whatever kind of debt it is. One color on purpose: which
 * loan a row belongs to is what its label is for, and eight student loans
 * in eight hues is what made the old chart unreadable.
 *
 * NOT A GRAY, though the first attempt was. The gate rejected it: a
 * blue-gray loan and the Other gray measured ΔE2000 4.3 apart under
 * protanopia, which is two grays a reader cannot separate standing for
 * two different things. Dark brown clears the whole set at 12.1.
 */
export const LOAN_COLOR: Record<"light" | "dark", string> = { dark: "#a1b3c7", light: "#3d2314" };

/** Bills, one-offs, and anything uncategorized: money spent rather than
 *  moved. The majority of most windows, which is why it is quiet. */
export const SPENDING_COLOR: Record<"light" | "dark", string> = { dark: "#e5e7eb", light: "#111827" };

/**
 * Past the eighth account there is no distinguishable hue left — measured,
 * at the gate's own floor, against the loan/spending/Other set. The ninth
 * DEGRADES rather than wrapping: wrapping would give two accounts the same
 * color silently, which breaks the guarantee without saying so.
 *
 * A bar degrades to an OUTLINE — no fill can collide with a fill. A wedge
 * cannot: an unfilled wedge reads as missing data or a rendering hole, so
 * where a solid is required this measured neutral is used instead. It
 * clears ΔE2000 12.6 (dark) / 14.1 (light) against slate, Other, the loan
 * color and all eight hues.
 */
export const DEGRADED_SOLID: Record<"light" | "dark", string> = { dark: "#afa5a1", light: "#a58c83" };
export const MAX_ACCOUNT_HUES = 8;

/** The color of the account holding `hue`, or null past the limit — null
 *  means "draw it degraded", which each view answers in its own way. */
export function accountColor(hue: number | null | undefined, isDark: boolean): string | null {
  if (hue == null || hue < 0 || hue >= MAX_ACCOUNT_HUES) return null;
  return ACCOUNT_HUES[isDark ? "dark" : "light"][hue]!;
}

/** The lowest hue index not already taken, or null when all are. Used at
 *  category creation and by the backfill, so the two cannot disagree. */
export function nextFreeHue(taken: ReadonlyArray<number | null | undefined>): number | null {
  const used = new Set(taken.filter((h): h is number => typeof h === "number"));
  for (let i = 0; i < MAX_ACCOUNT_HUES; i++) if (!used.has(i)) return i;
  return null;
}

/** Checking has never had a hue and still does not. */
export const NEUTRAL_LINE: Record<"light" | "dark", string> = {
  light: "#111827",
  dark: "#e5e7eb",
};

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
  // is genuinely uncategorized, which is why that bucket keeps gray.
  if (!cat) return "uncategorized";
  return cat.kind === "debt" ? "debt" : assetRole(cat.assetKind);
}

/** The role of a tracker category you already hold — no list lookup. */
export function roleOfTrackerCategory(cat: { kind: "asset" | "debt"; assetKind?: AssetKind }): Role {
  return cat.kind === "debt" ? "debt" : assetRole(cat.assetKind);
}
