import { useEffect, useState } from "react";
import { TOUR_STOPS as STOPS } from "../content/tour.ts";

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
// ORDER: Ledger first, Dashboard LAST. The thing a new user has to
// understand is the relationship — the Ledger and Budget are their PLAN,
// the Dashboard is where they actually STAND — and ending on the
// Dashboard leaves them on the screen they will open tomorrow.
//
// Both halves work on day one. What takes time is seeing where they stand
// OVER time, which needs a few logged balances. So the Dashboard is not
// broken on day one; it is showing a snapshot instead of a trend, and the
// copy says exactly that rather than leaving an empty chart to be read as
// a defect.

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
    <>
      {/* A SCRIM. The first version was a small card at the bottom of a
          Ledger the user had never seen, which asks them to work out
          both what they are looking at AND that the card is the thing to
          read. Dimming everything else answers the second question so
          they only have to deal with the first. Still shows the tab
          underneath, because the point is to point AT something. */}
      <div className="fixed inset-0 bg-black/55 z-40" onClick={onClose} aria-hidden="true" />

      <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-6">
        <div className="w-full mx-auto max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
              Step {i + 1} of {STOPS.length}
            </span>
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              Skip the tour
            </button>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">{stop.title}</h2>
          <p className="text-[15px] text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">{stop.body}</p>

          <div className="flex items-center gap-3 mt-5">
            <div className="flex gap-1.5 grow" aria-hidden="true">
              {STOPS.map((_, n) => (
                <span
                  key={n}
                  className={`h-1.5 rounded-full transition-all ${n === i ? "w-6 bg-gray-900 dark:bg-white" : "w-1.5 bg-gray-300 dark:bg-gray-700"}`}
                />
              ))}
            </div>
            {i > 0 && (
              <button onClick={() => setI((n) => n - 1)} className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700">
                Back
              </button>
            )}
            <button
              onClick={() => (last ? onClose() : setI((n) => n + 1))}
              className="text-sm px-5 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-semibold"
            >
              {last ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
