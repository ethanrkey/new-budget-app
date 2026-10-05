// The fictional account the landing-page screenshots are taken from.
//
// NOT the author's finances, and deliberately so: the public page shows a
// stranger's balances either way, and inventing them is the only version of
// that which is safe to regenerate without thinking about it each time.
//
// Dated RELATIVE TO TODAY, so a regeneration months from now produces a
// current-looking account rather than one whose newest reading is stale.
// That is the whole reason this is a committed script and not a run I did
// once by hand — see PROJECT_SPEC §10 item 0.
import { todayISO, PRIMARY_ACCOUNT_ID } from "../src/engine/model.ts";
import { normalize } from "../src/engine/stateShape.ts";

const TODAY = todayISO();

// UTC throughout: `new Date("…T00:00:00")` is local, and toISOString() then
// drags a US date back a day. Every arithmetic helper here stays in UTC.
const asDate = (iso) => new Date(iso + "T00:00:00Z");
const toISO = (dt) => dt.toISOString().slice(0, 10);
const shiftDays = (iso, n) => { const x = asDate(iso); x.setUTCDate(x.getUTCDate() + n); return toISO(x); };
const shiftMonths = (iso, n, day) => {
  const x = asDate(iso);
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  x.setUTCDate(day ?? asDate(iso).getUTCDate());
  return toISO(x);
};
const firstOf = (monthsAgo) => shiftMonths(TODAY, -monthsAgo, 1);
const monthKey = (iso) => iso.slice(0, 7);

const lastFriday = () => shiftDays(TODAY, -((asDate(TODAY).getUTCDay() + 2) % 7));

// A rule that has been running for half a year, so the Spending tab has
// history to compare against and no month reads "not due".
const since = (day) => shiftMonths(TODAY, -6, day);

const snaps = (prefix, amounts) =>
  amounts.map((amount, i) => ({ id: `${prefix}-${i}`, date: firstOf(amounts.length - 1 - i), amount }));

const given = (prefix, amount, n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`, date: firstOf(n - 1 - i), amount, source: "manual",
  }));

const bill = (id, name, amount, day, order, variable = false) => ({
  id, name, amount, category: "bill", order, cadence: "monthly",
  startDate: since(day), dayOfMonth: day, accountId: PRIMARY_ACCOUNT_ID,
  ...(variable ? { variable: true } : {}),
});

const toward = (id, name, amount, day, category, order) => ({
  id, name, amount, category, order, cadence: "monthly",
  startDate: since(day), dayOfMonth: day, accountId: PRIMARY_ACCOUNT_ID,
});

export function fixtureState() {
  return normalize({
    settings: {
      // Four months on the Ledger and six on the Budget: enough to show the
      // shape of a forecast, few enough that a 1100px-wide shot stays legible.
      ledgerHorizon: shiftMonths(TODAY, 4, 1),
      budgetHorizon: shiftMonths(TODAY, 6, 1),
      theme: "light",
      visibleTrackerCategoryIds: ["c-roth", "c-save"],
      tabOrder: ["dashboard", "ledger", "budget", "spending"],
      hasSeenOnboarding: true,
    },
    accounts: [{
      id: PRIMARY_ACCOUNT_ID, name: "Checking", kind: "checking",
      balance: 4280.55, balanceAsOf: shiftDays(TODAY, -2), order: 0,
    }],
    accountSnapshots: {
      [PRIMARY_ACCOUNT_ID]: [
        ...snaps("as", [2480.1, 2905.4, 3310.75, 3840.2]),
        { id: "as-now", date: shiftDays(TODAY, -2), amount: 4280.55 },
      ],
    },
    trackerCategories: [
      { id: "c-save", name: "Savings",     kind: "asset", assetKind: "savings",    order: 0 },
      { id: "c-roth", name: "Roth IRA",    kind: "asset", assetKind: "investment", order: 1 },
      { id: "c-brok", name: "Brokerage",   kind: "asset", assetKind: "investment", order: 2 },
      { id: "c-sloan", name: "Student loan", kind: "debt", order: 3, originalPrincipal: 18400, interestRate: 5.8 },
      { id: "c-car",   name: "Car loan",     kind: "debt", order: 4, originalPrincipal: 14200, interestRate: 6.4 },
    ],
    balanceSnapshots: {
      "c-save":  snaps("sv", [2100, 2400, 2700, 3000, 3300]),
      "c-roth":  snaps("rt", [11400, 11920, 12480, 12910, 13415]),
      "c-brok":  snaps("bk", [4100, 4340, 4615, 4880, 5180]),
      "c-sloan": snaps("sl", [10750, 10530, 10310, 10090, 9870]),
      "c-car":   snaps("cl", [7660, 7350, 7040, 6730, 6420]),
    },
    contributionLog: {
      "c-save": given("gs", 300, 5),
      "c-roth": given("gr", 250, 5),
    },
    recurring: [
      // Paid on Fridays, and started several periods back so the account
      // reads as established rather than as one opened this week.
      { id: "r-pay", name: "Paycheck", amount: 1840, category: "income", order: 0,
        cadence: "biweekly", startDate: shiftDays(lastFriday(), -14 * 6),
        accountId: PRIMARY_ACCOUNT_ID },
      bill("r-rent", "Rent", 1450, 1, 1),
      // Weekly, and running as long as the monthly rules: a logged actual
      // for a month the rule had not started yet renders as "not due" with
      // a delta against nothing, which is incoherent rather than realistic.
      { id: "r-groc", name: "Groceries", amount: 95, category: "bill", order: 2,
        cadence: "weekly", startDate: shiftDays(lastFriday(), -7 * 26), variable: true,
        accountId: PRIMARY_ACCOUNT_ID },
      bill("r-elec", "Electric", 112, 12, 3, true),
      bill("r-ins",  "Car insurance", 138, 20, 4),
      bill("r-net",  "Internet", 70, 5, 5),
      bill("r-cell", "Phone", 45, 8, 6),
      toward("r-sv", "Savings transfer",     300, 3,  "c-save",  7),
      toward("r-rt", "Roth IRA",             250, 3,  "c-roth",  8),
      toward("r-bk", "Brokerage",            150, 18, "c-brok",  9),
      toward("r-sl", "Student loan payment", 220, 10, "c-sloan", 10),
      toward("r-cl", "Car payment",          310, 22, "c-car",   11),
    ],
    oneoffs: [
      { id: "o-dent",  name: "Dentist",       amount: 180, category: "oneoff", order: 12, date: shiftDays(TODAY, 9),  accountId: PRIMARY_ACCOUNT_ID },
      { id: "o-fly",   name: "Flight home",   amount: 320, category: "oneoff", order: 13, date: shiftMonths(TODAY, 1, 20), accountId: PRIMARY_ACCOUNT_ID },
      { id: "o-gifts", name: "Holiday gifts", amount: 260, category: "oneoff", order: 14, date: shiftMonths(TODAY, 2, 12), accountId: PRIMARY_ACCOUNT_ID },
    ],
    monthlyActuals: {
      "r-elec": { [monthKey(firstOf(3))]: 104, [monthKey(firstOf(2))]: 118, [monthKey(firstOf(1))]: 96 },
      "r-groc": { [monthKey(firstOf(3))]: 402, [monthKey(firstOf(2))]: 437, [monthKey(firstOf(1))]: 391 },
    },
    overrides: {},
  });
}
