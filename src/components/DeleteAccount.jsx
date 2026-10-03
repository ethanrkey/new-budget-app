import { useState } from "react";

// The most destructive action in the app, and the one Apple requires to be
// reachable in-app. Two things it does NOT do:
//
// - No email confirmation. The project's SMTP is down, and a confirmation
//   step that silently never arrives is worse than none: it would look
//   like deletion failed while the request sat there unconfirmed. In-app
//   confirmation only, and the copy carries the weight instead.
// - No immediate purge. Seven days, cancellable from the same screen,
//   because the failure mode of an irreversible button is unrecoverable
//   and the failure mode of a delay is mild annoyance.
//
// The copy enumerates, to the same standard as Wipe Data: understating a
// destructive action is the app lying. Typing DELETE is not theatre here —
// it is the one control in the app that cannot be undone after a week.
export default function DeleteAccount({ email, request, onRequest, onCancel }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (request) {
    const when = new Date(request.purge_after);
    const days = Math.max(0, Math.ceil((when - Date.now()) / 86400000));
    return (
      <div className="rounded-lg border border-expense/40 bg-expense/5 p-3 text-sm">
        <p className="font-semibold text-expense">Your account is scheduled for deletion.</p>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Everything is permanently deleted on{" "}
          <strong>{when.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong>
          {days > 0 ? ` — ${days} day${days === 1 ? "" : "s"} from now.` : " — today."}{" "}
          You can still use the app until then, and cancelling undoes this completely.
        </p>
        <button
          onClick={async () => { setBusy(true); await onCancel(); setBusy(false); }}
          disabled={busy}
          className="mt-2 text-sm font-medium underline underline-offset-2 disabled:opacity-40"
        >
          Cancel deletion
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-expense underline decoration-dotted underline-offset-2"
      >
        Delete my account
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-xl border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2 text-expense">Delete your account?</h2>
            <p className="text-sm text-gray-500 mb-3">
              This deletes your account and everything in it, permanently, after a 7-day grace period.
              You can cancel any time before then. After that it cannot be undone — there is no backup
              we can restore you from.
            </p>
            <ul className="text-sm text-gray-500 mb-3 list-disc pl-5 space-y-0.5">
              <li>Your sign-in ({email})</li>
              <li>Every recurring rule, one-off and per-date edit</li>
              <li>Your savings, investment and loan categories, and their terms</li>
              <li>Every balance you logged, every contribution, every monthly actual</li>
              <li>Your verified checking balance and its whole history</li>
            </ul>
            <p className="text-sm text-gray-500 mb-4">
              If you might want any of it, <strong>export a backup first</strong> — it&apos;s one click
              away under Export, and it keeps working during the grace period.
            </p>

            <label className="block text-xs font-medium text-gray-500 mb-1">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder="DELETE"
            />
            {error && <p className="text-sm text-expense mt-2">{error}</p>}

            <div className="flex gap-3 mt-5">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                Keep my account
              </button>
              <button
                disabled={typed !== "DELETE" || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await onRequest();
                  setBusy(false);
                  if (res?.ok) setOpen(false);
                  else setError(res?.error?.message ?? "Couldn't schedule deletion. Try again.");
                }}
                className="flex-1 py-2 rounded-lg bg-expense text-white text-sm font-medium disabled:opacity-40"
              >
                Schedule deletion
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
