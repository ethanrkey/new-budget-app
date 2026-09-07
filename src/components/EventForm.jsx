import { useState } from "react";
import { CATEGORIES, CADENCES, uid, todayISO } from "../engine/model.js";
import ColorSwatches from "./ColorSwatches.jsx";

export default function EventForm({ onSave, onCancel, onDelete, initial, trackerCategories = [], isDark }) {
  const [mode, setMode] = useState(initial?.cadence ? "recurring" : "oneoff");
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [category, setCategory] = useState(initial?.category ?? "bill");
  const [color, setColor] = useState(initial?.color ?? null);
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [cadence, setCadence] = useState(initial?.cadence ?? "monthly");
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sortedCats = [...trackerCategories].sort((a, b) => a.order - b.order);

  function submit() {
    if (!name || amount === "" || isNaN(Number(amount))) return;
    const base = {
      id: initial?.id ?? uid(),
      name: name.trim(),
      amount: Math.abs(Number(amount)),
      category,
      color,
      order: initial?.order,
    };
    if (mode === "recurring") {
      onSave({
        ...base,
        cadence,
        startDate,
        endDate: endDate || null,
        dayOfMonth: new Date(startDate + "T00:00:00").getDate(),
      });
    } else {
      onSave({ ...base, date });
    }
  }

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onCancel}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">{initial ? "Edit" : "Add"} transaction</h2>

        {/* mode toggle */}
        <div className="flex gap-2 mb-4">
          {["oneoff", "recurring"].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition ${
                mode === m
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "border border-gray-300 dark:border-gray-700"
              }`}
            >
              {m === "oneoff" ? "One-time" : "Recurring"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, Paycheck, ..." />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className={label}>Amount</label>
              <input className={field} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="flex-1">
              <label className={label}>Category</label>
              <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
                {sortedCats.length > 0 && (
                  <optgroup label="Savings / Debt / Investments">
                    {sortedCats.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Color (optional)</label>
            <ColorSwatches value={color} onChange={setColor} isDark={isDark} allowNone noneLabel="Use the category's color" />
          </div>

          {mode === "oneoff" ? (
            <div>
              <label className={label}>Date</label>
              <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <label className={label}>Repeats</label>
                <select className={field} value={cadence} onChange={(e) => setCadence(e.target.value)}>
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {c === "weekly" ? "Every week" : c === "biweekly" ? "Every 2 weeks" : c === "monthly" ? "Monthly" : "Yearly"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className={label}>Start</label>
                  <input className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className={label}>End (optional)</label>
                  <input className={field} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancel</button>
          <button onClick={submit} className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium">Save</button>
        </div>

        {onDelete && (
          <div className="mt-3 text-center">
            {confirmDelete ? (
              <span className="text-sm text-expense">
                Delete {initial?.cadence ? "this rule and all its dates" : "this item"}?{" "}
                <button onClick={onDelete} className="font-semibold underline">Yes, delete</button>
                {" · "}
                <button onClick={() => setConfirmDelete(false)} className="underline">Keep</button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-sm text-gray-400 hover:text-expense py-1.5 px-2"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}