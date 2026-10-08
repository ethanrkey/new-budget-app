// The guided tour's stops, and the ONE copy of them — same reasoning as
// src/content/about.ts. The web routes to a tab and draws a card over a
// scrim; the phone routes to a route and draws a card over a scrim. The
// words are the same words.
export interface TourStop {
  /** Which tab to show behind the card. Matches the tab ids both clients use. */
  tab: "ledger" | "budget" | "spending" | "dashboard";
  title: string;
  body: string;
}

export const TOUR_STOPS: TourStop[] = [
  {
    tab: "ledger",
    title: "This is the Ledger — your plan",
    body: "Every transaction you expect, dated, with a running balance. It's built from the rules you just entered, so you can see a shortfall weeks before you reach it.",
  },
  {
    tab: "budget",
    title: "The Budget is the same plan, by month",
    body: "Income against outflow, projected as far out as you want. Same numbers as the Ledger — one is day by day, the other month by month.",
  },
  {
    tab: "spending",
    title: "Spending is plan against reality",
    body: "For bills that move — groceries, electric — log what you actually spent and this is where the two get compared.",
  },
  {
    tab: "dashboard",
    title: "And the Dashboard is where you stand",
    body: "Not a forecast: what's actually true right now. Your net position, your checking balance, and each account's balance as you log it. It works from day one — the charts just need a second reading before they can show a direction.",
  },
];
