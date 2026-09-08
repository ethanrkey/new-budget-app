/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // semantic colors for money direction. Bills no longer get an
        // automatic default color (that was the old text-bill purple,
        // which incorrectly reappeared even after picking "no color" —
        // "no color" now means literal default text, full stop). Savings/
        // debt/investment categories are user-defined (see
        // src/engine/model.js's CATEGORY_PALETTE) and rendered via inline
        // styles, not Tailwind classes — Tailwind's JIT scanner can't see a
        // runtime-built class name anyway, and a fixed 4-color set here
        // would just reintroduce the old hardcoded-categories problem.
        income: "#0B7A0B",
        expense: "#C0392B",
      },
    },
  },
  plugins: [],
};