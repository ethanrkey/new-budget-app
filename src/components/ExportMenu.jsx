import { useState } from "react";
import { ledgerToCSV, budgetToCSV } from "../engine/csv.js";
import { todayISO } from "../engine/model.js";

function downloadCSV(filename, csvString) {
  const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" }); // BOM so Excel opens it as UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportMenu({ ledger, budget }) {
  const [open, setOpen] = useState(false);

  function exportLedger() {
    downloadCSV(`ledger-${todayISO()}.csv`, ledgerToCSV(ledger));
    setOpen(false);
  }
  function exportBudget() {
    downloadCSV(`budget-${todayISO()}.csv`, budgetToCSV(budget));
    setOpen(false);
  }
  function exportBoth() {
    downloadCSV(`ledger-${todayISO()}.csv`, ledgerToCSV(ledger));
    downloadCSV(`budget-${todayISO()}.csv`, budgetToCSV(budget));
    setOpen(false);
  }

  const item = "block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
      >
        ⬇<span className="hidden sm:inline"> Export CSV</span>
      </button>
      {open && (
        <>
          {/* click-outside catcher */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20 overflow-hidden">
            <button onClick={exportLedger} className={item}>Ledger</button>
            <button onClick={exportBudget} className={item}>Budget</button>
            <button onClick={exportBoth} className={`${item} border-t border-gray-100 dark:border-gray-800`}>Both</button>
          </div>
        </>
      )}
    </div>
  );
}
