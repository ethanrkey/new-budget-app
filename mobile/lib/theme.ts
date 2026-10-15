// Dark, hardcoded. Theming twice costs an evening and teaches nothing about
// how the app feels; the phone this is for is on dark.
export const T = {
  bg: "#030712",
  surface: "#111827",
  surfaceAlt: "#1f2937",
  border: "#1f2937",
  text: "#f3f4f6",
  dim: "#9ca3af",
  faint: "#6b7280",
  income: "#34d399",
  expense: "#f87171",
  brass: "#eebb4d",
  // The Budget's total rows wear a tint, the same one the web's do.
  // These are the web's green-950/30 and red-950/30 already flattened
  // against the dark surface, because a phone cell is opaque — the
  // literals are copied from BudgetView.jsx's sticky column, which had
  // to flatten them for the same reason.
  tintIn: "#0d1f22",
  tintOut: "#21141e",
  // The web's border-gray-700, for the heavy rule above those totals.
  // Deliberately not T.border: a 2pt line in the hairline's own color
  // is not a rule, it is a thicker hairline.
  rule: "#374151",
};

export const money = (n: number) =>
  (n < 0 ? "-" : "") +
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
