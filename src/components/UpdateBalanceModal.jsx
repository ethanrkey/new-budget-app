import { useState } from "react";
import { todayISO } from "../engine/model.ts";
import { useSubmitOnce } from "../useSubmitOnce.js";
import { HIDDEN_ROWS_COPY as HIDDEN, DATE_LABEL } from "../content/logBalance.ts";
import { fmtDate } from "../shared/dates.ts";
import { CONNECT_HINT, CONNECT_HINT_DISMISS } from "../content/connect.ts";

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
export default function UpdateBalanceModal({ account, onConfirm, onClose, title, blurb, amountLabel, cta, hiddenRows, dateLabel, offerConnectHint, onOpenSettings, onHideHint }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  // The rows about to disappear, once Confirm has been pressed and
  // there turned out to be some. Null means "not asked yet".
  const [confirming, setConfirming] = useState(null);
  const valid = amount !== "" && !isNaN(Number(amount)) && !!date;

  // The validity check sits OUTSIDE the guard on purpose: useSubmitOnce
  // burns its one shot the moment it is called, so checking inside it meant
  // one Enter on an empty field disabled the modal for good.
  const [submit, submitted] = useSubmitOnce(() => onConfirm(Number(amount), date));
  // A BACK-DATED LOG THAT HIDES NOTHING GETS NO PROMPT. The warning
  // earns its interruption by naming specific rows; shown when there
  // are none it is noise, and noise is how a warning stops being read.
  const confirm = () => {
    if (!valid) return;
    const dropping = hiddenRows?.(date) ?? [];
    if (dropping.length > 0 && confirming == null) { setConfirming(dropping); return; }
    submit();
  };

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-sm shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {confirming ? (
          <>
            <h2 className="text-lg font-semibold mb-1">{HIDDEN.title}</h2>
            <p className="text-xs text-gray-500 mb-3">{HIDDEN.lede(confirming.length, date)}</p>
            <ul className="max-h-52 overflow-y-auto border-y border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {confirming.map((r) => (
                <li key={r.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="w-24 shrink-0 tabular-nums text-gray-500">{fmtDate(r.date)}</span>
                  <span className="grow truncate">{r.name}</span>
                  <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">{money(r.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500 mt-3">{HIDDEN.why}</p>
            <p className="text-xs text-brass mt-2">{HIDDEN.escape}</p>
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                {HIDDEN.cancel}
              </button>
              <button
                onClick={submit}
                disabled={submitted}
                className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
              >
                {HIDDEN.confirm}
              </button>
            </div>
          </>
        ) : (
        <>
        <h2 className="text-lg font-semibold mb-1">{title ?? `Update ${account.name} balance`}</h2>
        <p className="text-xs text-gray-500 mb-4">
          {blurb ?? (
            <>
              Enter the current balance of your primary checking account and the date you checked it.
              Transactions dated before that date will drop out of the ledger, since the balance
              already accounts for them — make sure none of them are bills you still owe.
              Currently {money(account.balance)}, as of {fmtDate(account.balanceAsOf)}.
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
            {/* "As of" for a reading, "On" for a contribution — the
                phone's distinction, from the same constant. */}
            <label className={label}>{dateLabel ?? DATE_LABEL.balance}</label>
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

        {/* THE ONE PLACE THIS IS EVER MENTIONED to someone who has not
            turned it on, and NOT IN SETUP, on the owner's call. The
            reason generalizes: somebody deciding whether to use this
            app at all is the wrong person to offer a bank connection
            to. This is read by somebody who has just typed a balance
            by hand and therefore knows what that costs them.

            IT LOADS NO PLAID CODE — a sentence, a link to Settings,
            and a way never to see it again. The script is only
            fetched at the moment of consent; see
            ConnectedAccount.jsx. */}
        {offerConnectHint && (
          <div className="mt-5 flex items-baseline justify-between gap-3">
            <button onClick={onOpenSettings} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 underline text-left">
              {CONNECT_HINT}
            </button>
            <button onClick={onHideHint} className="shrink-0 text-xs text-gray-400 hover:text-gray-600">
              {CONNECT_HINT_DISMISS}
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
