// The setup wizard's words, and the ONE copy of them.
//
// Same rule as src/content/about.ts and src/content/tour.ts: this is
// data, not a component. The web draws it as a modal with a progress
// bar; the phone draws it as a full-screen flow with a step counter.
// Neither owns the text.
//
// WHY THIS FILE EXISTS NOW rather than when the wizard was written.
// The strings sat at the top of Onboarding.jsx under "Draft copy —
// expected to be edited", which was fine while there was one client.
// The phone's flow asks the same six questions, so without this file
// the voice pass would have to find and match two copies of every
// sentence — and a sentence edited on one side only is how the two
// clients start describing the same app differently.
//
// PLATFORM VARIANTS are explicit and rare. A string differs between
// clients only when it names a control that genuinely differs, and
// then it is a {web, mobile} pair so the difference is visible in the
// copy rather than hidden in a component. There is exactly one today:
// the paycheck note pointed at Quick Entry, which the phone does not
// have and (decided 2026-10-12) is not getting.

/** A string that has to differ because the two clients differ. */
export interface PlatformText { web: string; mobile: string }
export type SetupPlatform = keyof PlatformText;

export const SETUP_COPY = {
  paycheck: {
    title: "What's your take-home pay?",
    sub: "We'll set this up as a recurring paycheck so your Ledger and Budget stay current on their own.",
    // ASKED, NOT ASSUMED. Setup used to start the paycheck today,
    // which is wrong in both directions: paid this morning and the
    // money is already in the balance on the next step, so it gets
    // counted twice; paid next Friday and every projected date is off
    // by a week.
    paydayLabel: "When's your next payday?",
    paydayHelp: "Not the last one — the next one. If you were paid today, say today.",
    note: {
      web: "Have more than one income source (a second job, side income, a partner's paycheck)? Add just one here — you can add the rest afterward with Quick Entry or the + Add button.",
      mobile: "Have more than one income source (a second job, side income, a partner's paycheck)? Add just one here — you can add the rest afterward with + Add on the Ledger.",
    } as PlatformText,
  },
  rent: {
    title: "What's your rent or mortgage?",
    sub: "This becomes a recurring bill so it shows up every month without re-entering it.",
    // A QUESTION, not a two-word column heading. "Due on day" beside a
    // number box was the label when the box was a number box; now that
    // it is a picker with the day already in it, the row has to say
    // what the day is FOR or it reads as something already answered.
    dayLabel: "What day of the month is your rent due?",
  },
  bills: {
    title: "Any other monthly bills?",
    sub: "Phone, internet, subscriptions, memberships — anything that's roughly the same amount every month. Set the day each one is due; it defaults to today.",
    add: "+ Add another bill",
  },
  groceries: {
    title: "About how much do you spend on groceries?",
    sub: "A rough estimate is fine — you can always adjust it later.",
    // A DAY OF THE WEEK, not a date. Shopping is the one thing setup
    // asks about that genuinely happens on a Saturday rather than on
    // the 23rd, and the rule used to start on whatever day setup was
    // run — so a Sunday shopper who set up on a Wednesday got a
    // Wednesday series forever.
    dayLabel: "Which day do you usually shop?",
  },
  balance: {
    title: "What's the balance of your primary checking account?",
    sub: "This is your starting point — everything else projects forward from here.",
    // Shown while the field is empty, because this is the one step
    // that cannot be skipped and the reason has to be on screen
    // rather than implied by a disabled button.
    why: "Enter the number your bank shows right now — even if it's 0. Everything in the Ledger is counted forward from it, so the forecast is wrong without it.",
  },
  accounts: {
    title: "What else do you track?",
    sub: "These accounts are what will show on your dashboard, which is the page where you see your full current financial picture. These can be added and updated at any time whenever needed.",
    add: "+ Add another",
    // Both halves of a row are required once either is filled in. The
    // alternative — inventing a name from the section heading — would
    // create a category the user never named.
    needsName: "Give this one a name, or clear the amount.",
    needsAmount: "Add the balance, or clear the name.",
  },
  // A STEP OF ITS OWN, and only when there is something to list. See
  // the long note in src/engine/setup.ts: the accounts step asks what
  // you have, this one asks what you are doing about it, and the
  // first is worth answering even when the second is skipped.
  contributions: {
    title: "Are you putting money in regularly?",
    sub: "Set up a transfer or payment for any of these and it will show up in your Ledger and Budget on its own. Leave anything blank to skip it.",
    // EVERY CADENCE, since 2026-10-15. This was "Payment day" and was
    // shown only for a monthly contribution; weekly and biweekly ones
    // silently started on the day setup was run, which put a $400
    // savings transfer on the same date as the balance it is counted
    // forward from. The paycheck step learned this already.
    startLabel: "First contribution",
    // Debt says "payment" for the same reason contributionName does:
    // it is the word for it, and the row has to read next to a
    // month's other bills.
    startLabelDebt: "First payment",
    amountFor: (name: string) => `Into ${name}`,
    owedFor: (name: string) => `Toward ${name}`,
  },
  done: {
    title: "All set!",
    // "YOU'VE", NOT "WE'VE", 2026-10-15. The user answered six
    // questions; the app turned the answers into rules. Taking credit
    // for that on the finish screen is the one place the app would
    // sound like it did the work, and it is the screen where the
    // person has just done the most.
    withRules: (n: number) =>
      `You've added ${n} recurring item${n === 1 ? "" : "s"} to get you started. You can edit, delete, or add more anytime.`,
    withoutRules: "No problem — you can add everything yourself whenever you're ready.",
    cta: "Go to my budget",
  },
  labels: {
    amount: "Amount",
    cadence: "How often?",
    dueDay: "Due on day",
    dueDayShort: "Due day",
    name: "Name",
    balance: "Balance",
    owedNow: "Owed now",
    currentBalance: "Current balance",
  },
  buttons: {
    skipAll: "Skip setup",
    skip: "Skip",
    continue: "Continue",
    finish: "Finish",
  },
} as const;

