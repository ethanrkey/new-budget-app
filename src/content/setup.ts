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
  },
  bills: {
    title: "Any other monthly bills?",
    sub: "Phone, internet, subscriptions, memberships — anything that's roughly the same amount every month. Set the day each one is due; it defaults to today.",
    add: "+ Add another bill",
  },
  groceries: {
    title: "About how much do you spend on groceries?",
    sub: "A rough estimate is fine — you can always adjust it later.",
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
  done: {
    title: "All set!",
    withRules: (n: number) =>
      `We've added ${n} recurring item${n === 1 ? "" : "s"} to get you started. You can edit, delete, or add more anytime.`,
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
export const ACCOUNT_GROUPS: readonly {
  key: "savings" | "investment" | "debt";
  label: string;
  kindNote: string;
  placeholder: string;
}[] = [
  { key: "savings", label: "Savings", kindNote: "Cash you control — saved as Savings", placeholder: "e.g. Everbank" },
  { key: "investment", label: "Investments", kindNote: "Value the market moves — saved as Investment", placeholder: "e.g. Roth IRA, 401k, HSA" },
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
 */
export const SETUP_STEPS = ["paycheck", "rent", "bills", "groceries", "balance", "accounts"] as const;
export type SetupStepKey = typeof SETUP_STEPS[number];
