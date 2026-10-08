// Mutation audit: can anything kill these tests?
//
//   node scripts/mutate.mjs     (from mobile/)
//
// "Has an expect()" is not the question. Three times in one week the
// lesson here was that a passing count implied coverage it did not have —
// a form verified standalone while its routing was not, 57 green
// assertions on a scope sheet whose editor never opened, and a test I
// wrote for an unexported component that asserted literally nothing. The
// only honest check is to break the behavior and see whether the suite
// notices.
//
// Each entry below breaks ONE thing the suite claims. A mutation that
// SURVIVES means the claim attached to it is not actually being tested;
// a test that no mutation can kill is decoration. Run this after adding
// tests, not instead of thinking about them — the list only covers what
// someone thought to break, which is its own limit and worth saying.
//
// Measured 2026-10-08: 22 mutations, 22 killed, and every one of the 17
// tests dies to at least one.
// --verbose is NOT cosmetic: with more than one test file jest stops
// printing per-test lines, and this runner parses them. Without it the
// script reported every mutation as surviving and "All 0 tests" — loudly
// wrong, which is the only acceptable way for a verification tool to
// break, but still wrong.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/** [what is broken, file, find, replace-with] */
const MUTATIONS = [
  ["scope sheet drops the occurrence option", "lib/edit.ts",
   'if (date) out.push({ kind: "edit-occurrence", date });', '// mutated'],
  ["scope sheet always offers reset", "lib/edit.ts",
   'if (date && overrideAt(state, id, date) != null) out.push({ kind: "reset-occurrence", date });',
   'if (date) out.push({ kind: "reset-occurrence", date });'],
  ["one-offs get an occurrence scope", "lib/edit.ts",
   'if (!isRecurring) return [{ kind: "edit-rule" }, { kind: "delete-rule" }];',
   'if (!isRecurring) return [{ kind: "edit-occurrence", date: dateOf(rowId)! }, { kind: "edit-rule" }, { kind: "delete-rule" }];'],
  ["rowTarget returns the wrong item", "lib/edit.ts",
   'if (rule) return { item: rule, name: rule.name, recurring: true, date: dateOf(rowId) };',
   'if (rule) return { item: rule, name: "WRONG", recurring: true, date: dateOf(rowId) };'],
  ["editor ignores occurrence scope", "components/TransactionSheet.tsx",
   'if (mode.kind === "occurrence") {', 'if (false) {'],
  ["rule editor loses its explanation", "components/TransactionSheet.tsx",
   '<Text style={styles.dim}>Changes every date this rule generates.</Text>',
   '<Text style={styles.dim} />'],
  ["delete skips the confirm", "components/ScopeSheet.tsx",
   'if (a.kind !== "delete-rule") { onPick(a); return; }', 'onPick(a); return;'],
  ["validation always passes", "lib/edit.ts",
   'if (!d.name.trim()) return "Give it a name.";', '// mutated'],
  ["orphan warning never shows", "components/TransactionSheet.tsx",
   '{orphans > 0 && (', '{false && ('],
  ["busy does not disable saving", "components/TransactionSheet.tsx",
   'disabled={disabled || busy}', 'disabled={disabled}'],
  ["an invisible sheet still renders", "components/BottomSheet.tsx",
   'visible={visible}', 'visible'],
  ["history rows are tappable offline", "components/HistoryList.tsx",
   'disabled={!online}', 'disabled={false}'],
  ["sparkline rests on the FIRST reading", "lib/charts.tsx",
   'const shown = active ?? points.length - 1;', 'const shown = active ?? 0;'],
  // The Ledger picker, reported twice and fixed on 2026-10-08. These
  // mutations re-create it exactly: the picker that never closes, and
  // the one with no way out.
  ["date picker re-opens itself on pick", "components/DatePicker.tsx",
   'onPick(d.toISOString().slice(0, 10));\n          onClose();',
   'onPick(d.toISOString().slice(0, 10));'],
  ["date picker swallows a cancel", "components/DatePicker.tsx",
   'if (!d || (event as { type?: string })?.type === "dismissed") { onClose(); return; }',
   'if (!d || (event as { type?: string })?.type === "dismissed") { return; }'],
  ["date picker loses its Done", "components/DatePicker.tsx",
   '<Pressable style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel={label}>',
   '<Pressable style={styles.done} accessibilityRole="button" accessibilityLabel={label}>'],
  ["the Ledger picker stops going through the host", "app/(tabs)/index.tsx",
   'visible={!!sheet || !!target || picking}', 'visible={!!sheet || !!target}'],
  ["sparkline draws a readout for one point", "lib/charts.tsx",
   'if (points.length < 2 || !geom) {', 'if (points.length < 1 || !geom) {'],

  ["occurrence editor also renders Name", "components/TransactionSheet.tsx",
   '        <Field label="Amount">\n          <TextInput\n            style={styles.field} keyboardType="decimal-pad" placeholder="0.00"\n            placeholderTextColor={T.faint} value={occAmount} onChangeText={setOccAmount}\n            autoFocus accessibilityLabel="Amount on this date"\n          />\n        </Field>',
   '        <Field label="Amount">\n          <TextInput style={styles.field} value={occAmount} onChangeText={setOccAmount} accessibilityLabel="Amount on this date" />\n        </Field>\n        <Field label="Name"><TextInput style={styles.field} accessibilityLabel="Name" /></Field>\n        <Text>Repeats</Text>'],
  ["rule editor hides Name", "components/TransactionSheet.tsx",
   'autoFocus={!existing} accessibilityLabel="Name"', 'autoFocus={!existing} accessibilityLabel="NotName"'],
  ["delete row stops saying what it removes", "components/ScopeSheet.tsx",
   'sub: "Removes the rule and every date it generates"', 'sub: "Delete"'],
  ["the editor submits a blank draft", "components/TransactionSheet.tsx",
   'onSubmit={() => onSaveDraft(draft)}', 'onSubmit={() => onSaveDraft(blankDraft())}'],
  ["typing into Amount is dropped", "components/TransactionSheet.tsx",
   'onChangeText={(v) => set("amount", v)} accessibilityLabel="Amount"',
   'onChangeText={() => {}} accessibilityLabel="Amount"'],
  ["history edit hands back the wrong row", "components/HistoryList.tsx",
   'onPress={() => onEdit(e)}', 'onPress={() => onEdit(entries[0]!)}'],
  ["history delete fires without confirming", "components/HistoryList.tsx",
   'onPress={() => confirmDelete(e)}', 'onPress={() => onDelete(e)}'],
  ["reset option loses its date", "components/ScopeSheet.tsx",
   'return { text: `Reset ${prettyDate(a.date)} to the rule`',
   'return { text: `Reset to the rule`']
];

