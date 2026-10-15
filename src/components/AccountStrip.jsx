import { fmtDate } from "../shared/dates.ts";
const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });


// Read-only account summary that replaces the old editable "check-in bar."
// Deliberately NOT an input: the old bar committed a new balance on every
// keystroke, so a half-typed number was live state. Here the number is
// display only; the single button opens UpdateBalanceModal, where nothing
// changes until Confirm. Stays visible on every tab because this balance is
// the anchor every Ledger/Budget number is built from.
export default function AccountStrip({ account, onUpdateClick }) {
  return (
    <div className="px-3 sm:px-6 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <span className="font-medium">{account.name}</span>
      <span className="text-gray-300 dark:text-gray-700">·</span>
      <span className="font-semibold text-base">{money(account.balance)}</span>
      {/* "as of", not "verified" — the owner's word, 2026-10-15, and
          the phone's bar says the same thing. What the line reports is
          when the number was true, not that an act of verification
          happened. The savings and investment cards keep "logged",
          which IS an act you performed. */}
      <span className="text-gray-500">
        as of {fmtDate(account.balanceAsOf)}
      </span>
      <button
        onClick={onUpdateClick}
        className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
      >
        Update balance
      </button>
    </div>
  );
}
