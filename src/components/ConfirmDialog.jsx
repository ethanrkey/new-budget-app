import { useEffect, useRef } from "react";

// A destructive question, asked once, in a real dialog (2026-10-29).
//
// CANCEL IS FOCUSED, so the key somebody presses without reading —
// Enter, Space — is the one that loses nothing. Escape and a click on
// the scrim cancel too. Delete is the app's expense red and is the
// only way through.
//
// Built for the Ledger's ✕, which deleted a whole recurring rule on
// one click. The other deletes on the web already had a second step,
// inline; this is the shape for the ones where a slip costs the most.
export default function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 p-5 shadow-xl"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {body && <p id="confirm-body" className="mt-2 text-sm text-gray-600 dark:text-gray-400">{body}</p>}
        <div className="flex gap-3 mt-5">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-lg bg-expense text-white text-sm font-medium hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
