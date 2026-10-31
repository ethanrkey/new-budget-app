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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
export function fmtMonthDay(iso: string | null | undefined): string {
  if (!isISO(iso)) return iso ?? "";
  const [, m, d] = iso.slice(0, 10).split("-");
  // The short name is the long one's first three letters for all
  // twelve, which is why there is no second list to keep in step.
  return `${MONTH_NAMES[Number(m) - 1]!.slice(0, 3)} ${Number(d)}`;
}

/**
 * The month and the year, for a grid heading: October 2026.
 */
export function fmtMonthYear(key: string | null | undefined): string {
  if (typeof key !== "string" || !/^\d{4}-\d{2}/.test(key)) return key ?? "";
  const [y, m] = key.slice(0, 7).split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/**
 * The whole date with its weekday: Tuesday, October 27, 2026.
 *
 * For a heading that names ONE day somebody has just picked — the
 * calendar's detail panel. The weekday is the point: "the 27th" is a
 * number, "Tuesday the 27th" is a day you can place yourself in.
 *
 * The weekday needs a real Date, which is the one thing the rest of
 * this file avoids. It is built at NOON so that neither end of a
 * daylight-saving shift can roll it into the day next door.
 */
const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
export function fmtLongDay(iso: string | null | undefined): string {
  if (!isISO(iso)) return iso ?? "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const weekday = WEEKDAY_NAMES[new Date(y!, m! - 1, d!, 12).getDay()];
  return `${weekday}, ${MONTH_NAMES[m! - 1]} ${d}, ${y}`;
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

/**
 * An INSTANT (an ISO timestamp with a zone), in the reader's own
 * local date and time: "10/20/2026, 8:46 PM".
 *
 * WHY THIS EXISTS RATHER THAN `fmtDate(iso.slice(0, 10))`, which is
 * what both clients did until 2026-10-20 and which is wrong in a way
 * that hides: slicing takes the UTC date off the string while
 * `toLocaleTimeString` renders the local time, so a sync at 8:46 PM
 * Eastern displayed as "10/21/2026, 8:46 PM" — tomorrow's date beside
 * tonight's clock. Half-converted is worse than not converted,
 * because it looks converted.
 *
 * Everything else in this file takes a DATE-ONLY string, which has no
 * zone and must never be put through a Date constructor. This one is
 * the opposite and is named for it.
 */
export function fmtInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-US")}, ${fmtClock(iso)}`;
}

/**
 * AN INSTANT, SHORT, TIME FIRST, THEN THE DAY:
 *
 *   today      ->  "8:46 PM, today"
 *   yesterday  ->  "8:46 PM, yesterday"
 *   older      ->  "8:46 PM, 10/20"
 *
 * THE DAY IS ALWAYS SAID, "today" included — the owner's call,
 * 2026-10-31. A bare "8:46 PM" left the reader to work out that no
 * day meant today; the word costs seven characters and removes the
 * question. Time first in all three, so the eye finds the clock in
 * the same place whatever the day.
 *
 * The phone's form. A bare clock time is unambiguous on a phone you
 * have just picked up and a lie on one you have not: "synced 8:46 PM"
 * on a reading from Sunday reads as this evening.
 *
 * NO YEAR, and that is the one piece deliberately dropped. This
 * answers "how old is this number", and a number old enough to need a
 * year is answered by the date alone. The web says the whole thing —
 * see fmtInstant and PILL_SUFFIX_LONG.
 *
 * `now` IS AN ARGUMENT so this can be asserted without a clock. It
 * defaults to the real one, so no caller has to care.
 */
export function fmtShortStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const clock = fmtClock(iso);
  // Compared as LOCAL CALENDAR DAYS, not as a span of hours. 11pm and
  // 1am are two hours apart and two different days, and "yesterday"
  // is a claim about the calendar.
  const dayOf = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (dayOf(d) === dayOf(now)) return `${clock}, today`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayOf(d) === dayOf(yesterday)) return `${clock}, yesterday`;
  return `${clock}, ${d.getMonth() + 1}/${d.getDate()}`;
}

/** Just the clock part of an instant, local: "8:46 PM". */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
