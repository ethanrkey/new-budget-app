// Engine test harness — pure Node, no framework. Run: npm test  (CI runs it on every push)
import { computeLedger, computeBudget } from "../src/engine/compute.js";
import { upsertItem, deleteItem, deleteItems, findItem, itemsByName, swapOrder, reorderList, togglePaidOverride, addCategory, updateCategory, deleteCategory, moveCategory, addBalanceSnapshot, updateBalanceSnapshot, deleteBalanceSnapshot, setMonthlyActual, deleteMonthlyActual, updateAccountBalance, updateAccountSnapshot, deleteAccountSnapshot, setupLoan, setupAsset, moveTab } from "../src/engine/mutate.js";
import { computeCategoryProgress, computeCategoryHistory, computeMonthVariance, computeContributionsByYear, computeNetPosition, lastMonthKeys } from "../src/engine/progress.js";
import { computeLoanExpected, computeLoanHistory, computeLoanProgress, isLoanConfigured } from "../src/engine/loans.js";
import { buildAllEvents, occurrenceDates } from "../src/engine/generate.js";
import { monthsDiff, addMonthsISO, paletteColor, primaryAccount, sanitizeTabOrder, TABS, PRIMARY_ACCOUNT_ID } from "../src/engine/model.js";
import { normalize, legacyTrackerCategories } from "../src/engine/stateShape.js";
import { computeBudgetLayout } from "../src/engine/budgetLayout.js";
import { ledgerToCSV, budgetToCSV } from "../src/engine/csv.js";
import { parseBudgetCSV } from "../src/engine/csvImport.js";
import { parseLedgerCSV } from "../src/engine/ledgerCsvImport.js";
import { isPlausibleBackup, countSnapshots, countMonthlyActuals } from "../src/engine/backupShape.js";

