import { useEffect } from "react";
import { applyTheme } from "../theme.js";

// The public root. Three features, one CTA, no scroll-jacking and no
// gradients that make a finance app look like a crypto product. Copy is
// the user's, verbatim.
// `w`/`h` are the shot's own CSS dimensions, and the three differ — one
// hardcoded 1280x900 for all of them reserved the wrong box and shifted the
// page as each image loaded. They come from SHOTS in scripts/screenshots.mjs
// and have to be changed with it.
const FEATURES = [
  {
    name: "Dashboard",
    blurb: "Every account in one place. Net position, balances you log yourself, and how each has moved.",
    shot: "/screenshots/dashboard.png", w: 1100, h: 728,
  },
  {
    name: "Ledger",
    blurb: "Your forecast: every transaction you expect, dated, with a running balance. Adjust as plans change.",
    shot: "/screenshots/ledger.png", w: 1100, h: 688,
  },
  {
    name: "Budget",
    blurb: "Month by month, income against outflow, projected as far out as you want.",
    shot: "/screenshots/budget.png", w: 1100, h: 1010,
  },
];

export default function Landing() {
  useEffect(() => {
    applyTheme();
    document.title = "Key Budget — Plan your future while viewing the present";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <span className="text-lg font-semibold tracking-tight text-[#8e670b] dark:text-[#eebb4d]">
          Key Budget
        </span>
        <a href="/app" className="text-sm underline underline-offset-2">Open the app</a>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6">
        <section className="py-14 sm:py-24 max-w-2xl">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
            Plan your future while viewing the present
          </h1>
          <p className="mt-5 text-lg text-gray-600 dark:text-gray-400">
            Describe your money as rules — a paycheck every two weeks, rent on the 2nd — and watch the
            balance day by day. Then log what actually happened and see how the two compare.
          </p>
          <a
            href="/app"
            className="inline-block mt-8 rounded-xl bg-[#8e670b] dark:bg-[#eebb4d] px-6 py-3 text-base font-semibold text-white dark:text-gray-900"
          >
            Try Key Budget
          </a>
          <p className="mt-3 text-sm text-gray-500">
            Free. No bank connection, ever — it never asks for one.
          </p>
        </section>

        <section className="pb-8 space-y-16 sm:space-y-24">
          {FEATURES.map((f, i) => (
            <div
              key={f.name}
              className={`grid gap-7 sm:gap-12 sm:grid-cols-2 items-center ${i % 2 ? "sm:[&>figure]:order-first" : ""}`}
            >
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{f.name}</h2>
                <p className="mt-3 text-gray-600 dark:text-gray-400 leading-relaxed">{f.blurb}</p>
              </div>
              {/* Fixture data, never real finances — a public page is the
                  last place a real balance should appear. */}
              <figure className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm">
                <img src={f.shot} alt={`The ${f.name} screen`} width={f.w} height={f.h} className="w-full h-auto block" />
              </figure>
            </div>
          ))}
        </section>

        <section className="py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Plan your future while viewing the present</h2>
          <a
            href="/app"
            className="inline-block mt-6 rounded-xl bg-[#8e670b] dark:bg-[#eebb4d] px-6 py-3 text-base font-semibold text-white dark:text-gray-900"
          >
            Try Key Budget
          </a>
        </section>
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
          <span>Key Budget</span>
          <a href="/privacy" className="underline underline-offset-2">Privacy</a>
          <a href="mailto:support@keybudget.app" className="underline underline-offset-2">support@keybudget.app</a>
        </div>
      </footer>
    </div>
  );
}
