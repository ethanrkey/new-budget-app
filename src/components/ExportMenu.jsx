import { useState } from "react";
import { ledgerToCSV, budgetToCSV } from "../engine/csv.js";
import { todayISO } from "../engine/model.js";
import { downloadFile } from "../downloadFile.js";

export default function ExportMenu({ ledger, budget, trackerCategories = [], state }) {
  const [open, setOpen] = useState(false);

  function exportLedger() {
    downloadFile(`ledger-${todayISO()}.csv`, ledgerToCSV(ledger, trackerCategories), "text/csv;charset=utf-8;");
    setOpen(false);
  }
  function exportBudget() {
    downloadFile(`budget-${todayISO()}.csv`, budgetToCSV(budget, trackerCategories), "text/csv;charset=utf-8;");
    setOpen(false);
  }
  function exportBoth() {
    downloadFile(`ledger-${todayISO()}.csv`, ledgerToCSV(ledger, trackerCategories), "text/csv;charset=utf-8;");
    downloadFile(`budget-${todayISO()}.csv`, budgetToCSV(budget, trackerCategories), "text/csv;charset=utf-8;");
    setOpen(false);
  }
  // The Ledger/Budget CSVs are transaction/monthly-grid shaped and don't have
  // a natural column for fund-balance snapshots or variable-bill monthly
  // actuals (they're not transactions). This exports the ENTIRE raw state —
  // including trackerCategories, balanceSnapshots, monthlyActuals, all of
  // it — as JSON, so nothing new is left un-backed-up. It also round-trips
  // perfectly (no lossy reconstruction the way CSV re-import needs), and
  // ImportCSV.jsx can restore it — see that file's "Restore backup" mode.
  function exportBackup() {
    downloadFile(`budget-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8;");
    setOpen(false);
  }

  const item = "block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
      >
        ⬇<span className="hidden sm:inline"> Export</span>
      </button>
      {open && (
        <>
          {/* click-outside catcher */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20 overflow-hidden">
            <button onClick={exportLedger} className={item}>Ledger</button>
            <button onClick={exportBudget} className={item}>Budget</button>
            <button onClick={exportBoth} className={`${item} border-t border-gray-100 dark:border-gray-800`}>Both</button>
            {state && (
              <button
                onClick={exportBackup}
                className={`${item} border-t border-gray-100 dark:border-gray-800`}
                title="Everything, including fund balances and variable-bill actuals — round-trips perfectly"
              >
                Full backup (JSON)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
