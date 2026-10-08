// The About page's words, and the ONE copy of them.
//
// This is data, not a component: no React, no styling, no platform. Both
// clients render it — the web as a sidebar and a panel, the phone as a
// chip row and a full screen — and neither owns the text. Two copies of
// an explanation is how an explanation goes stale on one platform, and
// this project has already paid for that lesson with screenshots and a
// README.
//
// Block kinds the renderers must handle:
//   ["p", string]              a paragraph
//   ["note", string]           an aside, quieter
//   ["dl", [[term, def], ...]] a definition list
//   ["steps", [string, ...]]   an ordered list
//   ["legend"]                 the color legend, drawn from palette.ts by
//                              each client, because the swatches are live
//                              values rather than copy
export type AboutBlock =
  | ["p", string]
  | ["note", string]
  | ["dl", [string, string][]]
  | ["steps", string[]]
  | ["legend"];

export interface AboutSection {
  id: string;
  title: string;
  body: AboutBlock[];
}

export const ABOUT_SECTIONS: AboutSection[] = [
  {
    id: "idea",
    title: "The idea",
    body: [
      ["p", "The app keeps two things apart on purpose: what you PLAN, and what actually HAPPENED."],
      ["dl", [
        ["Forecast — Ledger and Budget", "Built entirely from your rules and one-offs. It projects your checking balance forward. It's a prediction, and it says so."],
        ["Reality — Dashboard and Spending", "Built entirely from numbers you logged yourself: your verified bank balance, what's really in each account, what a variable bill really cost."],
      ]],
      ["p", "Nothing blends the two. The Dashboard never shows a projected checking balance, and the Ledger never pretends a projection is confirmed. When the two disagree, that gap is the useful information."],
      ["note", "On a computer you can drag the four tabs into whatever order you like — the app remembers it and opens on whichever one you put first. (Touch drags are left alone so a scroll can't shuffle them.)"],
    ],
  },
  {
    id: "balance",
    title: "Your checking balance",
    body: [
      ["p", "The bar under the header shows your checking balance and the date you last verified it against your bank. Everything in the Ledger is projected forward from exactly that point."],
      ["steps", [
        "Open your bank, look at the real number.",
        "Hit Update balance, type it in, set the date, Confirm.",
      ]],
      ["p", "Two things happen: the anchor moves, and the number is saved to your balance history (the chart on the Dashboard's Checking card). Do it whenever you think of it — weekly is plenty."],
      ["note", "Transactions dated BEFORE that verified date are dropped from the projection rather than counted again. That money is already inside the number you typed."],
    ],
  },
  {
    id: "adding",
    title: "Adding money in and out",
    body: [
      ["p", "+ Add transaction opens the editor. Two shapes:"],
      ["dl", [
        ["Recurring", "Something that repeats — a paycheck, rent, a subscription. Pick a cadence (weekly, biweekly, monthly, yearly), a start date, and optionally an end date."],
        ["One-time", "A single dated thing — a flight, a bonus, a car repair."],
      ]],
      ["p", "Every item picks a category, and the category decides what it means:"],
      ["dl", [
        ["Income", "Money in."],
        ["Bill", "Money out, spent."],
        ["One-off", "Money out, one time."],
        ["One of your own categories", "Money out, but into something you own or owe — savings, a Roth IRA, a loan. These get tracked on the Dashboard. When you add one you'll be asked whether it's cash you control or market-exposed; that's what decides whether it gets a projected line, and only you can answer it."],
      ]],
      ["p", "⚡ Quick entry is the same form without the modal closing between items — the fast way to type in a dozen bills at once."],
    ],
  },
  {
    id: "ledger",
    title: "Ledger",
    body: [
      ["p", "Every projected transaction, in date order, with a running balance. Grouped by month."],
      ["dl", [
        ["Project through", "How far out to run the projection, up to a year. The Ledger is a near-term guide; the Budget tab is where a longer projection lives, and it has its own slider that runs further."],
        ["Cumulative columns", "Pick which of your categories get a running column, so you can watch a fund build up — or a loan come down — alongside your checking balance."],
        ["Select", "Multi-select rows and delete them in one go."],
        ["Click any item name", "Edit it. For a recurring item you choose what you're changing: just that date, or every time. It starts on \"This date\", so a one-month fix can't quietly rewrite all twelve."],
      ]],
      ["p", "Changing one date gives that occurrence its own amount — Electric is $112 most months but $180 in July — and the row is marked “· edited” so an amount that disagrees with its rule doesn't look like a bug. Editing the rule later never wipes those; your July stays $180. Moving the rule to a different day of the month does drop them, because an override belongs to a date, and the form tells you how many before you save."],
      ["p", "Each cumulative column is labeled with the category it tracks, and sized to fit that name — two loans called “Student Loan AA” and “Student Loan AB” stay tellable apart."],
      ["p", "“List” and “Calendar” show the same transactions two ways. The calendar is a month grid: a colored dot per transaction, the day's net, and a click on any day for the detail. The running balance only appears in the list — a month grid has nowhere to put it, and rather than fake one the calendar leaves it out."],
      ["p", "“Planned spending” at the top breaks the window down by category — pie or bar, your choice, and it follows the horizon slider. It is the forecast: your rules, with income left out. It is not a record of what you actually spent; that comparison lives on the Spending tab."],
      ["p", "Bills and one-offs are always shown as the individual transactions inside them, never as one slice: \"Fixed bills\" is just where anything you didn't categorize lands, so a wedge labeled that tells you nothing. The categories you made yourself stay whole. Each broken-out slice keeps its bucket's name beside it, like \"Rent · Fixed bills\"."],
      ["p", "Past eight slices the rest fold into \"Other\" so the chart stays readable. Click it to see what's in there — the bar chart opens the rows in place, and the pie lists them beside the chart without redrawing the wedge. Either way the \"Other\" line is replaced by its parts, with a link to fold them back."],
    ],
  },
  {
    id: "budget",
    title: "Budget",
    body: [
      ["p", "The same data as a month-by-month grid. One column per month, one row per thing."],
      ["dl", [
        ["Take-home", "Every paycheck that actually lands in that month. A three-paycheck month shows three — that's the whole reason this row is computed rather than typed."],
        ["Starting point", "What you carry in from the month before."],
        ["Sections", "Income, fixed/recurring, one-off, and saving/debt clustered by category."],
        ["Monthly net / cumulative net", "What the month does to you, and where that leaves you."],
      ]],
      ["p", "Rows can be dragged or arrow-moved within their section. Click a row name to edit that item."],
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    body: [
      ["p", "The reality layer: what you actually have, based only on numbers you logged."],
      ["dl", [
        ["Net position", "Verified checking + the last logged balance of every savings/investment − the last logged balance of every loan. Anything you haven't logged yet is counted as unlogged, never as zero. Collapse it with the arrow if you'd rather not see it first thing — each device remembers that on its own."],
        ["Checking card", "Your verified balance and its history."],
        ["Savings / investment cards", "The balances you logged, as one line, plus what you've actually contributed — logged one contribution at a time with “Log contribution”, never added up from the ledger (that would be what you PLANNED to put in). An account you never log just shows a dash; that's fine, and honest, for something like a 401k you never see the money go into."],
        ["Loan cards", "What you owe, how much of the original you've paid off, the terms, and this month's planned payment. Debt starts collapsed into a single card — a total and a list of your loans — and expands into a card each when you want the detail. Each device remembers which way you left it."],
      ]],
      ["note", "Loan cards are the one place a dashed predicted line appears, because amortization is real math about a known quantity — what you owe, the rate, and the payments you've planned."],
    ],
  },
  {
    id: "accounts",
    title: "Savings and investment accounts",
    body: [
      ["p", "“+ Add account” on the Dashboard sets one up: a name, whether it's savings or an investment, and what's in it today. That opening balance becomes the first point in its history — the anchor every projection measures from."],
      ["steps", [
        "Add the account.",
        "Add a transaction for the money going into it, and pick the account as its category.",
        "Log the real balance whenever you check it — Log balance on the card.",
      ]],
      ["p", "Every logged balance and contribution is editable and deletable afterwards, under “Show history” / “Show contributions”. Fat-finger a number and you can just fix it."],
      ["p", "“Edit” on a card renames it, recolors it, and is where deleting lives. Deleting tells you how many transactions are tagged to it first — those are scheduled, so they stay in your ledger as uncategorized rather than vanishing and quietly changing your forecast."],
    ],
  },
  {
    id: "loans",
    title: "Loans and debt",
    body: [
      ["p", "A loan is its own category, exactly like a savings account — it exists whether or not you're paying on it right now. “+ Add loan” asks for:"],
      ["dl", [
        ["Original amount and APR", "Used to amortize: interest accrues daily against what you currently owe."],
        ["Interest starts (optional)", "For a loan that accrues nothing until a set date — a student loan in its grace period. Before that date, payments cut the principal dollar for dollar."],
        ["Current outstanding balance", "What you owe today. Everything projects from here."],
      ]],
      ["p", "Payments are ordinary transactions that pick the loan as their category — set up as many as you like, or none. Setting up a loan never creates a payment for you."],
      ["p", "Adding a loan from the collapsed debt card expands the section as well, so you can see the one you just added — it goes on the end."],
      ["note", "Loan cards show percent paid off, never “expected remaining vs. actual remaining.” That comparison only scolds, and it's wrong the moment you make an extra payment."],
      ["p", "If interest has pushed a loan above what you borrowed — normal for an unsubsidized loan before payments start — the card says so plainly (“$2,302.73 owed · $2,000.00 borrowed · $302.73 accrued interest”) instead of showing a percentage of a number you've already passed. The bar measures against the most you've ever owed, and never moves backwards."],
    ],
  },
  {
    id: "spending",
    title: "Variable spending",
    body: [
      ["p", "Groceries aren't $420 every month. For bills like that, turn on “Track actual vs. budgeted” in the item's editor. The item then appears on the Spending tab with a row per month."],
      ["p", "Log the real total whenever you know it — no need to tie it to a date or split it across trips. Logging it does NOT change your Ledger or Budget: those always show what your rule says. This tab is purely the comparison between the two."],
      ["p", "Clear the field to remove a logged amount. Nothing here is permanent."],
    ],
  },
  {
    id: "categories",
    title: "Your categories",
    body: [
      ["p", "Your categories are your own buckets: Emergency fund, Roth IRA, Brokerage, Car loan, anything. Settings → Categories to rename, reorder, or delete them, or add one without an opening balance."],
      ["p", "Each one is one of three kinds, and the kind decides both what its card shows and what color it gets everywhere in the app. You don't pick a color — see “What the colors mean”."],
      ["dl", [
        ["Savings", "Cash you control. Its card shows the balance you log and what you've contributed."],
        ["Investment", "Value the market moves — a Roth IRA, a 401k, a brokerage, an HSA. Same card, but no projected line: projecting a market is guessing. An account you never touch is still market-exposed."],
        ["Debt", "Something you owe. Its card shows what's left and progress against what you borrowed."],
      ]],
      ["p", "Savings or investment is the one thing the app can't work out for you, so it asks. Deleting a category doesn't touch existing transactions; they keep their history and show as uncategorized."],
    ],
  },
  {
    id: "colors",
    title: "What the colors mean",
    body: [
      ["p", "Color does three jobs here and they don't overlap. Nothing is chosen by you, and nothing is a code you have to learn — the words on screen always say what a thing is."],
      ["legend"],
      ["p", "The spending chart is one color because it is answering one question: how does this window divide up? In the pie the four biggest shares run darkest to lightest and everything else is one gray “Other” — four steps is as many as one color can keep clearly apart, so the chart shows four rather than pretending to show nine. The bar is the full list and keeps every row."],
      ["p", "On the Dashboard, each savings or investment card gets its own color so you can find the one you were reading. That's all it means — it's assigned by the card's position, not by what the account is. Loans share a plain gray, and your checking account has no color at all."],
      ["note", "Red and green are the only colors that mean something: green is money coming in, red is money going out. Money you moved to savings, put into an investment, or paid against a loan stays plain — it left your checking account, but it isn't gone."],
    ],
  },

  {
    id: "settings",
    title: "Settings",
    body: [
      ["dl", [
        ["Appearance", "Light or dark, remembered PER DEVICE — light on the laptop and dark on the phone is a normal thing to want, so the choice doesn't sync."],
        ["Categories", "The manager described above."],
        ["Account", "Who you're signed in as, how you signed in, and when you joined — plus Sign out. Signing out leaves your data on the server, tied to your account."],
        ["Delete my account", "Schedules your whole account for deletion in 7 days — the sign-in, every rule, every logged balance. You can cancel any time before then from the same place. After that it's gone and there's no backup to restore from."],
        ["Wipe data", "Resets your account to brand new — every rule, category, logged balance and contribution, and your verified balance back to $0.00 — behind a full confirmation that lists it all. You'll get the welcome wizard again afterwards. Export a backup first."],
      ]],
    ],
  },
  {
    id: "backup",
    title: "Import, export, backup",
    body: [
      ["dl", [
        ["Export → CSV", "The Ledger or the Budget grid as a spreadsheet."],
        ["Export → Full backup (JSON)", "Everything: items, categories, every logged balance, every monthly actual, settings. This is the one that's actually a backup."],
        ["Import → CSV", "A budget grid or a per-transaction export. It detects recurrence from repeated amounts and dates, and tells you what it guessed. It brings in items only — importing never changes your verified balance, because a file can't tell you when you checked it."],
        ["Import → Restore backup", "Replaces your data with a JSON backup — and downloads a copy of your current data first, automatically, before it touches anything."],
      ]],
      ["note", "Take a backup before anything drastic. It's one click and it has saved this project before."],
      ["p", "On more than one device: the app loads your data when you open it, so a phone that's been sitting open since yesterday is showing yesterday's copy. It can't overwrite newer data with it — if it tries, it tells you, reloads the current version, and keeps what was on the device as a downloadable copy. Switching back to the app also re-checks for you."],
    ],
  },
];