/** Resolve the one string that differs between the two clients. */
export function platformText(t: PlatformText, platform: SetupPlatform): string {
  return t[platform];
}

// Sunday first, like every calendar on the phone this runs on, and
// `value` is Date.getDay() so nothing has to translate it. Short
// labels because seven of them share one row at 390px.
export const WEEKDAY_OPTIONS: readonly { value: number; label: string; full: string }[] = [
  { value: 0, label: "Sun", full: "Sunday" },
  { value: 1, label: "Mon", full: "Monday" },
  { value: 2, label: "Tue", full: "Tuesday" },
  { value: 3, label: "Wed", full: "Wednesday" },
  { value: 4, label: "Thu", full: "Thursday" },
  { value: 5, label: "Fri", full: "Friday" },
  { value: 6, label: "Sat", full: "Saturday" },
];

// 1 to 31, and the engine clamps anything else — see clampDay in
// src/engine/setup.ts. Both clients draw a control that cannot express
// a 50th of the month, which is the reason this list exists rather
// than a `min`/`max` pair on a number box: build 8 let somebody type
// 50, clamped it to 31 behind their back, and said nothing.
export const DAY_OPTIONS: readonly number[] =
  Array.from({ length: 31 }, (_, i) => i + 1);

export const CADENCE_OPTIONS: readonly { value: "weekly" | "biweekly" | "monthly"; label: string }[] = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
];

// One screen, three groups — not three steps. The obvious version of
// this takes the wizard from five questions to eight and people leave;
// someone with nothing to add passes it in a second.
//
// Balance only, no terms, and that is the important call for debt: a
// loan wants principal, APR and a start date, and asking three numbers
// per loan during setup is exactly where someone gives up. Name and
// what you owe now is enough for the category, the Dashboard card and
// the net position. The card asks for terms later, when there is
// something to point at. (Decided twice, 2026-10-11 and again before
// the phone's flow was built: loan terms stay out of setup on BOTH
// clients.)
//
// INVESTMENTS FIRST, then Savings, then Debt — the owner's call from
// build 9's device pass, 2026-10-15. The order here is the order the
// step asks in AND the order the categories are created in: the
// engine walks SETUP_GROUPS, and tests/setup.test.mjs asserts the two
// lists agree, because content cannot import from the engine and the
// engine must not import copy.
//
// EVERY PLACEHOLDER NAMES A KIND OF THING, NEVER A BRAND. Savings
// named the owner's own bank until 2026-10-15 — a placeholder
// suggesting where to keep your money rather than what to call it,
// and in a shipped app a real institution's name it has nothing to do
// with. "Emergency fund" is the same shape as the other two.
export const ACCOUNT_GROUPS: readonly {
  key: "savings" | "investment" | "debt";
  label: string;
  kindNote: string;
  placeholder: string;
}[] = [
  { key: "investment", label: "Investments", kindNote: "Value the market moves — saved as Investment", placeholder: "e.g. Roth IRA, 401k, HSA" },
  { key: "savings", label: "Savings", kindNote: "Cash you control — saved as Savings", placeholder: "e.g. Emergency fund" },
  { key: "debt", label: "Debt", kindNote: "What you owe now — add the rate later on the card", placeholder: "e.g. Student loan" },
];

/**
 * The questions, in order, and the one ordering decision in the flow.
 *
 * "accounts" comes AFTER the balance on purpose. Everything up to the
 * balance is what a working Ledger needs; the accounts step only fills
 * the Dashboard. Ordering it last means someone who quits there still
 * leaves with the forecast working, which is the thing that makes the
 * app worth reopening.
 *
 * "contributions" comes after accounts for the same reason and one
 * more: it can only ask about accounts that step produced. It is
 * SKIPPED ENTIRELY — not shown, not counted in "step N of M" — when
 * nothing was entered there, because a step listing nothing makes the
 * flow look longer than it is.
 */
export const SETUP_STEPS = [
  "paycheck", "rent", "bills", "groceries", "balance", "accounts", "contributions",
] as const;
export type SetupStepKey = typeof SETUP_STEPS[number];

/**
 * The Dashboard's follow-up, which asks setup's contributions
 * question about ONE account right after it is added.
 *
 * Same words where they are the same question — the amount and day
 * labels come from SETUP_COPY.contributions — and its own title,
 * because "Are you putting money in regularly?" over a single
 * account reads as a survey rather than as an offer.
 *
 * DISMISSIBLE, and the dismissal is a real button rather than an X in
 * a corner: this is an offer, and an offer with no visible way to
 * decline is a demand.
 */
export const CONTRIBUTION_PROMPT = {
  title: (name: string) => `Put money into ${name} regularly?`,
  sub: "Set up a recurring transfer and it will show up in your Ledger and Budget on its own. You can add or change this any time.",
  debtSub: "Set up a recurring payment and it will show up in your Ledger and Budget on its own. You can add or change this any time.",
  add: "Schedule it",
  skip: "Not now",
} as const;
