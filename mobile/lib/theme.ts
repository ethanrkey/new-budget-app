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
};

export const money = (n: number) =>
  (n < 0 ? "-" : "") +
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
