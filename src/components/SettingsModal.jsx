import WipeData from "./WipeData.jsx";
import DeleteAccount from "./DeleteAccount.jsx";

// Everything that used to be scattered across the header and the old
// check-in bar, in one place: appearance, category management, sign-out,
// and — deliberately last, visually separated — the one destructive action.
// The header itself is now just Import / Export / Settings.
export default function SettingsModal({ isDark, onToggleTheme, onOpenCategories, onWipe, onSignOut, onClose,
  email, deletionRequest, onRequestDeletion, onCancelDeletion }) {
  const row = "flex items-center justify-between gap-3 py-3";
  const btn = "text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Done
          </button>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <div className={row}>
            <div>
              <div className="text-sm font-medium">Appearance</div>
              <div className="text-xs text-gray-500">This device only — other devices keep their own.</div>
            </div>
            <button onClick={onToggleTheme} className={btn}>
              {isDark ? "☀ Light" : "🌙 Dark"}
            </button>
          </div>

          <div className={row}>
            <div>
              <div className="text-sm font-medium">Savings / debt categories</div>
              <div className="text-xs text-gray-500">Rename, recolor, reorder, mark as asset or debt.</div>
            </div>
            <button onClick={onOpenCategories} className={btn}>Manage</button>
          </div>

          <div className={row}>
            <div className="text-sm font-medium">Account</div>
            <button onClick={onSignOut} className={btn}>Sign out</button>
          </div>

          <div className={`${row} mt-2`}>
            <div>
              <div className="text-sm font-medium text-expense">Danger zone</div>
              <div className="text-xs text-gray-500">
                Wiping resets this account to new. Deleting removes the account itself. Both ask first.
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <WipeData onWipe={onWipe} />
              <DeleteAccount
                email={email}
                request={deletionRequest}
                onRequest={onRequestDeletion}
                onCancel={onCancelDeletion}
              />
            </div>
          </div>

          {/* A scheduled deletion is not something to find only by opening
              Settings — it is shown here in full whenever one is pending. */}
          {deletionRequest && (
            <div className="mt-3">
              <DeleteAccount
                email={email}
                request={deletionRequest}
                onRequest={onRequestDeletion}
                onCancel={onCancelDeletion}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
