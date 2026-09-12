import { useRef, useState } from "react";
import { parseBudgetCSV } from "../engine/csvImport.js";
import { parseLedgerCSV } from "../engine/ledgerCsvImport.js";
import { normalize } from "../engine/stateShape.js";
import { isPlausibleBackup, countSnapshots, countMonthlyActuals } from "../engine/backupShape.js";
import { downloadFile } from "../downloadFile.js";
import { todayISO } from "../engine/model.js";

const money = (n) =>
  Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Auto-detects which export format a file is and parses accordingly:
// - Budget grid (engine/csv.js budgetToCSV): header row starts with a blank
//   cell, then month labels. Lossy — monthly totals only.
// - Clean per-transaction ledger (Date/Item/Direction/Amount columns, any
//   order): far more accurate — real dates, exact amounts.
function detectAndParse(text, trackerCategories) {
  const firstCell = (text.split(/\r\n|\n/)[0] || "").split(",")[0].replace(/^"|"$/g, "").trim();
  return firstCell === ""
    ? { format: "budget", ...parseBudgetCSV(text, trackerCategories) }
    : { format: "ledger", ...parseLedgerCSV(text, trackerCategories) };
}

const FORMAT_LABEL = {
  budget: "Budget grid export (lossy — monthly totals only)",
  ledger: "Per-transaction export (real dates, exact amounts)",
};

