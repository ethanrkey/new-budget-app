import { useState } from "react";
import { todayISO } from "../engine/model.js";
import ColorSwatches from "./ColorSwatches.jsx";

// Add a savings/investment account — which, like a loan, is just a tracker
// category. Deliberately NOT the transaction editor: creating the account
// never creates a contribution. A new one also logs what's in it today as its
// first snapshot, the anchor its card projects from. The Settings → Categories
// path still exists and does the same thing minus the opening balance.
export default function AssetSetupModal({ initial, taggedCount = 0, isDark, onSave, onDelete, onClose }) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? 0);
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(todayISO());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid = name.trim() !== "" && (balance === "" || !isNaN(Number(balance)));

  function save() {
    if (!valid) return;
    const hasBalance = balance !== "" && !isNaN(Number(balance));
    onSave({
      categoryId: initial?.id ?? null,
      name: name.trim(),
      color,
      balance: isNew && hasBalance ? Number(balance) : null,
      asOf: isNew && hasBalance ? asOf : null,
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
        <h2 className="text-lg font-semibold mb-1">{isNew ? "Add an account" : `Edit ${initial.name}`}</h2>
        <p className="text-xs text-gray-500 mb-4">
          Savings, a Roth, a brokerage — anything you want a balance and a history for. Money you put
          into it is an ordinary transaction that picks this account as its category.
        </p>

        <div className="space-y-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund, Roth IRA, brokerage…" autoFocus />
          </div>
          <div>
            <label className={label}>Color</label>
            <ColorSwatches value={color} onChange={setColor} isDark={isDark} />
          </div>
          {isNew && (
          <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <div className="flex-1">
              <label className={label}>Balance today (optional)</label>
              <input className={field} type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="what's in it now" />
            </div>
            <div className="flex-1">
              <label className={label}>As of</label>
              <input className={field} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
          </div>
          )}
          {isNew && (
            <p className="text-xs text-gray-400">
              Skip the balance if you don&apos;t know it — the card will ask for it later.
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancel</button>
          <button onClick={save} disabled={!valid} className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40">
            {isNew ? "Add account" : "Save"}
          </button>
        </div>

        {/* Delete lives here rather than being buried in Settings → Categories.
            The count is the point: these are SCHEDULED transactions in a
            forecast, so deleting them silently would change the forecast
            without saying so. They stay, uncategorized. */}
        {!isNew && onDelete && (
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  Delete {initial.name}?{" "}
                  {taggedCount > 0 ? (
                    <>
                      {taggedCount} transaction{taggedCount === 1 ? "" : "s"} tagged to this account
                      will remain in your ledger, uncategorized.
                    </>
                  ) : (
                    <>No transactions are tagged to it.</>
                  )}{" "}
                  Its logged balances and contributions are deleted.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                    Keep it
                  </button>
                  <button onClick={onDelete} className="flex-1 py-2 rounded-lg bg-expense text-white text-sm font-medium">
                    Delete account
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-gray-400 hover:text-expense">
                Delete this account
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
