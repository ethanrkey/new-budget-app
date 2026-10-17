// HOW A DATE LOOKS, in one place, for both clients.
//
// There were EIGHT of these: a `prettyDate` in Dashboard.jsx, another
// in AccountStrip.jsx, another in EventForm.jsx, a `shortDate` and a
// `dayOf` with their own shapes, and three more on the phone —
// TransactionSheet, ScopeSheet, SpendingMix and the Ledger screen,
// two of which formatted in UTC and two in local time. Everywhere
// none of them was called, the raw ISO string went straight to the
// screen: the phone's top bar said "verified 2026-10-14", the hidden-
// rows list said "2026-10-21", the investment history said
// "2026-09-30".
//
// So: MM/DD/YYYY, from here, everywhere a date is read by a person —
// except where a heading has already said the month, which is what
// fmtMonthDay is for. See its note; the Ledger's column is the one
// place that qualifies, and the 2026-10-15 sweep took it too.
//
// NOT HERE, deliberately:
//
//   - `<input type="date">` and the native picker. Those take and
//     return ISO because that is their contract with the browser and
//     with UIKit, and the user never sees the string — they see the
//     platform's own rendering of it.
//   - the CSV export. It stays ISO, which is a decision rather than
//     an oversight: the file is re-importable (ledgerCsvImport parses
//     these dates back), ISO is the one format that sorts correctly
//     as text in a spreadsheet, and MM/DD/YYYY is both ambiguous
//     outside the US and the format Excel most enjoys mangling.

/** A calendar date as a person reads it: 10/14/2026. */
export function fmtDate(iso: string | null | undefined): string {
  if (!isISO(iso)) return iso ?? "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

/**
 * The same date without the year: 10/14.
 *
 * ONLY for chart axis ticks, where a dozen four-digit years in a row
 * overlap into a smear and the year is already established by the
 * range the chart is drawn over. Nothing else should call this.
 */
export function fmtDay(iso: string | null | undefined): string {
  if (!isISO(iso)) return iso ?? "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}`;
}

/**
 * The month and the day, as a person says them: Oct 18.
 *
 * ONLY where a grouping heading has already established the year and
 * the dates are read as a COLUMN — the Ledger's list, whose month
 * headers say "October 2026" above every row they contain. Twelve
 * MM/DD/YYYYs stacked under a heading that already says the month is
 * three redundant characters a line, and the 2026-10-15 sweep put
 * them there: the owner asked for raw ISO dates to be fixed and the
 * sweep read that as every date everywhere.
 *
 * Built from the string, never from `new Date(iso)`. The formatter
 * this replaces parsed in local time while two of its siblings parsed
 * in UTC, which is how one app showed the same date a day apart on
 * two screens.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtMonthDay(iso: string | null | undefined): string {
  if (!isISO(iso)) return iso ?? "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/**
 * Anything that is not a date passes straight through.
 *
 * Not defensive programming for its own sake: the Dashboard hands a
 * card `balanceAsOf: latest?.date ?? "never"`, and a formatter that
 * turned "never" into "NaN/NaN/NaN" would be a worse bug than the one
 * this file exists to fix.
 */
function isISO(v: string | null | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
}
