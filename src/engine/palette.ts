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

// Hues are chosen for meaning and spread round the wheel; LIGHTNESS was
// then solved for, not guessed. That split matters: under deuteranopia and
// protanopia the wheel collapses onto roughly one axis, so two hues from
// the same family (two blues, two oranges) can only be told apart by
// lightness — which is exactly how the old Blue/Indigo pair reached 1.3. A
// search over lightness maximising the worst all-pairs ΔE, subject to a 3:1
// contrast floor on each surface, produced these. Worst pair across normal,
// deutan, protan AND tritan: 11.6 light, 12.8 dark, against a target of 8.
//
// Do not hand-edit a value here without re-running the gate. Hand-tuning is
// what produced the 1.3.
export const ROLE_COLORS: Record<Role, { light: string; dark: string }> = {
  // Income is green, which agrees with the direction colours on ledger
  // amounts — fine, because income IS money in, so the two systems cannot
  // contradict each other. Direction stays a separate system.
  income:        { light: "#004a07", dark: "#17924a" },
  // Bills get a hue that holds up: they are the majority of most people's
  // outflow and had the least separable treatment of anything.
  bill:          { light: "#387bcd", dark: "#2f77cc" },
  oneoff:        { light: "#744800", dark: "#a86a00" },
  savings:       { light: "#005871", dark: "#00ccfb" },
  investment:    { light: "#c773c0", dark: "#f19de9" },
  debt:          { light: "#c75e44", dark: "#ff6a44" },
  // Grey on purpose, and deliberately not promoted with the others: grey is
  // the honest colour for "no category", and it is immune to colour-vision
  // deficiency, which is the right property for the bucket that means
  // nothing. It is still in the all-pairs check — it has to differ from the
  // six, not just from the surface.
  uncategorized: { light: "#6b7280", dark: "#9ca3af" },
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
