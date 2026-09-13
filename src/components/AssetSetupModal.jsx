import { useState } from "react";
import { todayISO } from "../engine/model.js";
import ColorSwatches from "./ColorSwatches.jsx";

// Add a savings/investment account — which, like a loan, is just a tracker
// category. Deliberately NOT the transaction editor: creating the account
// never creates a contribution. A new one also logs what's in it today as its
// first snapshot, the anchor its card projects from. The Settings → Categories
// path still exists and does the same thing minus the opening balance.
export default function AssetSetupModal({ isDark, onSave, onClose }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(0);
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(todayISO());

  const valid = name.trim() !== "" && (balance === "" || !isNaN(Number(balance)));

  function save() {
    if (!valid) return;
    const hasBalance = balance !== "" && !isNaN(Number(balance));
    onSave({
      categoryId: null,
      name: name.trim(),
      color,
      balance: hasBalance ? Number(balance) : null,
      asOf: hasBalance ? asOf : null,
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
        <h2 className="text-lg font-semibold mb-1">Add an account</h2>
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
          <p className="text-xs text-gray-400">
            Skip the balance if you don&apos;t know it — the card will ask for it later.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancel</button>
          <button onClick={save} disabled={!valid} className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40">
            Add account
          </button>
        </div>
      </div>
    </div>
  );
}
