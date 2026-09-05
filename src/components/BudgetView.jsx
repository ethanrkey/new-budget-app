import HorizonSlider from "./HorizonSlider.jsx";

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

export default function BudgetView({ budget, settings, setSettings, onEditName, onReorder }) {
  const horizonControl = settings && setSettings ? (
    <HorizonSlider
      label="Project through"
      anchor={settings.checkInDate}
      horizon={settings.budgetHorizon}
      onChange={(iso) => setSettings({ budgetHorizon: iso })}
    />
  ) : null;

  if (budget.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-4">
        {horizonControl && <div className="mb-4">{horizonControl}</div>}
        <div className="text-center text-gray-400 py-12">No data yet — add transactions.</div>
      </div>
    );
  }

  // collect item names per section (across all months, preserve first-seen order)
  const sectionItems = {};
  for (const sec of SECTIONS) sectionItems[sec.key] = [];
  const otherIncomeNames = [];
  const nameCat = {};   // item name -> its category
  const nameOrder = {}; // item name -> its manual order

  for (const col of budget) {
    for (const [name, obj] of Object.entries(col.expenseItems)) {
      const secKey = CAT_TO_SECTION[obj.category] || "oneoff";
      if (!sectionItems[secKey].includes(name)) sectionItems[secKey].push(name);
      nameCat[name] = obj.category;
      nameOrder[name] = obj.order ?? 0;
    }
    for (const [name, obj] of Object.entries(col.otherInItems || {})) {
      if (!otherIncomeNames.includes(name)) otherIncomeNames.push(name);
      nameOrder[name] = obj.order ?? 0;
    }
  }

  otherIncomeNames.sort((a, b) => nameOrder[a] - nameOrder[b]);
  sectionItems.bill.sort((a, b) => nameOrder[a] - nameOrder[b]);
  sectionItems.oneoff.sort((a, b) => nameOrder[a] - nameOrder[b]);
  // SAVING / DEBT: cluster by category (roth, saved, brokerage, loans), order within each
  const savingCats = SECTIONS.find((s) => s.key === "saving").cats;
  sectionItems.saving.sort((a, b) => {
    const catDiff = savingCats.indexOf(nameCat[a]) - savingCats.indexOf(nameCat[b]);
    return catDiff !== 0 ? catDiff : nameOrder[a] - nameOrder[b];
  });
  // reorder arrows move within the same category cluster, never across
  const savingGroups = savingCats.map((cat) => sectionItems.saving.filter((n) => nameCat[n] === cat));

  const th = "py-2 px-3 text-right font-semibold whitespace-nowrap";
  const editRow = (name) => onEditName && (() => onEditName(name));

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-4 overflow-x-auto">
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
          {withMoves(otherIncomeNames, onReorder).map(({ name, up, down }) => (
            <DataRow key={name} label={name} cols={budget} tone="income"
              pick={(c) => c.otherInItems?.[name]?.val || 0} hideZero
              onLabelClick={editRow(name)} onMoveUp={up} onMoveDown={down} />
          ))}
          <TotalRow label="TOTAL IN" cols={budget} pick={(c) => c.totalIn} tone="income" fill="income" />

          {/* FIXED / RECURRING, ONE-OFF / SEASONAL: simple per-section ordering */}
          {[SECTIONS[0], SECTIONS[2]].map((sec) =>
            sectionItems[sec.key].length ? (
              <FragmentSection key={sec.key} sec={sec} names={sectionItems[sec.key]}
                budget={budget} onEditName={onEditName} onReorder={onReorder} />
            ) : null
          )}

          {/* SAVING / DEBT: one header, rows clustered by category, reorder within a category */}
          {sectionItems.saving.length ? (
            <>
              <SectionHeader label="SAVING / DEBT" span={budget.length + 1} />
              {savingGroups.map((names) =>
                withMoves(names, onReorder).map(({ name, up, down }) => (
                  <DataRow key={name} label={name} cols={budget}
                    pick={(c) => c.expenseItems[name]?.val || 0} tone="expense" hideZero
                    onLabelClick={editRow(name)} onMoveUp={up} onMoveDown={down} />
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

// pair each name with move-up/move-down callbacks against its neighbor, or
// null at the ends / when reordering isn't wired up
function withMoves(names, onReorder) {
  return names.map((name, i) => ({
    name,
    up: onReorder && i > 0 ? () => onReorder(name, names[i - 1]) : null,
    down: onReorder && i < names.length - 1 ? () => onReorder(name, names[i + 1]) : null,
  }));
}

function FragmentSection({ sec, names, budget, onEditName, onReorder }) {
  return (
    <>
      <SectionHeader label={sec.label} span={budget.length + 1} />
      {withMoves(names, onReorder).map(({ name, up, down }) => (
        <DataRow key={name} label={name} cols={budget}
          pick={(c) => c.expenseItems[name]?.val || 0} tone="expense" hideZero
          onLabelClick={onEditName && (() => onEditName(name))} onMoveUp={up} onMoveDown={down} />
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

function DataRow({ label, cols, pick, tone, muted, hideZero, onLabelClick, onMoveUp, onMoveDown }) {
  const reorderable = onMoveUp !== undefined;
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800/50 group">
      <td className="py-1.5 px-3 sticky left-0 bg-white dark:bg-gray-900 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {reorderable && (
            <span className="inline-flex flex-col opacity-0 group-hover:opacity-100 transition -my-1">
              <button onClick={onMoveUp} disabled={!onMoveUp} title="Move up"
                className="leading-none text-[9px] text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20 disabled:hover:text-gray-400">▲</button>
              <button onClick={onMoveDown} disabled={!onMoveDown} title="Move down"
                className="leading-none text-[9px] text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-20 disabled:hover:text-gray-400">▼</button>
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
