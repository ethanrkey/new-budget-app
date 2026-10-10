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
// Measured 2026-10-10: 40 mutations, 40 killed, and every one of the 38
// renderer tests dies to at least one. The twelve added that day were written
// BECAUSE the run before them reported nine new sign-in tests that no
// mutation could reach — the list only covers what someone thought to
// break, so a new test file means new entries here or the suite is
// trusted for no reason.
// --verbose is NOT cosmetic: with more than one test file jest stops
// printing per-test lines, and this runner parses them. Without it the
// script reported every mutation as surviving and "All 0 tests" — loudly
// wrong, which is the only acceptable way for a verification tool to
// break, but still wrong.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/** Plain-node suites that import mobile/lib directly, relative to mobile/. */
const NODE_SUITES = ["tests/mobile-signin.test.mjs", "tests/mobile-edit.test.mjs"];

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
   'return { text: `Reset to the rule`'],

  // --- sign-in. Nine tests arrived 2026-10-09 and no mutation could
  // reach any of them, which is exactly the state this script exists to
  // make visible: a suite nothing can kill is decoration.
  ["the address is sent raw, so an iOS capital letter matches nobody", "lib/signin.ts",
   "return raw.trim().toLowerCase();", "return raw;"],
  ["a five-digit code counts as ready", "lib/signin.ts",
   "return normalizeCode(code).length === CODE_LENGTH;", "return normalizeCode(code).length >= CODE_LENGTH - 1;"],
  ["a pasted code keeps its spaces", "lib/signin.ts",
   'return raw.replace(/\\D/g, "").slice(0, CODE_LENGTH);', "return raw.slice(0, CODE_LENGTH);"],
  ["the rate limit is swallowed like every other error", "lib/signin.ts",
   '  if (isRateLimited(error)) return "A code was just sent. Wait a minute before asking for another.";', "  // mutated"],
  ["a failed send leaks which addresses have accounts", "lib/signin.ts",
   "  if (isUnknownAccount(error)) return null;", '  if (isUnknownAccount(error)) return "No account for that address.";'],
  ["a wrong code says nothing useful", "lib/signin.ts",
   'return "That code is wrong or has expired. Check the latest email, or ask for a new code.";',
   'return "Error.";'],
  ["the resend cooldown never elapses", "lib/signin.ts",
   "return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);", "return RESEND_COOLDOWN_SECONDS;"],
  ["the send never advances to the code step", "components/SignIn.tsx",
   'if (!resending) setStep("code");', "// mutated"],
  ["the code step forgets which address it is waiting on", "components/SignIn.tsx",
   "email: clean,\n      token,", 'email: "someone@else.com",\n      token,'],
  ["going back wipes the address you mistyped", "components/SignIn.tsx",
   'onPress={() => { setStep("email"); setError(null); attempted.current = null; }}', 'onPress={() => { setStep("email"); setError(null); attempted.current = null; setEmail(""); }}'],
  ["resend is pressable during the cooldown", "components/SignIn.tsx",
   "disabled={busy || cooldown > 0}", "disabled={busy}"],
  ["sign-in creates an account for a typo", "components/SignIn.tsx",
   "options: { shouldCreateUser: false },", "options: { shouldCreateUser: true },"],
  ["the sixth digit does not submit on its own", "components/SignIn.tsx",
   "    if (next.length === CODE_LENGTH && !busy && next !== attempted.current) {\n      void verify(next);\n    }",
   "    // mutated"],
  ["auto-submit sends the stale state, not the digit just typed", "components/SignIn.tsx",
   "void verify(next);", "void verify();"],
  ["a rejected code is auto-submitted again on the next keystroke", "components/SignIn.tsx",
   "next !== attempted.current", "true"],
  ["every send failure is hidden, so offline looks like success", "lib/signin.ts",
   "  if (isUnknownAccount(error)) return null;", "  return null;"],
  ["a server error is swallowed instead of spoken", "lib/signin.ts",
   '  return "Something went wrong sending the code. Try again in a moment.";', "  return null;"],
  ["offline is reported as a server error", "lib/signin.ts",
   '  if (isUnreachable(error)) return "Can\'t reach the server. Check your connection and try again.";',
   "  // mutated"],
];

const killedBy = new Map();
const survived = [];

/** Names of the node-harness checks that FAIL right now, if any. */
function runNodeHarness() {
  for (const suite of NODE_SUITES) {
    let out = "";
    try { execSync(`node ../${suite} 2>&1`, { encoding: "utf8" }); continue; }
    catch (e) { out = e.stdout || ""; }
    const failed = [...out.matchAll(/^FAIL  (.+)$/gm)].map((m) => `${suite}: ${m[1].trim()}`);
    // A harness that exits non-zero without naming a check still counts
    // as a kill — silence here would read as "nothing noticed".
    if (failed.length) return failed;
    return [`${suite}: exited non-zero`];
  }
  return [];
}

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
  // The OTHER suite. `lib/` is imported by the plain-node harness as well
  // as by the renderer, and a mutation this file can only reach through
  // logic would otherwise be reported as surviving while a test in
  // tests/mobile-signin.test.mjs was failing loudly one directory up.
  // "Can anything kill these tests" has to mean anything.
  const node = runNodeHarness();
  writeFileSync(file, orig);          // always restore, pass or fail

  const dead = [...out.matchAll(/\u2715 (.+?) \(/g)].map((m) => m[1]);
  dead.push(...node);
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
