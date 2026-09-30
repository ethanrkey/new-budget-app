import { addMonthsISO, monthsDiff } from "../engine/model.ts";
import InfoTip from "./InfoTip.jsx";

const MIN_MONTHS = 3;
const DEFAULT_MAX_MONTHS = 36;

// A single horizon control: "Project through <Mon YYYY> (<N> mo)". `anchor` is
// the ISO date the month-count is measured from (the check-in date); `horizon`
// is the current ISO horizon date; `onChange` receives the new ISO horizon.
// `maxMonths` is per-caller: the Ledger caps at a year (see LEDGER_MAX_MONTHS),
// the Budget keeps the long range, because a monthly grid two years out is
// still useful where a transaction list is not.
export default function HorizonSlider({ label, anchor, horizon, onChange, help, maxMonths = DEFAULT_MAX_MONTHS }) {
  const months = Math.min(maxMonths, Math.max(MIN_MONTHS, monthsDiff(anchor, horizon)));
  const horizonLabel = new Date(horizon + "T00:00:00").toLocaleString("en-US", {
    month: "short", year: "numeric",
  });
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-gray-500 whitespace-nowrap">{label}</span>
      {help && <InfoTip text={help} />}
      <input
        type="range"
        min={MIN_MONTHS}
        max={maxMonths}
        value={months}
        onChange={(e) => onChange(addMonthsISO(anchor, Number(e.target.value)))}
        className="w-28 sm:w-40 accent-gray-900 dark:accent-white ml-1"
      />
      <span className="font-medium whitespace-nowrap">{horizonLabel}</span>
      <span className="text-gray-400 whitespace-nowrap">({months} mo)</span>
    </div>
  );
}
