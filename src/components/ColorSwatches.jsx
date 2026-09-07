import { CATEGORY_PALETTE, paletteColor } from "../engine/model.js";

// A row of small clickable color dots for picking a CATEGORY_PALETTE index —
// the one color-picking UI shared by CategoryManager (a category's own
// color) and EventForm/QuickEntry (an optional per-item override). Never a
// raw color picker — the whole point of the curated palette is that every
// choice stays validated (distinct from every other color, in both themes).
export default function ColorSwatches({ value, onChange, isDark, allowNone, noneLabel = "Auto" }) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title={noneLabel}
          className={`h-6 w-6 rounded-full border-2 border-dashed flex items-center justify-center text-[10px] text-gray-400 transition ${
            value == null ? "border-gray-800 dark:border-white" : "border-gray-300 dark:border-gray-600"
          }`}
        >
          ×
        </button>
      )}
      {CATEGORY_PALETTE.map((c, i) => (
        <button
          type="button"
          key={c.name}
          onClick={() => onChange(i)}
          title={c.name}
          style={{ backgroundColor: paletteColor(i, isDark) }}
          className={`h-6 w-6 rounded-full transition ${
            value === i ? "ring-2 ring-offset-2 ring-gray-800 dark:ring-white dark:ring-offset-gray-900" : ""
          }`}
        />
      ))}
    </div>
  );
}
