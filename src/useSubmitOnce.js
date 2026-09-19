import { useCallback, useRef, useState } from "react";

// ---- One submit per modal, ever ----
// A modal's submit handler closes the modal by setting state, which only takes
// effect on the NEXT render. Every additional fire that lands before that
// render runs the handler again — and these handlers append: a balance
// snapshot, a contribution, a category with a fresh uid(), a transaction with
// a fresh uid(). The result is silent duplicates.
//
// This is not theoretical. Three identical checking-balance snapshots turned up
// in real data, and the cause reproduces exactly: three Confirms landing before
// the re-render produce three identical rows. Holding Enter does it (the key
// auto-repeats), and so does clicking twice when the render is slow — the real
// dashboard re-renders a full Recharts grid, so the race is much easier to lose
// there than anywhere it would be noticed in testing.
//
// The ref is what actually guards: state updates are async, a ref is immediate,
// so even fires within a single tick see it. `submitted` is only for disabling
// the button. Both reset on unmount, which is what makes "once per modal
// opening" the unit — reopening the modal gives a fresh guard.
//
// NOT for repeated-entry surfaces: QuickEntry is deliberately designed to add
// item after item without closing, so a once-guard there would break it.
export function useSubmitOnce(fn) {
  const fired = useRef(false);
  const [submitted, setSubmitted] = useState(false);

  const run = useCallback(
    (...args) => {
      if (fired.current) return;
      fired.current = true;
      setSubmitted(true);
      fn(...args);
    },
    [fn]
  );

  return [run, submitted];
}
