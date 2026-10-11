// Is this account new? The predicate behind the phone's first-run
// screen, tested without a renderer.
//
//   node tests/mobile-firstrun.test.mjs     (runs in `npm test`, so in CI)
//
// The trap this exists for: `normalize()` SEEDS a brand-new account with
// a checking account, a $0 snapshot dated today, and three tracker
// categories. So "is anything here" answers yes for an account nobody
// has touched, and the only honest question is "did a person put
// anything in". Every case below is a way to get that wrong.
import { normalize } from "../src/engine/stateShape.ts";
import { isNewAccount } from "../mobile/lib/firstRun.ts";
import {
  updateAccountBalance, upsertItem, addBalanceSnapshot, addContribution,
} from "../src/engine/mutate.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);
const not = (label, c) => eq(label, !!c, false);

const blank = normalize({});

// The seeded shape is real, and it is why a length check would lie.
eq("a new account already has one checking account", blank.accounts.length, 1);
eq("...and three tracker categories", blank.trackerCategories.length, 3);
eq("...and a seeded snapshot nobody logged", blank.accountSnapshots.checking.length, 1);
is("...and is still NEW", isNewAccount(blank));

// Each of these is somebody using the app.
{
  // THE TRAP. `updateAccountBalance` upserts by date, and the seed is
  // dated today, so this keeps the id `seed-checking` and changes only
  // the amount. An id-only test says "still new" and the first-run
  // screen never goes away.
  const sameDay = updateAccountBalance(blank, "checking", 4000, blank.accounts[0].balanceAsOf);
  eq("...and it reused the seed's id", sameDay.accountSnapshots.checking[0].id, "seed-checking");
  not("logging a balance ON THE SEED'S OWN DATE makes it used", isNewAccount(sameDay));

  const otherDay = updateAccountBalance(blank, "checking", 4000, "2026-11-01");
  not("logging one on another date does too", isNewAccount(otherDay));

  // Genuinely indistinguishable from the seed, and the first-run screen
  // is still the right answer: no rules and nothing in checking means
  // there is nothing to project.
  const zero = updateAccountBalance(blank, "checking", 0, blank.accounts[0].balanceAsOf);
  is("logging exactly zero on the seed date stays new, on purpose", isNewAccount(zero));
}
{
  const withRule = upsertItem(blank, {
    id: "r-pay", name: "Paycheck", amount: 2100, category: "income",
    cadence: "biweekly", startDate: "2026-10-09", order: 0,
  });
  not("adding a paycheck makes it used", isNewAccount(withRule));
}
{
  const withOneoff = upsertItem(blank, {
    id: "o-dent", name: "Dentist", amount: 180, category: "oneoff", date: "2026-10-20", order: 0,
  });
  not("adding a one-off makes it used", isNewAccount(withOneoff));
}
{
  const cat = blank.trackerCategories[0].id;
  not("logging a category balance makes it used",
    isNewAccount(addBalanceSnapshot(blank, cat, 500, "2026-10-11")));
  not("logging a contribution makes it used",
    isNewAccount(addContribution(blank, cat, 100, "2026-10-11")));
}

// The distinction the original bug collapsed: an empty LEDGER is not an
// empty ACCOUNT. A rule whose dates all fall outside the window leaves
// nothing to list, and that wants "nothing in this window", not a
// tutorial for someone who has already done the work.
{
  const longGone = upsertItem(blank, {
    id: "r-old", name: "Old gym", amount: 40, category: "bill",
    cadence: "monthly", dayOfMonth: 1, startDate: "2019-01-01", endDate: "2019-12-01", order: 0,
  });
  not("an account whose only rule has ended is NOT new", isNewAccount(longGone));
}

// Defensive: a state missing the optional maps entirely must not throw.
is("a bare object is new, not a crash", isNewAccount({ recurring: [], oneoffs: [] }));

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
