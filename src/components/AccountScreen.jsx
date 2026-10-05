// Settings → Account, as its own screen.
//
// This was inline until 2026-10-05, on the argument that three read-only
// facts behind a tap is navigation for nothing. That argument was about the
// CONTENT and missed the container: Settings reads as a short list of
// sections or as one long scroll, and the sections are what make it
// scannable. Account is also the section that grows — changing an email,
// changing a password, sessions — and each of those arriving inline is one
// more thing between Appearance and the danger zone.
//
// Same pattern as the category manager: its own modal, "← Back to Settings"
// top-left, "Done" top-right. Back returns to Settings; Done closes the lot.
const PROVIDER_LABEL = { google: "Google", email: "Email", apple: "Apple", github: "GitHub" };

// Which identity provider actually signed you in. Supabase keeps the list on
// app_metadata.providers; "email" covers both magic link and password, which
// are the same credential from the database's point of view, so this does
// not try to tell them apart and claim something it cannot know.
function providerNames(providers) {
  const list = (providers ?? []).map((p) => PROVIDER_LABEL[p] ?? p);
  return list.length ? list.join(" and ") : "—";
}

export default function AccountScreen({ email, providers, createdAt, onSignOut, onBack, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-2 -mt-1">
          ← Back to Settings
        </button>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Account</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Done
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Who you are signed in as. Your data is tied to this account and nothing else.
        </p>

        <dl className="text-sm divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-100 dark:border-gray-800">
          <Fact term="Signed in as" value={email ?? "—"} truncate />
          <Fact term="Signed in via" value={providerNames(providers)} />
          <Fact
            term="Member since"
            value={createdAt
              ? new Date(createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
              : "—"}
          />
        </dl>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Signing out leaves your data where it is. Nothing is deleted.
          </p>
          <button
            onClick={onSignOut}
            className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ term, value, truncate = false }) {
  return (
    <div className="flex gap-3 py-2.5">
      <dt className="w-28 shrink-0 text-gray-500">{term}</dt>
      <dd className={`text-gray-900 dark:text-gray-100 ${truncate ? "truncate" : ""}`}>{value}</dd>
    </div>
  );
}
