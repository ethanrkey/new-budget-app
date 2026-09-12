import { useState } from "react";
import { todayISO } from "../engine/model.js";

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The one place the account's verified balance changes. Drafts live here;
// nothing touches state until Confirm — which then commits balance + as-of
// date + a history snapshot atomically (mutate.js updateAccountBalance).
// The amount field starts EMPTY on purpose (placeholder shows the current
// figure): pre-filling it would make one stray Confirm re-log the same
// number as a fresh snapshot dated today.
export default function UpdateBalanceModal({ account, onConfirm, onClose }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const valid = amount !== "" && !isNaN(Number(amount)) && !!date;

  function confirm() {
    if (!valid) return;
    onConfirm(Number(amount), date);
  }

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-sm shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Update {account.name} balance</h2>
        <p className="text-xs text-gray-500 mb-4">
          Enter what the bank actually shows and when you checked it. Everything dated before that
          is treated as already inside this number; the forecast builds forward from it.
          Currently {money(account.balance)}, verified {account.balanceAsOf}.
        </p>

        <div className="space-y-3">
          <div>
            <label className={label}>Current balance</label>
            <input
              className={field}
              type="number"
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              placeholder={String(account.balance)}
            />
          </div>
          <div>
            <label className={label}>As of</label>
            <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!valid}
            className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
