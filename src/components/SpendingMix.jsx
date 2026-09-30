import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { paletteColor } from "../engine/model.ts";
import { getDeviceFlag, setDeviceFlag } from "../devicePrefs.js";

// ---- Where the PLANNED outflow goes, over the Ledger's own window ----
// Forecast data, labelled as such. It reads the same event list the table
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
// where uncategorised money lands and grouping by it says nothing. Tracker
// categories arrive whole. That is the engine's call; this file only has to
// colour and label the two kinds so they can't be mistaken for each other.
//
// "Other" folds the tail past 8 slices, and at 11% of a window it was the
// one slice you could learn nothing from. It opens on click — differently
// per view, on purpose. The PIE never re-shapes: its wedge stays whole and
// grey (seventeen wedges would be unreadable, and 1-2% slivers unhittable),
// and the expansion happens in the legend beside it. The BAR expands its
// rows in place, which is the bar's whole advantage. Both views show the
// same data; they already differ in how much is drawn versus listed.
const COLLAPSED_PREF = "ledger-mix-collapsed";
const KIND_PREF = "ledger-mix-bar";

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The two fixed buckets and the two fold-ups are deliberately NEUTRAL. The
// 8-colour palette belongs to categories the user actually chose a colour
// for; a 9th and 10th hue would break the categorical colour rules (and the
// palette's all-pairs separation is already tight). Greys are also immune to
// colour-vision deficiency, which is the right property for "no category".
const NEUTRAL = {
  // Bills are cool grey, one-offs warm. Both fixed buckets now break out at
  // once, so their tint ramps share the chart; two ramps off the same slate
  // would overlap, and a warm/cool split separates them without spending a
  // categorical hue.
  bill:          { light: "#64748b", dark: "#94a3b8" },
  oneoff:        { light: "#78716c", dark: "#a8a29e" },
  uncategorized: { light: "#94a3b8", dark: "#64748b" },
  other:         { light: "#94a3b8", dark: "#64748b" },
};

// Items broken out of a dominant bucket are TINTS OF THEIR PARENT, not fresh
// palette hues. A 9th hue would collide with a real category sitting in the
// same chart, and would claim a category's identity for something that is
// only one transaction. Steps run AWAY from the surface — darker on light,
// lighter on dark — so the quietest step still holds its contrast.
const mix2 = (hex, target, t) => {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(hex, i) + (p(target, i) - p(hex, i)) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};
const TINT_TARGET = { light: "#0f172a", dark: "#f8fafc" };
const TINT_RANGE = 0.55;

const sliceColor = (slice, isDark) => {
  if (slice.bucket === "category") return paletteColor(slice.color, isDark);
  if (slice.bucket !== "item") return NEUTRAL[slice.bucket][isDark ? "dark" : "light"];
  const base =
    slice.color == null
      ? NEUTRAL[slice.parentBucket ?? "bill"][isDark ? "dark" : "light"]
      : paletteColor(slice.color, isDark);
  const steps = slice.shadeCount ?? 1;
  const t = steps > 1 ? ((slice.shade ?? 0) / (steps - 1)) * TINT_RANGE : 0;
  return mix2(base, TINT_TARGET[isDark ? "dark" : "light"], t);
};

// The palette rule: identity never rests on colour alone. An item slice is a
// tint of its parent, so the parent's name rides along inline — otherwise
// "Rent" and "Roth" are two blues with nothing to tell them apart.
function SliceLabel({ d }) {
  return (
    <span className="truncate text-gray-700 dark:text-gray-300">
      {d.label}
      {d.parentLabel && <span className="text-gray-400"> · {d.parentLabel}</span>}
    </span>
  );
}

// The row every list shares: swatch, label, amount, percent.
function Amount({ d }) {
  return (
    <span className="shrink-0 text-sm tabular-nums text-gray-600 dark:text-gray-400">
      {money(d.amount)} <span className="text-gray-400">· {d.percent}%</span>
    </span>
  );
}

