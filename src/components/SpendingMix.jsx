import { useState } from "react";
import { sliceFill, DEGRADED_SOLID } from "../engine/palette.ts";
import { getDeviceFlag, setDeviceFlag } from "../devicePrefs.js";

// ---- Where the PLANNED outflow goes, over the Ledger's own window ----
// Forecast data, labeled as such. It reads the same event list the table
// below it renders, so it moves with the horizon slider and never touches a
// logged number. An actual-spending breakdown is a different chart on a
// different tab.
//
// Two renderings of one dataset: a pie (familiar, default) and a horizontal
// bar (reads proportions precisely, and labels every row inline). Both come
// from computeSpendingByCategory — the toggle swaps the rendering, nothing
// else. Collapse state and chart kind are per device, like the theme.
//
// The fixed buckets (bills, one-offs) arrive already broken out into their
// own transactions — always, not on a threshold — because "Fixed bills" is
// where uncategorized money lands and grouping by it says nothing. Tracker
// categories arrive whole. That is the engine's call; this file only has to
// color and label the two kinds so they can't be mistaken for each other.
//
// "Other" folds the tail past the fourth slice. It opens on click — differently
// per view, on purpose. The PIE never re-shapes: its wedge stays whole and
// gray (seventeen wedges would be unreadable, and 1-2% slivers unhittable),
// and the expansion happens in the legend beside it. The BAR expands its
// rows in place, which is the bar's whole advantage. Both views show the
// same data; they already differ in how much is drawn versus listed.
const COLLAPSED_PREF = "ledger-mix-collapsed";

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// ONE HUE, and the two views spend it differently because they are
// different claims:
//
//   PIE  a ramp by RANK. The pie draws four wedges and a gray Other, so
//        rank is a true statement about every wedge in it.
//   BAR  flat brass. The bar is the full view and keeps every row, so a
//        ramp would run out and start lying at the fifth.
//
// Rank is the slice's position in `mix.slices`, which the engine returns
// biggest-first with Other last — so the index IS the rank, and the view
// never re-sorts.

// The row every list shares: swatch, label, amount, percent.
function Amount({ d }) {
  return (
    <span className="shrink-0 text-sm tabular-nums text-gray-600 dark:text-gray-400">
      {money(d.amount)} <span className="text-gray-400">· {d.percent}%</span>
    </span>
  );
}

// A null fill is an account past the eighth hue. It draws as an OUTLINE
// rather than borrowing a color that already belongs to another account —
// no fill can collide with a fill, and the row's label carries the
// identity, as it does for every row.
function Swatch({ fill }) {
  return (
    <span
      className="h-2.5 w-2.5 rounded-sm shrink-0 self-center"
      style={fill
        ? { backgroundColor: fill }
        : { border: `1.5px solid ${DEGRADED_SOLID.light}`, backgroundColor: "transparent" }}
    />
  );
}

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"
      className={`h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Identity never rests on color alone, and with one hue it cannot: the
// label carries it. An item slice names the bucket it came out of inline,
// so "Rent" reads as "Rent · Fixed bills" rather than passing as a
// category of its own.
function SliceLabel({ d }) {
  return (
    <span className="truncate text-gray-700 dark:text-gray-300">
      {d.label}
      {d.parentLabel && <span className="text-gray-400"> · {d.parentLabel}</span>}
    </span>
  );
}

function prettyDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SpendingMix({ mix, isDark }) {
  const [collapsed, setCollapsed] = useStickyFlag(COLLAPSED_PREF, true);
  // Component state, not devicePrefs: opening Other is a drill-down you do
  // to answer a question, not a layout preference worth remembering.
  const [otherOpen, setOtherOpen] = useState(false);

  // A fill is an IDENTITY now, so it comes from the slice rather than from
  // its position: the account's own hue, one color for every loan, slate
  // for spending, gray for Other. `null` is an account past the eighth
  // hue — that row draws an outlined swatch rather than borrowing a color
  // that already belongs to someone else.
  const paint = (s) => ({ ...s, fill: sliceFill(s, isDark) });
  const data = mix.slices.map((s) => ({ ...paint(s), children: s.children?.map(paint) }));
  const empty = data.length === 0;

  return (
    <section className="mb-4 border border-gray-200 dark:border-gray-800 rounded-xl">
      {/* The pie/bar control sits WITH the header it belongs to, not pinned
          to the panel's right edge — on a wide screen that put it a long way
          from the chart it controls. */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 py-2 flex-wrap">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-left group min-w-0"
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Planned spending</span>
          <span className="text-xs text-gray-400 truncate">{money(mix.total)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200 transition-transform duration-300 motion-reduce:transition-none ${collapsed ? "" : "rotate-180"}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3">
            {/* Says what this is, every time. It is the forecast. */}
            <p className="text-xs text-gray-400 mb-3">
              Projected from your rules for {prettyDate(mix.from)} – {prettyDate(mix.to)} — not what you&apos;ve
              logged. Income is excluded.
            </p>

            {empty ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                Nothing going out in this window yet.
              </p>
            ) : (
              <BarView data={data} total={mix.total} otherOpen={otherOpen} onToggleOther={setOtherOpen} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// A flag that lives on this device only (localStorage), read during the
// first render so a collapsed panel never flashes open.
function useStickyFlag(name, fallback) {
  const [value, setValue] = useState(() => getDeviceFlag(name, fallback));
  return [
    value,
    (next) => { setDeviceFlag(name, next); setValue(next); },
  ];
}

function BarView({ data, total, otherOpen, onToggleOther }) {
  return (
    <div className="space-y-2">
      {data.map((d) => {
        // Open: the parent row is REPLACED by its children, not stacked
        // above them — the same $2,350 as a row and again as its parts
        // reads as double-counting.
        if (d.children && otherOpen) {
          return (
            <div key={d.key} className="space-y-2">
              {d.children.map((c) => <BarRow key={c.key} d={c} total={total} />)}
              <Collapse n={d.children.length} onClick={() => onToggleOther(false)} />
            </div>
          );
        }
        if (d.children) {
          return (
            <button
              key={d.key}
              onClick={() => onToggleOther(true)}
              aria-expanded={false}
              className="w-full text-left rounded hover:bg-gray-50 dark:hover:bg-gray-800/60 -mx-1 px-1"
            >
              <BarRow d={d} total={total} chevron={<Chevron open={false} />} />
            </button>
          );
        }
        return <BarRow key={d.key} d={d} total={total} />;
      })}
    </div>
  );
}

function BarRow({ d, total, chevron }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-baseline max-w-3xl">
      <div className="flex items-baseline gap-2 min-w-0 text-sm">
        <Swatch fill={d.fill} />
        <SliceLabel d={d} />
        {chevron}
      </div>
      <Amount d={d} />
      <div className="col-span-2 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${total > 0 ? (d.amount / total) * 100 : 0}%`, backgroundColor: d.fill }} />
      </div>
    </div>
  );
}
function Collapse({ n, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-expanded
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1 -mx-1 px-1 rounded"
    >
      <Chevron open />
      Fold {n} back into Other
    </button>
  );
}
