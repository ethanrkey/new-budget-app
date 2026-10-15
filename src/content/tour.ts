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
  // SPELLED OUT, 2026-10-15, from the owner's own first run: "the
  // Dashboard's value isn't obvious right after setup". The old copy
  // said what the screen is NOT (not a forecast) and named net
  // position, which is a term you have to already know. This one
  // lists the four things on it and says what the second reading
  // buys. DRAFT — the owner finalizes it in the voice pass.
  {
    tab: "dashboard",
    title: "And the Dashboard is your whole picture",
    body: "Everything you have and everything you owe, on one screen: checking, savings, investments and debt, and what they come to together. Nothing here is projected — it's what's true today, built only from balances you've logged. Log them again next month and the same screen starts showing which way each one is going.",
  },
];
