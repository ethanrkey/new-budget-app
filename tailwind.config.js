/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // semantic colors for money direction + bill types
        income: "#0B7A0B",
        expense: "#C0392B",
        bill: "#7030A0",
        roth: "#6A1B9A",
        saved: "#0B7A0B",
        brokerage: "#1565C0",
        loans: "#B36A00",
      },
    },
  },
  plugins: [],
};