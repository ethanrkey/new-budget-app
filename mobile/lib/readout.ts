/**
 * Where the sparkline's readout sits, horizontally.
 *
 * ONE RULE FOR BOTH STATES, and that is the whole fix. Reported from
 * the build 12 device pass: while scrubbing, the value and date sat
 * centered over the finger and looked right; at rest they floated at
 * a fixed spot to the LEFT of the last point, "so it reads like it
 * belongs to a different point".
 *
 * The cause was that the readout lived in a fixed 150pt box with its
 * text centered inside, and the BOX was clamped rather than the text.
 * At rest the box is pushed up against the right edge, so its centered
 * text ends up about half a box-width short of the point it is
 * labeling — a constant 75pt gap that only disappears when the point
 * happens to be near the middle.
 *
 * So the readout is measured and ITS OWN edges are clamped:
 *
 *   centered on the point, except that it never leaves the plot.
 *
 * Which gives, for free and without a second branch, exactly what was
 * asked for: right-aligned over the last point at rest, left-aligned
 * over the first point when dragged there, centered everywhere else,
 * and continuous in between — no jump as it crosses from one case to
 * the next, because there are no cases.
 *
 * Clamped to the PLOT's bounds rather than the view's. The points
 * themselves are inset by `pad`, so clamping to the view would leave
 * the resting readout `pad` past the dot it belongs to.
 *
 * @param pointX  the point's x, in the same space as `width`
 * @param textW   the readout's measured width; 0 before it is known
 * @param width   the chart's width
 * @param pad     the plot's inset, which is where the end points sit
 */
export function readoutLeft(pointX: number, textW: number, width: number, pad: number): number {
  const min = pad;
  const max = width - pad - textW;
  // THE ORDER OF THE TWO CLAMPS IS THE WHOLE SAFETY. A readout wider
  // than the plot makes `max` smaller than `min`, and the two
  // orderings disagree exactly there: `max(min, min(max, x))` pins it
  // to the left edge, while `min(max, max(min, x))` returns `max` and
  // pushes it off the other side — a readout half off the screen on a
  // narrow phone with a seven-figure balance, which is the case
  // nobody tries.
  //
  // This used to be spelled out as an `if (max <= min) return min;`
  // above the return. The mutation audit found that line surviving
  // every one of 1,900 checks, and the reason was not a missing test:
  // `max(min, ...)` already floors the answer at `min`, so the branch
  // could never change an answer. A guard that cannot fire is a claim
  // the code does not keep, and it hid which line was really doing
  // the work.
  return Math.max(min, Math.min(max, pointX - textW / 2));
}
