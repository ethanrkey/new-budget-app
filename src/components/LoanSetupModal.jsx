import { useState } from "react";
import { todayISO } from "../engine/model.js";
import ColorSwatches from "./ColorSwatches.jsx";

// Set up (or edit the terms of) a loan — which is a debt-kind category, so
// this is deliberately NOT the transaction editor. Setting up a loan never
// creates a payment; payments are ordinary transactions that pick this loan
// as their category. A brand-new loan also logs its current outstanding
// balance as the first snapshot (the anchor everything projects from);
// editing an existing loan's terms doesn't touch balance history — that's
// the card's own "Log balance."
export default function LoanSetupModal({ initial, presetName, taggedCount = 0, isDark, onSave, onDelete, onClose }) {
  const isNew = !initial?.originalPrincipal && initial?.originalPrincipal !== 0;
  const [name, setName] = useState(initial?.name ?? presetName ?? "");
  const [color, setColor] = useState(initial?.color ?? 3);
  const [originalPrincipal, setOriginalPrincipal] = useState(initial?.originalPrincipal ?? "");
  const [interestRate, setInterestRate] = useState(initial?.interestRate ?? "");
  const [interestStartDate, setInterestStartDate] = useState(initial?.interestStartDate ?? "");
  const [outstanding, setOutstanding] = useState("");
  const [asOf, setAsOf] = useState(todayISO());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid =
    name.trim() !== "" &&
    originalPrincipal !== "" && !isNaN(Number(originalPrincipal)) &&
    (interestRate === "" || !isNaN(Number(interestRate))) &&
    (!isNew || (outstanding !== "" && !isNaN(Number(outstanding)) && !!asOf));

  function save() {
    if (!valid) return;
    onSave({
      categoryId: initial?.id ?? null,
      name: name.trim(),
      color,
      originalPrincipal: Math.abs(Number(originalPrincipal)),
      interestRate: interestRate === "" ? null : Math.abs(Number(interestRate)),
      interestStartDate: interestStartDate || null,
      outstanding: isNew ? Math.abs(Number(outstanding)) : null,
      asOf: isNew ? asOf : null,
    });
  }

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{isNew ? "Set up a loan" : `Edit ${initial.name}`}</h2>
        <p className="text-xs text-gray-500 mb-4">
          A loan is its own category. Payments toward it are ordinary transactions that pick it as their
          category — add those separately, whenever you plan them.
        </p>

        <div className="space-y-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Car loan, mortgage, student loan…" autoFocus={isNew} />
          </div>
          <div>
            <label className={label}>Color</label>
            <ColorSwatches value={color} onChange={setColor} isDark={isDark} />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className={label}>Original loan amount</label>
              <input className={field} type="number" step="0.01" value={originalPrincipal} onChange={(e) => setOriginalPrincipal(e.target.value)} placeholder="e.g. 18000" />
            </div>
            <div className="flex-1">
              <label className={label}>Interest rate (APR %)</label>
              <input className={field} type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="e.g. 5.8" />
            </div>
          </div>
          <div>
            <label className={label}>Interest starts (optional)</label>
            <input className={field} type="date" value={interestStartDate} onChange={(e) => setInterestStartDate(e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">
              For a loan that accrues nothing until a set date — before it, payments cut principal dollar-for-dollar.
            </p>
          </div>
          {isNew && (
            <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="flex-1">
                <label className={label}>Current outstanding balance</label>
                <input className={field} type="number" step="0.01" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} placeholder="what you owe today" />
              </div>
              <div className="flex-1">
                <label className={label}>As of</label>
                <input className={field} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancel</button>
          <button onClick={save} disabled={!valid} className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40">
            {isNew ? "Set up loan" : "Save terms"}
          </button>
        </div>

        {/* Deleting a loan is a primary action, so it lives here rather than
            only in Settings → Categories. The payments tagged to it are
            SCHEDULED, not completed — removing them would quietly change the
            forecast, so they stay and the count says so up front. */}
        {onDelete && (
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  Delete {initial.name}?{" "}
                  {taggedCount > 0 ? (
                    <>
                      {taggedCount} transaction{taggedCount === 1 ? "" : "s"} tagged to this loan will
                      remain in your ledger, uncategorized.
                    </>
                  ) : (
                    <>No transactions are tagged to it.</>
                  )}{" "}
                  Its terms and logged balances are deleted.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                    Keep it
                  </button>
                  <button onClick={onDelete} className="flex-1 py-2 rounded-lg bg-expense text-white text-sm font-medium">
                    Delete loan
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-gray-400 hover:text-expense">
                Delete this loan
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
