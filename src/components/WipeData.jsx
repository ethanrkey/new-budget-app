import { useState } from "react";

// Deliberately NOT near the header icon buttons — this is the single most
// destructive action in the app, so it lives as small, muted text in the
// check-in bar instead, and always requires a full confirmation modal (never
// a one-click action, not even the inline 2-step used elsewhere).
export default function WipeData({ onWipe }) {
  const [open, setOpen] = useState(false);

  function confirm() {
    onWipe();
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-expense underline decoration-dotted underline-offset-2 ml-auto"
      >
        Wipe all data
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-xl border border-gray-200 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2 text-expense">Wipe all data?</h2>
            <p className="text-sm text-gray-500 mb-4">
              This permanently deletes every recurring rule and one-off transaction, in this app and
              in your Supabase account. There is no undo.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
                Cancel
              </button>
              <button onClick={confirm} className="flex-1 py-2 rounded-lg bg-expense text-white text-sm font-medium hover:opacity-90">
                Yes, delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
