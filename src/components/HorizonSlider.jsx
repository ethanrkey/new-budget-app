import { addMonthsISO, monthsDiff } from "../engine/model.js";

const MIN_MONTHS = 3;
const MAX_MONTHS = 36;

// A single horizon control: "Project through <Mon YYYY> (<N> mo)". `anchor` is
// the ISO date the month-count is measured from (the check-in date); `horizon`
// is the current ISO horizon date; `onChange` receives the new ISO horizon.
export default function HorizonSlider({ label, anchor, horizon, onChange }) {
  const months = Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, monthsDiff(anchor, horizon)));
  const horizonLabel = new Date(horizon + "T00:00:00").toLocaleString("en-US", {
    month: "short", year: "numeric",
  });
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-gray-500 whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={MIN_MONTHS}
        max={MAX_MONTHS}
        value={months}
        onChange={(e) => onChange(addMonthsISO(anchor, Number(e.target.value)))}
        className="w-40 accent-gray-900 dark:accent-white"
      />
      <span className="font-medium whitespace-nowrap">{horizonLabel}</span>
      <span className="text-gray-400 whitespace-nowrap">({months} mo)</span>
    </div>
  );
}
