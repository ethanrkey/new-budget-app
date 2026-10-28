// The web's event form, OPENED, for every way into it.
//
//   node tests/web-forms.test.mjs     (runs in `npm test`, so in CI)
//
// PRODUCTION, 2026-10-26 to 10-28: clicking an existing one-off in the
// Ledger, or any row in the Budget, blanked the whole app. EventForm
// seeded its amount field with the saved item's NUMBER and the
// validator called `.trim()` on it during render. Recurring occurrences
// survived only because their field was String()-wrapped.
//
// Nothing caught it because the web has no renderer harness and every
// check of this form read its source. So this one RENDERS it: esbuild
// compiles the JSX in memory and react-dom/server runs the render,
// which is exactly the code path that threw.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { WHY_NOT } from "../src/content/logBalance.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}

console.log("\n== the validators cannot throw on what a saved item holds ==");
{
  const tryIt = (f) => { try { return f(); } catch (e) { return `THREW ${e.message}`; } };
  eq("an event with a numeric amount is valid", tryIt(() => WHY_NOT.event("Truck service", 180)), null);
  eq("...and a numeric zero is an amount, not a blank", tryIt(() => WHY_NOT.event("Truck service", 0)), null);
  eq("a missing amount is named, not thrown", tryIt(() => WHY_NOT.event("Truck service", undefined)), "Enter an amount.");
  eq("a missing name is named, not thrown", tryIt(() => WHY_NOT.event(undefined, 5)), "Give it a name.");
  eq("an occurrence with a numeric amount is valid", tryIt(() => WHY_NOT.occurrence(42)), null);
  eq("a balance with a numeric amount is valid", tryIt(() => WHY_NOT.balance(-12.5)), null);
  eq("a contribution with a numeric amount is valid", tryIt(() => WHY_NOT.contribution(25)), null);
  eq("a contribution of numeric zero still says why", tryIt(() => WHY_NOT.contribution(0)), "Enter an amount more than zero.");
  eq("null is a blank", tryIt(() => WHY_NOT.balance(null)), "Enter the balance.");
}

// ---- Render it ------------------------------------------------------
const out = await build({
  stdin: {
    contents: `
      import { renderToString } from "react-dom/server";
      import { createElement } from "react";
      import EventForm from "./src/components/EventForm.jsx";
      export const render = (props) => renderToString(createElement(EventForm, props));
    `,
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "jsx",
  },
  bundle: true, write: false, format: "esm", platform: "node",
  // React stays external so the bundle and the render share ONE copy.
  external: ["react", "react-dom", "react/*", "react-dom/*"],
  jsx: "automatic", logLevel: "silent",
});
// Inside the repo, so `react` resolves from node_modules.
const cache = new URL("../node_modules/.cache/web-forms-test/", import.meta.url);
mkdirSync(cache, { recursive: true });
const file = new URL("bundle.mjs", cache);
writeFileSync(file, out.outputFiles[0].text);
const mod = await import(file.href);

const noop = () => {};
const base = { onSave: noop, onCancel: noop, trackerCategories: [] };
function opens(label, props) {
  let html = null, err = null;
  try { html = mod.render({ ...base, ...props }); } catch (e) { err = e.message; }
  eq(`${label}: it renders`, err, null);
  return html ?? "";
}

console.log("\n== every way into the event form opens it ==");
{
  // The exact item from the report: a saved one-off, amount a number.
  const oneoff = { id: "o-truck", name: "Truck service diagnosis", amount: 180, category: "oneoff", order: 3, date: "2026-10-30", accountId: "checking" };
  const html = opens("an existing one-off from the Ledger", { initial: oneoff, onDelete: noop });
  eq("...with its amount in the field", /value="180"/.test(html), true);
  eq("...and its name", html.includes("Truck service diagnosis"), true);

  // A Budget row opens the RULE, by id, with no date — the other path
  // that crashed.
  const rule = { id: "r-rent", name: "Rent", amount: 1650, category: "bill", order: 1, cadence: "monthly", startDate: "2026-01-02", endDate: null };
  const ruleHtml = opens("a rule from a Budget row", { initial: rule, onDelete: noop, onCheckOrphans: () => [] });
  eq("...with its amount in the field", /value="1650"/.test(ruleHtml), true);

  // The path that always worked, kept working.
  opens("a recurring occurrence from the Ledger", { initial: rule, occurrenceDate: "2026-11-02", overrideAmount: 1700, onSaveOverride: noop, onClearOverride: noop });
  opens("a brand-new item", {});
  opens("an amount of zero", { initial: { ...oneoff, amount: 0 } });
}

// The error boundary is proven in a browser (scripts/drive_edit.mjs):
// renderToString does not run boundaries — React recovers only on the
// client — so nothing here could show it catching.

console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `ALL PASS (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
