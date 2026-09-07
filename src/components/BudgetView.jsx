import { useState } from "react";
import HorizonSlider from "./HorizonSlider.jsx";
import { BUDGET_SECTIONS, computeBudgetLayout } from "../engine/budgetLayout.js";

const money = (n) =>
  (n < 0 ? "-" : "") +
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Tailwind's JIT scanner only picks up literal class-name strings, not
// runtime-built ones (`text-${category}` would silently emit no CSS on its
// own) — spell each one out so this file doesn't depend on some other file
// happening to reference the same classes literally.
const CATEGORY_COLOR_CLASS = {
  roth: "text-roth",
  saved: "text-saved",
  brokerage: "text-brokerage",
  loans: "text-loans",
};

export default function BudgetView({ budget, settings, setSettings, onEditName, onReorder, onReorderDrop, onOpenOnboarding }) {
  const [dragName, setDragName] = useState(null);
  const [overName, setOverName] = useState(null);

  const horizonControl = settings && setSettings ? (
    <HorizonSlider
      label="Project through"
      anchor={settings.checkInDate}
      horizon={settings.budgetHorizon}
      onChange={(iso) => setSettings({ budgetHorizon: iso })}
      help="How many months of columns the Budget grid shows. Independent from the Ledger's own horizon — you can project the Budget further (or less far) than the Ledger."
    />
  ) : null;

  // `budget` always has one column per horizon month regardless of whether
  // there's any actual data — checking .length === 0 alone almost never
  // fires. What actually means "nothing here yet" is every month totaling
  // zero both ways (true for an empty array too, so this subsumes that case).
  const isEmpty = budget.every((c) => c.totalIn === 0 && c.totalOut === 0);

  if (isEmpty) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-3 sm:p-4">
        {horizonControl && <div className="mb-4">{horizonControl}</div>}
        <div className="text-center py-12 px-4">
          <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto text-sm">
            The Budget groups every transaction into a monthly grid — income, fixed bills, savings
            &amp; debt, one-offs — with running totals, so a whole month is visible at a glance. It
            fills in automatically as you add recurring rules and one-off transactions on the
            Ledger tab.
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={onOpenOnboarding}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium hover:opacity-90"
            >
              Run setup wizard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { otherIncomeNames, sectionItems, savingGroups, nameCat } = computeBudgetLayout(budget);

  const th = "py-2 px-3 text-right font-semibold whitespace-nowrap";
  const editRow = (name) => onEditName && (() => onEditName(name));

  // Per-name arrow (▲▼) + drag-and-drop wiring, scoped to exactly `names` —
  // a drag can never be dropped into a different group (section, or Saving/
  // Debt category cluster) because the drop handler only accepts a drag
  // whose source is a member of its own `names` list.
  function rowMeta(names) {
    return names.map((name, i) => {
      const dragProps = onReorderDrop
        ? {
            draggable: true,
            onDragStart: (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", name);
              setDragName(name);
            },
            onDragOver: (e) => {
              if (dragName && names.includes(dragName)) {
                e.preventDefault();
                if (overName !== name) setOverName(name);
              }
            },
            onDragLeave: () => setOverName((o) => (o === name ? null : o)),
            onDrop: (e) => {
              e.preventDefault();
              const from = dragName;
              setDragName(null);
              setOverName(null);
              if (!from || from === name || !names.includes(from)) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const dropAfter = e.clientY - rect.top > rect.height / 2;
              const idx = names.indexOf(name);
              onReorderDrop(names, from, dropAfter ? names[idx + 1] ?? null : name);
            },
            onDragEnd: () => { setDragName(null); setOverName(null); },
          }
        : undefined;

      return {
        name,
        up: onReorder && i > 0 ? () => onReorder(name, names[i - 1]) : null,
        down: onReorder && i < names.length - 1 ? () => onReorder(name, names[i + 1]) : null,
        dragProps,
        isDragging: dragName === name,
        isDragOver: overName === name && dragName !== name,
      };
    });
  }

  function renderSection(sec) {
    const names = sectionItems[sec.key];
    if (!names.length) return null;
    return (
      <>
        <SectionHeader label={sec.label} span={budget.length + 1} />
        {rowMeta(names).map(({ name, up, down, dragProps, isDragging, isDragOver }) => (
          <DataRow key={name} label={name} cols={budget}
            pick={(c) => c.expenseItems[name]?.val || 0} tone="expense" hideZero
            onLabelClick={editRow(name)} onMoveUp={up} onMoveDown={down}
            dragProps={dragProps} isDragging={isDragging} isDragOver={isDragOver} />
        ))}
      </>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-3 sm:p-4 overflow-x-auto">
      {horizonControl && <div className="mb-4">{horizonControl}</div>}
      <table className="text-sm border-collapse min-w-full">
        <thead>
          <tr className="text-gray-500 border-b-2 border-gray-300 dark:border-gray-700">
            <th className="py-2 px-3 text-left font-semibold sticky left-0 bg-white dark:bg-gray-900">MONTH</th>
            {budget.map((c) => (
              <th key={c.key} className={th}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* INCOME */}
          <SectionHeader label="INCOME" span={budget.length + 1} tone="income" />
          <DataRow label="Starting point" cols={budget} pick={(c) => c.startingPoint} muted />
          <DataRow label="Take-home" cols={budget} pick={(c) => c.takeHome} tone="income" />
          <DataRow label="TD checking" cols={budget} pick={(c) => c.tdChecking} tone="income" hideZero />
          {rowMeta(otherIncomeNames).map(({ name, up, down, dragProps, isDragging, isDragOver }) => (
            <DataRow key={name} label={name} cols={budget} tone="income"
              pick={(c) => c.otherInItems?.[name]?.val || 0} hideZero
              onLabelClick={editRow(name)} onMoveUp={up} onMoveDown={down}
              dragProps={dragProps} isDragging={isDragging} isDragOver={isDragOver} />
          ))}
          <TotalRow label="TOTAL IN" cols={budget} pick={(c) => c.totalIn} tone="income" fill="income" />

          {/* FIXED / RECURRING, ONE-OFF / SEASONAL */}
          {renderSection(BUDGET_SECTIONS[0])}
          {renderSection(BUDGET_SECTIONS[2])}

          {/* SAVING / DEBT: one header, rows clustered by category (own color each),
              reorder — arrows or drag — never crosses a category cluster */}
          {sectionItems.saving.length ? (
            <>
              <SectionHeader label="SAVING / DEBT" span={budget.length + 1} />
              {savingGroups.map((names) =>
                rowMeta(names).map(({ name, up, down, dragProps, isDragging, isDragOver }) => (
                  <DataRow key={name} label={name} cols={budget}
                    pick={(c) => c.expenseItems[name]?.val || 0} colorClass={CATEGORY_COLOR_CLASS[nameCat[name]]} hideZero
                    onLabelClick={editRow(name)} onMoveUp={up} onMoveDown={down}
                    dragProps={dragProps} isDragging={isDragging} isDragOver={isDragOver} />
                ))
              )}
            </>
          ) : null}

          {/* TOTALS */}
          <TotalRow label="TOTAL OUT" cols={budget} pick={(c) => c.totalOut} tone="expense" fill="expense" />
          <TotalRow label="MONTHLY NET" cols={budget} pick={(c) => c.net} net />
          <TotalRow label="CUMULATIVE NET" cols={budget} pick={(c) => c.cumulative} net fill="dark" bold />
        </tbody>
      </table>
    </div>
  );
}

function SectionHeader({ label, span, tone }) {
  const bg = tone === "income"
    ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300"
    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300";
  return (
    <tr>
      <td colSpan={span} className={`py-1.5 px-3 font-semibold text-xs tracking-wide ${bg} sticky left-0`}>
        {label}
      </td>
    </tr>
  );
}

function DataRow({
  label, cols, pick, tone, muted, hideZero, onLabelClick, onMoveUp, onMoveDown,
  colorClass, dragProps, isDragging, isDragOver,
}) {
  const reorderable = onMoveUp !== undefined;
  const draggable = !!dragProps?.draggable;
  return (
    <tr
      {...dragProps}
      className={`border-b border-gray-100 dark:border-gray-800/50 group ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-30" : ""} ${isDragOver ? "border-t-2 border-t-gray-900 dark:border-t-white" : ""}`}
    >
      <td className="py-2 sm:py-1.5 px-3 sticky left-0 bg-white dark:bg-gray-900 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {reorderable && (
            <span className="inline-flex flex-col opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition -my-1">
              <button onClick={onMoveUp} disabled={!onMoveUp} title="Move up"
                className="leading-none text-xs sm:text-[9px] px-1 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20 disabled:hover:text-gray-400">▲</button>
              <button onClick={onMoveDown} disabled={!onMoveDown} title="Move down"
                className="leading-none text-xs sm:text-[9px] px-1 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20 disabled:hover:text-gray-400">▼</button>
            </span>
          )}
          {onLabelClick ? (
            <button onClick={onLabelClick} className="text-left hover:underline decoration-dotted underline-offset-2" title="Edit">
              {label}
            </button>
          ) : (
            label
          )}
        </span>
      </td>
      {cols.map((c) => {
        const v = pick(c);
        const show = hideZero ? v !== 0 : true;
        const color = colorClass ?? (muted ? "text-gray-400" : tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "");
        return (
          <td key={c.key} className={`py-2 sm:py-1.5 px-3 text-right ${color}`}>
            {show && v !== 0 ? money(v) : muted && v === 0 ? "$0.00" : ""}
          </td>
        );
      })}
    </tr>
  );
}

function TotalRow({ label, cols, pick, tone, net, fill, bold }) {
  const fillCls =
    fill === "income" ? "bg-green-50 dark:bg-green-950/30"
    : fill === "expense" ? "bg-red-50 dark:bg-red-950/30"
    : fill === "dark" ? "bg-gray-800 text-white dark:bg-gray-700" : "";
  return (
    <tr className={`border-t-2 border-gray-300 dark:border-gray-700 ${bold ? "font-bold" : "font-semibold"} ${fillCls}`}>
      <td className={`py-1.5 px-3 sticky left-0 whitespace-nowrap ${fillCls || "bg-white dark:bg-gray-900"}`}>{label}</td>
      {cols.map((c) => {
        const v = pick(c);
        const color = fill === "dark" ? "text-white"
          : net ? (v < 0 ? "text-expense" : "text-income")
          : tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "";
        return <td key={c.key} className={`py-1.5 px-3 text-right ${color}`}>{money(v)}</td>;
      })}
    </tr>
  );
}
