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
  bill:          { light: "#64748b", dark: "#94a3b8" },
  oneoff:        { light: "#475569", dark: "#cbd5e1" },
  uncategorized: { light: "#94a3b8", dark: "#64748b" },
  other:         { light: "#94a3b8", dark: "#64748b" },
};
const sliceColor = (slice, isDark) =>
  slice.bucket === "category"
    ? paletteColor(slice.color, isDark)
    : NEUTRAL[slice.bucket][isDark ? "dark" : "light"];

function prettyDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SpendingMix({ mix, isDark }) {
  const [collapsed, setCollapsed] = useStickyFlag(COLLAPSED_PREF, true);
  const [asBar, setAsBar] = useStickyFlag(KIND_PREF, false);

  const data = mix.slices.map((s) => ({ ...s, fill: sliceColor(s, isDark) }));
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
              <BarView data={data} total={mix.total} />
            ) : (
              <PieView data={data} isDark={isDark} />
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

function PieView({ data, isDark }) {
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
      <Legend data={data} />
    </div>
  );
}

function BarView({ data, total }) {
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-baseline max-w-3xl">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0 self-center" style={{ backgroundColor: d.fill }} />
            <span className="text-sm truncate text-gray-700 dark:text-gray-300">{d.label}</span>
          </div>
          <span className="text-sm tabular-nums text-gray-600 dark:text-gray-400">
            {money(d.amount)} <span className="text-gray-400">· {d.percent}%</span>
          </span>
          <div className="col-span-2 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${total > 0 ? (d.amount / total) * 100 : 0}%`, backgroundColor: d.fill }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Capped width: on a wide screen a full-bleed legend strands each value
// metres from its own label.
function Legend({ data }) {
  return (
    <ul className="grow w-full min-w-0 max-w-lg space-y-1">
      {data.map((d) => (
        <li key={d.key} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0 self-center" style={{ backgroundColor: d.fill }} />
            <span className="truncate text-gray-700 dark:text-gray-300">{d.label}</span>
          </span>
          <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
            {money(d.amount)} <span className="text-gray-400">· {d.percent}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function MixTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-2.5 py-1.5 shadow-sm text-xs">
      <div className="font-medium text-gray-700 dark:text-gray-200">{d.label}</div>
      <div className="tabular-nums text-gray-600 dark:text-gray-400">{money(d.amount)} · {d.percent}%</div>
    </div>
  );
}
