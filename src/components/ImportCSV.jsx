import { useRef, useState } from "react";
import { parseBudgetCSV } from "../engine/csvImport.js";

const money = (n) =>
  Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// A Budget-CSV importer, mainly built for restoring a Budget export after
// data loss. Parses on file selection, shows exactly what it found (and
// every guess it had to make) before anything touches state — nothing is
// imported until you press Import.
export default function ImportCSV({ onImport, onClose }) {
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setParsed(null);
    try {
      const text = await file.text();
      setParsed(parseBudgetCSV(text));
    } catch (err) {
      setError(err.message);
    }
  }

  function confirmImport() {
    onImport(parsed);
    setDone(true);
  }

  const totalItems = parsed ? parsed.recurring.length + parsed.oneoffs.length : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Import Budget CSV</h2>

        {done ? (
          <>
            <p className="text-sm text-income mb-4">
              Imported {totalItems} item{totalItems === 1 ? "" : "s"} from {fileName}.
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
              Rebuilds recurring rules and one-off transactions from a Budget export (not a Ledger
              export). This is a best-effort reconstruction from monthly totals — review the notes
              below before importing.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="text-sm mb-3 w-full"
            />

            {error && <p className="text-sm text-expense mb-3">{error}</p>}

            {parsed && (
              <div className="space-y-3 mb-4">
                <div className="text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
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
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                Cancel
              </button>
              <button
                onClick={confirmImport}
                disabled={!parsed || totalItems === 0}
                className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
              >
                Import {totalItems > 0 ? totalItems : ""} item{totalItems === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
