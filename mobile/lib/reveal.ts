// How far to scroll so a box is fully on screen, and no further.
//
// Asked for on 2026-11-02 for the Ledger calendar: tapping a day near
// the bottom of the grid put its card under the floating tab bar, and
// the owner wanted "just enough that the whole day card is visible
// above the tab bar. If it already fits, don't move."
//
// PURE, so tests/calendar.test.mjs can ask it questions without a
// renderer. Every number is in the same space (window points); the
// caller measures both boxes with measureInWindow.
//
//   0         the box already fits: do not move
//   positive  scroll DOWN by that much (the box hangs off the bottom)
//   negative  scroll UP by that much (its top is above the view)
//
// A box taller than the view cannot fit, so its TOP is what is brought
// into view: the head of the card says which day it is, and the rest
// is one swipe away.
export function revealDelta(box: { top: number; bottom: number }, view: { top: number; bottom: number }): number {
  const room = view.bottom - view.top;
  if (box.bottom - box.top > room) return box.top - view.top;
  if (box.top < view.top) return box.top - view.top;
  if (box.bottom > view.bottom) return box.bottom - view.bottom;
  return 0;
}
