// Shown when this device's copy turned out to be out of date and was replaced
// with the server's. Never silent: a reload that swaps your data under you has
// to be visible, and if we had to discard edits you can take them with you —
// the copy is stashed in this browser before anything is replaced.
//
// The third kind, "error", is the one that used to be invisible. A save that
// fails for any reason other than a conflict was console.error only, so the
// app went on looking normal while nothing it did was reaching the server —
// the worst shape a failure can take, because the user keeps working. It
// matters most during a storage migration, when an out-of-date tab is
// EXPECTED to be refused, but a silent save failure was never acceptable in
// any phase.
export default function SyncNotice({ notice, onDownload, onDismiss, onReload }) {
  if (!notice) return null;
  const conflict = notice.kind === "conflict";
  const failed = notice.kind === "error";

  if (failed) {
    return (
      <div
        role="alert"
        className="px-3 sm:px-6 py-2.5 text-sm flex items-start gap-3 border-b bg-expense/10 border-expense/30 text-expense"
      >
        <span className="grow text-gray-900 dark:text-gray-100">
          <strong className="font-semibold">Your changes aren&apos;t being saved.</strong>{" "}
          This tab may be out of date, or the connection failed. Reload to pick up the
          current version — anything you&apos;ve changed since the last successful save will be lost.
        </span>
        <button
          onClick={onReload}
          className="shrink-0 underline underline-offset-2 hover:no-underline font-medium text-gray-900 dark:text-gray-100"
        >
          Reload
        </button>
        <button onClick={onDismiss} title="Dismiss" className="shrink-0 opacity-60 hover:opacity-100 px-1 -my-1">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={`px-3 sm:px-6 py-2.5 text-sm flex items-start gap-3 border-b ${
        conflict
          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200"
          : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300"
      }`}
    >
      <span className="grow">
        {conflict ? (
          <>
            This device was out of date, so its changes weren&apos;t saved — your data had already
            been updated somewhere else. Reloaded the newer version.
            {notice.stashed
              ? " A copy of what was on this device was kept in this browser."
              : " (A copy could not be kept — this browser blocked local storage.)"}
          </>
        ) : (
          <>Reloaded — your data had changed on another device.</>
        )}
      </span>
      {conflict && notice.stashed && (
        <button
          onClick={onDownload}
          className="shrink-0 underline underline-offset-2 hover:no-underline font-medium"
        >
          Download that copy
        </button>
      )}
      <button
        onClick={onDismiss}
        title="Dismiss"
        className="shrink-0 opacity-60 hover:opacity-100 px-1 -my-1"
      >
        ✕
      </button>
    </div>
  );
}
