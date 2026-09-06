// ---- Reconstruct recurring/oneoffs from a clean per-transaction CSV ----
// Expected columns (case-insensitive, any order): Date, Item, Direction
// (in/out), Amount. This is a far better recovery source than the Budget
// grid (engine/csvImport.js) — real dates and exact amounts, no monthly
// aggregation — so reconstruction here is much more accurate: anything that
// repeats monthly at a fixed amount becomes a real recurring rule (so it
// keeps generating future months on its own); anything irregular or
// one-time stays exactly as the individual transaction(s) it was, with its
// real date and amount preserved.
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

function guessCategory(name, direction, isRecurring) {
  if (direction === "in") return "income";
  const n = name.toLowerCase();
  if (/roth|\bira\b/.test(n)) return "roth";
  if (/everbank|emergency|\bsaving/.test(n)) return "saved";
  if (/brokerage|\binvest|\bstock|\betf\b/.test(n)) return "brokerage";
  if (/student loan|\bloan/.test(n)) return "loans";
  return isRecurring ? "bill" : "oneoff";
}

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }
function addMonthsToKey(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// The date this item's cadence would next land on, after `lastDateStr`.
function nextExpectedDate(lastDateStr, dayOfMonth) {
  const [y, m] = addMonthsToKey(monthKeyOf(lastDateStr), 1).split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const day = Math.min(dayOfMonth, daysInMonth);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Returns { recurring, oneoffs, checkInBalance, warnings }. `checkInBalance`
// is always null here — this format has no running-balance concept, unlike
// the Budget grid's "TD checking" row — kept in the return shape so the
// import UI can render both formats' results identically.
export function parseLedgerCSV(text) {
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

  for (const [name, group] of byName) {
    group.sort((a, b) => (a.date < b.date ? -1 : 1));

    const sameDirection = group.every((t) => t.direction === group[0].direction);
    const sameAmount = group.every((t) => Math.abs(t.amount - group[0].amount) < 0.005);
    const monthKeys = group.map((t) => monthKeyOf(t.date));
    const oneOccurrencePerMonth = new Set(monthKeys).size === monthKeys.length;
    const contiguous = monthKeys.every((k, i) => i === 0 || addMonthsToKey(monthKeys[i - 1], 1) === k);

    const isCleanRecurring =
      group.length > 1 && sameDirection && sameAmount && oneOccurrencePerMonth && contiguous;

    if (isCleanRecurring) {
      const first = group[0];
      const last = group[group.length - 1];
      const category = guessCategory(name, first.direction, true);
      const dayOfMonth = Number(first.date.slice(8, 10));
      // Still active if its NEXT expected charge would fall after the most
      // recent transaction date anywhere in the file — i.e. it simply
      // hasn't happened yet. If that next date had already passed by the
      // file's end and never showed up, it genuinely stopped — cap it there.
      const stillActive = nextExpectedDate(last.date, dayOfMonth) > globalLastDate;
      recurring.push({
        id: uid(),
        name,
        amount: first.amount,
        category,
        cadence: "monthly",
        startDate: first.date,
        dayOfMonth,
        endDate: stillActive ? null : last.date,
      });
    } else {
      if (group.length > 1 && (!sameAmount || !sameDirection)) {
        warnings.push(`"${name}": amount or direction is not consistent across its ${group.length} occurrences → imported as ${group.length} separate one-offs.`);
      } else if (group.length > 1 && (!oneOccurrencePerMonth || !contiguous)) {
        warnings.push(`"${name}": occurs more than once in some months or has gaps between months → imported as ${group.length} separate one-offs rather than guessing at a schedule.`);
      }
      for (const t of group) {
        oneoffs.push({ id: uid(), name, amount: t.amount, category: guessCategory(name, t.direction, false), date: t.date });
      }
    }
  }

  return { recurring, oneoffs, checkInBalance: null, warnings, totalRows: txns.length };
}
