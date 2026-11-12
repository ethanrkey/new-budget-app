// THE CALENDAR'S MONTH SWIPE, the decisions only (2026-11-11).
//
// Pure, so the rules can be asked questions without a finger: when a
// drag counts as a horizontal swipe at all, how far past the first or
// last month the grid may be pulled, and where a release lands.
// CalendarView owns the animation; this owns the arithmetic.

/** How far the finger has to move before the grid takes the touch. Under
 *  this a tap is still a tap, and the cell under it gets it. */
export const SWIPE_SLOP = 12;
/** A release past this share of the width turns the page. */
export const TURN_SHARE = 0.2;
/** ...or a flick at least this fast (points per millisecond), however
 *  short. PanResponder's vx is in those units. */
export const FLICK = 0.3;
/** How long a page takes to slide into place: the arrows, and the
 *  rest of a swipe after the finger lets go. */
export const SLIDE_MS = 280;

/**
 * Is this drag a swipe between months?
 *
 * MOSTLY SIDEWAYS, OR IT IS NOT OURS. The calendar sits inside the
 * Ledger's list, which scrolls up and down; a drag that is more
 * vertical than horizontal belongs to that list. The 1.5 keeps a
 * slightly diagonal scroll from turning the month.
 */
export function isMonthSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy) * 1.5;
}

export type DragAxis = "x" | "y" | null;

/**
 * WHICH WAY THIS DRAG IS GOING, decided once (2026-11-11). Until the
 * finger has moved past the slop either way, nothing is decided (null).
 * The first move past it settles the drag for as long as the finger is
 * down: "x" is a month swipe, "y" belongs to the list. Asked by the owner
 * in those words: once a sideways swipe has started, the Ledger must not
 * scroll as the finger drifts, and a drag that starts out vertical stays
 * a scroll however sideways it later wanders. `decided` is the answer
 * already given for this touch; it is kept, whatever the finger does.
 */
export function dragAxis(dx: number, dy: number, decided: DragAxis = null): DragAxis {
  if (decided) return decided;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= SWIPE_SLOP) return null;
  return isMonthSwipe(dx, dy) ? "x" : "y";
}

/**
 * Where the finger has pulled the page, in points, for the month at
 * `index` of `count`. Past the first or last month there is nothing
 * to slide in, so the pull is a third as far: it moves, so it does not
 * feel stuck, but plainly does not want to go.
 */
export function dragOffset(dx: number, index: number, count: number): number {
  const noPrev = index <= 0 && dx > 0;
  const noNext = index >= count - 1 && dx < 0;
  return noPrev || noNext ? dx / 3 : dx;
}

/**
 * The month a release lands on: one either side, or back where it was.
 * Never past either end.
 */
export function releaseTarget(dx: number, vx: number, width: number, index: number, count: number): number {
  const far = Math.abs(dx) > width * TURN_SHARE;
  const fast = Math.abs(vx) > FLICK;
  // A flick against the drag is the finger changing its mind: it decides.
  const dir = fast ? Math.sign(vx) : far ? Math.sign(dx) : 0;
  // Dragging LEFT (dx < 0) brings in the NEXT month.
  const to = index - dir;
  return Math.min(Math.max(to, 0), Math.max(count - 1, 0));
}