const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
let failures = 0;
function check(label, got, want) {
  const ok = Math.abs(got - want) < 0.005;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${money(got)} want=${money(want)}`);
}

// ---------- Scenario A: biweekly paycheck + monthly rent ----------
const stateA = {
  settings: {
    checkInBalance: 1000,
    checkInDate: "2026-09-01",
    budgetHorizon: "2027-02-01",
    ledgerHorizon: "2027-02-01",
    theme: "light",
    showCumulative: true,
  },
  recurring: [
    { id: "pay", name: "Paycheck", amount: 2000, category: "income",
      cadence: "biweekly", startDate: "2026-09-04", endDate: null, dayOfMonth: 4 },
    { id: "rent", name: "Rent", amount: 1500, category: "bill",
      cadence: "monthly", startDate: "2026-09-02", endDate: null, dayOfMonth: 2 },
  ],
  oneoffs: [],
};

const budgetA = computeBudget(stateA, stateA.settings.budgetHorizon);
const byKeyA = Object.fromEntries(budgetA.map((c) => [c.key, c]));
console.log("\n== Scenario A: biweekly $2000 paycheck ==");
for (const c of budgetA) {
  console.log(`  ${c.label}: takeHome=${money(c.takeHome)} out=${money(c.totalOut)} net=${money(c.net)} cum=${money(c.cumulative)}`);
}
// Sept 2026: paydays 9/4, 9/18 -> 2 checks
check("Sep take-home (2 paydays)", byKeyA["2026-09"].takeHome, 4000);
// Oct 2026: paydays 10/2, 10/16, 10/30 -> 3 checks
check("Oct take-home (3 paydays)", byKeyA["2026-10"].takeHome, 6000);
// Dec 2026: paydays 12/11, 12/25 -> 2 checks
check("Dec take-home (2 paydays)", byKeyA["2026-12"].takeHome, 4000);

// ---------- Scenario B: two differently-named checks in one month ----------
const stateB = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-01", budgetHorizon: "2026-10-01",
    ledgerHorizon: "2026-10-01", theme: "light", showCumulative: false },
  recurring: [
    { id: "payA", name: "BU Paycheck", amount: 1800, category: "income",
      cadence: "monthly", startDate: "2026-09-15", endDate: null, dayOfMonth: 15 },
  ],
  oneoffs: [
    { id: "payB", name: "Salary top-up", amount: 700, category: "income", date: "2026-09-20" },
  ],
};
const budgetB = computeBudget(stateB, stateB.settings.budgetHorizon);
const sepB = budgetB.find((c) => c.key === "2026-09");
console.log("\n== Scenario B: two differently-named paychecks in Sep ==");
console.log(`  Sep take-home=${money(sepB.takeHome)}`);
check("Sep take-home (1800 + 700)", sepB.takeHome, 2500);

// ---------- Scenario C: tracker categories step the cumulative columns ----------
const stateC = {
  settings: { checkInBalance: 5000, checkInDate: "2026-09-01", budgetHorizon: "2026-12-01",
    ledgerHorizon: "2026-12-01", theme: "light", showCumulative: true },
  recurring: [
    { id: "roth", name: "Roth IRA", amount: 500, category: "roth",
      cadence: "monthly", startDate: "2026-09-05", endDate: null, dayOfMonth: 5 },
    { id: "save", name: "Emergency fund", amount: 200, category: "saved",
      cadence: "monthly", startDate: "2026-09-10", endDate: null, dayOfMonth: 10 },
    { id: "rent", name: "Rent", amount: 1000, category: "bill",
      cadence: "monthly", startDate: "2026-09-02", endDate: null, dayOfMonth: 2 },
  ],
  oneoffs: [],
  trackerCategories: legacyTrackerCategories(),
};
const ledgerC = computeLedger(stateC, stateC.settings.ledgerHorizon);
console.log("\n== Scenario C: roth $500/mo, saved $200/mo — stepped ledger ==");
for (const r of ledgerC.rows) {
  console.log(`  ${r.date}  ${r.name.padEnd(16)} ${r.direction}  bal=${money(r.balance)}  stepped=${r.stepped ? r.stepped.key + " " + money(r.stepped.value) : "-"}`);
}
const rothSteps = ledgerC.rows.filter((r) => r.stepped && r.stepped.key === "roth").map((r) => r.stepped.value);
const savedSteps = ledgerC.rows.filter((r) => r.stepped && r.stepped.key === "saved").map((r) => r.stepped.value);
console.log(`  roth steps: [${rothSteps.join(", ")}]  saved steps: [${savedSteps.join(", ")}]`);
check("roth cumulative after 3 months", rothSteps[2] ?? 0, 1500);
check("saved cumulative after 3 months", savedSteps[2] ?? 0, 600);
check("rent rows never step a tracker", ledgerC.rows.filter((r) => r.name === "Rent" && r.stepped).length, 0);

function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// ---------- Scenario D: CRUD mutations (engine/mutate.js) ----------
console.log("\n== Scenario D: upsert / delete ==");
let s = {
  recurring: [{ id: "a", name: "Rent", amount: 1000, category: "bill", cadence: "monthly", order: 0 }],
  oneoffs: [{ id: "b", name: "Gift", amount: 50, category: "oneoff", date: "2026-09-10", order: 1 }],
};

// edit-in-place: recurring rule, no type change -> same position, same order, edits "all instances"
s = upsertItem(s, { id: "a", name: "Rent", amount: 1200, category: "bill", cadence: "monthly" });
eq("edit rule keeps position", s.recurring.map((r) => r.id), ["a"]);
check("edit rule new amount", s.recurring[0].amount, 1200);
check("edit rule preserves order", s.recurring[0].order ?? -99, 0);

// new item gets appended with a fresh order
s = upsertItem(s, { id: "c", name: "Roth IRA", amount: 500, category: "roth", cadence: "monthly" });
check("new item order = max+1", s.recurring.find((r) => r.id === "c").order, 2);

// type switch: one-off "b" becomes recurring -> leaves oneoffs, joins recurring
s = upsertItem(s, { id: "b", name: "Gift", amount: 50, category: "oneoff", cadence: "monthly", startDate: "2026-09-10" });
eq("one-off -> recurring: gone from oneoffs", s.oneoffs.map((o) => o.id), []);
eq("one-off -> recurring: now in recurring", s.recurring.some((r) => r.id === "b"), true);

// lookups
eq("findItem by bare id", findItem(s, "a")?.name, "Rent");
eq("itemsByName unique", itemsByName(s, "Roth IRA").length, 1);

// delete
s = deleteItem(s, "a");
eq("delete removes the rule", s.recurring.some((r) => r.id === "a"), false);

// bulk delete (multi-select) — one call, mixed recurring + one-off ids
s = deleteItems(s, ["b", "c"]);
eq("deleteItems removes a recurring id", s.recurring.some((r) => r.id === "c"), false);
eq("deleteItems removes a one-off id (b became recurring above)", s.oneoffs.some((o) => o.id === "b") || s.recurring.some((r) => r.id === "b"), false);
eq("deleteItems leaves unrelated ids alone", s.recurring.length + s.oneoffs.length, 0);

// ---------- Scenario E: manual reordering (swapOrder) + Budget row order ----------
console.log("\n== Scenario E: swapOrder + Budget sort ==");
const stateE = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-01", budgetHorizon: "2026-10-01",
    ledgerHorizon: "2026-10-01", theme: "light", showCumulative: false },
  recurring: [
    { id: "e1", name: "Internet", amount: 80, category: "bill", cadence: "monthly", startDate: "2026-09-05", order: 0 },
    { id: "e2", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", order: 1 },
  ],
  oneoffs: [],
  paidOverrides: {},
};
// computeBudget doesn't sort (that's BudgetView's job, by .order) — it just
// has to carry each item's order through so the UI can.
let budgetE = computeBudget(stateE, stateE.settings.budgetHorizon);
let sepE = budgetE.find((c) => c.key === "2026-09");
check("order carried onto expenseItems", sepE.expenseItems.Internet.order, 0);
check("order carried onto expenseItems (2)", sepE.expenseItems.Rent.order, 1);

const swapped = swapOrder(stateE, "Internet", "Rent");
check("swapOrder: Internet now order 1", swapped.recurring.find((r) => r.id === "e1").order, 1);
check("swapOrder: Rent now order 0", swapped.recurring.find((r) => r.id === "e2").order, 0);
budgetE = computeBudget(swapped, swapped.settings.budgetHorizon);
sepE = budgetE.find((c) => c.key === "2026-09");
eq("Budget respects the swap (order-wise; caller sorts by .order)",
  Object.entries(sepE.expenseItems).sort((a, b) => a[1].order - b[1].order).map(([n]) => n),
  ["Rent", "Internet"]);

// ---------- Scenario F: mark-bill-paid override ----------
// Fixed dates (not todayISO()) so the test is deterministic and independent
// of the checkInDate event-filter added for the live-month convention.
console.log("\n== Scenario F: paidOverride zeroes a bill's effect ==");
const stateF = {
  settings: { checkInBalance: 2000, checkInDate: "2026-09-10", budgetHorizon: "2026-11-10",
    ledgerHorizon: "2026-11-10", theme: "light", showCumulative: false },
  recurring: [
    { id: "f1", name: "Electric", amount: 100, category: "bill", cadence: "monthly", startDate: "2026-09-15", order: 0 },
  ],
  oneoffs: [],
  paidOverrides: {},
};
const beforePaid = computeLedger(stateF, stateF.settings.ledgerHorizon);
check("unpaid: balance drops by 100 this month", beforePaid.rows[0].balance, 1900);
check("unpaid: not flagged paidOverride", beforePaid.rows[0].paidOverride ? 1 : 0, 0);

const stateFPaid = togglePaidOverride(stateF, "f1", "2026-09");
const afterPaid = computeLedger(stateFPaid, stateFPaid.settings.ledgerHorizon);
check("paid: balance unaffected this month", afterPaid.rows[0].balance, 2000);
check("paid: row still shows the real amount", afterPaid.rows[0].amount, 100);
check("paid: flagged paidOverride", afterPaid.rows[0].paidOverride ? 1 : 0, 1);
// next month's instance of the same rule must NOT be affected
const nextMonthRow = afterPaid.rows.find((r) => r.date.slice(0, 7) !== "2026-09");
check("paid override doesn't leak into next month", nextMonthRow?.paidOverride ? 1 : 0, 0);

const budgetFPaid = computeBudget(stateFPaid, stateFPaid.settings.budgetHorizon);
const sepFCol = budgetFPaid.find((c) => c.key === "2026-09");
check("Budget: paid bill contributes $0 this month", sepFCol.totalOut, 0);

// ---------- Scenario G: live-month convention ----------
console.log("\n== Scenario G: live month = checkInDate's month ==");
const stateG = {
  settings: { checkInBalance: 3000, checkInDate: "2026-09-15", budgetHorizon: "2026-11-15",
    ledgerHorizon: "2026-11-15", theme: "light", showCumulative: false },
  recurring: [
    // biweekly paycheck: instances 9/4 (before check-in -> dropped), 9/18, 10/2, 10/16, 10/30
    { id: "g-pay", name: "Paycheck", amount: 2000, category: "income", cadence: "biweekly", startDate: "2026-09-04", order: 0 },
    // monthly rent: 9/1 instance predates the rule's own start*, so really starts 9/20
    { id: "g-rent", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-08-20", dayOfMonth: 20, order: 1 },
  ],
  oneoffs: [],
  paidOverrides: {},
};
const budgetG = computeBudget(stateG, stateG.settings.budgetHorizon);
const ledgerG = computeLedger(stateG, stateG.settings.ledgerHorizon);
const sepG = budgetG.find((c) => c.key === "2026-09");
const octG = budgetG.find((c) => c.key === "2026-10");
console.log(`  Sep (live, checkIn 9/15): takeHome=${money(sepG.takeHome)} out=${money(sepG.totalOut)}`);
console.log(`  Oct: takeHome=${money(octG.takeHome)} out=${money(octG.totalOut)}`);
console.log(`  Ledger rows: ${ledgerG.rows.map((r) => `${r.date} ${r.name}`).join(", ")}`);
check("live month take-home = only unreceived paycheck (9/18, not 9/4)", sepG.takeHome, 2000);
check("full month take-home is unaffected (10/2, 10/16, 10/30)", octG.takeHome, 6000);
check("Aug rent (before check-in) doesn't leak into Sep totals", sepG.totalOut, 1500); // only the 9/20 Rent instance
eq("ledger has no Aug rent row, and no 9/4 paycheck row",
  ledgerG.rows.some((r) => r.date < "2026-09-15"), false);
eq("first ledger row is the 9/18 paycheck, not 9/4", ledgerG.rows[0].date, "2026-09-18");

// ---------- Scenario H: a same-day-as-check-in item must still show up ----------
// (the most common real case: adding "today's" transaction, where date defaults
// to the same todayISO() as checkInDate)
console.log("\n== Scenario H: same-day-as-checkInDate item is kept ==");
const stateH = {
  settings: { checkInBalance: 500, checkInDate: "2026-09-01", budgetHorizon: "2026-10-01",
    ledgerHorizon: "2026-10-01", theme: "light", showCumulative: false },
  recurring: [],
  oneoffs: [{ id: "h1", name: "Coffee", amount: 5, category: "oneoff", date: "2026-09-01", order: 0 }],
  paidOverrides: {},
};
const ledgerH = computeLedger(stateH, stateH.settings.ledgerHorizon);
check("same-day item is not dropped", ledgerH.rows.length, 1);
check("same-day item still affects the balance", ledgerH.endingBalance, 495);

// ---------- Scenario I: reorderList (drag-and-drop) ----------
console.log("\n== Scenario I: reorderList ==");
let sI = {
  recurring: [
    { id: "i1", name: "A", amount: 10, category: "bill", cadence: "monthly", order: 0 },
    { id: "i2", name: "B", amount: 10, category: "bill", cadence: "monthly", order: 1 },
    { id: "i3", name: "C", amount: 10, category: "bill", cadence: "monthly", order: 2 },
    { id: "i4", name: "D", amount: 10, category: "bill", cadence: "monthly", order: 3 },
  ],
  oneoffs: [],
};
const namesI = ["A", "B", "C", "D"];
const orderedNames = (s) => [...s.recurring].sort((a, b) => a.order - b.order).map((r) => r.name);

// drag D to before B -> A, D, B, C
let moved = reorderList(sI, namesI, "D", "B");
eq("drag D before B", orderedNames(moved), ["A", "D", "B", "C"]);

// drag A to the end (beforeName = null) -> B, C, D, A
moved = reorderList(sI, namesI, "A", null);
eq("drag A to end", orderedNames(moved), ["B", "C", "D", "A"]);

// dragging a name not in this group is a no-op that doesn't corrupt the list
moved = reorderList(sI, namesI, "not-in-group", "B");
eq("drag from outside the group is inert", orderedNames(moved), ["A", "B", "C", "D"]);

// ---------- Scenario J: computeBudgetLayout matches BudgetView's own sorting ----------
console.log("\n== Scenario J: computeBudgetLayout ==");
const stateJ = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-01", budgetHorizon: "2026-10-01",
    ledgerHorizon: "2026-10-01", theme: "light", showCumulative: false },
  recurring: [
    { id: "j-loans", name: "Loan pmt", amount: 200, category: "loans", cadence: "monthly", startDate: "2026-09-02", order: 0 },
    { id: "j-roth", name: "Roth IRA", amount: 500, category: "roth", cadence: "monthly", startDate: "2026-09-03", order: 1 },
    { id: "j-bill2", name: "Internet", amount: 80, category: "bill", cadence: "monthly", startDate: "2026-09-05", order: 3 },
    { id: "j-bill1", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", order: 2 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: legacyTrackerCategories(),
};
const budgetJ = computeBudget(stateJ, stateJ.settings.budgetHorizon);
const layoutJ = computeBudgetLayout(budgetJ, stateJ.trackerCategories);
eq("bill section sorted by order (Rent order=2, Internet order=3)", layoutJ.sectionItems.bill, ["Rent", "Internet"]);
eq("saving section clusters by category (roth before loans) despite order (loans=0, roth=1)",
  layoutJ.sectionItems.saving, ["Roth IRA", "Loan pmt"]);
// Only clusters with at least one item survive (saved/brokerage are empty
// here and dropped, not rendered as blank groups) — roth's cluster (len 1)
// then loans' (len 1), in category order.
eq("savingGroups splits by category cluster, empty clusters dropped", layoutJ.savingGroups.map((g) => g.length), [1, 1]);

// ---------- Scenario K: CSV export ----------
console.log("\n== Scenario K: ledgerToCSV / budgetToCSV ==");
const stateK = {
  settings: { checkInBalance: 1000, checkInDate: "2026-09-01", budgetHorizon: "2026-10-01",
    ledgerHorizon: "2026-10-01", theme: "light", showCumulative: false },
  recurring: [
    { id: "k-rent", name: "Rent, Utilities", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", order: 0 },
    { id: "k-roth", name: 'Bob\'s "Roth"', amount: 500, category: "roth", cadence: "monthly", startDate: "2026-09-03", order: 1 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: legacyTrackerCategories(),
};
const ledgerK = computeLedger(stateK, stateK.settings.ledgerHorizon);
const budgetK = computeBudget(stateK, stateK.settings.budgetHorizon);

const ledgerCSV = ledgerToCSV(ledgerK, stateK.trackerCategories);
const ledgerLines = ledgerCSV.split("\r\n");
eq("ledger CSV header", ledgerLines[0], "Date,Item,Category,In,Out,Balance,Roth,Saved,Brokerage,Loans");
eq("comma-in-name gets quoted", ledgerLines[1].startsWith('"Rent, Utilities"') || ledgerLines[1].includes('"Rent, Utilities"'), true);
check("row count = header + 2 events", ledgerLines.length, 3);
// the roth row's embedded quote must be doubled per RFC 4180
eq("embedded quote is escaped (doubled)", ledgerCSV.includes('"Bob\'s ""Roth"""'), true);
// the roth row should show a Roth-column value and blank Saved/Brokerage/Loans
// (search the data rows only — the header line also contains the word "Roth")
const rothLine = ledgerLines.slice(1).find((l) => l.startsWith("2026-09-03,"));
eq("roth row steps the Roth column", rothLine.endsWith("500.00,,,"), true);

const budgetCSV = budgetToCSV(budgetK, stateK.trackerCategories);
const budgetLines = budgetCSV.split("\r\n");
eq("budget CSV header row = blank + month labels", budgetLines[0], "," + budgetK.map((c) => c.label).join(","));
eq("budget CSV has an INCOME section marker", budgetLines.includes("INCOME"), true);
eq("budget CSV has a SAVING / DEBT section marker", budgetLines.includes("SAVING / DEBT"), true);
eq("budget CSV includes the Rent row with its September value", budgetCSV.includes("Rent, Utilities"), true);

// ---------- Scenario L: CSV import (round-trip a real budget through export+parse) ----------
console.log("\n== Scenario L: parseBudgetCSV round-trip ==");
const stateL = {
  settings: { checkInBalance: 3200.55, checkInDate: "2026-09-01", budgetHorizon: "2026-12-01",
    ledgerHorizon: "2026-12-01", theme: "light", showCumulative: false },
  recurring: [
    // constant every month -> should reconstruct as ONE recurring rule
    { id: "l-rent", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", order: 0 },
    // biweekly paycheck -> monthly sum VARIES (2 vs 3 paydays) -> should
    // reconstruct as separate one-offs, one per month, with the right sums
    { id: "l-pay", name: "Paycheck", amount: 2000, category: "income", cadence: "biweekly", startDate: "2026-09-04", order: 1 },
    // saving/debt rows -> category isn't in the CSV, so it's guessed from the name
    { id: "l-roth", name: "Roth IRA", amount: 500, category: "roth", cadence: "monthly", startDate: "2026-09-05", order: 2 },
    { id: "l-loan", name: "Student Loan", amount: 300, category: "loans", cadence: "monthly", startDate: "2026-09-06", order: 3 },
    { id: "l-save", name: "Emergency fund", amount: 200, category: "saved", cadence: "monthly", startDate: "2026-09-07", order: 4 },
  ],
  oneoffs: [
    { id: "l-gift", name: "Birthday gift", amount: 60, category: "oneoff", date: "2026-09-20", order: 5 },
  ],
  paidOverrides: {},
  trackerCategories: legacyTrackerCategories(),
};
const budgetL = computeBudget(stateL, stateL.settings.budgetHorizon);
const parsedL = parseBudgetCSV(budgetToCSV(budgetL, stateL.trackerCategories), stateL.trackerCategories);

check("checkInBalance recovered from the \"Checking\" row", parsedL.checkInBalance, 3200.55);
const rentRuleL = parsedL.recurring.find((r) => r.name === "Rent");
check("Rent reconstructed as recurring", !!rentRuleL, true);
check("Rent amount", rentRuleL.amount, 1500);
eq("Rent category", rentRuleL.category, "bill");
// Rent's true end is null, but a monthly rule falling on the 2nd can lose its
// final instance to the horizon cutoff (Dec 1) — a 1-month tolerance at the
// export boundary must not spuriously cap an ongoing bill.
eq("Rent stays open-ended despite the horizon-boundary artifact", rentRuleL.endDate, null);

// 4 months now, not 3 — the computeBudget last-column fix (2026-09-12)
// means December (the horizon's own month) now correctly includes its
// biweekly paychecks (Dec 11, 25) instead of being truncated at the
// horizon's exact day (Dec 1), which used to make December look like it
// had zero income at all. That was the actual bug: Dec 1 as a cutoff
// meant BOTH of December's paydays (11th and 25th) were silently dropped.
const paycheckOneoffsL = parsedL.oneoffs.filter((o) => o.name === "Paycheck");
check("variable Paycheck -> one one-off per month, not one recurring rule", paycheckOneoffsL.length, 4);
const paySumsL = Object.fromEntries(paycheckOneoffsL.map((o) => [o.date.slice(0, 7), o.amount]));
check("Sep paycheck sum (2 paydays)", paySumsL["2026-09"], 4000);
check("Oct paycheck sum (3 paydays)", paySumsL["2026-10"], 6000);
check("Nov paycheck sum (2 paydays)", paySumsL["2026-11"], 4000);
check("Dec paycheck sum (2 paydays) — previously missing entirely due to the last-column bug", paySumsL["2026-12"], 4000);

const giftL = parsedL.oneoffs.find((o) => o.name === "Birthday gift");
eq("Birthday gift reconstructed as a one-off", !!giftL, true);
check("Birthday gift amount", giftL.amount, 60);

eq("Roth IRA category guessed", parsedL.recurring.find((r) => r.name === "Roth IRA")?.category, "roth");
eq("Student Loan category guessed", parsedL.recurring.find((r) => r.name === "Student Loan")?.category, "loans");
eq("Emergency fund category guessed (catch-all)", parsedL.recurring.find((r) => r.name === "Emergency fund")?.category, "saved");
check("a guess warning is emitted for every Saving/Debt row", parsedL.warnings.filter((w) => w.includes("guess")).length, 3);
check("a variable-amount warning is emitted for Paycheck", parsedL.warnings.filter((w) => w.includes("varies")).length, 1);

// ---------- Scenario M: parseLedgerCSV (clean per-transaction import) ----------
// Tolerant, mode-based classification: a "few months differ" (Rent's one
// off-day, Roth's rate change) must NOT knock a genuinely recurring item
// into one-offs, but a loan with no amount holding real support (>=3
// occurrences) must still fall through. Biweekly items (Gas, Paycheck, and
// Roth's real cadence) must be detected as biweekly, not forced monthly.
console.log("\n== Scenario M: parseLedgerCSV (tolerant mode-based + biweekly) ==");
const ledgerRowsM = [
  ["Date", "Item", "Direction", "Amount"],
  // Rent: monthly, mostly the 1st but ONE month lands on the 3rd -> mode day
  // must still be 1, and the amount is constant -> open-ended (reaches Jan).
  ["2026-09-01", "Rent", "out", "1500"], ["2026-10-03", "Rent", "out", "1500"],
  ["2026-11-01", "Rent", "out", "1500"], ["2026-12-01", "Rent", "out", "1500"], ["2027-01-01", "Rent", "out", "1500"],
  // Spotify: constant, monthly, but stops in Dec while other items continue
  // into Jan -> recurring, capped at its last real occurrence.
  ["2026-09-08", "Spotify", "out", "12.99"], ["2026-10-08", "Spotify", "out", "12.99"],
  ["2026-11-08", "Spotify", "out", "12.99"], ["2026-12-08", "Spotify", "out", "12.99"],
  // Student loan: $200 once, $400 twice -> NO amount reaches the >=3-occurrence
  // support threshold -> must stay one-offs with each real amount preserved.
  ["2026-09-15", "Student loan", "out", "200"], ["2026-10-15", "Student loan", "out", "400"], ["2026-11-15", "Student loan", "out", "400"],
  ["2026-10-05", "Dresser", "out", "300"], ["2026-11-12", "Flight", "out", "450"], ["2026-12-20", "Truck", "out", "8000"],
  // Roth IRA: BIWEEKLY (not monthly), and a genuine rate change ($500 -> $600)
  // with 6 and 4 occurrences respectively -> mode ($500, more support) wins,
  // amount-varied warning fires, still recurring and open-ended (last
  // occurrence's next charge is well past the file's overall end).
  ["2026-09-05", "Roth IRA", "out", "500"], ["2026-09-19", "Roth IRA", "out", "500"],
  ["2026-10-03", "Roth IRA", "out", "500"], ["2026-10-17", "Roth IRA", "out", "500"],
  ["2026-10-31", "Roth IRA", "out", "500"], ["2026-11-14", "Roth IRA", "out", "500"],
  ["2026-11-28", "Roth IRA", "out", "600"], ["2026-12-12", "Roth IRA", "out", "600"],
  ["2026-12-26", "Roth IRA", "out", "600"], ["2027-01-09", "Roth IRA", "out", "600"],
  // Gas: BIWEEKLY with slightly irregular gaps (13-15 days, not exactly 14) ->
  // must still be detected as biweekly via the gap tolerance band.
  ["2026-09-03", "Gas", "out", "40"], ["2026-09-16", "Gas", "out", "40"], ["2026-09-30", "Gas", "out", "40"],
  ["2026-10-14", "Gas", "out", "40"], ["2026-10-29", "Gas", "out", "40"], ["2026-11-12", "Gas", "out", "40"],
  ["2026-11-26", "Gas", "out", "40"], ["2026-12-10", "Gas", "out", "40"], ["2026-12-24", "Gas", "out", "40"],
  ["2027-01-07", "Gas", "out", "40"],
  ["2026-09-07", "EverBank savings", "out", "200"], ["2026-10-07", "EverBank savings", "out", "200"],
  ["2026-11-07", "EverBank savings", "out", "200"], ["2026-12-07", "EverBank savings", "out", "200"], ["2027-01-07", "EverBank savings", "out", "200"],
  ["2026-09-10", "Brokerage", "out", "300"], ["2026-10-10", "Brokerage", "out", "300"],
  ["2026-11-10", "Brokerage", "out", "300"], ["2026-12-10", "Brokerage", "out", "300"], ["2027-01-10", "Brokerage", "out", "300"],
  // Paycheck: BIWEEKLY, constant amount, extends through Jan -> open-ended.
  ["2026-09-04", "Paycheck", "in", "2000"], ["2026-09-18", "Paycheck", "in", "2000"], ["2026-10-02", "Paycheck", "in", "2000"],
  ["2026-10-16", "Paycheck", "in", "2000"], ["2026-10-30", "Paycheck", "in", "2000"], ["2026-11-13", "Paycheck", "in", "2000"],
  ["2026-11-27", "Paycheck", "in", "2000"], ["2026-12-11", "Paycheck", "in", "2000"], ["2026-12-25", "Paycheck", "in", "2000"],
  ["2027-01-08", "Paycheck", "in", "2000"],
  ["2026-09-12", "Money from Poppy", "in", "100"], ["2026-10-12", "Money from Poppy", "in", "100"],
  ["2026-11-12", "Money from Poppy", "in", "100"], ["2026-12-12", "Money from Poppy", "in", "100"], ["2027-01-12", "Money from Poppy", "in", "100"],
];
const parsedM = parseLedgerCSV(ledgerRowsM.map((r) => r.join(",")).join("\n"), legacyTrackerCategories());

check("total rows parsed", parsedM.totalRows, ledgerRowsM.length - 1);

const rentM = parsedM.recurring.find((r) => r.name === "Rent");
eq("Rent: recurring monthly, bill, open-ended despite one off-day month", [rentM.category, rentM.cadence, rentM.endDate], ["bill", "monthly", null]);
check("Rent dayOfMonth is the MODE (1st), not thrown off by the one 3rd", rentM.dayOfMonth, 1);

const spotifyM = parsedM.recurring.find((r) => r.name === "Spotify");
eq("Spotify recurring but capped (next charge had time to happen and didn't)", spotifyM.endDate, "2026-12-08");

const loanOneoffsM = parsedM.oneoffs.filter((o) => o.name === "Student loan");
check("irregular-amount Student loan -> 3 one-offs (no amount has >=3 support)", loanOneoffsM.length, 3);
check("Student loan Sep amount preserved exactly", loanOneoffsM.find((o) => o.date === "2026-09-15").amount, 200);
check("Student loan Oct amount preserved exactly", loanOneoffsM.find((o) => o.date === "2026-10-15").amount, 400);
eq("a 'not common enough to trust' warning fires for Student loan", parsedM.warnings.some((w) => w.includes("Student loan") && w.includes("common enough to trust")), true);

for (const name of ["Dresser", "Flight", "Truck"]) {
  const o = parsedM.oneoffs.find((x) => x.name === name);
  eq(`${name} is a single one-off categorized "oneoff"`, [!!o, o?.category], [true, "oneoff"]);
}

const rothM = parsedM.recurring.find((r) => r.name === "Roth IRA");
eq("Roth IRA: detected BIWEEKLY (not monthly), category roth, open-ended", [rothM.cadence, rothM.category, rothM.endDate], ["biweekly", "roth", null]);
check("Roth amount uses the MODE ($500, 6 occurrences) over the newer $600 (4)", rothM.amount, 500);
eq("an amount-varied warning fires for Roth IRA", parsedM.warnings.some((w) => w.includes("Roth IRA") && w.includes("varied")), true);

const gasM = parsedM.recurring.find((r) => r.name === "Gas");
eq("Gas: detected biweekly despite 13-15 day (not exactly 14) gaps", [gasM.cadence, gasM.category, gasM.endDate], ["biweekly", "bill", null]);

const paycheckM = parsedM.recurring.find((r) => r.name === "Paycheck");
eq("Paycheck: detected biweekly (not one-offs), income, open-ended", [paycheckM.cadence, paycheckM.category, paycheckM.endDate], ["biweekly", "income", null]);

eq("EverBank savings / Brokerage categories guessed, both monthly recurring",
  ["EverBank savings", "Brokerage"].map((n) => {
    const r = parsedM.recurring.find((x) => x.name === n);
    return [r?.category, r?.cadence];
  }),
  [["saved", "monthly"], ["brokerage", "monthly"]]);

const poppyM = parsedM.recurring.find((r) => r.name === "Money from Poppy");
eq("Poppy recurring monthly, income, open-ended", [poppyM.cadence, poppyM.category, poppyM.endDate], ["monthly", "income", null]);

// ---------- Scenario N: hasSeenOnboarding migration (storage.normalize) ----------
console.log("\n== Scenario N: onboarding-seen migration ==");
eq("existing user w/ real data, field never existed -> retroactively marked seen",
  normalize({ recurring: [{ id: "x", name: "Rent", amount: 1500, category: "bill", cadence: "monthly" }], oneoffs: [], settings: {} }).settings.hasSeenOnboarding,
  true);
eq("brand-new user, no data, field absent -> NOT marked seen (should get the wizard)",
  normalize({ recurring: [], oneoffs: [], settings: {} }).settings.hasSeenOnboarding,
  false);
eq("field explicitly false is respected even with data present (not silently flipped)",
  normalize({ recurring: [{ id: "x", name: "Rent", amount: 1500, category: "bill", cadence: "monthly" }], oneoffs: [], settings: { hasSeenOnboarding: false } }).settings.hasSeenOnboarding,
  false);
eq("field explicitly true is preserved",
  normalize({ recurring: [], oneoffs: [], settings: { hasSeenOnboarding: true } }).settings.hasSeenOnboarding,
  true);

// ---------- Scenario O: tracker-category CRUD (mutate.js) ----------
console.log("\n== Scenario O: addCategory / updateCategory / deleteCategory / moveCategory ==");
let sO = { trackerCategories: legacyTrackerCategories() }; // roth(0), saved(1), brokerage(2), loans(3)

sO = addCategory(sO, "Crypto", 6);
const cryptoId = sO.trackerCategories.find((c) => c.name === "Crypto").id;
check("addCategory appends with order = max+1", sO.trackerCategories.find((c) => c.id === cryptoId).order, 4);
check("addCategory total count", sO.trackerCategories.length, 5);

sO = updateCategory(sO, cryptoId, { name: "Crypto Wallet", color: 7 });
eq("updateCategory renames", sO.trackerCategories.find((c) => c.id === cryptoId).name, "Crypto Wallet");
check("updateCategory recolors", sO.trackerCategories.find((c) => c.id === cryptoId).color, 7);
eq("updateCategory leaves other categories alone", sO.trackerCategories.find((c) => c.id === "roth").name, "Roth");

sO = moveCategory(sO, "saved", -1); // swap saved(order1) up past roth(order0)
check("moveCategory: saved now order 0", sO.trackerCategories.find((c) => c.id === "saved").order, 0);
check("moveCategory: roth now order 1", sO.trackerCategories.find((c) => c.id === "roth").order, 1);
const beforeMoveTop = sO.trackerCategories.find((c) => c.order === Math.min(...sO.trackerCategories.map((c) => c.order)));
const movedPastTop = moveCategory(sO, beforeMoveTop.id, -1); // already first -> no-op
eq("moveCategory: moving the first item up is a no-op", movedPastTop, sO);
const lastCat = sO.trackerCategories.find((c) => c.order === Math.max(...sO.trackerCategories.map((c) => c.order)));
const movedPastBottom = moveCategory(sO, lastCat.id, 1); // already last -> no-op
eq("moveCategory: moving the last item down is a no-op", movedPastBottom, sO);

sO = deleteCategory(sO, cryptoId);
check("deleteCategory removes it", sO.trackerCategories.length, 4);
eq("deleteCategory leaves the rest untouched", sO.trackerCategories.some((c) => c.id === "roth"), true);

// deleting a category never touches items still tagged with it — an
// orphaned id just falls into budgetLayout's trailing "Uncategorized"
// cluster (already covered by Scenario J's null-cluster logic) rather than
// being reassigned or blocking the delete.
const stateOrphan = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-01", budgetHorizon: "2026-10-01",
    ledgerHorizon: "2026-10-01", theme: "light" },
  recurring: [
    { id: "orphan-1", name: "Old Crypto Stash", amount: 100, category: cryptoId, cadence: "monthly", startDate: "2026-09-01", order: 0 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: sO.trackerCategories, // cryptoId no longer exists here
};
const budgetOrphan = computeBudget(stateOrphan, stateOrphan.settings.budgetHorizon);
const layoutOrphan = computeBudgetLayout(budgetOrphan, stateOrphan.trackerCategories);
eq("an orphaned category's item still renders, in the trailing null cluster",
  layoutOrphan.savingGroups[layoutOrphan.savingGroups.length - 1], ["Old Crypto Stash"]);
check("paletteColor falls back to gray for an orphaned/out-of-range index (light)",
  paletteColor(999, false) === "#6b7280" ? 1 : 0, 1);
check("paletteColor falls back to gray for an orphaned/out-of-range index (dark)",
  paletteColor(999, true) === "#9ca3af" ? 1 : 0, 1);

// ---------- Scenario P: trackerCategories migration (stateShape.normalize) ----------
console.log("\n== Scenario P: trackerCategories migration ==");
const existingUser = normalize({
  recurring: [{ id: "x", name: "Rent", amount: 1500, category: "bill", cadence: "monthly" }],
  oneoffs: [],
  settings: {},
});
eq("existing user with real data, field never existed -> legacy 4 categories seeded, same ids",
  existingUser.trackerCategories.map((c) => c.id).sort(),
  ["brokerage", "loans", "roth", "saved"].sort());

const newUser = normalize({ recurring: [], oneoffs: [], settings: {} });
check("brand-new user, no data -> gets the 3 fresh defaults, not the legacy 4",
  newUser.trackerCategories.length, 3);

const explicitEmpty = normalize({ recurring: [], oneoffs: [], settings: {}, trackerCategories: [] });
eq("an explicitly-cleared (empty array) trackerCategories is respected, not re-seeded",
  explicitEmpty.trackerCategories, []);

const explicitCustom = normalize({
  recurring: [], oneoffs: [], settings: {},
  trackerCategories: [{ id: "z1", name: "My Fund", color: 4, order: 0 }],
});
eq("an existing custom trackerCategories list passes through untouched except for the kind backfill",
  explicitCustom.trackerCategories, [{ id: "z1", name: "My Fund", color: 4, order: 0, kind: "asset" }]);

// ---------- Scenario P2: `kind` (asset/debt) backfill migration ----------
console.log("\n== Scenario P2: category `kind` backfill (loan-amortization feature) ==");
eq("legacy migration: the legacy 'loans' id is retroactively marked debt automatically",
  existingUser.trackerCategories.find((c) => c.id === "loans").kind, "debt");
eq("legacy migration: roth/saved/brokerage default to asset",
  ["roth", "saved", "brokerage"].map((id) => existingUser.trackerCategories.find((c) => c.id === id).kind),
  ["asset", "asset", "asset"]);
eq("brand-new account: the fresh 'Debt' default is kind debt, others asset",
  newUser.trackerCategories.map((c) => c.kind),
  ["asset", "asset", "debt"]);

const preLoanFeatureCustom = normalize({
  recurring: [], oneoffs: [], settings: {},
  trackerCategories: [
    { id: "z1", name: "Car Loan", color: 4, order: 0 },      // predates `kind` entirely, name reads as debt
    { id: "z2", name: "House Fund", color: 1, order: 1 },    // predates `kind`, name reads as asset
    { id: "z3", name: "Credit Card", color: 6, order: 2, kind: "asset" }, // has an explicit kind -> respected, not overridden by the name heuristic
  ],
});
eq("an already-saved category with no `kind` yet gets inferred from its name (debt)",
  preLoanFeatureCustom.trackerCategories.find((c) => c.id === "z1").kind, "debt");
eq("an already-saved category with no `kind` yet gets inferred from its name (asset default)",
  preLoanFeatureCustom.trackerCategories.find((c) => c.id === "z2").kind, "asset");
eq("an explicit `kind` already set is NEVER overridden by the name heuristic",
  preLoanFeatureCustom.trackerCategories.find((c) => c.id === "z3").kind, "asset");

// ---------- Scenario Q: fund-balance progress (anchor + contributions since) ----------
console.log("\n== Scenario Q: computeCategoryProgress / computeCategoryHistory ==");
const stateQ = {
  settings: { checkInBalance: 0, checkInDate: "2026-01-01", budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01", theme: "light" },
  recurring: [
    { id: "sav-dep", name: "Savings deposit", amount: 100, category: "sav", cadence: "monthly", startDate: "2026-01-05", dayOfMonth: 5, order: 0 },
    { id: "inv-dep", name: "Investment deposit", amount: 50, category: "inv", cadence: "monthly", startDate: "2026-01-10", dayOfMonth: 10, order: 1 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: [
    { id: "sav", name: "Savings", color: 2, order: 0 },
    { id: "inv", name: "Investments", color: 5, order: 1 },
  ],
  balanceSnapshots: {
    sav: [
      { id: "s1", date: "2026-01-01", amount: 1000 },
      { id: "s2", date: "2026-03-01", amount: 1350 },
    ],
  },
  monthlyActuals: {},
};

// History: snapshot s2's "expected at the time" = s1's 1000 + deposits
// strictly after 2026-01-01 through 2026-03-01 (Jan5, Feb5 = 200; Mar5 is
// AFTER the snapshot date, correctly excluded) = 1200. Actual was 1350 ->
// variance +150.
const histQ = computeCategoryHistory(stateQ, "sav");
check("history: first snapshot's own expected = itself (no prior anchor)", histQ[0].expected, 1000);
check("history: first snapshot's variance = 0", histQ[0].variance, 0);
check("history: second snapshot's expected (1000 + Jan/Feb deposits)", histQ[1].expected, 1200);
check("history: second snapshot's variance (1350 actual vs 1200 expected)", histQ[1].variance, 150);

// Live "expected now" as of 2026-04-01: last snapshot (1350 @ 2026-03-01) +
// Mar5's deposit (100, after the snapshot, on/before asOf) = 1450. Apr5 is
// after asOf, correctly excluded.
const progQ = computeCategoryProgress(stateQ, "sav", "2026-04-01");
check("progress: expectedNow anchors off the LAST snapshot, not from zero", progQ.expectedNow, 1450);
eq("progress: latest is the most recent snapshot", progQ.latest.id, "s2");

// No snapshot ever logged for "inv" -> falls back to from-zero cumulative
// (today's Ledger-stepping behavior), exactly like before this feature existed.
const progInv = computeCategoryProgress(stateQ, "inv", "2026-03-15");
eq("progress: no snapshot -> latest is null", progInv.latest, null);
check("progress: no snapshot -> expectedNow sums ALL contributions from zero (Jan10+Feb10+Mar10)", progInv.expectedNow, 150);
eq("history: no snapshots ever -> empty array, not a crash", computeCategoryHistory(stateQ, "inv"), []);

// ---------- Scenario R: variable-bill monthly actuals override the estimate ----------
console.log("\n== Scenario R: setMonthlyActual / deleteMonthlyActual + generate.js override ==");
let stateR = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-01", budgetHorizon: "2026-11-01", ledgerHorizon: "2026-11-01", theme: "light" },
  recurring: [
    { id: "elec", name: "Electric", amount: 150, category: "bill", cadence: "monthly", startDate: "2026-09-05", dayOfMonth: 5, order: 0, variable: true },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: [],
  balanceSnapshots: {},
  monthlyActuals: {},
};

let eventsR = buildAllEvents(stateR, "2026-11-06");
check("before logging an actual: Sep event uses the flat estimate", eventsR.find((e) => e.date === "2026-09-05").amount, 150);
eq("before logging an actual: isActual is false", eventsR.find((e) => e.date === "2026-09-05").isActual, false);

stateR = setMonthlyActual(stateR, "elec", "2026-09", 187.34);
eventsR = buildAllEvents(stateR, "2026-11-06");
check("after logging Sep's actual: Sep event uses the real amount", eventsR.find((e) => e.date === "2026-09-05").amount, 187.34);
eq("after logging Sep's actual: isActual is true", eventsR.find((e) => e.date === "2026-09-05").isActual, true);
check("Oct's event is untouched (no actual logged for 2026-10)", eventsR.find((e) => e.date === "2026-10-05").amount, 150);
eq("Oct's event isActual is false", eventsR.find((e) => e.date === "2026-10-05").isActual, false);

eq("computeMonthVariance: a month with a logged actual",
  computeMonthVariance(stateR.recurring[0], stateR.monthlyActuals, "2026-09"),
  { monthKey: "2026-09", occurrences: 1, expected: 150, actual: 187.34, delta: 37.34 });
eq("computeMonthVariance: a month with no actual logged yet",
  computeMonthVariance(stateR.recurring[0], stateR.monthlyActuals, "2026-10"),
  { monthKey: "2026-10", occurrences: 1, expected: 150, actual: null, delta: null });

stateR = deleteMonthlyActual(stateR, "elec", "2026-09");
eventsR = buildAllEvents(stateR, "2026-11-06");
check("deleting the actual reverts Sep's event back to the estimate", eventsR.find((e) => e.date === "2026-09-05").amount, 150);

eq("lastMonthKeys: last 3 months ending at the anchor's month", lastMonthKeys("2026-09-15", 3), ["2026-07", "2026-08", "2026-09"]);

// ---------- Scenario S: balance-snapshot CRUD (mutate.js) — fully editable/deletable ----------
console.log("\n== Scenario S: addBalanceSnapshot / updateBalanceSnapshot / deleteBalanceSnapshot ==");
let sS = { balanceSnapshots: {} };
sS = addBalanceSnapshot(sS, "sav", 500, "2026-09-01");
check("addBalanceSnapshot creates the category's list", sS.balanceSnapshots.sav.length, 1);
const snapId = sS.balanceSnapshots.sav[0].id;
check("addBalanceSnapshot stores the amount", sS.balanceSnapshots.sav[0].amount, 500);

sS = updateBalanceSnapshot(sS, "sav", snapId, { amount: 525 });
check("updateBalanceSnapshot corrects a fat-fingered amount in place", sS.balanceSnapshots.sav[0].amount, 525);
eq("updateBalanceSnapshot leaves the date untouched when not patched", sS.balanceSnapshots.sav[0].date, "2026-09-01");

sS = deleteBalanceSnapshot(sS, "sav", snapId);
eq("deleteBalanceSnapshot removes it entirely, not just zeroes it", sS.balanceSnapshots.sav, []);

// ---------- Scenario T: new fields survive/default correctly through normalize() ----------
console.log("\n== Scenario T: balanceSnapshots/monthlyActuals migration safety ==");
const existingUserNoNewFields = normalize({
  recurring: [{ id: "x", name: "Rent", amount: 1500, category: "bill", cadence: "monthly" }],
  oneoffs: [],
  settings: {},
});
eq("an existing account predating these fields gets empty defaults, not undefined/a crash",
  [existingUserNoNewFields.balanceSnapshots, existingUserNoNewFields.monthlyActuals], [{}, {}]);
eq("...and existing data is completely untouched by that migration",
  existingUserNoNewFields.recurring.map((r) => r.name), ["Rent"]);

const existingUserWithData = normalize({
  recurring: [],
  oneoffs: [],
  settings: {},
  balanceSnapshots: { sav: [{ id: "s1", date: "2026-01-01", amount: 1000 }] },
  monthlyActuals: { elec: { "2026-09": 187.34 } },
});
eq("existing logged actuals pass through normalize() untouched",
  existingUserWithData.balanceSnapshots, { sav: [{ id: "s1", date: "2026-01-01", amount: 1000 }] });
eq("existing monthly actuals pass through normalize() untouched",
  existingUserWithData.monthlyActuals, { elec: { "2026-09": 187.34 } });

// ---------- Scenario U: variable bill on a non-monthly cadence (the groceries/gas gap) ----------
console.log("\n== Scenario U: even-split of a variable bill's actual across a multi-instance month ==");
let stateU = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-01", budgetHorizon: "2026-11-01", ledgerHorizon: "2026-11-01", theme: "light" },
  recurring: [
    { id: "gas", name: "Gas", amount: 40, category: "bill", cadence: "biweekly", startDate: "2026-09-03", order: 0, variable: true },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: [],
  balanceSnapshots: {},
  monthlyActuals: {},
};

eq("occurrenceDates: Gas fires 2x in September, 3x in October (2 vs 3 paydays, same shape)",
  occurrenceDates(stateU.recurring[0], "2026-10-31").filter((d) => d < "2026-11-01").map((d) => d.slice(0, 7)),
  ["2026-09", "2026-09", "2026-10", "2026-10", "2026-10"]);

check("computeMonthVariance (no actual yet): Sep expected = $40 x 2 occurrences",
  computeMonthVariance(stateU.recurring[0], stateU.monthlyActuals, "2026-09").expected, 80);
check("computeMonthVariance (no actual yet): Oct expected = $40 x 3 occurrences",
  computeMonthVariance(stateU.recurring[0], stateU.monthlyActuals, "2026-10").expected, 120);

stateU = setMonthlyActual(stateU, "gas", "2026-09", 84);
let eventsU = buildAllEvents(stateU, "2026-10-05");
const sepGasEvents = eventsU.filter((e) => e.id.startsWith("gas@") && e.date.slice(0, 7) === "2026-09");
check("Sep's logged $84 total splits evenly across its 2 instances -> $42 each", sepGasEvents[0].amount, 42);
check("...and the second instance too", sepGasEvents[1].amount, 42);
eq("both Sep instances are flagged isActual", sepGasEvents.map((e) => e.isActual), [true, true]);
const octGasEvent = eventsU.find((e) => e.id === "gas@2026-10-01");
check("October is untouched (no actual logged for it) -> still the $40 estimate", octGasEvent.amount, 40);
eq("October isActual is false", octGasEvent.isActual, false);

eq("computeMonthVariance's full shape after logging (includes occurrences)",
  computeMonthVariance(stateU.recurring[0], stateU.monthlyActuals, "2026-09"),
  { monthKey: "2026-09", occurrences: 2, expected: 80, actual: 84, delta: 4 });

// ---------- Scenario V: computeContributionsByYear ----------
console.log("\n== Scenario V: computeContributionsByYear ==");
const stateV = {
  settings: { checkInBalance: 0, checkInDate: "2025-01-01", budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01", theme: "light" },
  recurring: [
    { id: "roth-v", name: "Roth IRA", amount: 500, category: "roth", cadence: "monthly", startDate: "2025-01-05", dayOfMonth: 5, order: 0 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: [],
  balanceSnapshots: {},
  monthlyActuals: {},
};
eq("contributions grouped by year, most recent first (2025: 12mo, 2026: 6mo of $500)",
  computeContributionsByYear(stateV, "roth", "2026-06-30"), { "2026": 3000, "2025": 6000 });
eq("a category with zero transactions -> empty object, not a crash",
  computeContributionsByYear(stateV, "nonexistent", "2026-06-30"), {});

// ---------- Scenario Y: full JSON backup restore (isPlausibleBackup + normalize round-trip) ----------
console.log("\n== Scenario Y: backup validation + export/restore round-trip ==");
const realState = {
  settings: { checkInBalance: 3200.55, checkInDate: "2026-09-01", budgetHorizon: "2026-12-01",
    ledgerHorizon: "2026-12-01", theme: "dark", visibleTrackerCategoryIds: ["roth"], hasSeenOnboarding: true },
  recurring: [
    { id: "rent", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", dayOfMonth: 2, order: 0, color: null },
    { id: "elec", name: "Electric", amount: 120, category: "bill", cadence: "monthly", startDate: "2026-09-05", dayOfMonth: 5, order: 1, variable: true, color: 1 },
    { id: "loan1", name: "Student Loan", amount: 220, category: "debt", cadence: "monthly", startDate: "2026-01-15", dayOfMonth: 15, order: 2, originalPrincipal: 18000, interestRate: 5.8 },
  ],
  oneoffs: [{ id: "gift", name: "Birthday gift", amount: 60, category: "oneoff", date: "2026-09-20", order: 3 }],
  paidOverrides: { "2026-09": ["rent"] },
  trackerCategories: [
    { id: "roth", name: "Roth", color: 5, order: 0, kind: "asset" },
    { id: "debt", name: "Debt", color: 1, order: 1, kind: "debt" },
  ],
  balanceSnapshots: { roth: [{ id: "s1", date: "2026-08-01", amount: 9100 }], debt: [{ id: "s2", date: "2026-08-01", amount: 18500 }] },
  monthlyActuals: { elec: { "2026-08": 98.2 } },
};

// Simulates exactly what ExportMenu -> file -> ImportCSV's handleFile does:
// JSON.stringify to a file, then JSON.parse back out of it.
const roundTripped = JSON.parse(JSON.stringify(realState));
eq("isPlausibleBackup accepts a real exported state", isPlausibleBackup(roundTripped), true);

const restored = normalize(roundTripped);
const expectedNormalized = normalize(realState);
eq("normalize(exported-then-reimported state) matches normalize(original) exactly — nothing lost in the round trip",
  restored, expectedNormalized);
check("...the loan's terms now live on its CATEGORY (loan model) and survive the round trip", restored.trackerCategories.find((c) => c.id === "debt").originalPrincipal, 18000);
eq("...and the payment item is stripped of loan fields but keeps its category", [restored.recurring.find((r) => r.id === "loan1").originalPrincipal, restored.recurring.find((r) => r.id === "loan1").category], [undefined, "debt"]);
eq("...the variable flag survives", restored.recurring.find((r) => r.id === "elec").variable, true);
eq("...balanceSnapshots survive, both categories", countSnapshots(restored.balanceSnapshots), 2);
eq("...monthlyActuals survive", countMonthlyActuals(restored.monthlyActuals), 1);
eq("...paidOverrides survive", restored.paidOverrides, { "2026-09": ["rent"] });

// A backup from BEFORE trackerCategories/balanceSnapshots/monthlyActuals/kind
// existed still restores safely — normalize()'s existing migrations apply
// exactly as they would on a normal load, not a separate weaker path.
const oldBackup = {
  settings: { checkInBalance: 500, checkInDate: "2026-01-01" },
  recurring: [{ id: "x", name: "Rent", amount: 1000, category: "bill", cadence: "monthly" }],
  oneoffs: [],
};
eq("isPlausibleBackup accepts an old-shaped backup (just needs recurring/oneoffs arrays)", isPlausibleBackup(oldBackup), true);
const restoredOld = normalize(oldBackup);
check("an old backup gets trackerCategories seeded on restore, same as any old load", restoredOld.trackerCategories.length, 4);
eq("...and balanceSnapshots/monthlyActuals default to empty, not crash", [restoredOld.balanceSnapshots, restoredOld.monthlyActuals], [{}, {}]);

// Garbage rejection — never let the app crash trying to restore a file
// that just isn't one of its own backups.
eq("isPlausibleBackup rejects null", isPlausibleBackup(null), false);
eq("isPlausibleBackup rejects an empty object", isPlausibleBackup({}), false);
eq("isPlausibleBackup rejects unrelated JSON", isPlausibleBackup({ foo: "bar", count: 3 }), false);
eq("isPlausibleBackup rejects wrong-typed recurring/oneoffs", isPlausibleBackup({ recurring: "nope", oneoffs: [] }), false);
eq("isPlausibleBackup rejects a bare array", isPlausibleBackup([1, 2, 3]), false);
eq("isPlausibleBackup rejects a string", isPlausibleBackup("just some text"), false);

// ---------- Scenario Z: Budget's last-column truncation bug (2026-09-12) ----------
// The reported bug: the Budget grid's LAST column went blank for most
// bills. Cause: horizonISO always shares checkInDate's day-of-month (the
// horizon slider adds whole months to checkInDate), but event generation
// used to stop at that exact DATE — so anything due later in the horizon's
// own month than checkInDate's day never generated an event for that
// final month at all, even though the column is presented as covering the
// whole month.
console.log("\n== Scenario Z: Budget's last column now covers the WHOLE final month ==");
const stateZ = {
  settings: { checkInBalance: 0, checkInDate: "2026-09-05", budgetHorizon: "2026-11-05", ledgerHorizon: "2026-11-05", theme: "light" },
  recurring: [
    // due on the 25th — well after checkInDate's "5th." With the bug,
    // November's occurrence (Nov 25) is after the horizon's exact date
    // (Nov 5) and would never be generated, leaving the last column blank
    // for this bill despite it being a perfectly ordinary monthly bill.
    { id: "rent-z", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-25", dayOfMonth: 25, order: 0 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: [],
  balanceSnapshots: {},
  monthlyActuals: {},
};
const budgetZ = computeBudget(stateZ, stateZ.settings.budgetHorizon);
const monthKeysZ = budgetZ.map((c) => c.key);
eq("3 columns: Sep, Oct, Nov (checkInDate's month through horizon's month)", monthKeysZ, ["2026-09", "2026-10", "2026-11"]);
check("Sep (not the last column) already had Rent correctly", budgetZ.find((c) => c.key === "2026-09").expenseItems.Rent?.val, 1500);
check("Oct (not the last column) already had Rent correctly", budgetZ.find((c) => c.key === "2026-10").expenseItems.Rent?.val, 1500);
check("Nov (the LAST column) now ALSO has Rent — this was the bug: Rent due the 25th, horizon date is only the 5th",
  budgetZ.find((c) => c.key === "2026-11").expenseItems.Rent?.val, 1500);
check("Nov's TOTAL OUT correctly includes the Nov 25th Rent, not $0", budgetZ.find((c) => c.key === "2026-11").totalOut, 1500);

// ---------- Scenario AA: account-shaped migration (Phase 1 rebuild) ----------
// The state shape the user's Supabase row is in RIGHT NOW: an implicit
// checking balance in settings, items with no accountId, no `accounts` key.
// Every number below must survive the migration to the cent/day.
console.log("\n== Scenario AA: legacy checkInBalance -> accounts[] migration ==");
const legacyAA = {
  settings: { checkInBalance: 4210.55, checkInDate: "2026-09-08", budgetHorizon: "2027-06-08",
    ledgerHorizon: "2027-09-08", theme: "dark", visibleTrackerCategoryIds: ["roth"], hasSeenOnboarding: true },
  recurring: [
    { id: "pay", name: "Paycheck", amount: 2200, category: "income", cadence: "biweekly", startDate: "2026-09-04", order: 0 },
    { id: "rent", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", dayOfMonth: 2, order: 1 },
    { id: "roth-aa", name: "Roth IRA", amount: 500, category: "roth", cadence: "monthly", startDate: "2026-01-05", dayOfMonth: 5, order: 2 },
  ],
  oneoffs: [{ id: "gift", name: "Gift", amount: 60, category: "oneoff", date: "2026-09-20", order: 3 }],
  paidOverrides: { "2026-09": ["rent"] },
  trackerCategories: [{ id: "roth", name: "Roth", color: 5, order: 0, kind: "asset" }],
  balanceSnapshots: { roth: [{ id: "s1", date: "2026-08-01", amount: 9100 }] },
  monthlyActuals: {},
};
const migratedAA = normalize(legacyAA);

check("exactly one account is created", migratedAA.accounts.length, 1);
eq("...with the stable primary id", migratedAA.accounts[0].id, PRIMARY_ACCOUNT_ID);
eq("...kind checking, named Checking", [migratedAA.accounts[0].kind, migratedAA.accounts[0].name], ["checking", "Checking"]);
check("balance carried over to the cent", migratedAA.accounts[0].balance, 4210.55);
eq("verified date carried over to the day", migratedAA.accounts[0].balanceAsOf, "2026-09-08");
eq("every recurring item stamped with the account", migratedAA.recurring.map((r) => r.accountId), ["checking", "checking", "checking"]);
eq("every one-off stamped with the account", migratedAA.oneoffs.map((o) => o.accountId), ["checking"]);
eq("history seeded with exactly the verified balance, once",
  migratedAA.accountSnapshots.checking, [{ id: "seed-checking", date: "2026-09-08", amount: 4210.55 }]);
// Phase 2: the Phase 1 rollback mirror is retired — the legacy fields are
// STRIPPED from the saved blob, while the legacy READ path (which built the
// account above from exactly those fields) keeps working forever.
eq("Phase 2: legacy checkInBalance/checkInDate are stripped from settings (accounts[0] is the only source of truth)",
  [migratedAA.settings.checkInBalance, migratedAA.settings.checkInDate], [undefined, undefined]);
eq("nothing unrelated was touched (categories, category snapshots, paidOverrides, settings extras)",
  [migratedAA.trackerCategories, migratedAA.balanceSnapshots, migratedAA.paidOverrides, migratedAA.settings.theme, migratedAA.settings.visibleTrackerCategoryIds],
  [legacyAA.trackerCategories, legacyAA.balanceSnapshots, legacyAA.paidOverrides, "dark", ["roth"]]);

// Idempotent: normalize runs on EVERY load. A second pass must change nothing
// — no second seed, no re-stamping, byte-identical.
eq("normalize(normalize(x)) === normalize(x) — safe to reload forever", normalize(migratedAA), migratedAA);
eq("two independent migrations of the same legacy state are byte-identical (deterministic seed id)",
  normalize(legacyAA), migratedAA);

// The whole point: the numbers must not move. Compute on the RAW legacy
// state (primaryAccount's fallback path) vs. the migrated state (accounts
// path) — identical, row for row.
const ledgerLegacy = computeLedger(legacyAA, legacyAA.settings.ledgerHorizon);
const ledgerMigrated = computeLedger(migratedAA, migratedAA.settings.ledgerHorizon);
check("ledger ending balance identical before/after", ledgerMigrated.endingBalance, ledgerLegacy.endingBalance);
check("ledger row count identical", ledgerMigrated.rows.length, ledgerLegacy.rows.length);
eq("every ledger row's date/amount/running balance identical",
  ledgerMigrated.rows.map((r) => [r.date, r.amount, r.balance]),
  ledgerLegacy.rows.map((r) => [r.date, r.amount, r.balance]));
const budgetLegacy = computeBudget(legacyAA, legacyAA.settings.budgetHorizon);
const budgetMigrated = computeBudget(migratedAA, migratedAA.settings.budgetHorizon);
eq("every budget column identical (starting point, take-home, totals, cumulative)",
  budgetMigrated.map((c) => [c.key, c.startingPoint, c.takeHome, c.totalIn, c.totalOut, c.cumulative]),
  budgetLegacy.map((c) => [c.key, c.startingPoint, c.takeHome, c.totalIn, c.totalOut, c.cumulative]));
check("first budget column still anchors to the VERIFIED month, not today (gap transactions must not vanish)",
  budgetMigrated[0].key === "2026-09" ? 1 : 0, 1);

// The confirm flow: one atomic transition.
const afterUpdate = updateAccountBalance(migratedAA, "checking", 3990.1, "2026-09-12");
check("updateAccountBalance: new balance", afterUpdate.accounts[0].balance, 3990.1);
eq("updateAccountBalance: new as-of date", afterUpdate.accounts[0].balanceAsOf, "2026-09-12");
check("updateAccountBalance: a history snapshot appended (seed + new = 2)", afterUpdate.accountSnapshots.checking.length, 2);
eq("updateAccountBalance: the new snapshot has the right date/amount",
  [afterUpdate.accountSnapshots.checking[1].date, afterUpdate.accountSnapshots.checking[1].amount], ["2026-09-12", 3990.1]);
eq("updateAccountBalance no longer touches settings at all (Phase 1 mirror retired)", afterUpdate.settings, migratedAA.settings);
check("...and the ledger now anchors off the new balance", computeLedger(afterUpdate, afterUpdate.settings.ledgerHorizon).rows[0].balance > 0 ? 1 : 0, 1);
eq("moving the anchor date forward drops the now-already-counted Sep 4 paycheck (correct: it's inside the new verified number)",
  computeLedger(afterUpdate, afterUpdate.settings.ledgerHorizon).rows.some((r) => r.date < "2026-09-12"), false);

// History stays editable/deletable like everything else the user logs.
const acctSnapId = afterUpdate.accountSnapshots.checking[1].id;
check("updateAccountSnapshot corrects an amount in place", updateAccountSnapshot(afterUpdate, "checking", acctSnapId, { amount: 4000 }).accountSnapshots.checking[1].amount, 4000);
check("deleteAccountSnapshot removes exactly that entry", deleteAccountSnapshot(afterUpdate, "checking", acctSnapId).accountSnapshots.checking.length, 1);

// New items get the account silently (no picker with a single account).
const stamped = upsertItem(migratedAA, { id: "new1", name: "Spotify", amount: 12, category: "bill", cadence: "monthly", startDate: "2026-09-10" });
eq("upsertItem stamps a brand-new item with the primary account", stamped.recurring.find((r) => r.id === "new1").accountId, "checking");
eq("primaryAccount() on a raw legacy fixture falls back to settings (why every older scenario above still passes untouched)",
  [primaryAccount(legacyAA).balance, primaryAccount(legacyAA).balanceAsOf], [4210.55, "2026-09-08"]);

// Backup round-trip carries the new fields.
eq("export -> import -> normalize keeps accounts + accountSnapshots exactly",
  [normalize(JSON.parse(JSON.stringify(afterUpdate))).accounts, normalize(JSON.parse(JSON.stringify(afterUpdate))).accountSnapshots],
  [afterUpdate.accounts, afterUpdate.accountSnapshots]);

// ---------- Scenario W: loan model — the CATEGORY is the loan, payments are tagged transactions ----------
// Mirrors assets: terms live on the debt-kind category, the outstanding
// balance is a logged snapshot, a payment is any transaction tagged to it.
// The amortization anchors to the LAST LOGGED balance (start-of-day
// semantics: a payment dated the same day still counts against it).
console.log("\n== Scenario W: category-is-the-loan amortization ==");
const loanCat = { id: "sl", name: "Student Loan", color: 3, order: 0, kind: "debt", originalPrincipal: 1000, interestRate: 12, interestStartDate: null };
const payA = { id: "payA", name: "Student Loan payment", amount: 100, category: "sl", cadence: "monthly", startDate: "2026-01-05", dayOfMonth: 5, order: 0 };
const acctW = [{ id: "checking", name: "Checking", kind: "checking", balance: 0, balanceAsOf: "2026-01-01", order: 0 }];
const stateW = {
  settings: { budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01", theme: "light" },
  accounts: acctW, recurring: [payA], oneoffs: [], paidOverrides: {},
  trackerCategories: [loanCat],
  balanceSnapshots: { sl: [{ id: "s0", date: "2026-01-05", amount: 1000 }] }, // "on Jan 5 I owed $1000" — the seed a migration writes
  accountSnapshots: {}, monthlyActuals: {},
};

// CONTINUITY: the old per-item model (1000 @ 12%, $100/mo from Jan 5) gave
// 716.62 on 2026-03-05. Anchoring to a snapshot of 1000 dated Jan 5 with
// the same payments must reproduce it exactly.
check("continuity: new model from the origination seed == old model (716.62)", computeLoanExpected(stateW, loanCat, "2026-03-05").expected, 716.62);
eq("anchor is the seed snapshot", computeLoanExpected(stateW, loanCat, "2026-03-05").anchor.id, "s0");

// interestStartDate: no interest before it (Jan/Feb payments cut principal 1:1; Mar 5 accrues Mar 1 -> Mar 5 on $800 = 1.05)
const graceCat = { ...loanCat, interestStartDate: "2026-03-01" };
check("interestStartDate: 800 + 1.05 - 100", computeLoanExpected({ ...stateW, trackerCategories: [graceCat] }, graceCat, "2026-03-05").expected, 701.05);
const earlyCat = { ...loanCat, interestStartDate: "2025-01-01" };
check("interestStartDate EARLIER than the anchor is ignored (later-of rule)", computeLoanExpected({ ...stateW, trackerCategories: [earlyCat] }, earlyCat, "2026-03-05").expected, 716.62);

// Trailing interest: a debt keeps accruing after the last payment (5 days on 716.62 @ 12% = 1.18)
check("trailing interest to asOf (Mar 5 -> Mar 10)", computeLoanExpected(stateW, loanCat, "2026-03-10").expected, 717.8);

// ANY transaction tagged to the loan is a payment — a one-off too.
const stateW1 = { ...stateW, oneoffs: [{ id: "extra", name: "Extra payment", amount: 50, category: "sl", date: "2026-02-20", order: 1 }] };
check("a one-off tagged to the loan reduces the balance (900 -> 809.17 -> 763.16 -> 666.42)", computeLoanExpected(stateW1, loanCat, "2026-03-05").expected, 666.42);

// History + progress: the user logs $700 on Mar 5 (start-of-day: the Mar 5
// payment belongs to the NEXT segment).
const stateW2 = { ...stateW, balanceSnapshots: { sl: [{ id: "s0", date: "2026-01-05", amount: 1000 }, { id: "s1", date: "2026-03-05", amount: 700 }] } };
const histW = computeLoanHistory(stateW2, loanCat);
check("history: first snapshot matches itself", histW[0].expected, 1000);
check("history: s1's expected = Jan/Feb payments applied + interest carried to Mar 5 (816.62)", histW[1].expected, 816.62);
check("history: s1's variance (700 - 816.62)", histW[1].variance, -116.62);
check("live projection from s1 on Mar 5 counts the same-day payment: 700 - 100", computeLoanExpected(stateW2, loanCat, "2026-03-05").expected, 600);
const progW = computeLoanProgress(stateW2, loanCat, "2026-03-05");
eq("computeLoanProgress: outstanding = LOGGED balance, percent from it, projection alongside",
  [progW.outstanding, progW.percentPaid, progW.expectedNow, progW.original, progW.interestRate], [700, 30, 600, 1000, 12]);

// Not-set-up / never-logged states never crash or invent numbers.
const bareCat = { id: "bare", name: "Bare", color: 1, order: 1, kind: "debt" };
eq("isLoanConfigured: no originalPrincipal -> false", isLoanConfigured(bareCat), false);
eq("computeLoanProgress on an unconfigured category -> null", computeLoanProgress(stateW, bareCat, "2026-03-05"), null);
eq("configured but never logged -> no anchor, expected null (nothing fabricated from origination)",
  computeLoanExpected({ ...stateW, balanceSnapshots: {} }, loanCat, "2026-03-05"), { anchor: null, expected: null });
eq("history with no snapshots -> []", computeLoanHistory({ ...stateW, balanceSnapshots: {} }, loanCat), []);

// setupLoan: one atomic transition, never a transaction.
const fresh = { ...stateW, trackerCategories: [], balanceSnapshots: {}, recurring: [] };
const setUp = setupLoan(fresh, { name: "Car loan", color: 1, originalPrincipal: 24000, interestRate: 6.5, interestStartDate: null, outstanding: 19850.25, asOf: "2026-09-13" });
check("setupLoan creates exactly one debt category", setUp.trackerCategories.length, 1);
eq("...with the terms and kind debt", [setUp.trackerCategories[0].kind, setUp.trackerCategories[0].originalPrincipal, setUp.trackerCategories[0].interestRate], ["debt", 24000, 6.5]);
eq("...and logs the outstanding balance as the first snapshot", setUp.balanceSnapshots[setUp.trackerCategories[0].id].map((s) => [s.date, s.amount]), [["2026-09-13", 19850.25]]);
check("...and creates NO transaction", setUp.recurring.length + setUp.oneoffs.length, 0);
const edited = setupLoan(setUp, { categoryId: setUp.trackerCategories[0].id, name: "Car loan (refi)", color: 1, originalPrincipal: 24000, interestRate: 4.9, interestStartDate: null });
eq("editing terms patches the category in place", [edited.trackerCategories[0].name, edited.trackerCategories[0].interestRate], ["Car loan (refi)", 4.9]);
check("...without adding a snapshot", edited.balanceSnapshots[setUp.trackerCategories[0].id].length, 1);

// Hero math under the loan model: debt = last LOGGED outstanding per loan;
// a configured-but-never-logged loan is counted as unlogged, not projected.
const stateNet = {
  settings: { budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01", theme: "light" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4210.55, balanceAsOf: "2026-09-08", order: 0 }],
  recurring: [], oneoffs: [], paidOverrides: {},
  trackerCategories: [
    { id: "roth", name: "Roth", color: 5, order: 0, kind: "asset" },
    { id: "brokerage", name: "Brokerage", color: 0, order: 1, kind: "asset" },                    // never logged
    { id: "loans", name: "Student Loans", color: 3, order: 2, kind: "debt", originalPrincipal: 18000, interestRate: 5.8 },
    { id: "cc", name: "Credit Card", color: 4, order: 3, kind: "debt", originalPrincipal: 2400, interestRate: 22 }, // configured, never logged
  ],
  balanceSnapshots: { roth: [{ id: "r1", date: "2026-08-01", amount: 9100 }], loans: [{ id: "d1", date: "2026-08-01", amount: 18500 }] },
  accountSnapshots: {}, monthlyActuals: {},
};
const netW = computeNetPosition(stateNet);
check("net = 4210.55 + 9100 - 18500", netW.net, -5189.45);
eq("unlogged: 1 asset (Brokerage), 1 debt (Credit Card: configured but never logged)", [netW.unloggedAssets, netW.unloggedDebts], [1, 1]);

// ---------- Scenario AC: loan-model migration (loan terms move from the PAYMENT item to the CATEGORY) ----------
// Exactly the user's situation: "Student Loans" is a recurring payment with
// originalPrincipal/interestRate/interestStartDate bolted on. Plus the
// harder cases: a SECOND configured loan-item in the same category, an
// unconfigured item elsewhere, and a user-logged snapshot that must survive.
console.log("\n== Scenario AC: legacy loan-item -> loan-category migration ==");
const legacyAC = {
  settings: { checkInBalance: 500, checkInDate: "2026-09-01", budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01", theme: "light" },
  recurring: [
    { id: "sl-pay", name: "Student Loans", amount: 220, category: "loans", cadence: "monthly", startDate: "2026-01-15", dayOfMonth: 15, order: 0,
      originalPrincipal: 18000, interestRate: 5.8, interestStartDate: "2026-12-01", variable: true },
    { id: "cc-pay", name: "Credit Card", amount: 150, category: "loans", cadence: "monthly", startDate: "2026-06-01", dayOfMonth: 1, order: 1,
      originalPrincipal: 2400, interestRate: 22 },
    { id: "car-pay", name: "Car", amount: 300, category: "carloan", cadence: "monthly", startDate: "2026-05-10", dayOfMonth: 10, order: 2 },
  ],
  oneoffs: [],
  paidOverrides: {},
  trackerCategories: [
    { id: "loans", name: "Loans", color: 3, order: 0, kind: "debt" },
    { id: "carloan", name: "Car Loan", color: 1, order: 1, kind: "debt" },
  ],
  balanceSnapshots: { loans: [{ id: "u1", date: "2026-08-01", amount: 16240 }] },
  monthlyActuals: { "sl-pay": { "2026-09": 220 } },
};
const migAC = normalize(legacyAC);
const loansCat = migAC.trackerCategories.find((c) => c.id === "loans");
eq("Student Loans' terms land on the 'loans' category, to the cent/day",
  [loansCat.originalPrincipal, loansCat.interestRate, loansCat.interestStartDate], [18000, 5.8, "2026-12-01"]);
const slPay = migAC.recurring.find((r) => r.id === "sl-pay");
eq("the Student Loans payment is stripped of loan fields (keys gone, not just null)",
  ["originalPrincipal", "interestRate", "interestStartDate"].some((k) => k in slPay), false);
eq("...but keeps everything else: category, amount, variable flag", [slPay.category, slPay.amount, slPay.variable], ["loans", 220, true]);
eq("the user's own logged snapshot on 'loans' is kept untouched — NOT replaced by a seed",
  migAC.balanceSnapshots.loans, [{ id: "u1", date: "2026-08-01", amount: 16240 }]);
const ccCat = migAC.trackerCategories.find((c) => c.id === "loan-cc-pay");
eq("a SECOND configured loan-item in the same category spawns its own debt category (deterministic id, same color)",
  [ccCat?.name, ccCat?.kind, ccCat?.color, ccCat?.originalPrincipal, ccCat?.interestRate, ccCat?.interestStartDate, ccCat?.order],
  ["Credit Card", "debt", 3, 2400, 22, null, 2]);
const ccPay = migAC.recurring.find((r) => r.id === "cc-pay");
eq("...and its payment is retagged to the new category, stripped of loan fields", [ccPay.category, "originalPrincipal" in ccPay], ["loan-cc-pay", false]);
eq("...with a seeded anchor: originalPrincipal as of the payment's start (a real fact, not a fabricated 'today')",
  migAC.balanceSnapshots["loan-cc-pay"], [{ id: "seed-loan-loan-cc-pay", date: "2026-06-01", amount: 2400 }]);
eq("an unconfigured payment elsewhere is untouched", migAC.recurring.find((r) => r.id === "car-pay"), { ...legacyAC.recurring[2], accountId: "checking" });
eq("its category stays a plain, not-set-up debt category", "originalPrincipal" in migAC.trackerCategories.find((c) => c.id === "carloan"), false);
eq("monthlyActuals survive", migAC.monthlyActuals, legacyAC.monthlyActuals);
eq("idempotent: normalize(normalize(x)) === normalize(x)", normalize(migAC), migAC);
eq("deterministic: two independent migrations are byte-identical", normalize(legacyAC), migAC);
// The numbers must not move: same events, same amounts — only where the
// loan's terms are stored changed.
const ledgerLegacyAC = computeLedger(legacyAC, "2026-12-01");
const ledgerMigAC = computeLedger(migAC, "2026-12-01");
check("ledger ending balance identical before/after", ledgerMigAC.endingBalance, ledgerLegacyAC.endingBalance);
eq("every ledger row's date/amount/balance identical", ledgerMigAC.rows.map((r) => [r.date, r.amount, r.balance]), ledgerLegacyAC.rows.map((r) => [r.date, r.amount, r.balance]));
eq("every budget column's totals identical", computeBudget(migAC, "2026-12-01").map((c) => [c.key, c.totalOut, c.cumulative]), computeBudget(legacyAC, "2026-12-01").map((c) => [c.key, c.totalOut, c.cumulative]));
// And the migrated loan projects exactly as before from its kept snapshot.
check("the migrated Student Loans projects from the user's logged 16240 (Aug 1) with the Aug 15 + Sep 15 payments, no interest before Dec 1",
  computeLoanExpected(migAC, loansCat, "2026-09-15").expected, 15800);

// ---------- Scenario AD: setupAsset (the asset mirror of setupLoan) ----------
console.log("\n== Scenario AD: setupAsset ==");
const baseAD = normalize({
  settings: { checkInBalance: 1000, checkInDate: "2026-09-01", budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01" },
  recurring: [], oneoffs: [], paidOverrides: {}, trackerCategories: [],
});
const catCountAD = baseAD.trackerCategories.length;

// New account WITH an opening balance: one category, one snapshot, no transaction.
const withBalAD = setupAsset(baseAD, { name: "Brokerage", color: 2, balance: 8890, asOf: "2026-09-01" });
const newCatAD = withBalAD.trackerCategories.find((c) => c.name === "Brokerage");
check("adds exactly one category", withBalAD.trackerCategories.length, catCountAD + 1);
eq("it's an asset, not a debt", newCatAD.kind, "asset");
eq("color kept", newCatAD.color, 2);
check("opening balance logged as the first snapshot", withBalAD.balanceSnapshots[newCatAD.id][0].amount, 8890);
eq("snapshot dated as-of", withBalAD.balanceSnapshots[newCatAD.id][0].date, "2026-09-01");
check("creates NO transaction (setup is not a contribution)", withBalAD.recurring.length + withBalAD.oneoffs.length, 0);
check("it shows up in net position as an asset", computeNetPosition(withBalAD).assets, 8890);

// New account WITHOUT a balance: category only, nothing invented.
const noBalAD = setupAsset(baseAD, { name: "Roth IRA", color: 4, balance: null, asOf: null });
const rothAD = noBalAD.trackerCategories.find((c) => c.name === "Roth IRA");
eq("no snapshot fabricated when the balance is left blank", noBalAD.balanceSnapshots[rothAD.id], undefined);
check("counted as unlogged, not as zero", computeNetPosition(noBalAD).unloggedAssets, 1);

// Editing an existing category through the same door renames/recolors it in
// place — it must never spawn a duplicate.
const renamedAD = setupAsset(withBalAD, { categoryId: newCatAD.id, name: "Fidelity brokerage", color: 5 });
check("editing an existing account adds no category", renamedAD.trackerCategories.length, withBalAD.trackerCategories.length);
eq("renamed in place", renamedAD.trackerCategories.find((c) => c.id === newCatAD.id).name, "Fidelity brokerage");
eq("history untouched by an edit", renamedAD.balanceSnapshots[newCatAD.id], withBalAD.balanceSnapshots[newCatAD.id]);

// ---------- Scenario AE: the Budget CSV's starting-balance row label ----------
console.log("\n== Scenario AE: \"Checking\" / legacy \"TD checking\" starting-balance row ==");
const stateAE = normalize({
  settings: { checkInBalance: 4321.98, checkInDate: "2026-09-01", budgetHorizon: "2026-11-01", ledgerHorizon: "2026-11-01" },
  recurring: [{ id: "ae-rent", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-09-02", order: 0 }],
  oneoffs: [], paidOverrides: {}, trackerCategories: [],
});
const csvAE = budgetToCSV(computeBudget(stateAE, "2026-11-01"), stateAE.trackerCategories);
check("export writes the row as \"Checking\"", /(^|\r\n)Checking,/.test(csvAE), true);
check("export no longer writes \"TD checking\"", csvAE.includes("TD checking"), false);
check("a fresh export round-trips its starting balance", parseBudgetCSV(csvAE, stateAE.trackerCategories).checkInBalance, 4321.98);
// An export taken before the rename must still import — the label is the only
// thing the parser has to find that number by.
const legacyCsvAE = csvAE.replace(/(^|\r\n)Checking,/, "$1TD checking,");
check("a LEGACY export (\"TD checking\") still round-trips", parseBudgetCSV(legacyCsvAE, stateAE.trackerCategories).checkInBalance, 4321.98);
check("the label row isn't mistaken for a transaction", parseBudgetCSV(legacyCsvAE, stateAE.trackerCategories).recurring.some((r) => /checking/i.test(r.name)), false);

// ---------- Scenario AF: tab order (sanitize + drag + migration) ----------
console.log("\n== Scenario AF: settings.tabOrder ==");
eq("a brand-new account gets the default order", sanitizeTabOrder(undefined), TABS);
eq("a stored order is kept as-is", sanitizeTabOrder(["spending", "ledger", "budget", "dashboard"]), ["spending", "ledger", "budget", "dashboard"]);
// User data can be stale or corrupt — never drop a real tab, never invent one.
eq("a tab that no longer exists is dropped", sanitizeTabOrder(["spending", "reports", "dashboard"]), ["spending", "dashboard", "budget", "ledger"]);
eq("a tab added since the order was saved is appended", sanitizeTabOrder(["ledger", "budget"]), ["ledger", "budget", "dashboard", "spending"]);
eq("duplicates collapse", sanitizeTabOrder(["ledger", "ledger", "budget"]), ["ledger", "budget", "dashboard", "spending"]);
eq("garbage falls back to the default", sanitizeTabOrder("nope"), TABS);

// Migration: an account saved before tabs were reorderable has no tabOrder.
const legacyAF = normalize({
  settings: { checkInBalance: 100, checkInDate: "2026-09-01", budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01" },
  recurring: [], oneoffs: [], paidOverrides: {},
});
eq("normalize backfills the default order", legacyAF.settings.tabOrder, TABS);
eq("normalize repairs a stale stored order", normalize({ ...legacyAF, settings: { ...legacyAF.settings, tabOrder: ["spending", "gone"] } }).settings.tabOrder, ["spending", "dashboard", "budget", "ledger"]);
eq("normalize is idempotent on tabOrder", normalize(normalize(legacyAF)).settings.tabOrder, legacyAF.settings.tabOrder);

// Dragging.
eq("drag spending in front of budget", moveTab(legacyAF, "spending", "budget").settings.tabOrder, ["dashboard", "spending", "budget", "ledger"]);
eq("drag dashboard onto the last tab", moveTab(legacyAF, "dashboard", "spending").settings.tabOrder, ["budget", "ledger", "dashboard", "spending"]);
eq("dropping a tab on itself changes nothing", moveTab(legacyAF, "budget", "budget").settings.tabOrder, TABS);
eq("an unknown dragged id is ignored", moveTab(legacyAF, "nope", "budget").settings.tabOrder, TABS);
check("reordering touches nothing but settings.tabOrder",
  JSON.stringify({ ...moveTab(legacyAF, "spending", "budget"), settings: null }) === JSON.stringify({ ...legacyAF, settings: null }), true);

// ---------- monthsDiff / addMonthsISO round trip (for the horizon sliders) ----------
console.log("\n== monthsDiff / addMonthsISO ==");
check("monthsDiff(Sep 1 -> May 1) = 8", monthsDiff("2026-09-01", "2027-05-01"), 8);
eq("addMonthsISO then monthsDiff round-trips", monthsDiff("2026-09-15", addMonthsISO("2026-09-15", 7)), 7);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
