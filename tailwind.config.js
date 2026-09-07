/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // semantic colors for money direction + bill types. Savings/debt/
        // investment categories are now user-defined (see
        // src/engine/model.js's CATEGORY_PALETTE) and rendered via inline
        // styles, not Tailwind classes — Tailwind's JIT scanner can't see a
        // runtime-built class name anyway, and a fixed 4-color set here
        // would just reintroduce the old hardcoded-categories problem.
        income: "#0B7A0B",
        expense: "#C0392B",
        bill: "#7030A0",
      },
    },
  },
  plugins: [],
};