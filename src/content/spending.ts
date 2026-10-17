// The Planned spending panel's words, and the ONE copy of them.
//
// Same rule as tour.ts, setup.ts and calendar.ts: the web draws a
// collapsible panel of horizontal bars and the phone draws a
// collapsible panel of horizontal bars. The sentence under the
// heading was written out twice, which is how it came to say
// "Projected from your rules for … — not what you've logged. Income
// is excluded." in both places: three claims, two of them about what
// the panel is NOT.
//
// The owner's replacement, 2026-10-17, is one claim about what it is.
export const SPENDING_COPY = {
  caption: (from: string, to: string) =>
    `Projected spending based on the transactions you've entered from ${from} – ${to}.`,
  empty: "Nothing going out in this window yet.",
} as const;
