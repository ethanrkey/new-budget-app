// ---- Reconstruct recurring/oneoffs from a clean per-transaction CSV ----
// Expected columns (case-insensitive, any order): Date, Item, Direction
// (in/out), Amount. This is a far better recovery source than the Budget
// grid (engine/csvImport.js) — real dates and exact amounts, no monthly
// aggregation.
//
// Classification is deliberately tolerant, not strict: real recurring items
// drift a few days in day-of-month and occasionally change amount (a rate
// bump, a skipped month) without stopping being "the same bill." So an item
// qualifies as MONTHLY or BIWEEKLY recurring based on its overall shape (see
// detectCadence), using the most common ("mode") day-of-month and amount for
// the reconstructed rule — not requiring every single occurrence to match.
// The one hard requirement is that the chosen amount actually has real
// support: at least MIN_MODE_AMOUNT_COUNT occurrences share it. That's what
// separates "Roth went from $500 to $600 in 2027" (plenty of occurrences on
// each side) from "a student loan that was $200 once, $400 twice, then
// stopped" (no amount has enough support) — the latter stays as one-offs
// with each real amount preserved exactly, by design.
import { uid } from "./model.js";

function findCol(header, patterns) {
  for (let i = 0; i < header.length; i++) {
    const h = header[i].trim().toLowerCase();
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

// Minimal RFC 4180 line parser (quoted fields, doubled "" for an embedded
// quote) — same approach as engine/csvImport.js.
function parseCSVLine(line) {
  const fields = [];
  let field = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field); field = "";
    } else field += c;
  }
  fields.push(field);
  return fields;
}
function parseCSV(text) {
  return text.split(/\r\n|\n/).filter((l) => l.length > 0).map(parseCSVLine);
}

function parseDate(raw) {
  const s = (raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, mm, dd, yyyy] = us;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}
