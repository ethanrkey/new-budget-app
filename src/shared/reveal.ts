// Where to scroll so a tapped day's card sits right, on both clients.
//
// THE TARGET IS THE LOWEST SCROLL POSITION AT WHICH THE WHOLE CARD IS
// VISIBLE, and zero if it fits with the page at the top. The owner's
// rule, 2026-11-02 (OTA 22). The first version (OTA 20) only ever
// scrolled DOWN, by the overflow: going from a busy day to a short one
// left you scrolled down past a calendar that no longer needed it. Now
// the move goes either way, so a short card glides the page back up
// until the grid is in view again.
//
// A CARD TALLER THAN THE VIEW cannot be wholly visible anywhere, so
// its TOP is aligned with the view's: the head of the card says which
// day it is, and the rest is one swipe away.
//
// PURE, so tests/calendar.test.mjs can ask it questions. `offset` is
// the current scroll position; the boxes are measured in the same
// space as each other (window points or pixels), at that offset.
export function revealTarget(
  offset: number,
  card: { top: number; bottom: number },
  view: { top: number; bottom: number },
): number {
  const room = view.bottom - view.top;
  if (card.bottom - card.top > room) return Math.max(0, offset + card.top - view.top);
  return Math.max(0, offset + card.bottom - view.bottom);
}
