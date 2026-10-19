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
    // "THE PLANNED TRANSACTIONS YOU'VE ENTERED", not "the rules you
    // just entered" (2026-10-19). The tour is reachable from About
    // at any time, not only off the end of setup, so "just entered"
    // is wrong for most of the times it is read — and "rules" is
    // the engine's word for them, not the screen's.
    body: "Every transaction you expect, dated, with a running balance. It's built from the planned transactions you've entered, so you can see a shortfall weeks before you reach it. After you finish setup, add any one-off transactions you know are coming up — and keep adding and updating them over time. The forecast is only as accurate as what's in it.",
  },
  {
    tab: "budget",
    title: "The Budget is the same plan, by month",
    body: "Monthly income and outflow. These are the same transactions/numbers from the Ledger. View where all of your money is going each month.",
  },
  {
    tab: "spending",
    title: "Spending is plan against reality",
    body: "For bills that move — groceries, electric — log what you actually spent and this is where you can compare what you had planned on spending vs what actually was spent.",
  },
  // SPELLED OUT, 2026-10-15, from the owner's own first run: "the
  // Dashboard's value isn't obvious right after setup". The old copy
  // said what the screen is NOT (not a forecast) and named net
  // position, which is a term you have to already know. This one
  // lists the four things on it and says what the second reading
  // buys. The last sentence is the owner's own, 2026-10-17.
  {
    tab: "dashboard",
    title: "And the Dashboard is your whole picture",
    body: "Everything you have and everything you owe: checking, savings, investments and debt. Nothing here is projected — it's what's true today, built only from balances you've logged. Log them again whenever and over time the Dashboard screen will show you how these balances have been trending.",
  },
];