function parseAmount(raw) {
  const cleaned = (raw || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

// Guess which of the user's OWN tracker categories a saving/debt/investment
// transaction belongs to, by matching its name against a keyword and then
// against the user's category NAMES — a clean per-transaction CSV never
// records the real category id either, so this is still a guess, just a
// better-informed one than a hardcoded 4-category list. Falls back to the
// user's first category, or the legacy "saved" id if they have none.
function guessCategory(name, direction, isRecurring, trackerCategories) {
  if (direction === "in") return "income";
  const n = name.toLowerCase();
  const find = (re) => trackerCategories.find((c) => re.test(c.name.toLowerCase()));
  const fallback = () => trackerCategories[0]?.id ?? "saved";
  if (/roth|\bira\b/.test(n)) return find(/roth|ira/)?.id ?? fallback();
  if (/everbank|emergency|\bsaving/.test(n)) return find(/saved|savings/)?.id ?? fallback();
  if (/brokerage|\binvest|\bstock|\betf\b/.test(n)) return find(/brokerage|invest|stock/)?.id ?? fallback();
  if (/student loan|\bloan/.test(n)) return find(/loan|debt/)?.id ?? fallback();
  return isRecurring ? "bill" : "oneoff";
}

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }
function addMonthsToKey(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthsBetweenKeys(aKey, bKey) {
  const [ay, am] = aKey.split("-").map(Number);
  const [by, bm] = bKey.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
// The date a MONTHLY item would next land on, after `lastDateStr`.
function nextExpectedMonthlyDate(lastDateStr, dayOfMonth) {
  const [y, m] = addMonthsToKey(monthKeyOf(lastDateStr), 1).split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const day = Math.min(dayOfMonth, daysInMonth);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Most frequent value among `values` (rounded to cents). Ties broken toward
// whichever candidate's most recent occurrence is later — a slight bias
// toward "the current rate" when two amounts are equally common.
function mode(values) {
  const buckets = new Map();
  values.forEach((v, i) => {
    const key = v.toFixed(2);
    const b = buckets.get(key) || { value: v, count: 0, lastIndex: -1 };
    b.count++;
    b.lastIndex = i;
    buckets.set(key, b);
  });
  let best = null;
  for (const b of buckets.values()) {
    if (!best || b.count > best.count || (b.count === best.count && b.lastIndex > best.lastIndex)) best = b;
  }
  return best;
}

const MIN_OCCURRENCES = 3;
const MIN_MODE_AMOUNT_COUNT = 3; // the chosen amount must have real support
const MONTHLY_COVERAGE_MIN = 0.6; // fraction of the spanned months that has an occurrence
const BIWEEKLY_GAP = [12, 16]; // days
const BIWEEKLY_MATCH_MIN = 0.6; // fraction of gaps that must look ~14 days apart

// `group` must already be sorted by date and share one direction.
function detectCadence(group) {
  if (group.length < MIN_OCCURRENCES) return null;

  const monthKeys = group.map((t) => monthKeyOf(t.date));
  const perMonth = new Map();
  for (const k of monthKeys) perMonth.set(k, (perMonth.get(k) || 0) + 1);
  const noDoubleMonths = [...perMonth.values()].every((c) => c === 1);

  if (noDoubleMonths) {
    const spanMonths = monthsBetweenKeys(monthKeys[0], monthKeys[monthKeys.length - 1]) + 1;
    if (group.length / spanMonths >= MONTHLY_COVERAGE_MIN) return "monthly";
  }

  const gaps = group.slice(1).map((t, i) => daysBetween(group[i].date, t.date));
  const biMatches = gaps.filter((g) => g >= BIWEEKLY_GAP[0] && g <= BIWEEKLY_GAP[1]).length;
  if (gaps.length > 0 && biMatches / gaps.length >= BIWEEKLY_MATCH_MIN) return "biweekly";

  return null;
}

// Returns { recurring, oneoffs, checkInBalance, warnings }. `checkInBalance`
// is always null here — this format has no running-balance concept, unlike
// the Budget grid's "Checking" starting-balance row — kept in the return shape so the
// import UI can render both formats' results identically. `trackerCategories`
// is the importing user's own list — used to guess which category a
// saving/debt/investment row belongs to (see guessCategory above).
export function parseLedgerCSV(text, trackerCategories = []) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("This file is empty or has no data rows.");

  const header = rows[0];
  const dateCol = findCol(header, [/^date$/]);
  const itemCol = findCol(header, [/^item$/, /^name$/, /^description$/]);
  const dirCol = findCol(header, [/^direction$/, /^type$/, /^in\/?out$/]);
  const amtCol = findCol(header, [/^amount$/, /^amt$/]);
  if (dateCol < 0 || itemCol < 0 || dirCol < 0 || amtCol < 0) {
    throw new Error("Could not find Date / Item / Direction / Amount columns in the header row.");
  }

  const warnings = [];
  const txns = [];
  let globalLastDate = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === "")) continue;
    const date = parseDate(row[dateCol]);
    const item = (row[itemCol] || "").trim();
    const dirRaw = (row[dirCol] || "").trim().toLowerCase();
    const direction = dirRaw === "in" ? "in" : dirRaw === "out" ? "out" : null;
    const amount = parseAmount(row[amtCol]);
    if (!date || !item || !direction || amount == null) {
      warnings.push(`Row ${r + 1}: could not parse this row (date="${row[dateCol] ?? ""}", direction="${row[dirCol] ?? ""}") — skipped.`);
      continue;
    }
    txns.push({ date, item, direction, amount });
    if (!globalLastDate || date > globalLastDate) globalLastDate = date;
  }
  if (txns.length === 0) throw new Error("No valid transaction rows were found.");

  const byName = new Map();
  for (const t of txns) {
    if (!byName.has(t.item)) byName.set(t.item, []);
    byName.get(t.item).push(t);
  }

  const recurring = [];
  const oneoffs = [];

  for (const [name, groupRaw] of byName) {
    const group = [...groupRaw].sort((a, b) => (a.date < b.date ? -1 : 1));
    const sameDirection = group.every((t) => t.direction === group[0].direction);
    const cadence = sameDirection ? detectCadence(group) : null;

    const amountMode = cadence ? mode(group.map((t) => t.amount)) : null;
    const qualifies = cadence && amountMode.count >= MIN_MODE_AMOUNT_COUNT;

    if (qualifies) {
      const first = group[0];
      const last = group[group.length - 1];
      const category = guessCategory(name, first.direction, true, trackerCategories);
      const amount = amountMode.value;
      const amountVaried = amountMode.count < group.length;

      let item;
      if (cadence === "monthly") {
        const dayCounts = new Map();
        for (const t of group) {
          const d = Number(t.date.slice(8, 10));
          dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
        }
        let dayOfMonth = first.date.slice(8, 10), bestCount = -1;
        for (const [d, c] of dayCounts) if (c > bestCount) { dayOfMonth = d; bestCount = c; }
        const stillActive = nextExpectedMonthlyDate(last.date, dayOfMonth) > globalLastDate;
        item = { cadence: "monthly", startDate: first.date, dayOfMonth, endDate: stillActive ? null : last.date };
      } else {
        const stillActive = addDays(last.date, 14) > globalLastDate;
        item = { cadence: "biweekly", startDate: first.date, endDate: stillActive ? null : last.date };
      }

      recurring.push({ id: uid(), name, amount, category, ...item });

      if (amountVaried) {
        const distinct = [...new Set(group.map((t) => t.amount.toFixed(2)))];
        warnings.push(
          `"${name}": amount varied across its history ($${distinct.join(", $")}) — used the most common, $${amount.toFixed(2)}. Check months that used a different amount.`
        );
      }
    } else {
      if (cadence) {
        warnings.push(`"${name}": ${cadence} timing detected, but no single amount is common enough to trust (varies too much) → imported as ${group.length} separate one-offs instead.`);
      } else if (group.length > 1) {
        warnings.push(`"${name}": doesn't look like a clean recurring schedule → imported as ${group.length} separate one-offs.`);
      }
      for (const t of group) {
        oneoffs.push({ id: uid(), name, amount: t.amount, category: guessCategory(name, t.direction, false, trackerCategories), date: t.date });
      }
    }
  }

  return { recurring, oneoffs, checkInBalance: null, warnings, totalRows: txns.length };
}
