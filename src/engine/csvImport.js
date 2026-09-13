// ---- Reconstruct recurring/oneoffs from a Budget CSV (engine/csv.js's
// budgetToCSV output) ----
// Necessarily lossy: the monthly grid has no day-of-month, and Saving/Debt
// rows don't record which of roth/saved/brokerage/loans they were (the CSV
// only has the section, not the sub-category). This makes the best
// reconstruction it can and returns `warnings` describing every guess, so
// the caller can show them before committing anything to state.
import { uid } from "./model.js";

const SECTION_HEADERS = new Set(["INCOME", "FIXED / RECURRING", "SAVING / DEBT", "ONE-OFF / SEASONAL"]);
const SKIP_ROWS = new Set(["Starting point", "TOTAL IN", "TOTAL OUT", "MONTHLY NET", "CUMULATIVE NET"]);
const MONTH_NUM = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Guess which of the user's OWN tracker categories a Saving/Debt row
// belongs to, by matching its name against a keyword and then against the
// user's category NAMES (the CSV only records the section, never the real
// category id) — falls back to their first category, or the legacy "saved"
// id if they somehow have none at all.
function guessSavingCategory(name, trackerCategories) {
  const n = name.toLowerCase();
  const find = (re) => trackerCategories.find((c) => re.test(c.name.toLowerCase()));
  const fallback = () => trackerCategories[0]?.id ?? "saved";
  if (/roth|ira/.test(n)) return find(/roth|ira/)?.id ?? fallback();
  if (/loan|debt/.test(n)) return find(/loan|debt/)?.id ?? fallback();
  if (/brokerage|invest|stock|etf/.test(n)) return find(/brokerage|invest|stock/)?.id ?? fallback();
  return find(/saved|savings/)?.id ?? fallback(); // catch-all default
}

// Minimal RFC 4180 line parser — quoted fields, doubled "" for an embedded
// quote. Fine here because this export never puts a literal newline inside
// a field (item names don't contain them).
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

function monthLabelToKey(label) {
  const m = label.trim().match(/^(\w{3})\s+(\d{4})$/);
  if (!m || !(m[1] in MONTH_NUM)) return null;
  return `${m[2]}-${String(MONTH_NUM[m[1]] + 1).padStart(2, "0")}`;
}
function monthKeyToDate(key) { return `${key}-01`; } // exact day is lost information
function addMonthsToKey(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Returns { recurring, oneoffs, checkInBalance, warnings }. Throws if the
// file doesn't look like a Budget export at all (unparseable header).
// `trackerCategories` is the importing user's own list — used to guess which
// category a Saving/Debt row belongs to (see guessSavingCategory above).
// The Budget grid's starting-balance row. Exports write "Checking";
// "TD checking" is what exports said before the label was generalized, and
// old files must keep importing.
const STARTING_BALANCE_LABELS = new Set(["Checking", "TD checking"]);

export function parseBudgetCSV(text, trackerCategories = []) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("This file is empty or has no data rows.");

  const monthKeys = rows[0].slice(1).map(monthLabelToKey);
  if (monthKeys.length === 0 || monthKeys.some((k) => !k)) {
    throw new Error('Could not read the month header row — is this a "Budget" export (not "Ledger")?');
  }

  const recurring = [];
  const oneoffs = [];
  const warnings = [];
  let checkInBalance = null;
  let section = "INCOME";

  for (let r = 1; r < rows.length; r++) {
    const [label, ...cells] = rows[r];
    if (!label) continue;

    if (SECTION_HEADERS.has(label)) { section = label; continue; }
    if (STARTING_BALANCE_LABELS.has(label)) {
      const v = Number(cells[0]);
      if (!Number.isNaN(v)) checkInBalance = v;
      continue;
    }
    if (SKIP_ROWS.has(label)) continue;

    const values = monthKeys.map((_, i) => (cells[i] === "" || cells[i] == null ? 0 : Number(cells[i])));
    const occurrences = monthKeys
      .map((key, i) => ({ key, value: values[i] }))
      .filter((o) => Math.abs(o.value) > 0.005);
    if (occurrences.length === 0) continue;

    const name = label === "Take-home" ? "Paycheck" : label;
    const category =
      section === "INCOME" ? "income" :
      section === "FIXED / RECURRING" ? "bill" :
      section === "ONE-OFF / SEASONAL" ? "oneoff" :
      guessSavingCategory(name, trackerCategories);

    if (section === "SAVING / DEBT") {
      warnings.push(`"${name}" → category "${category}" is a guess (the CSV doesn't record which Saving/Debt sub-category a row was) — please verify.`);
    }

    const isContiguous = occurrences.every(
      (o, i) => i === 0 || addMonthsToKey(occurrences[i - 1].key, 1) === o.key
    );
    const sameAmount = occurrences.every((o) => Math.abs(o.value - occurrences[0].value) < 0.005);

    if (occurrences.length > 1 && isContiguous && sameAmount) {
      const startKey = occurrences[0].key;
      const endKey = occurrences[occurrences.length - 1].key;
      // A monthly rule with no true end date can still show its very last
      // month as $0 in the export: if its day-of-month falls after the
      // horizon's cutoff day, that final instance never gets generated at
      // all (a horizon-boundary artifact, not a real end). That can only
      // ever swallow one month for a monthly cadence, so treat "reaches the
      // last exported month OR the one right before it" as open-ended —
      // otherwise every genuinely-ongoing bill would come back with a
      // spurious end date needing manual cleanup.
      const endIdx = monthKeys.indexOf(endKey);
      const reachesEnd = endIdx >= monthKeys.length - 2;
      recurring.push({
        id: uid(),
        name,
        amount: Math.abs(occurrences[0].value),
        category,
        cadence: "monthly",
        startDate: monthKeyToDate(startKey),
        endDate: reachesEnd ? null : monthKeyToDate(endKey),
        dayOfMonth: 1,
      });
    } else {
      if (occurrences.length > 1) {
        warnings.push(
          `"${name}" varies month to month (or has gaps) → imported as ${occurrences.length} separate one-off entries instead of one recurring rule.`
        );
      }
      for (const o of occurrences) {
        oneoffs.push({ id: uid(), name, amount: Math.abs(o.value), category, date: monthKeyToDate(o.key) });
      }
    }
  }

  return { recurring, oneoffs, checkInBalance, warnings };
}
