import { useRef, useState } from "react";
import { CATEGORIES, CADENCES, uid, todayISO } from "../engine/model.js";

const money = (n) =>
  Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

const CADENCE_LABEL = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};

// Fast, no-modal entry: fill the row, hit Enter, it lands in state immediately
// and the row resets (keeping type/category/date — only name+amount clear) so
// you can keep typing without touching the mouse. Supports one-off and
// recurring both. This is additive to the full Add/Edit modal, not a
// replacement — precise stuff (end dates, editing) still goes through that.
export default function QuickEntry({ onAdd, onRemove, onClose, trackerCategories = [] }) {
  const [mode, setMode] = useState("oneoff");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("bill");
  const [date, setDate] = useState(todayISO());
  const sortedCats = [...trackerCategories].sort((a, b) => a.order - b.order);
  const categoryLabel = (id) => CATEGORIES[id]?.label ?? trackerCategories.find((c) => c.id === id)?.name ?? id;
  const [cadence, setCadence] = useState("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [added, setAdded] = useState([]); // items added this session, newest first
  const nameRef = useRef(null);

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name required");
      nameRef.current?.focus();
      return;
    }
    if (amount === "" || isNaN(Number(amount))) {
      setError("Amount required");
      return;
    }
    const base = {
      id: uid(),
      name: name.trim(),
      amount: Math.abs(Number(amount)),
      category,
    };
    const item =
      mode === "recurring"
        ? {
            ...base,
            cadence,
            startDate,
            endDate: endDate || null,
            dayOfMonth: new Date(startDate + "T00:00:00").getDate(),
          }
        : { ...base, date };

    onAdd(item);
    setAdded((a) => [item, ...a]);
    setError("");
    setName("");
    setAmount("");
    nameRef.current?.focus();
  }

  function undo(id) {
    onRemove(id);
    setAdded((a) => a.filter((it) => it.id !== id));
  }

  const field =
    "px-2 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4 mb-3">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300 truncate">
          Quick entry <span className="hidden sm:inline text-gray-400 font-normal">— Enter to add, keeps going</span>
        </h2>
        <button
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          Done
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {["oneoff", "recurring"].map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-2 sm:py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                mode === m
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "border border-gray-300 dark:border-gray-700"
              }`}
            >
              {m === "oneoff" ? "One-time" : "Recurring"}
            </button>
          ))}
        </div>

        <input
          ref={nameRef}
          className={`${field} w-40`}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className={`${field} w-24`}
          type="number"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
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

        {mode === "oneoff" ? (
          <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        ) : (
          <>
            <select className={field} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              {CADENCES.map((c) => (
                <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
              ))}
            </select>
            <input
              className={field}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              title="Start"
            />
            <input
              className={field}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              title="End (optional)"
            />
          </>
        )}

        <button
          type="submit"
          className="px-3 py-2 sm:py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90"
        >
          Add
        </button>
      </form>
      {error && <p className="text-xs text-expense mt-1.5">{error}</p>}

      {added.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="text-xs text-gray-400 mb-1">Added this session ({added.length})</div>
          <div className="max-h-40 overflow-y-auto">
            {added.map((it) => (
              <div key={it.id} className="flex items-center justify-between text-sm py-0.5">
                <span className="truncate">
                  {it.name}{" "}
                  <span className="text-gray-400">
                    — {categoryLabel(it.category)}
                    {it.cadence ? ` · ${CADENCE_LABEL[it.cadence]}` : ` · ${it.date}`}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0 pl-2">
                  <span>{money(it.amount)}</span>
                  <button
                    onClick={() => undo(it.id)}
                    className="text-gray-300 hover:text-expense text-sm sm:text-xs px-1 -m-1"
                    title="Remove"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
