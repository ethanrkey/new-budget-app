const money = (n) =>
  (n < 0 ? "-" : "") +
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

const SECTIONS = [
  { key: "bill", label: "FIXED / RECURRING", cats: ["bill"] },
  { key: "saving", label: "SAVING / DEBT", cats: ["roth", "saved", "brokerage", "loans"] },
  { key: "oneoff", label: "ONE-OFF / SEASONAL", cats: ["oneoff"] },
];

// category -> section key
const CAT_TO_SECTION = {};
for (const sec of SECTIONS) for (const c of sec.cats) CAT_TO_SECTION[c] = sec.key;

export default function BudgetView({ budget, onEditName }) {
  if (budget.length === 0) {
    return <div className="text-center text-gray-400 py-12">No data yet — add transactions.</div>;
  }

  // collect item names per section (across all months, preserve first-seen order)
  const sectionItems = {};
  for (const sec of SECTIONS) sectionItems[sec.key] = [];
  const otherIncomeNames = [];
  const nameCat = {}; // item name -> its category, for ordering within a section

  for (const col of budget) {
    for (const [name, obj] of Object.entries(col.expenseItems)) {
      const secKey = CAT_TO_SECTION[obj.category] || "oneoff";
      if (!sectionItems[secKey].includes(name)) sectionItems[secKey].push(name);
      nameCat[name] = obj.category;
    }
    for (const name of Object.keys(col.otherInItems || {})) {
      if (!otherIncomeNames.includes(name)) otherIncomeNames.push(name);
    }
  }

  // within SAVING / DEBT, group rows by category (roth, saved, brokerage, loans)
  const savingCats = SECTIONS.find((s) => s.key === "saving").cats;
  sectionItems.saving.sort(
    (a, b) => savingCats.indexOf(nameCat[a]) - savingCats.indexOf(nameCat[b])
  );

  const th = "py-2 px-3 text-right font-semibold whitespace-nowrap";
  const editRow = (name) => onEditName && (() => onEditName(name));

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-4 overflow-x-auto">
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
          {otherIncomeNames.map((name) => (
            <DataRow key={name} label={name} cols={budget} tone="income"
              pick={(c) => c.otherInItems?.[name] || 0} hideZero onLabelClick={editRow(name)} />
          ))}
          <TotalRow label="TOTAL IN" cols={budget} pick={(c) => c.totalIn} tone="income" fill="income" />

          {/* EXPENSE SECTIONS */}
          {SECTIONS.map((sec) =>
            sectionItems[sec.key].length ? (
              <FragmentSection key={sec.key} sec={sec} names={sectionItems[sec.key]}
                budget={budget} onEditName={onEditName} />
            ) : null
          )}

          {/* TOTALS */}
          <TotalRow label="TOTAL OUT" cols={budget} pick={(c) => c.totalOut} tone="expense" fill="expense" />
          <TotalRow label="MONTHLY NET" cols={budget} pick={(c) => c.net} net />
          <TotalRow label="CUMULATIVE NET" cols={budget} pick={(c) => c.cumulative} net fill="dark" bold />
        </tbody>
      </table>
    </div>
  );
}

function FragmentSection({ sec, names, budget, onEditName }) {
  return (
    <>
      <SectionHeader label={sec.label} span={budget.length + 1} />
      {names.map((name) => (
        <DataRow key={name} label={name} cols={budget}
          pick={(c) => c.expenseItems[name]?.val || 0} tone="expense" hideZero
          onLabelClick={onEditName && (() => onEditName(name))} />
      ))}
    </>
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

function DataRow({ label, cols, pick, tone, muted, hideZero, onLabelClick }) {
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800/50">
      <td className="py-1.5 px-3 sticky left-0 bg-white dark:bg-gray-900 whitespace-nowrap">
        {onLabelClick ? (
          <button onClick={onLabelClick} className="text-left hover:underline decoration-dotted underline-offset-2" title="Edit">
            {label}
          </button>
        ) : (
          label
        )}
      </td>
      {cols.map((c) => {
        const v = pick(c);
        const show = hideZero ? v !== 0 : true;
        const color = muted ? "text-gray-400" : tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "";
        return (
          <td key={c.key} className={`py-1.5 px-3 text-right ${color}`}>
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
