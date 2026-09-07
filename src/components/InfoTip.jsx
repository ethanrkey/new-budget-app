import { useState } from "react";

// A small "?" affordance for a short explanation. Hover works on desktop;
// since touch has no hover, tapping toggles it too (the same lesson learned
// making the Ledger's hover-only controls tap-accessible on mobile).
export default function InfoTip({ text }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="w-4 h-4 inline-flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-[10px] leading-none text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500 transition"
        aria-label="More info"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-1.5 w-48 text-xs leading-snug text-left bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 rounded-lg px-2.5 py-2 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
