import { useEffect, useState } from "react";

// A walkthrough, as distinct from the reference page About replaced.
//
// The old "Tutorial" was an explanation — valuable when you are confused
// and useless as a first experience, because reading about four tabs is
// not the same as being taken to them. This takes you to each tab in turn
// and says what it is for while you are looking at it.
//
// Deliberately NOT a true spotlight with cut-outs and element measuring:
// that needs every target to expose a ref and breaks whenever a layout
// moves. Switching the tab and putting a card over it teaches the same
// thing and cannot be broken by a CSS change.
const STOPS = [
  {
    tab: "dashboard",
    title: "This is your Dashboard",
    body: "What's actually true right now. Your net position, your verified checking balance, and every account you track — with the balances you log yourself.",
  },
  {
    tab: "ledger",
    title: "This is the Ledger",
    body: "Every transaction you expect, dated, with a running balance. It's the forecast: built from your rules, so you can see a shortfall before you reach it.",
  },
  {
    tab: "budget",
    title: "This is the Budget",
    body: "The same forecast month by month — income against outflow, projected as far out as you want.",
  },
  {
    tab: "spending",
    title: "And this is Spending",
    body: "Where what you planned meets what actually happened, for the bills that move. Log a real total and this is where the comparison lives.",
  },
];

export default function GuidedTour({ onGoToTab, onClose }) {
  const [i, setI] = useState(0);
  const stop = STOPS[i];

  // Take them to the tab the card is talking about, as the card appears.
  useEffect(() => { onGoToTab(stop.tab); }, [i, stop.tab, onGoToTab]);

  // Escape dismisses, like every other overlay in the app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const last = i === STOPS.length - 1;
  return (
    // Bottom-anchored on purpose: the tab row and the content it describes
    // are above, and a centred modal would cover the thing being pointed at.
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-6 pointer-events-none">
      <div className="w-full mx-auto max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl p-4 pointer-events-auto">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{stop.title}</h2>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0">
            Skip
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">{stop.body}</p>

        <div className="flex items-center gap-3 mt-4">
          <div className="flex gap-1.5 grow" aria-hidden="true">
            {STOPS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-gray-900 dark:bg-white" : "w-1.5 bg-gray-300 dark:bg-gray-700"}`}
              />
            ))}
          </div>
          {i > 0 && (
            <button onClick={() => setI((n) => n - 1)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700">
              Back
            </button>
          )}
          <button
            onClick={() => (last ? onClose() : setI((n) => n + 1))}
            className="text-sm px-4 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
          >
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
