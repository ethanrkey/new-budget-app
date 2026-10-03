// ---- Colour by ROLE: what the money is doing ----
//
// Colour used to be a per-category choice from an 8-hue palette. Two things
// were wrong with that, and the second is the serious one.
//
// It wasn't eight hues. Measured all-pairs, Blue/Indigo separated by ΔE 1.3
// under deuteranopia and Orange/Gold by 0.9 under protanopia — identical,
// not tight. The palette was four hue families wearing eight names, and the
// numbers only surfaced because nothing re-ran the check after it was set.
// scripts/validate_palette.mjs is a CI gate now for exactly that reason.
//
// And colour-as-choice answers the wrong question. A hue someone picked
// says what a category is CALLED. What a reader scanning a chart needs is
// what the money is DOING — is this a bill, a contribution, a loan payment.
// So the hue is derived from the role and nobody picks it. Two consequences
// worth stating: customisation goes away deliberately, and bills — most of
// most people's outflow — stop being grey, which was backwards.
//
// The six hues are Okabe-Ito, the published CVD-safe qualitative set, with
// per-mode steps so each clears 3:1 against its own surface. Adopted rather
// than hand-tuned: hand-tuning is what produced the 1.3.
export type Role =
  | "income"
  | "bill"
  | "oneoff"
  | "savings"       // cash you control
  | "investment"    // market-exposed value you do not
  | "debt"
  | "uncategorized";

/** Fixed order, so a chart's colours never depend on what else is in it. */
export const ROLE_ORDER: Role[] = ["income", "bill", "oneoff", "savings", "investment", "debt", "uncategorized"];

// SEMANTIC FAMILIES CONSTRAIN HUE; the gate then optimises LIGHTNESS
// inside that constraint. Order of operations, and it was wrong once:
// hues were first picked without a semantic rule and the search was left
// to separate them, which put bills at 255° and savings at 215° — the same
// blue family for two things that are opposites (an obligation leaving vs
// money you keep). Separable by measurement, wrong by meaning.
//
//   OUT   bill, one-off, debt      warm — money leaving
//   KEEP  savings, investment      cool — money you hold
//   IN    income                   green
//   —     uncategorized            grey
//
// Same-family pairs are now semantic SIBLINGS, so splitting them by
// lightness reinforces the meaning instead of fighting it: two warms are
// two kinds of money going out, two cools are two kinds you keep.
export const SEMANTIC_FAMILY: Record<Role, "out" | "keep" | "in" | "none"> = {
  bill: "out", oneoff: "out", debt: "out",
  savings: "keep", investment: "keep",
  income: "in", uncategorized: "none",
};

/** Hue in degrees, per role — the part that carries MEANING. */
export const ROLE_HUE: Record<Role, number | null> = {
  bill: 80, oneoff: 58, debt: 30, savings: 240, investment: 300, income: 150,
  uncategorized: null, // grey has no hue, and that is the point
};

// HUES ARE PICKED FROM THE RENDERED RESULT, not from the OKLCH number.
// They are not the same thing and assuming they were produced a palette
// described as "bills gold, savings blue" that actually rendered brown and
// navy, with debt at OKLCH 20° coming out HSL 346° — lipstick, not red.
// The mapping at L .55: ok 30 -> red, 58 -> orange, 80 -> amber,
// 150 -> green, 240 -> blue, 300 -> purple. Check the output, not the input.
//
// Lightness was then solved for by search, maximising the worst all-pairs
// ΔE across normal/deutan/protan/tritan subject to a 3:1 contrast floor and
// a per-role band that keeps each colour recognisably itself. Worst pair:
// 11.2 light, 11.9 dark. Do not hand-edit — re-run the gate.
export const ROLE_COLORS: Record<Role, { light: string; dark: string }> = {
  income:        { light: "#006c2e", dark: "#48b467" },
  bill:          { light: "#d87700", dark: "#ffc555" },
  oneoff:        { light: "#7a3b00", dark: "#b85f00" },
  debt:          { light: "#b62316", dark: "#e74b39" },
  savings:       { light: "#005fc8", dark: "#009fff" },
  investment:    { light: "#a661ff", dark: "#a659ff" },
  // Grey on purpose and never promoted: the honest colour for "no
  // category", immune to colour-vision deficiency, and still in the
  // all-pairs check — it must differ from the six, not just the surface.
  uncategorized: { light: "#6b7280", dark: "#9ca3af" },
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

export function roleColor(role: Role, isDark: boolean): string {
  return ROLE_COLORS[role][isDark ? "dark" : "light"];
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

// ---- Shades within a role ----
// Pie only. In a bar chart every row sits beside its own label and its own
// bar length, so a shade there is decoration; in a pie the shade is what
// links a wedge to its legend entry.
//
// CAPPED AND FLOORED, which the old ramp was not: TINT_RANGE 0.55 split
// across ten siblings produced steps far below any usable separation, and
// five of eight rows came out as the same grey-blue. Four steps is what a
// single hue can carry at ΔE >= 8; past that the tail folds.
export const MAX_SHADES = 4;
const SHADE_SPAN = 0.62;
const SHADE_TARGET = { light: "#0b1220", dark: "#f8fafc" };

export function roleShade(role: Role, index: number, count: number, isDark: boolean): string {
  const base = roleColor(role, isDark);
  if (count <= 1 || index <= 0) return base;
  const steps = Math.min(count, MAX_SHADES);
  const t = (Math.min(index, steps - 1) / (steps - 1)) * SHADE_SPAN;
  return mixHex(base, SHADE_TARGET[isDark ? "dark" : "light"], t);
}

function mixHex(hex: string, target: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(hex, i) + (p(target, i) - p(hex, i)) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
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

/**
 * Shade index within a role, assigned across everything sharing that role
 * in one chart. This has to span CATEGORIES, not just items: four
 * investments, or five student loans, now share a hue by design, and
 * telling them apart in a pie is exactly what the shades are for.
 */
export function assignShades<T extends { role: Role; shade?: number; shadeCount?: number }>(slices: T[]): T[] {
  const counts = new Map<Role, number>();
  for (const s of slices) counts.set(s.role, (counts.get(s.role) ?? 0) + 1);
  const seen = new Map<Role, number>();
  for (const s of slices) {
    const n = seen.get(s.role) ?? 0;
    seen.set(s.role, n + 1);
    s.shade = n;
    s.shadeCount = counts.get(s.role) ?? 1;
  }
  return slices;
}
