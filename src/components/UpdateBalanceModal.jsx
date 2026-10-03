import { useState } from "react";
import { todayISO } from "../engine/model.ts";
import { useSubmitOnce } from "../useSubmitOnce.js";

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// THE COPY HERE WARNS BEFORE IT EXPLAINS (rewritten 2026-10-03). The old
// text described the mechanism — "everything dated before that is already
// inside this number; the forecast builds forward from it" — without
// saying what that costs you. Setting an as-of date makes every earlier
// transaction drop out of the ledger (generate.ts buildEvents filters
// `e.date >= balanceAsOf`), so a user with an unpaid bill dated before the
// cutoff watches it vanish from the forecast while still owing it. The
// warning is the point; the mechanics are secondary.
//
// The cutoff is balanceAsOf, NOT today: a date you set in the past drops
// everything before THAT. Same-day transactions are kept — the filter is
// `>=` — so "before that date" is exact rather than approximate.
//
// The one place the account's verified balance changes. Drafts live here;
// nothing touches state until Confirm — which then commits balance + as-of
// date + a history snapshot atomically (mutate.ts updateAccountBalance).
// The amount field starts EMPTY on purpose (placeholder shows the current
// figure): pre-filling it would make one stray Confirm re-log the same
// number as a fresh snapshot dated today.
// Also used, with copy overrides, to log a contribution — it is already
// exactly amount + date + Confirm, and a near-identical second modal would
// be two places to fix every future change to this interaction.
export default function UpdateBalanceModal({ account, onConfirm, onClose, title, blurb, amountLabel, cta }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const valid = amount !== "" && !isNaN(Number(amount)) && !!date;

  // The validity check sits OUTSIDE the guard on purpose: useSubmitOnce
  // burns its one shot the moment it is called, so checking inside it meant
  // one Enter on an empty field disabled the modal for good.
  const [submit, submitted] = useSubmitOnce(() => onConfirm(Number(amount), date));
  const confirm = () => { if (valid) submit(); };

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-sm shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{title ?? `Update ${account.name} balance`}</h2>
        <p className="text-xs text-gray-500 mb-4">
          {blurb ?? (
            <>
              Enter the current balance of your primary checking account and the date you checked it.
              Transactions dated before that date will drop out of the ledger, since the balance
              already accounts for them — make sure none of them are bills you still owe.
              Currently {money(account.balance)}, verified {account.balanceAsOf}.
            </>
          )}
        </p>

        <div className="space-y-3">
          <div>
            <label className={label}>{amountLabel ?? "Current balance"}</label>
            <input
              className={field}
              type="number"
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              placeholder={account.balance == null ? "0.00" : String(account.balance)}
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
            disabled={!valid || submitted}
            className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
          >
            {cta ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