const killedBy = new Map();
const survived = [];

for (const [label, file, find, repl] of MUTATIONS) {
  const orig = readFileSync(file, "utf8");
  if (!orig.includes(find)) {
    console.log(`SKIP      ${label} — the code it breaks has moved; fix or drop this mutation`);
    continue;
  }
  writeFileSync(file, orig.replace(find, repl));
  let out = "";
  try { out = execSync("npx jest --verbose 2>&1", { encoding: "utf8" }); }
  catch (e) { out = e.stdout || ""; }
  writeFileSync(file, orig);          // always restore, pass or fail

  const dead = [...out.matchAll(/\u2715 (.+?) \(/g)].map((m) => m[1]);
  for (const d of dead) killedBy.set(d, (killedBy.get(d) ?? 0) + 1);
  if (dead.length === 0) { survived.push(label); console.log(`SURVIVED  ${label}`); }
  else console.log(`killed ${String(dead.length).padStart(2)}  ${label}`);
}

// THE OTHER DIRECTION, and the more useful one: a test that nothing can
// kill. Every name in the suite, diffed against the ones that died.
let baseline = "";
try { baseline = execSync("npx jest --verbose 2>&1", { encoding: "utf8" }); }
catch (e) { baseline = e.stdout || ""; }
const allTests = [...baseline.matchAll(/[\u2713\u2715] (.+?)(?: \(\d+ ms\))?$/gm)].map((m) => m[1].trim());

const neverKilled = allTests.filter((t) => !killedBy.has(t));

console.log("\nkilled, with how many mutations each test caught:");
for (const [t, n] of [...killedBy].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${String(n).padStart(2)}x  ${t}`);
}
if (neverKilled.length) {
  console.log("\nNO MUTATION KILLED THESE — each is unverified until one is written:");
  neverKilled.forEach((t) => console.log(`  ${t}`));
} else {
  console.log(`\nAll ${allTests.length} tests die to at least one mutation.`);
}

console.log(survived.length ? `\n${survived.length} MUTATION(S) SURVIVED` : "\nEvery mutation was caught.");
process.exit(survived.length === 0 && neverKilled.length === 0 ? 0 : 1);
