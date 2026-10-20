import { fmtDate } from "../shared/dates.ts";
import { pillIsAction, pillStateOf, pillSuffixOf } from "../shared/connect.ts";
import { todayISO } from "../engine/model.ts";
const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });


// Read-only account summary that replaces the old editable "check-in bar."
// Deliberately NOT an input: the old bar committed a new balance on every
// keystroke, so a half-typed number was live state. Here the number is
// display only; the single button opens UpdateBalanceModal, where nothing
// changes until Confirm. Stays visible on every tab because this balance is
// the anchor every Ledger/Budget number is built from.
export default function AccountStrip({ account, onUpdateClick, connection, newestSnapshot }) {
  // WHICH OF THE FIVE STATES, decided in src/shared/connect.ts so
  // that the phone cannot answer it differently. The source read is
  // the one on the SNAPSHOT CURRENTLY ON SCREEN, not the last pull:
  // when a manual log won the date, saying "synced" would attribute
  // the user's own figure to their bank.
  const pill = pillStateOf(
    connection ?? null,
    newestSnapshot?.date === account.balanceAsOf ? newestSnapshot?.source : undefined,
    account.balanceAsOf,
    todayISO(),
  );
  const syncedAt = connection?.lastSyncedAt ? new Date(connection.lastSyncedAt) : null;
  const clock = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const suffix = pillSuffixOf(pill, {
    asOf: fmtDate(account.balanceAsOf),
    syncedTime: syncedAt ? clock(syncedAt) : "",
    syncedWhen: syncedAt ? `${fmtDate(connection.lastSyncedAt.slice(0, 10))} ${clock(syncedAt)}` : "never",
  });

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
      {/* GOLD ONLY WHEN IT ASKS FOR SOMETHING. Four of the five
          states describe; "Reconnect" is the one that wants a tap,
          and the accent is spent on it for that reason and not
          because a bank connection is exciting. */}
      <span className={pillIsAction(pill) ? "font-semibold text-amber-600 dark:text-amber-500" : "text-gray-500"}>
        {suffix}
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
