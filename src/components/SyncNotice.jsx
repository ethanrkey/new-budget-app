// Shown when this device's copy turned out to be out of date and was replaced
// with the server's. Never silent: a reload that swaps your data under you has
// to be visible, and if we had to discard edits you can take them with you —
// the copy is stashed in this browser before anything is replaced.
export default function SyncNotice({ notice, onDownload, onDismiss }) {
  if (!notice) return null;
  const conflict = notice.kind === "conflict";
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