function Swatch({ fill }) {
  return <span className="h-2.5 w-2.5 rounded-sm shrink-0 self-center" style={{ backgroundColor: fill }} />;
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

// Folded rows are indented under the Other row they came out of, so a
// coloured swatch beside them can't be read as a slice of its own rank.
const NESTED = "ml-1 pl-3 border-l border-gray-200 dark:border-gray-800";

function prettyDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SpendingMix({ mix, isDark }) {
  const [collapsed, setCollapsed] = useStickyFlag(COLLAPSED_PREF, true);
  const [asBar, setAsBar] = useStickyFlag(KIND_PREF, false);
  // Component state, not devicePrefs: opening Other is a drill-down you do
  // to answer a question, not a layout preference worth remembering.
  const [otherOpen, setOtherOpen] = useState(false);

  const withFill = (s) => ({
    ...s,
    fill: sliceColor(s, isDark),
    children: s.children?.map((c) => ({ ...c, fill: sliceColor(c, isDark) })),
  });
  const data = mix.slices.map(withFill);
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
        {!collapsed && !empty && (
          <div className="flex items-center gap-1 shrink-0 -ml-0.5" role="group" aria-label="Chart type">
            {[["Pie", false], ["Bar", true]].map(([label, val]) => (
              <button
                key={label}
                onClick={() => setAsBar(val)}
                aria-pressed={asBar === val}
                className={`text-xs px-2 py-1 rounded-md transition ${
                  asBar === val
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3">
            {/* Says what this is, every time. It is the forecast. */}
            <p className="text-xs text-gray-400 mb-3">
              Projected from your rules for {prettyDate(mix.from)} – {prettyDate(mix.to)} — not what you&apos;ve
              logged. Income and bills you&apos;ve marked paid are excluded.
            </p>

            {empty ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                Nothing going out in this window yet.
              </p>
            ) : asBar ? (
              <BarView data={data} total={mix.total} otherOpen={otherOpen} onToggleOther={setOtherOpen} />
            ) : (
              <PieView data={data} isDark={isDark} otherOpen={otherOpen} onToggleOther={setOtherOpen} />
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

function PieView({ data, isDark, otherOpen, onToggleOther }) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="h-52 w-full sm:w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="label"
              innerRadius="52%"
              outerRadius="88%"
              paddingAngle={2}
              stroke={isDark ? "#111827" : "#ffffff"}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => <Cell key={d.key} fill={d.fill} />)}
            </Pie>
            <Tooltip content={<MixTip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* The legend is not decoration: the category palette's separation is
          tight enough that identity must never rest on colour alone. */}
      <Legend data={data} otherOpen={otherOpen} onToggleOther={onToggleOther} />
    </div>
  );
}

function BarView({ data, total, otherOpen, onToggleOther }) {
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const rows = [
          d.children ? (
            <button
              key={d.key}
              onClick={() => onToggleOther(!otherOpen)}
              aria-expanded={otherOpen}
              className="w-full text-left rounded hover:bg-gray-50 dark:hover:bg-gray-800/60 -mx-1 px-1"
            >
              <BarRow d={d} total={total} chevron={<Chevron open={otherOpen} />} />
            </button>
          ) : (
            <BarRow key={d.key} d={d} total={total} />
          ),
        ];
        if (d.children && otherOpen) {
          rows.push(
            <div key={`${d.key}-kids`} className={`${NESTED} space-y-2 pt-1`}>
              {d.children.map((c) => <BarRow key={c.key} d={c} total={total} />)}
            </div>,
          );
        }
        return rows;
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

// Capped width: on a wide screen a full-bleed legend strands each value
// metres from its own label.
function Legend({ data, otherOpen, onToggleOther }) {
  return (
    <ul className="grow w-full min-w-0 max-w-lg space-y-1">
      {data.map((d) => {
        const rows = [
          <li key={d.key} className="text-sm">
            {d.children ? (
              <button
                onClick={() => onToggleOther(!otherOpen)}
                aria-expanded={otherOpen}
                className="w-full flex items-baseline justify-between gap-3 text-left rounded hover:bg-gray-50 dark:hover:bg-gray-800/60 -mx-1 px-1"
              >
                <span className="flex items-baseline gap-2 min-w-0">
                  <Swatch fill={d.fill} />
                  <span className="truncate text-gray-700 dark:text-gray-300">{d.label}</span>
                  <Chevron open={otherOpen} />
                </span>
                <Amount d={d} />
              </button>
            ) : (
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 min-w-0">
                  <Swatch fill={d.fill} />
                  <SliceLabel d={d} />
                </span>
                <Amount d={d} />
              </span>
            )}
          </li>,
        ];
        if (d.children && otherOpen) {
          rows.push(
            <li key={`${d.key}-kids`} className={NESTED}>
              {/* Said once, not per row: these have colours but no wedge. */}
              <p className="text-xs text-gray-400 mb-1">All inside the grey wedge.</p>
              <ul className="space-y-1">
                {d.children.map((c) => (
                  <li key={c.key} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <Swatch fill={c.fill} />
                      <SliceLabel d={c} />
                    </span>
                    <Amount d={c} />
                  </li>
                ))}
              </ul>
            </li>,
          );
        }
        return rows;
      })}
    </ul>
  );
}

function MixTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-2.5 py-1.5 shadow-sm text-xs">
      <div className="font-medium text-gray-700 dark:text-gray-200">{d.label}</div>
      {d.parentLabel && <div className="text-gray-400">{d.parentLabel}</div>}
      <div className="tabular-nums text-gray-600 dark:text-gray-400">{money(d.amount)} · {d.percent}%</div>
    </div>
  );
}
