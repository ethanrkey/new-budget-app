import { useState } from "react";
import { BRASS_RAMP, BAR_COLOR, CARD_COLORS, NEUTRAL_CHART } from "../engine/palette.ts";
import { getDeviceTheme } from "../theme.js";

// The full feature walkthrough — everything the app can do, in the order you'd
// actually meet it. Quick Setup gets you a working budget in two minutes; this
// is the reference for the rest.
//
// RULE: this file ships in the SAME COMMIT as any feature change it describes.
// A stale tutorial is worse than none.

const SECTIONS = [
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
      ["p", "“List” and “Calendar” show the same transactions two ways. The calendar is a month grid: a coloured dot per transaction, the day's net, and a click on any day for the detail. The running balance only appears in the list — a month grid has nowhere to put it, and rather than fake one the calendar leaves it out."],
      ["p", "“Planned spending” at the top breaks the window down by category — pie or bar, your choice, and it follows the horizon slider. It is the forecast: your rules, with income left out. It is not a record of what you actually spent; that comparison lives on the Spending tab."],
      ["p", "Bills and one-offs are always shown as the individual transactions inside them, never as one slice: \"Fixed bills\" is just where anything you didn't categorize lands, so a wedge labelled that tells you nothing. The categories you made yourself stay whole. Each broken-out slice keeps its bucket's name beside it, like \"Rent · Fixed bills\"."],
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
      ["p", "“Edit” on a card renames it, recolours it, and is where deleting lives. Deleting tells you how many transactions are tagged to it first — those are scheduled, so they stay in your ledger as uncategorized rather than vanishing and quietly changing your forecast."],
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
      ["p", "Each one is one of three kinds, and the kind decides both what its card shows and what colour it gets everywhere in the app. You don't pick a colour — see “What the colours mean”."],
      ["dl", [
        ["Savings", "Cash you control. Its card shows the balance you log and what you've contributed."],
        ["Investment", "Value the market moves — a Roth IRA, a 401k, a brokerage, an HSA. Same card, but no projected line: projecting a market is guessing. An account you never touch is still market-exposed."],
        ["Debt", "Something you owe. Its card shows what's left and progress against what you borrowed."],
      ]],
      ["p", "Savings or investment is the one thing the app can't work out for you, so it asks. Deleting a category doesn't touch existing transactions; they keep their history and show as uncategorized."],
    ],
  },
  {
    id: "colours",
    title: "What the colours mean",
    body: [
      ["p", "Colour does three jobs here and they don't overlap. Nothing is chosen by you, and nothing is a code you have to learn — the words on screen always say what a thing is."],
      ["legend"],
      ["p", "The spending chart is one colour because it is answering one question: how does this window divide up? In the pie the four biggest shares run darkest to lightest and everything else is one grey “Other” — four steps is as many as one colour can keep clearly apart, so the chart shows four rather than pretending to show nine. The bar is the full list and keeps every row."],
      ["p", "On the Dashboard, each savings or investment card gets its own colour so you can find the one you were reading. That's all it means — it's assigned by the card's position, not by what the account is. Loans share a plain grey, and your checking account has no colour at all."],
      ["note", "Red and green are the only colours that mean something: green is money coming in, red is money going out. Money you moved to savings, put into an investment, or paid against a loan stays plain — it left your checking account, but it isn't gone."],
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

export default function Tutorial({ onClose, onStartTour }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const index = SECTIONS.indexOf(section);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 sm:rounded-2xl w-full h-full sm:h-auto sm:max-h-[88vh] sm:max-w-4xl flex flex-col shadow-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <h2 className="text-lg font-semibold">How this app works</h2>
          <div className="flex items-center gap-3">
            {/* The reference page and the walkthrough are different things
                and this is where they meet: you came here confused, and
                sometimes the answer is to be shown the tabs again. */}
            {onStartTour && (
              <button
                onClick={onStartTour}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Take the tour
              </button>
            )}
            <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Done</button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Section list: a sidebar on desktop, a scrolling chip row on mobile */}
          <nav className="hidden sm:block w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto py-2">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`w-full text-left px-4 py-2 text-sm transition ${
                  s.id === active
                    ? "bg-gray-100 dark:bg-gray-800 font-medium"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                }`}
              >
                <span className="tabular-nums text-xs text-gray-400 mr-2">{i + 1}</span>
                {s.title}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="sm:hidden flex gap-2 overflow-x-auto px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs transition ${
                    s.id === active
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
                      : "border border-gray-300 dark:border-gray-700 text-gray-500"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto px-4 sm:px-7 py-5 grow">
              <h3 className="text-xl font-semibold tracking-tight mb-4">{section.title}</h3>
              <div className="space-y-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {section.body.map((block, i) => <Block key={i} block={block} />)}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 sm:px-7 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
              <span className="text-xs text-gray-400 tabular-nums">{index + 1} of {SECTIONS.length}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setActive(SECTIONS[Math.max(0, index - 1)].id)}
                  disabled={index === 0}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40"
                >
                  Back
                </button>
                {index === SECTIONS.length - 1 ? (
                  <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium">
                    Done
                  </button>
                ) : (
                  <button
                    onClick={() => setActive(SECTIONS[index + 1].id)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// What each colour is FOR. The job, not a taxonomy of money — that was
// the old legend, and seven hues to memorise is what made the app hard to
// read. These four entries are the whole system.
const LEGEND = [
  { key: "brass", name: "Brass", hint: "the spending chart, and the app's own gold", swatches: (dark) => BRASS_RAMP[dark ? "dark" : "light"] },
  { key: "bar",   name: "One brass", hint: "every row of the bar chart — the full list, so no ranking", swatches: (dark) => [BAR_COLOR[dark ? "dark" : "light"]] },
  { key: "cards", name: "Card colours", hint: "telling your Dashboard accounts apart. Decoration, not meaning", swatches: (dark) => CARD_COLORS[dark ? "dark" : "light"] },
  { key: "grey",  name: "Grey", hint: "“Other”, loans, and anything deliberately not identified", swatches: () => [NEUTRAL_CHART] },
];

function Block({ block }) {
  const [kind, value] = block;
  if (kind === "p") return <p>{value}</p>;
  // The mapping, stated once, where someone confused will look for it —
  // and drawn from the engine's own constants, so a legend that disagrees
  // with the app is not a thing that can happen.
  if (kind === "legend") {
    const dark = getDeviceTheme(null) === "dark";
    return (
      <dl className="space-y-2">
        {LEGEND.map((row) => (
          <div key={row.key} className="flex items-baseline gap-2.5">
            <span className="flex gap-0.5 shrink-0 self-center">
              {row.swatches(dark).map((hex) => (
                <span key={hex} className="h-3 w-3 rounded-sm" style={{ backgroundColor: hex }} />
              ))}
            </span>
            <dt className="font-medium shrink-0">{row.name}</dt>
            <dd className="text-gray-500">{row.hint}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (kind === "note") {
    return (
      <p className="text-xs bg-gray-50 dark:bg-gray-800/60 border-l-2 border-gray-300 dark:border-gray-700 rounded-r-lg px-3 py-2 text-gray-600 dark:text-gray-400">
        {value}
      </p>
    );
  }
  if (kind === "steps") {
    return (
      <ol className="space-y-1.5">
        {value.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="shrink-0 h-5 w-5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-medium flex items-center justify-center tabular-nums">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className="space-y-2.5">
      {value.map(([term, def], i) => (
        <div key={i}>
          <dt className="font-medium text-gray-900 dark:text-gray-100">{term}</dt>
          <dd className="text-gray-600 dark:text-gray-400">{def}</dd>
        </div>
      ))}
    </dl>
  );
}
