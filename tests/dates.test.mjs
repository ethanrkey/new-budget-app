// How a date looks, and the one place that decides.
//
//   node tests/dates.test.mjs     (runs in `npm test`, so in CI)
//
// There were eight private formatters and, wherever none of them was
// called, the raw ISO string went to the screen — the phone's top bar
// said "verified 2026-10-14". These checks are what stops a ninth.
import { fmtDate, fmtDay, fmtMonthDay } from "../src/shared/dates.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}

eq("a date reads MM/DD/YYYY", fmtDate("2026-10-14"), "10/14/2026");
eq("single digits keep their zeros, so columns line up", fmtDate("2026-01-05"), "01/05/2026");
eq("the last day of a year", fmtDate("2026-12-31"), "12/31/2026");

// NO TIMEZONE MATH. Four of the eight formatters parsed the string
// into a Date first and two of them did it in UTC, which is how the
// same date rendered a day apart on two screens of the same app.
eq("a date is not an instant and is never shifted", fmtDate("2026-03-01"), "03/01/2026");
eq("a timestamp is read as the date it starts with", fmtDate("2026-07-04T23:30:00Z"), "07/04/2026");

// Anything that is not a date passes through. The Dashboard hands a
// card `balanceAsOf: latest?.date ?? "never"`, and "NaN/NaN/NaN"
// would be a worse bug than the one this file exists to fix.
eq("a word is left alone", fmtDate("never"), "never");
eq("the sheet's end-date placeholder is left alone", fmtDate("No end date"), "No end date");
eq("null is empty, not the word null", fmtDate(null), "");
eq("so is undefined", fmtDate(undefined), "");
eq("so is an empty string", fmtDate(""), "");

// fmtDay is for chart axis ticks only — a dozen four-digit years in a
// row overlap into a smear and the range already says the year.
eq("an axis tick drops the year", fmtDay("2026-10-14"), "10/14");
eq("...and is tolerant in the same way", fmtDay("never"), "never");

// fmtMonthDay is for a column under a heading that already says the
// month — the Ledger's list, and nothing else. The 2026-10-15 sweep
// took it to MM/DD/YYYY, which repeated "October 2026" on every line
// under a heading that had just said it.
eq("the Ledger's column drops the year AND pads nothing",
  fmtMonthDay("2026-10-18"), "Oct 18");
eq("a single-digit day has no leading zero", fmtMonthDay("2026-03-07"), "Mar 7");
eq("January is the first month, not the zeroth", fmtMonthDay("2026-01-01"), "Jan 1");
eq("and December the last", fmtMonthDay("2026-12-31"), "Dec 31");
// Built from the string, never parsed into a Date: the formatter this
// replaces parsed in local time while two of its siblings parsed in
// UTC, which is how the same date showed a day apart on two screens.
eq("a date is not an instant here either", fmtMonthDay("2026-01-01T00:30:00Z"), "Jan 1");
eq("...and is tolerant like the rest", fmtMonthDay("never"), "never");
eq("null is empty", fmtMonthDay(null), "");

if (checks < 10) {
  console.log(`FAIL  this suite ran only ${checks} checks — truncated, or short-circuited before the end`);
  failures++;
}
console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
