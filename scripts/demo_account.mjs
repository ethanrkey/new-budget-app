// A fictional account for App Store screenshots, as an importable backup.
//
//   node scripts/demo_account.mjs            # writes ./demo-account.json
//   node scripts/demo_account.mjs <path>
//
// WHY A SCRIPT AND NOT A COMMITTED FILE. Every date in it is relative to
// the day it is generated, so a file committed in October would show a
// newest reading from October forever — and a screenshot whose newest
// balance is four months stale is exactly the thing the landing-page
// shots were turned into a script to avoid (PROJECT_SPEC §10 item 0).
// Run it on the day you take the shots.
//
// NOT THE OWNER'S FINANCES, and deliberately so. It starts from
// scripts/fixture.mjs — the same invented account the landing page is
// shot from, so there is ONE set of fictional names and amounts rather
// than two to keep plausible — and changes only what a phone screenshot
// needs that a 1100px web shot did not:
//
//   1. SIX MONTHS OF MONTHLY READINGS on every account instead of five
//      on some. Every Dashboard sparkline is drawn from these, and a
//      two-point line is a line segment, not a chart.
//   2. INVESTMENTS THAT FALL AS WELL AS RISE. The landing fixture's
//      Roth and brokerage only ever go up, which is not what a market
//      does and makes the one chart on the screen that should look
//      alive look fabricated. The savings account still climbs
//      steadily and the two loans still shrink, because those are what
//      those things do.
//   3. A CHECKING SERIES THAT WOBBLES, for the same reason.
//
// The output is exactly what ExportMenu's "Full backup (JSON)" writes —
// JSON.stringify(state, null, 2) — so Import → Restore backup takes it.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixtureState } from "./fixture.mjs";
import { todayISO, PRIMARY_ACCOUNT_ID } from "../src/engine/model.ts";
import { normalize } from "../src/engine/stateShape.ts";
import { isPlausibleBackup, countSnapshots } from "../src/engine/backupShape.ts";

const TODAY = todayISO();
const asDate = (iso) => new Date(iso + "T00:00:00Z");
const toISO = (dt) => dt.toISOString().slice(0, 10);
const shiftDays = (iso, n) => { const x = asDate(iso); x.setUTCDate(x.getUTCDate() + n); return toISO(x); };
const firstOf = (monthsAgo) => {
  const x = asDate(TODAY);
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() - monthsAgo);
  return toISO(x);
};

/** A series of monthly readings, oldest first, ending last month. */
const series = (prefix, amounts) =>
  amounts.map((amount, i) => ({
    id: `${prefix}-${i}`, date: firstOf(amounts.length - 1 - i), amount,
  }));

const given = (prefix, amount, n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`, date: firstOf(n - 1 - i), amount, source: "manual",
  }));

const monthKey = (iso) => iso.slice(0, 7);

export function demoAccount() {
  const base = fixtureState();
  return normalize({
    ...base,
    settings: {
      ...base.settings,
      // The phone is dark only, and a backup carries the theme.
      theme: "dark",
      // Both investments on the Dashboard, which is the screen being
      // shot; the landing fixture hides the brokerage to keep a wide
      // web shot from running long.
      visibleTrackerCategoryIds: ["c-roth", "c-brok", "c-save"],
    },
    accountSnapshots: {
      // Wobbles, because a checking balance does. Ends two days ago so
      // the "as of" line reads as somebody who checked recently rather
      // than as a number the app made up today.
      [PRIMARY_ACCOUNT_ID]: [
        ...series("as", [2180.4, 2486.15, 2294.8, 2918.6, 3277.05, 3094.35, 3851.9]),
        { id: "as-now", date: shiftDays(TODAY, -2), amount: 4280.55 },
      ],
    },
    balanceSnapshots: {
      // Steady: a savings account is money you put in, not money that
      // moves on its own.
      "c-save": series("sv", [1800, 2100, 2400, 2700, 3000, 3300, 3600]),
      // UP OVERALL, DOWN TWICE. A retirement account that has never
      // had a red month is the detail that makes a demo look staged.
      "c-roth": series("rt", [11400, 11920, 11605, 12480, 12185, 12910, 13415]),
      // Smaller and livelier, and it ends off its own peak — not every
      // chart on the screen should be pointing the same way.
      "c-brok": series("bk", [4100, 4485, 4210, 4062, 4615, 4880, 4723]),
      // Shrinking, which is what a loan being paid does.
      "c-sloan": series("sl", [10970, 10750, 10530, 10310, 10090, 9870, 9650]),
      "c-car": series("cl", [7970, 7660, 7350, 7040, 6730, 6420, 6110]),
    },
    contributionLog: {
      "c-save": given("gs", 300, 6),
      "c-roth": given("gr", 250, 6),
    },
    // Six months of logged actuals against the two variable rules, so
    // the Spending tab has a column of real comparisons rather than one
    // or two and a row of blanks.
    monthlyActuals: {
      "r-elec": Object.fromEntries(
        [148, 131, 104, 96, 118, 127].map((v, i) => [monthKey(firstOf(6 - i)), v]),
      ),
      "r-groc": Object.fromEntries(
        [388, 441, 402, 437, 391, 419].map((v, i) => [monthKey(firstOf(6 - i)), v]),
      ),
    },
  });
}

const out = resolve(process.argv[2] ?? "demo-account.json");
const state = demoAccount();

// The file is only useful if the thing that reads it would take it, so
// ask that function rather than trusting the shape.
if (!isPlausibleBackup(state)) throw new Error("the generated state is not a restorable backup");

writeFileSync(out, JSON.stringify(state, null, 2));
console.log(`wrote ${out}`);
console.log(
  `  ${state.recurring.length} recurring, ${state.oneoffs.length} one-off, ` +
  `${state.trackerCategories.length} tracked accounts, ` +
  `${countSnapshots(state.balanceSnapshots) + countSnapshots(state.accountSnapshots)} logged balances`,
);
console.log(`  newest reading ${shiftDays(TODAY, -2)}, oldest ${firstOf(6)}`);
console.log("");
console.log("To load it into a FRESH account:");
console.log("  1. Sign in on the web as the account you want the demo in.");
console.log("  2. Header -> Import (the ⬇ button).");
console.log("  3. Choose this file. It is recognized as a full backup, not a CSV.");
console.log("  4. Tick the red confirm box, then press \"Restore backup\".");
console.log("     Your previous data is downloaded as a safety copy first.");
console.log("  5. Sign in on the phone with the same account — it syncs down.");
