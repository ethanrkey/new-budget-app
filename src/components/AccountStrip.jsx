import { useState } from "react";
import { fmtDate } from "../shared/dates.ts";
import {
  canReconnect, canUseBankBalance, pillIsAction, pillLongOf, pillStateOf,
} from "../shared/connect.ts";
import { PILL_SHEET } from "../content/connect.ts";
import { fmtInstant } from "../shared/dates.ts";
import { todayISO } from "../engine/model.ts";
const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });


// Read-only account summary that replaces the old editable "check-in bar."
// Deliberately NOT an input: the old bar committed a new balance on every
// keystroke, so a half-typed number was live state. Here the number is
// display only; the single button opens UpdateBalanceModal, where nothing
// changes until Confirm. Stays visible on every tab because this balance is
// the anchor every Ledger/Budget number is built from.
export default function AccountStrip({ account, onUpdateClick, connection, newestSnapshot, onPull, onReconnect, syncing = false, connecting = false }) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  async function run(trigger) {
    setBusy(true);
    setSaid(null);
    const message = await onPull?.(trigger);
    setBusy(false);
    // A refresh that did nothing says so IN THE MENU and never as an
    // error: the server declines for four ordinary reasons and a
    // silent button reads as broken. See refreshOutcome.
    if (message) { setSaid(message); return; }
    setMenu(false);
  }
  const doRefresh = () => run("refresh");
  const doAdopt = () => run("adopt");

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
    // A pull is running. The line said "as of 10/22" for the five
    // seconds one takes, which reads as a tap that did nothing.
    syncing || busy,
    // Still reading the connection on an account with the feature
    // on: "syncing…", never the manual "as of" in the meantime.
    connecting,
  );
  // THE WEB SAYS THE WHOLE STAMP, the phone says the short form —
  // the owner's call after seeing both. A browser has the room, and
  // "synced 8:14 AM" on a tab left open since yesterday is ambiguous
  // in a way it never is on a phone you just picked up. Same five
  // states and the same decision underneath; only the rendering
  // differs. The Dashboard card is untouched and still says "as of".
  const line = pillLongOf(pill, {
    amount: money(account.balance),
    asOf: fmtDate(account.balanceAsOf),
    syncedStamp: fmtInstant(connection?.lastSyncedAt),
    // When the override was typed. Older snapshots have no
    // `loggedAt`, so they fall back to the day they are about.
    loggedStamp: newestSnapshot?.loggedAt ? fmtInstant(newestSnapshot.loggedAt) : fmtDate(account.balanceAsOf),
  });
  const suffix = line.slice(line.indexOf(" · ") + 3);

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
      {/* CONNECTED OPENS A CHOICE, NOT A FORM — the same three doors
          the phone offers, for the same reason: somebody with a bank
          may want either, and the manual one must not become the
          small print the day they connect. Unconnected, the button
          is what it always was. */}
      {connection ? (
        <div className="ml-auto relative">
          <button
            onClick={() => setMenu((m) => !m)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-haspopup="menu"
            aria-expanded={menu}
          >
            Balance ▾
          </button>
          {menu && (
            <>
              {/* Click-away, behind the menu and in front of
                  everything else. A menu you can only close with the
                  same button is a trap on a page this dense. */}
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute right-0 mt-1 z-50 w-56 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-1 text-sm">
                {/* RECONNECT INSTEAD OF REFRESH when the bank is
                    asking to be signed into again: a refresh in that
                    state cannot work, and the top item of the menu
                    should not be a button whose only outcome is a
                    failure. It opens Settings rather than Link —
                    update mode is the only repair path, and a second
                    place that opens Link is a second place for
                    "which mode?" to be answered wrongly. */}
                {canReconnect(connection) ? (
                  <button role="menuitem" onClick={() => { setMenu(false); onReconnect?.(); }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                    {PILL_SHEET.reconnect}
                  </button>
                ) : (
                  <button role="menuitem" disabled={busy} onClick={doRefresh}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
                    {busy ? "Refreshing…" : PILL_SHEET.refresh}
                  </button>
                )}
                <button role="menuitem" onClick={() => { setMenu(false); onUpdateClick(); }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                  {PILL_SHEET.manual}
                </button>
                {canUseBankBalance(pill) && (
                  <button role="menuitem" disabled={busy} onClick={doAdopt}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
                    {PILL_SHEET.useBank}
                  </button>
                )}
                <p className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800 mt-1">
                  {said ?? PILL_SHEET.lastSynced(fmtInstant(connection.lastSyncedAt))}
                </p>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={onUpdateClick}
          className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        >
          Update balance
        </button>
      )}
    </div>
  );
}
