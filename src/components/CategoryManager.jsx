import { useState } from "react";

// Create / rename / reorder / delete a user's own savings/debt/
// investment categories. These replace the old hardcoded Roth/Saved/
// Brokerage/Loans — every user gets their own set, editable here.
export default function CategoryManager({ categories, onAdd, onUpdate, onDelete, onMove, onClose, onBack }) {
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("asset");

  function startEdit(cat) {
    setEditingId(cat.id);
    setDraftName(cat.name);
  }
  function commitEdit() {
    const trimmed = draftName.trim();
    if (trimmed) onUpdate(editingId, { name: trimmed });
    setEditingId(null);
  }
  function addNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAdd(trimmed, newKind);
    setNewName("");
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {onBack && (
          <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-2 -mt-1">
            ← Back to Settings
          </button>
        )}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Savings / debt categories</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Done
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          These are your own buckets — Savings, Investments, Debt, or anything else you track. Rename,
          reorder, or delete them any time. There is nothing to colour: the only colours in
          the app are the chart&apos;s and red/green for direction. Deleting one doesn&apos;t touch existing
          transactions — they keep their history, just shown as uncategorized.
        </p>

        <div className="space-y-2 mb-4">
          {sorted.map((cat, i) => (
            <div key={cat.id}>
              <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-800 rounded-lg p-2">
                <span className="flex flex-col -my-1 shrink-0">
                  <button
                    onClick={() => onMove(cat.id, -1)}
                    disabled={i === 0}
                    title="Move up"
                    className="leading-none text-[9px] px-1 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => onMove(cat.id, 1)}
                    disabled={i === sorted.length - 1}
                    title="Move down"
                    className="leading-none text-[9px] px-1 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20"
                  >
                    ▼
                  </button>
                </span>

                <KindPill kind={cat.kind} onClick={() => onUpdate(cat.id, { kind: cat.kind === "debt" ? "asset" : "debt" })} />

                {editingId === cat.id ? (
                  <input
                    autoFocus
                    className="flex-1 min-w-0 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => startEdit(cat)}
                    title="Rename"
                    className="flex-1 min-w-0 text-left text-sm truncate hover:underline decoration-dotted underline-offset-2"
                  >
                    {cat.name}
                  </button>
                )}

                {confirmDeleteId === cat.id ? (
                  <span className="text-xs text-expense whitespace-nowrap shrink-0">
                    <button onClick={() => { onDelete(cat.id); setConfirmDeleteId(null); }} className="font-semibold underline">
                      Delete
                    </button>
                    {" · "}
                    <button onClick={() => setConfirmDeleteId(null)} className="underline">Keep</button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(cat.id)}
                    title="Delete"
                    className="text-gray-300 hover:text-expense text-xs px-1 shrink-0"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {sorted.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No categories yet — add one below.</p>
          )}
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Add a category</label>
          <div className="flex gap-2 mb-2">
            <input
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              placeholder="e.g. Crypto, HSA, Car loan"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addNew(); }}
            />
            <KindPill kind={newKind} onClick={() => setNewKind((k) => (k === "debt" ? "asset" : "debt"))} />
            <button
              onClick={addNew}
              disabled={!newName.trim()}
              className="px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Asset/Debt toggle — affects how the Dashboard calculates "expected" for
// this category (contributions-based vs. amortized off each loan's own
// interest rate). Click to flip.
function KindPill({ kind, onClick }) {
  const isDebt = kind === "debt";
  return (
    <button
      type="button"
      onClick={onClick}
      title="Asset (savings/investments accumulate) or Debt (loans amortize down) — affects the Dashboard's math"
      className={`text-[10px] font-medium px-1.5 py-1 rounded shrink-0 transition ${
        isDebt
          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      {isDebt ? "Debt" : "Asset"}
    </button>
  );
}