// Handles two entirely different things behind one file picker, since both
// are "load my data from a file" to the user even though they work nothing
// alike under the hood:
// - A .csv export (Budget grid or clean per-transaction) is reconstructed
//   best-effort into recurring/oneoffs, and can be MERGED on top of
//   existing data or used to replace it — see the existing CSV flow below.
// - A .json full backup (ExportMenu's "Full backup") is a literal state
//   snapshot. Restoring one is always a full replace (merging two whole
//   states isn't well-defined — trackerCategory ids, balanceSnapshots,
//   monthlyActuals would all need reconciling against each other with no
//   clear right answer), so that path is a separate, more serious
//   confirmation: it names exactly what's in the file, requires an
//   explicit "I understand this replaces everything" checkbox, and
//   auto-downloads a safety-net copy of whatever's currently loaded
//   BEFORE applying the restore — so even a wrong restore is itself
//   recoverable from that fresh safety copy.
export default function ImportCSV({ onImport, onRestoreBackup, onClose, trackerCategories = [], currentState }) {
  const [parsed, setParsed] = useState(null);
  const [restoreState, setRestoreState] = useState(null); // normalized full-backup state, once validated
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [replace, setReplace] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setParsed(null);
    setRestoreState(null);
    setConfirmRestore(false);
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        let raw;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new Error("This file isn't valid JSON — is it really a Budget backup?");
        }
        if (!isPlausibleBackup(raw)) {
          throw new Error("This doesn't look like a Budget backup file (missing recurring/oneoffs data).");
        }
        // Same migration pipeline any normal load goes through — a backup
        // from an older version of the app (missing trackerCategories,
        // balanceSnapshots, a category's `kind`, ...) restores safely too.
        setRestoreState(normalize(raw));
      } else {
        setParsed(detectAndParse(text, trackerCategories));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  function confirmImport() {
    onImport(parsed, replace);
    setDone(true);
  }

  function confirmRestoreBackup() {
    if (currentState) {
      downloadFile(
        `budget-pre-restore-safety-copy-${todayISO()}.json`,
        JSON.stringify(currentState, null, 2),
        "application/json;charset=utf-8;"
      );
    }
    onRestoreBackup(restoreState);
    setDone(true);
  }

  const totalItems = parsed ? parsed.recurring.length + parsed.oneoffs.length : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Import / Restore</h2>

        {done ? (
          <>
            <p className="text-sm text-income mb-4">
              {restoreState
                ? <>Restored your full backup from {fileName}. A safety copy of what you had just before was downloaded too.</>
                : <>{replace ? "Replaced your data with" : "Imported"} {totalItems} item{totalItems === 1 ? "" : "s"} from {fileName}.</>}
            </p>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-4">
              Accepts a CSV export (Budget grid or a clean Date/Item/Direction/Amount transaction
              export — reconstructed best-effort, mergeable) or a full JSON backup (from Export ▸ Full
              backup — an exact restore of everything, categories/balances/actuals included). Detected
              automatically from the file.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFile}
              className="text-sm mb-3 w-full"
            />

            {error && <p className="text-sm text-expense mb-3">{error}</p>}

            {restoreState && (
              <div className="space-y-3 mb-4">
                <div className="text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">Full backup — exact restore</p>
                  <p><span className="font-medium">{restoreState.recurring.length}</span> recurring rule{restoreState.recurring.length === 1 ? "" : "s"}</p>
                  <p><span className="font-medium">{restoreState.oneoffs.length}</span> one-off transaction{restoreState.oneoffs.length === 1 ? "" : "s"}</p>
                  <p><span className="font-medium">{restoreState.trackerCategories.length}</span> savings/debt categor{restoreState.trackerCategories.length === 1 ? "y" : "ies"}</p>
                  <p><span className="font-medium">{countSnapshots(restoreState.balanceSnapshots)}</span> logged balance snapshot{countSnapshots(restoreState.balanceSnapshots) === 1 ? "" : "s"}</p>
                  <p><span className="font-medium">{countMonthlyActuals(restoreState.monthlyActuals)}</span> logged variable-bill actual{countMonthlyActuals(restoreState.monthlyActuals) === 1 ? "" : "s"}</p>
                  <p>TD checking balance: <span className="font-medium">{money(restoreState.settings.checkInBalance)}</span> as of {restoreState.settings.checkInDate}</p>
                </div>

                <label className="flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-lg p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmRestore}
                    onChange={(e) => setConfirmRestore(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-expense">I understand this replaces ALL my current data</span> — every
                    transaction, category, logged balance, and setting, with no merge option. We&apos;ll download a safety
                    copy of what you have right now first, just in case.
                  </span>
                </label>
              </div>
            )}

            {parsed && (
              <div className="space-y-3 mb-4">
                <div className="text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">{FORMAT_LABEL[parsed.format]}</p>
                  <p><span className="font-medium">{parsed.recurring.length}</span> recurring rule{parsed.recurring.length === 1 ? "" : "s"}</p>
                  <p><span className="font-medium">{parsed.oneoffs.length}</span> one-off transaction{parsed.oneoffs.length === 1 ? "" : "s"}</p>
                  {parsed.checkInBalance != null && (
                    <p>TD checking balance found: <span className="font-medium">{money(parsed.checkInBalance)}</span> (as of the export date, not today — update it after importing)</p>
                  )}
                </div>

                {parsed.warnings.length > 0 && (
                  <div className="text-xs text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                    <p className="font-medium text-amber-800 dark:text-amber-300">Review these before/after importing:</p>
                    {parsed.warnings.map((w, i) => <p key={i}>• {w}</p>)}
                  </div>
                )}

                {totalItems === 0 && (
                  <p className="text-sm text-gray-400">No items found in this file.</p>
                )}

                <label className="flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-lg p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-expense">Replace all current data</span> instead
                    of merging — deletes every existing recurring rule and one-off first. Leave
                    unchecked to add these on top of what you already have.
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                Cancel
              </button>
              {restoreState ? (
                <button
                  onClick={confirmRestoreBackup}
                  disabled={!confirmRestore}
                  className="flex-1 py-2 rounded-lg bg-expense text-white text-sm font-medium disabled:opacity-40"
                >
                  Restore backup
                </button>
              ) : (
                <button
                  onClick={confirmImport}
                  disabled={!parsed || totalItems === 0}
                  className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
                >
                  {replace ? "Replace with" : "Import"} {totalItems > 0 ? totalItems : ""} item{totalItems === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
