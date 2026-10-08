import { useState } from "react";
import { ACCOUNT_HUES, LOAN_COLOR, SPENDING_COLOR, NEUTRAL_CHART } from "../engine/palette.ts";
import { getDeviceTheme } from "../theme.js";
// The words live in one place and neither client owns them.
import { ABOUT_SECTIONS as SECTIONS } from "../content/about.ts";

// The full feature walkthrough — everything the app can do, in the order you'd
// actually meet it. Quick Setup gets you a working budget in two minutes; this
// is the reference for the rest.
//
// RULE: this file ships in the SAME COMMIT as any feature change it describes.
// A stale tutorial is worse than none.


export default function Tutorial({ onClose, onStartTour }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const index = SECTIONS.indexOf(section);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 sm:rounded-2xl w-full h-full sm:h-auto sm:max-h-[88vh] sm:max-w-4xl flex flex-col shadow-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <h2 className="text-lg font-semibold">How this app works</h2>
          <div className="flex items-center gap-3">
            {/* The reference page and the walkthrough are different things
                and this is where they meet: you came here confused, and
                sometimes the answer is to be shown the tabs again. */}
            {onStartTour && (
              <button
                onClick={onStartTour}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Take the tour
              </button>
            )}
            <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Done</button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Section list: a sidebar on desktop, a scrolling chip row on mobile */}
          <nav className="hidden sm:block w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto py-2">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`w-full text-left px-4 py-2 text-sm transition ${
                  s.id === active
                    ? "bg-gray-100 dark:bg-gray-800 font-medium"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                }`}
              >
                <span className="tabular-nums text-xs text-gray-400 mr-2">{i + 1}</span>
                {s.title}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="sm:hidden flex gap-2 overflow-x-auto px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs transition ${
                    s.id === active
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
                      : "border border-gray-300 dark:border-gray-700 text-gray-500"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto px-4 sm:px-7 py-5 grow">
              <h3 className="text-xl font-semibold tracking-tight mb-4">{section.title}</h3>
              <div className="space-y-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {section.body.map((block, i) => <Block key={i} block={block} />)}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 sm:px-7 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
              <span className="text-xs text-gray-400 tabular-nums">{index + 1} of {SECTIONS.length}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setActive(SECTIONS[Math.max(0, index - 1)].id)}
                  disabled={index === 0}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40"
                >
                  Back
                </button>
                {index === SECTIONS.length - 1 ? (
                  <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium">
                    Done
                  </button>
                ) : (
                  <button
                    onClick={() => setActive(SECTIONS[index + 1].id)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// What each color is FOR. The job, not a taxonomy of money — that was
// the old legend, and seven hues to memorize is what made the app hard to
// read. These four entries are the whole system.
const LEGEND = [
  { key: "accounts", name: "One per account", hint: "each savings or investment account keeps its own color, everywhere it appears", swatches: (dark) => ACCOUNT_HUES[dark ? "dark" : "light"] },
  { key: "loans", name: "Loans", hint: "all of them, one color — which loan a row is, its name says", swatches: (dark) => [LOAN_COLOR[dark ? "dark" : "light"]] },
  { key: "spending", name: "Spending", hint: "bills, one-offs, anything not tagged to an account", swatches: (dark) => [SPENDING_COLOR[dark ? "dark" : "light"]] },
  { key: "other", name: "Other", hint: "the folded tail of the spending list", swatches: () => [NEUTRAL_CHART] },
];

function Block({ block }) {
  const [kind, value] = block;
  if (kind === "p") return <p>{value}</p>;
  // The mapping, stated once, where someone confused will look for it —
  // and drawn from the engine's own constants, so a legend that disagrees
  // with the app is not a thing that can happen.
  if (kind === "legend") {
    const dark = getDeviceTheme(null) === "dark";
    return (
      <dl className="space-y-2">
        {LEGEND.map((row) => (
          <div key={row.key} className="flex items-baseline gap-2.5">
            <span className="flex gap-0.5 shrink-0 self-center">
              {row.swatches(dark).map((hex) => (
                <span key={hex} className="h-3 w-3 rounded-sm" style={{ backgroundColor: hex }} />
              ))}
            </span>
            <dt className="font-medium shrink-0">{row.name}</dt>
            <dd className="text-gray-500">{row.hint}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (kind === "note") {
    return (
      <p className="text-xs bg-gray-50 dark:bg-gray-800/60 border-l-2 border-gray-300 dark:border-gray-700 rounded-r-lg px-3 py-2 text-gray-600 dark:text-gray-400">
        {value}
      </p>
    );
  }
  if (kind === "steps") {
    return (
      <ol className="space-y-1.5">
        {value.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="shrink-0 h-5 w-5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-medium flex items-center justify-center tabular-nums">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className="space-y-2.5">
      {value.map(([term, def], i) => (
        <div key={i}>
          <dt className="font-medium text-gray-900 dark:text-gray-100">{term}</dt>
          <dd className="text-gray-600 dark:text-gray-400">{def}</dd>
        </div>
      ))}
    </dl>
  );
}
