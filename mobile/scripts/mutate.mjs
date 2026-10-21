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
// HOW THIS IS RUN, set by the owner on 2026-10-16 and not
// negotiable:
//
//   - PER BATCH, only the mutations whose FILE changed in that batch.
//     `node scripts/mutate.mjs --changed <base>` does that off a git
//     diff. Minutes, not hours.
//   - THE FULL LIST only before a build goes to external testers or
//     the App Store, or when he asks for it.
//   - A HARD 30-MINUTE CAP on any run. At the cap it stops and
//     reports what it finished, because a number from half the list
//     is worth more than a run nobody waited for.
//
// The rule exists because two batches in a row were spent waiting on
// a full run: build 12's took eight hours of wall clock, across two
// laptop sleeps, while nothing was blocked on it — the build had
// already been tested on a phone. It reached 103 of 202 with no
// survivors before it was stopped.
//
// If the full run is needed at release and an hour is too long, the
// thing to try is worktrees: `git worktree add` per shard, one
// process each, and merge the kill maps.
//
// A TEST LABEL MUST NOT CARRY A MEASURED NUMBER, and this file is
// why. The kill map is keyed by test NAME, and the "nothing could
// kill this" report diffs those names against an unmutated baseline
// run — so a label built like `(worst ${measured})` is a DIFFERENT
// test under every mutation that moves the number, and the
// baseline's version comes back listed as unverified. Found
// 2026-10-16 in the build 13 scoped run, which printed
// "it never crosses the left edge of the plot (min 0)" where the
// baseline says "(min 8)". A loop PARAMETER in a label is fine — it
// is the same string every run. Failures print the number instead.
//
// Measured 2026-10-15, build 10: 180 mutations, ALL killed, 147
// renderer tests, every one of them dying to at least one. The first
// run of that set (178 mutations) reported THREE tests nothing could
// kill, all three written that day, and all three gaps were real:
//   - "it opens on the Ledger and walks the stops in order" — nothing
//     in the list moved the tour's ROUTES, only where it leaves you.
//     Now killed by a mutation that stops `go()` routing at all;
//   - "...and it is on EVERY bill row, including the blank one" —
//     nothing hid the ✕ at one row, which is precisely the behavior
//     the web had until build 10 and the thing this test exists for.
//     Now killed by a mutation that puts `d.bills.length > 1` back;
//   - "the Dashboard stop names the four things on the Dashboard" —
//     this one was the HARNESS's fault, and it is the lesson of the
//     run. The mutation written for it replaced the opening clause
//     of the body and left the rest of the sentence dangling, so
//     tour.ts failed to PARSE. jest reports a parse error as a
//     suite-level failure with no per-test "✕" lines, the runner had
//     nothing to attribute the kill to, and the test came back
//     unverified. A mutation must break the BEHAVIOR; one that
//     breaks the file is worse than none, because it reads as
//     coverage while proving nothing.
//
// Before that, 2026-10-15, build 9: 165 mutations, ALL killed, 139
// renderer tests. The first run of that set (164 mutations) reported
// two tests nothing could kill, both written that day:
//   - "every cadence asks when the first contribution is" — real, and
//     now killed by a mutation that puts the first-date row back
//     behind `row.cadence === "monthly"`, which is exactly the thing
//     it watches for;
//   - "the bottom sheet has no grabber to drag any more" — an
//     ABSENCE, and the only mutation that would have killed it is one
//     adding back the testID it looks for, which tests the marker and
//     not the behavior. DELETED rather than propped up. A test
//     nothing can kill is decoration; propping it up with a mutation
//     written to match it is worse, because then the number says
//     otherwise.
//
// Earlier that day: 136 mutations, 135 killed, 127 renderer tests,
// every one of them dying to at least one. The survivor was the date
// picker's Android branch, and it survived because the TEST was weak
// rather than because the code was untested: it only ever fired a
// dismissal with no date, which the `!d` guard catches on its own, so
// deleting the `type === "dismissed"` check killed nothing. The
// dismissal that CARRIES a date is the one that check exists for —
// cancel an Android picker and it hands back whatever the wheel was
// showing. The test fires both shapes now and the mutation dies.
// (Earlier that day: 113/113. 2026-10-13: 94/86.)
//
// The 2026-10-13 note, kept because it is this file's whole argument: — one
// survived and two new tests could not be killed by anything:
//   - swapping a contribution's confirm back to "reading" killed
//     nothing, because the test only read the list label. The confirm
//     is where that noun matters most;
//   - "a dismissed Apple sheet says nothing" checked for the phrase
//     "didn't work" and would have passed while the screen showed
//     Apple's own "The user canceled the authorization attempt."
// Both tests were rewritten to assert the thing rather than a phrase,
// and both mutations are killed now. 94/94, 86 renderer tests, every
// one of them dies to at least one. (2026-10-12: 76 and 63.) The twelve added that day were written
// BECAUSE the run before them reported nine new sign-in tests that no
// mutation could reach — the list only covers what someone thought to
// break, so a new test file means new entries here or the suite is
// trusted for no reason.
// --verbose is NOT cosmetic: with more than one test file jest stops
// printing per-test lines, and this runner parses them. Without it the
// script reported every mutation as surviving and "All 0 tests" — loudly
// wrong, which is the only acceptable way for a verification tool to
// break, but still wrong.
import { exec, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUITES } from "../../scripts/suites.mjs";

// Every plain-node suite, from the one list — see scripts/suites.mjs
// for what went wrong when there were two.
const NODE_SUITES = SUITES;

/**
 * [what is broken, file, find, replace-with, drive?]
 *
 * `drive` NAMES A BROWSER DRIVE for the handful of mutations the
 * harnesses cannot reach — see the loop below for why it is opt-in
 * and why it only runs when nothing cheaper caught the mutation.
 */
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
   'disabled={busy}\n          onPress={onSubmit}', 'disabled={false}\n          onPress={onSubmit}'],
  ["the form greets you with a red error before you have typed anything",
   "components/TransactionSheet.tsx",
   'error={tried ? err : null}\n        // ONE PRESS.', 'error={err}\n        // ONE PRESS.'],
  ["pressing Add saves a draft it has already found fault with",
   "components/TransactionSheet.tsx",
   'onSubmit={() => { setTried(true); if (!err) onSaveDraft(draft); }}',
   'onSubmit={() => { setTried(true); onSaveDraft(draft); }}'],
  ["a form opened for income opens on One-off like any other",
   "lib/edit.ts",
   'category: initialCategory("oneoff", { presetCategory }),',
   'category: initialCategory("oneoff", {}),'],
  ["picking a cadence turns an income form into a fixed bill",
   "components/TransactionSheet.tsx",
   '{ touched: categoryTouched, presetCategory: preset },',
   '{ touched: categoryTouched },'],
  ["the guide's income button opens the form on nothing in particular",
   "app/(tabs)/index.tsx",
   'setSheet({ kind: "add", presetCategory: "income" })', 'setSheet({ kind: "add" })'],
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
   'visible={!!target || picking}', 'visible={!!target}'],
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
   'if (!err) onSaveDraft(draft);', 'if (!err) onSaveDraft(blankDraft());'],
  ["typing into Amount is dropped", "components/TransactionSheet.tsx",
   'onChangeText={(v) => set("amount", v)} accessibilityLabel="Amount"',
   'onChangeText={() => {}} accessibilityLabel="Amount"'],
  ["history edit hands back the wrong row", "components/HistoryList.tsx",
   'onPress={() => onEdit(e)}', 'onPress={() => onEdit(entries[0]!)}'],
  ["history delete fires without confirming", "components/HistoryList.tsx",
   'onPress={() => confirmDelete(e)}', 'onPress={() => onDelete(e)}'],
  ["reset option loses its date", "components/ScopeSheet.tsx",
   'return { text: `Reset ${fmtDate(a.date)} to the rule`',
   'return { text: `Reset to the rule`'],

  // --- sign-in. Nine tests arrived 2026-10-09 and no mutation could
  // reach any of them, which is exactly the state this script exists to
  // make visible: a suite nothing can kill is decoration.
  ["the address is sent raw, so an iOS capital letter matches nobody", "../src/shared/signin.ts",
   "return raw.trim().toLowerCase();", "return raw;"],
  ["a five-digit code counts as ready", "../src/shared/signin.ts",
   "return normalizeCode(code).length === CODE_LENGTH;", "return normalizeCode(code).length >= CODE_LENGTH - 1;"],
  ["a pasted code keeps its spaces", "../src/shared/signin.ts",
   'return raw.replace(/\\D/g, "").slice(0, CODE_LENGTH);', "return raw.slice(0, CODE_LENGTH);"],
  ["the rate limit is swallowed like every other error", "../src/shared/signin.ts",
   '  if (isRateLimited(error)) return "A code was just sent. Wait a minute before asking for another.";', "  // mutated"],
  ["a failed send leaks which addresses have accounts", "../src/shared/signin.ts",
   "  if (isUnknownAccount(error)) return null;", '  if (isUnknownAccount(error)) return "No account for that address.";'],
  ["a wrong code says nothing useful", "../src/shared/signin.ts",
   'return "That code is wrong or has expired. Check the latest email, or ask for a new code.";',
   'return "Error.";'],
  ["the resend cooldown never elapses", "../src/shared/signin.ts",
   "return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);", "return RESEND_COOLDOWN_SECONDS;"],
  ["the send never advances to the code step", "components/SignIn.tsx",
   'if (!resending) setStep("code");', "// mutated"],
  ["the code step forgets which address it is waiting on", "components/SignIn.tsx",
   "email: clean,\n      token,", 'email: "someone@else.com",\n      token,'],
  ["going back wipes the address you mistyped", "components/SignIn.tsx",
   'onPress={() => { setStep("email"); setError(null); attempted.current = null; }}', 'onPress={() => { setStep("email"); setError(null); attempted.current = null; setEmail(""); }}'],
  ["resend is pressable during the cooldown", "components/SignIn.tsx",
   "disabled={busy || cooldown > 0}", "disabled={busy}"],
  // Was "sign-in creates an account for a typo", which inverted the
  // flag. The flag is gone (2026-10-16): the emailed code creates an
  // account, like Apple and Google already did, and the version that
  // refused dead-ended every new user. The mutation runs the other
  // way now.
  ["the emailed code refuses an address it does not know", "components/SignIn.tsx",
   "    const { error: err } = await supabase.auth.signInWithOtp({ email: clean });",
   "    const { error: err } = await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: false } });"],
  ["the code step tells a new user it may have done nothing",
   "components/SignIn.tsx",
   "            A {CODE_LENGTH}-digit code is on its way to <Text style={styles.strong}>{clean}</Text>.",
   "            If <Text style={styles.strong}>{clean}</Text> has an account, a {CODE_LENGTH}-digit code is on its way."],
  ["the hint says you need an account already", "components/SignIn.tsx",
   "            No password. We email you a six-digit code — it signs you in, or starts you off if you're\n            new. Same account as the web.",
   "            No password. We email a six-digit code to the address on your account."],
  ["the sixth digit does not submit on its own", "components/SignIn.tsx",
   "    if (next.length === CODE_LENGTH && !busy && next !== attempted.current) {\n      void verify(next);\n    }",
   "    // mutated"],
  ["auto-submit sends the stale state, not the digit just typed", "components/SignIn.tsx",
   "void verify(next);", "void verify();"],
  ["a rejected code is auto-submitted again on the next keystroke", "components/SignIn.tsx",
   "next !== attempted.current", "true"],
  ["every send failure is hidden, so offline looks like success", "../src/shared/signin.ts",
   "  if (isUnknownAccount(error)) return null;", "  return null;"],
  ["a server error is swallowed instead of spoken", "../src/shared/signin.ts",
   '  return "Something went wrong sending the code. Try again in a moment.";', "  return null;"],
  // --- About. Both faults shipped because nobody had pressed the screen,
  // and both are layout, which is the half a renderer test can reach.
  ["the tab row is free to stretch down the screen again", "components/About.tsx",
   "chipRow: { height: CHIP_H + 10, flexGrow: 0, flexShrink: 0 },",
   "chipRow: { flexShrink: 0 },"],
  ["the pills go back to a minimum height, so they balloon", "components/About.tsx",
   "borderRadius: 999, paddingHorizontal: 12, height: CHIP_H, justifyContent: \"center\" }",
   "borderRadius: 999, paddingHorizontal: 12, minHeight: CHIP_H, justifyContent: \"center\" }"],
  ["pressing a tab does not change the section", "components/About.tsx",
   "onPress={() => setActive(s.id)}", "onPress={() => {}}"],
  ["the tour button inside About is inert", "components/About.tsx",
   'onPress={onStartTour} accessibilityRole="button"', 'onPress={() => {}} accessibilityRole="button"'],

  // --- the account manager, 2026-10-12.
  ["the form asks an asset for its APR", "components/CategorySheet.tsx",
   "            {debt && (", "            {true && ("],
  ["the kind picker does nothing", "components/CategorySheet.tsx",
   "onPress={() => setD((p) => ({ ...p, kind, assetKind }))}", "onPress={() => {}}"],
  ["saving skips validation", "components/CategorySheet.tsx",
   "onPress={() => { setShowError(true); if (!error) onSave(d); }}",
   "onPress={() => { setShowError(true); onSave(d); }}"],
  ["a refusal is silent", "components/CategorySheet.tsx",
   "{showError && error ? <Text style={styles.err}>{error}</Text> : null}", "{null}"],
  ["an as-of date is offered with nothing to date", "components/CategorySheet.tsx",
   '            {d.balance.trim() !== "" && (', "            {true && ("],
  ["a debt with no principal is silently made an asset", "lib/categories.ts",
   "  const principal = num(d.originalPrincipal);", "  const principal = 1;"],
  ["a loan with terms loses them", "lib/categories.ts",
   "      originalPrincipal: principal,", "      originalPrincipal: 0,"],
  ["editing answers the prompt on a NEW category instead", "lib/categories.ts",
   "  if (!id || !next.trackerCategories.some((c) => c.id === id)) {", "  if (true) {"],
  ["typing a name is dropped", "components/CategorySheet.tsx",
   'onChangeText={(v) => set("name", v)}', "onChangeText={() => {}}"],
  ["the delete warning stops counting what is at stake", "lib/categories.ts",
   '  if (row.tagged > 0) parts.push(`${row.tagged} ${row.tagged === 1 ? "transaction" : "transactions"}`);',
   "  // mutated"],
  ["a loan with no terms stops saying so", "lib/categories.ts",
   '? (terms ? "Loan · terms set" : "Loan · no rate or original amount yet")',
   '? "Loan · terms set"'],

  // --- the first-run signpost, 2026-10-11.
  ["a new account is never recognized, so the signpost never shows", "lib/firstRun.ts",
   "  if ((state.recurring?.length ?? 0) > 0) return false;", "  return false;"],
  ["a used account is called new, so the signpost never goes away", "../src/engine/entities.ts",
   'return s.id.startsWith("seed-") && s.amount === 0;', "return true;"],
  ["THE SHIPPED BUG: the guide dies on the first write again", "lib/firstRun.ts",
   "  return !dismissed && stepsRemaining(state) > 0;",
   "  return !dismissed && isNewAccount(state);"],
  ["a finished step never ticks off", "lib/firstRun.ts",
   "    income: income ? \"done\" : state.settings?.askedAboutIncome ? \"skipped\" : \"todo\",",
   "    income: \"todo\","],
  ["a skipped income step goes back to demanding a paycheck", "lib/firstRun.ts",
   "    income: income ? \"done\" : state.settings?.askedAboutIncome ? \"skipped\" : \"todo\",",
   "    income: income ? \"done\" : \"todo\","],
  ["a skipped step claims income was added", "components/FirstRun.tsx",
   'const title = at === "skipped" ? step.skipped ?? step.done : at === "done" ? step.done : step.title;',
   'const title = settled ? step.done : step.title;'],
  ["finishing setup forgets that income was asked about", "../src/engine/setup.ts",
   "  next = { ...next, settings: { ...next.settings, askedAboutIncome: true } };",
   "  // mutated"],
  ["dismissing the guide does nothing", "lib/firstRun.ts",
   "  return !dismissed && stepsRemaining(state) > 0;", "  return stepsRemaining(state) > 0;"],
  ["a done step keeps its button, reading as do-it-again", "components/FirstRun.tsx",
   "          {!settled && (", "          {true && ("],
  ["the hide control is inert", "components/FirstRun.tsx",
   'onPress={onDismiss} hitSlop={10}', 'onPress={() => {}} hitSlop={10}'],
  // Renames the middle step's button. A mutation that only ADDED an
  // unused field was tried first and survived, correctly — it broke
  // nothing, which is what a useless mutation looks like.
  ["the income step's button is renamed out from under the screen", "lib/firstRun.ts",
   '    cta: "Add income",', '    cta: "Add money",'],
  ["the first-run buttons are wired to the wrong handlers", "components/FirstRun.tsx",
   "    balance: onLogBalance, income: onAddIncome, bills: onAddBill,",
   "    balance: onAddBill, income: onLogBalance, bills: onAddIncome,"],
  ["the first-run buttons are live while offline", "components/FirstRun.tsx",
   "disabled={!online}", "disabled={false}"],

  // --- Google, and the export filename, both added 2026-10-11.
  ["a dismissed Google sheet is reported as a failure", "lib/signin.ts",
   'if (code === "SIGN_IN_CANCELLED" || code === "-5" || /cancel/i.test(message)) return null;',
   'if (false) return null;'],
  ["a Google failure stops offering the way out that works", "lib/signin.ts",
   'return message || "Google sign-in didn\'t work. Try the emailed code instead.";',
   'return message || "Error.";'],
  ["the Google button is not drawn at all", "components/SignIn.tsx",
   "{GOOGLE_AVAILABLE && <GoogleButton", "{false && <GoogleButton"],
  ["the Google error is swallowed", "components/SignIn.tsx",
   "    if (message) setError(message);", "    // mutated"],
  ["the export goes out as a nameless string again", "components/ExportSheet.tsx",
   "await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: filename });",
   "await Sharing.shareAsync(file.uri, {});"],
  ["the ledger export is written with the wrong extension", "components/ExportSheet.tsx",
   "filename: `key-budget-ledger-${stamp}.csv`", "filename: `key-budget-ledger-${stamp}.txt`"],
  ["the file is shared empty, so the name is right and the data is gone",
   "components/ExportSheet.tsx", "file.write(body);", 'file.write("");'],
  ["the budget export reuses the ledger's filename", "components/ExportSheet.tsx",
   "filename: `key-budget-budget-${stamp}.csv`", "filename: `key-budget-ledger-${stamp}.csv`"],
  ["the backup claims to be a csv", "components/ExportSheet.tsx",
   "filename: `key-budget-backup-${stamp}.json`, ...JSON_,",
   "filename: `key-budget-backup-${stamp}.json`, ...CSV,"],
  ["a device that cannot share fails silently", "components/ExportSheet.tsx",
   '        setFailed("This device cannot open a share sheet.");', "        // mutated"],

  ["offline is reported as a server error", "../src/shared/signin.ts",
   '  if (isUnreachable(error)) return "Can\'t reach the server. Check your connection and try again.";',
   "  // mutated"],

  // ---- the setup flow, Sign in with Apple and the two list nouns.
  // Added 2026-10-13 with the features, because the run before them
  // reported fifteen new renderer tests that no mutation could reach.
  // Same lesson as the twelve added on the 12th: a new test file means
  // new entries here, or the suite is trusted for no reason.
  ["the step counter is off by one", "components/Setup.tsx",
   "Step {i + 1} of {STEPS.length}", "Step {i} of {STEPS.length}"],
  ["the phone shows the web's note, naming a control it does not have",
   "components/Setup.tsx", "{COPY.paycheck.note.mobile}", "{COPY.paycheck.note.web}"],
  ["Skip keeps what was typed, same as Continue", "components/Setup.tsx",
   "[step]: keep ? rulesForStep(step, d, todayISO) : []",
   "[step]: rulesForStep(step, d, todayISO)"],
  ["Back throws away the draft instead of returning to it", "components/Setup.tsx",
   "onPress={() => { feel.selection(); setI(i - 1); }}",
   "onPress={() => { feel.selection(); setD(blankSetupDraft(todayISO)); setI(i - 1); }}"],
  ["Skip setup does nothing at all", "components/Setup.tsx",
   "<Pressable onPress={onSkip} hitSlop={10}", "<Pressable onPress={() => {}} hitSlop={10}"],
  ["the balance step can be passed empty", "lib/setup.ts",
   'if (step === "balance") return balanceAnswer(d.balance) != null;',
   'if (step === "balance") return true;'],
  ["a half-filled account row no longer blocks Finish", "lib/setup.ts",
   'if (step === "accounts") return incompleteAccountRows(d.accounts).length === 0;',
   'if (step === "accounts") return true;'],
  ["the balance never reaches applySetup", "lib/setup.ts",
   "checkInBalance: balanceAnswer(d.balance),", "checkInBalance: null,"],
  ["setup is offered again to an account that already did it", "lib/setup.ts",
   "if (state.settings?.hasSeenOnboarding) return false;", "// mutated"],

  ["Apple's button is drawn on a device that cannot use it", "components/SignIn.tsx",
   "{appleReady && <AppleButton onPress={apple} busy={busy} />}",
   "{<AppleButton onPress={apple} busy={busy} />}"],
  ["the Apple authorization code is never sent to the server", "lib/apple.ts",
   "void linkAppleAuthorization(supabase, credential.authorizationCode);", "// mutated"],
  ["a dismissed Apple sheet is reported as a failure", "lib/signin.ts",
   'if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED" || /cancel/i.test(message)) return null;',
   "// mutated"],
  ["Supabase refusing the Apple token is treated as a sign-in", "lib/apple.ts",
   "if (error) return { ok: false, message: appleFailureMessage(error) };",
   "if (error) return { ok: true, message: null };"],

  ["a contribution is called a reading in the confirm", "components/HistoryList.tsx",
   'confirmTitle: "Delete this contribution?"', 'confirmTitle: "Delete this reading?"'],
  ["a reading is called a contribution in the list", "components/HistoryList.tsx",
   '    show: "history",', '    show: "contributions",'],
  // ...and the other direction. Renaming BOTH to "contributions" left
  // the contribution test green — it checks that "Show history" is
  // absent, which it is when nothing says history at all. One mutation
  // per claim, not one per string.
  ["a contribution list is labeled history", "components/HistoryList.tsx",
   '    show: "contributions",', '    show: "history",'],

  // ---- the device-test fixes, 2026-10-14.
  ["the anchor strip is not a control", "components/Chrome.tsx",
   "            if (connection) setConnectedSheet(true);\n            else setLogging(true);",
   "            return;"],
  ["tapping the anchor opens a sheet that writes nothing", "components/LogBalance.tsx",
   "onPress={() => onSubmit(parsed!, date)}", "onPress={() => {}}"],
  ["a half-linked Apple sign-in is silent again", "components/Settings.tsx",
   "{prefs.appleLinkFailed && (", "{false && ("],
  ["...and a healthy one is told it is broken", "components/Settings.tsx",
   "{prefs.appleLinkFailed && (", "{true && ("],
  ["a failed token exchange is not recorded", "lib/apple.ts",
   "await patchPrefs({ appleLinkFailed: failed });", "// mutated"],
  ["...and a success never clears the notice", "lib/apple.ts",
   "    else failed = false;", "    // mutated"],
  ["the accounts form still offers a balance box on an edit", "components/CategorySheet.tsx",
   "            {creating && (", "            {true && ("],
  ["a new account can be created with no balance at all", "lib/categories.ts",
   'if (creating && d.balance.trim() === "") return "Enter what is in it now — 0 is fine.";',
   "// mutated"],
  ["a new account's balance starts blank again", "lib/categories.ts",
   '    balance: "0", asOf: today,', '    balance: "", asOf: today,'],

  // ---- the engine's anchor rule, 2026-10-14. It is engine code, so
  // the plain-node harness one directory up is what kills these.
  ["deleting a reading leaves the anchor on the deleted number",
   "../src/engine/mutate.ts",
   "  return withAccountSnapshots(state, accountId, list.filter((s) => s.id !== snapshotId));",
   "  return { ...state, accountSnapshots: { ...state.accountSnapshots, [accountId]: list.filter((s) => s.id !== snapshotId) } };"],
  ["a seed at zero outranks a reading a person logged", "../src/engine/entities.ts",
   "  const pool = logged.length > 0 ? logged : list;", "  const pool = list;"],

  // ---- the Dashboard's sections and the scrub's tick, 2026-10-15.
  // The run before this reported seven renderer tests that nothing
  // could reach — five of them the Dashboard work from the day
  // before, which went in without entries here.
  ["the savings section is labeled as the loans one", "app/(tabs)/dashboard.tsx",
   "        label={COPY.addAsset.label}\n        body={COPY.addAsset.body}\n        cta={COPY.addAsset.cta}",
   "        label={COPY.addLoan.label}\n        body={COPY.addLoan.body}\n        cta={COPY.addLoan.cta}"],
  ["an empty debt section shows an overview of nothing", "app/(tabs)/dashboard.tsx",
   "      {debts.length === 0 ? (", "      {false ? ("],
  ["the collapsed debt card stops naming the loans", "app/(tabs)/dashboard.tsx",
   "        {summary.loans.map((loan) => (", "        {[].map((loan) => (" ],
  ["expanding drops the add card, so the loans shuffle up", "app/(tabs)/dashboard.tsx",
   "      ) : (\n        <AddCard\n          label={COPY.addLoan.label}", "      ) : (\n        <AddCardOff\n          label={COPY.addLoan.label}"],
  ["adding a loan from the collapsed card leaves it collapsed", "app/(tabs)/dashboard.tsx",
   'onAddLoan={() => { animate(); setPref("debtsExpanded", true); setAdding("debt"); }}',
   'onAddLoan={() => { animate(); setAdding("debt"); }}'],

  ["the scrub ticks on every touch event, not every point", "lib/charts.tsx",
   "    if (lastTick.current === i) return;", "    // mutated"],
  ["setup ignores the payday it just asked for", "../src/engine/setup.ts",
   "  const start = payday >= today ? payday : today;", "  const start = today;"],

  // ---- the 2026-10-15 device pass, twelve items.
  // The run before these reported THIRTEEN renderer tests that nothing
  // could reach — every one of them written that day. Same lesson as
  // 2026-10-13 and 2026-10-14: a new test file means new entries here,
  // or the suite is trusted for no reason.
  ["every bill row inherits the row above's due day again", "components/Setup.tsx",
   'set("bills", [...d.bills, emptyBillRow(todayISO)])',
   'set("bills", [...d.bills, { name: "", amount: "", day: d.bills[0]?.day ?? "1" }])'],
  ["the due day goes back to being typed, so 50 is enterable again",
   "components/Setup.tsx",
   "      {open && (\n        <DayPicker",
   "      {false && (\n        <DayPicker"],
  // "the day wheel does not close when a day is chosen" was here from
  // build 9. Build 10 made closing-on-settle the BUG — see the build
  // 10 block below, where the mutation runs the other way.
  ["the wheel offers a 32nd of the month", "../src/content/setup.ts",
   "  Array.from({ length: 31 }, (_, i) => i + 1);",
   "  Array.from({ length: 32 }, (_, i) => i + 1);"],
  ["the engine stops clamping a day to 1-31", "../src/engine/setup.ts",
   "  Math.min(31, Math.max(1, Number(raw) || fallback));",
   "  (Number(raw) || fallback);"],
  ["rent's day question goes back to a column heading", "components/Setup.tsx",
   "<Day label={COPY.rent.dayLabel}", "<Day label={COPY.labels.dueDay}"],
  ["a new bill row's day is frozen at module load", "../src/engine/setup.ts",
   "  return String(dayOf(today));", "  return String(dayOf(todayISO()));"],

  ["a setup field stops reporting its focus, so the keyboard can hide it",
   "components/Setup.tsx",
   "        onFocus={() => reveal(box.current)}\n        keyboardType=\"decimal-pad\"",
   "        keyboardType=\"decimal-pad\""],
  ["the setup scroll view stops making room for the keyboard", "components/Setup.tsx",
   "              automaticallyAdjustKeyboardInsets\n", ""],
  ["the payday row stops saying it is a control", "components/Setup.tsx",
   "<Text style={styles.pickCue}>Change \u203a</Text>", "<Text style={styles.pickCue}></Text>"],

  ["groceries start on the day setup was run again", "../src/engine/setup.ts",
   "  const start = firstWeekdayOn(weekday, today);", "  const start = today;"],
  ["the groceries step opens on no particular day", "lib/setup.ts",
   'groceryCadence: "weekly", groceryDay: 0,', 'groceryCadence: "weekly", groceryDay: 3,'],

  ["the contributions step is offered with nothing to list", "lib/setup.ts",
   '    (s) => s !== "contributions" || contributionTargets(d.accounts).length > 0',
   "    () => true"],
  ["a contribution wears the To prefix again", "../src/engine/setup.ts",
   'return a.group === "debt" ? `${a.name} payment` : a.name;',
   'return a.group === "debt" ? `${a.name} payment` : `To ${a.name}`;'],
  ["a debt payment loses the word payment", "../src/engine/setup.ts",
   'return a.group === "debt" ? `${a.name} payment` : a.name;', "return a.name;"],
  ["a contribution lands in the wrong category", "../src/engine/setup.ts",
   "    id: uid(), name: contributionName(a), amount: c.amount, category: categoryId,",
   '    id: uid(), name: contributionName(a), amount: c.amount, category: "bill",'],
  ["Skip on the contributions step keeps what was typed", "components/Setup.tsx",
   '    if (step === "contributions" && !keep) set("contributions", {});', "    // mutated"],
  ["a weekly contribution starts on the day setup was run again",
   "../src/engine/setup.ts",
   "  const start = c.start >= today ? c.start : today;", "  const start = today;"],
  ["a backdated contribution is allowed to start before the balance",
   "../src/engine/setup.ts",
   "  const start = c.start >= today ? c.start : today;", "  const start = c.start;"],
  ["the contributions step forgets the date that was picked",
   "../src/engine/setup.ts",
   "  return { amount: amt, cadence: row.cadence, start: row.start || today };",
   "  return { amount: amt, cadence: row.cadence, start: today };"],
  ["a debt row is asked for a first CONTRIBUTION", "components/Setup.tsx",
   "                              label={account.group === \"debt\"\n                                ? COPY.contributions.startLabelDebt\n                                : COPY.contributions.startLabel}",
   "                              label={COPY.contributions.startLabel}"],

  ["TOTAL OUT loses the tint that separates it from the rows above",
   "app/(tabs)/budget.tsx",
   "tone: T.expense, bold: true, fill: T.tintOut, rule: true",
   "tone: T.expense, bold: true, rule: true"],
  ["the totals lose the rule above them", "app/(tabs)/budget.tsx",
   "                  r.rule && styles.ruleAbove,\n                ]}",
   "                ]}"],
  ["the rule is drawn in the hairline's own color, which is not a rule",
   "lib/theme.ts", '  rule: "#374151",', '  rule: "#1f2937",'],

  ["the form is drawn as a bottom sheet rather than a page sheet",
   "components/NativeSheet.tsx",
   '      presentationStyle="pageSheet"', '      presentationStyle="overFullScreen"'],
  ["a dirty form can be swiped away without being asked about",
   "components/NativeSheet.tsx",
   "      allowSwipeDismissal={swipeToClose}", "      allowSwipeDismissal"],
  ["a clean form refuses the swipe for no reason", "components/NativeSheet.tsx",
   "      allowSwipeDismissal={swipeToClose}", "      allowSwipeDismissal={false}"],
  ["the swipe stops reaching the host's one door", "components/NativeSheet.tsx",
   "      onRequestClose={onClose}", "      onRequestClose={() => {}}"],
  ["the editor is presented while the scope sheet is still dismissing",
   "app/(tabs)/index.tsx",
   '      setQueued({ kind: "rule", item });', '      setSheet({ kind: "rule", item });'],
  ["the queued editor never opens at all", "app/(tabs)/index.tsx",
   "        onDismissed={() => { if (queued) { setSheet(queued); setQueued(null); } }}",
   "        onDismissed={() => {}}"],
  ["a clean form is interrupted by a confirm nobody needs", "app/(tabs)/index.tsx",
   "    if (!sheet || !dirty) { leave(); return; }", "    if (false) { leave(); return; }"],
  ["leaving a half-typed transaction throws it away silently", "app/(tabs)/index.tsx",
   "    if (!sheet || !dirty) { leave(); return; }", "    leave(); return;"],
  ["the form stops reporting whether anything was typed",
   "components/TransactionSheet.tsx",
   "  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);", "  // mutated"],
  ["a typed name does not count as typing", "lib/edit.ts",
   "    d.name, d.amount, d.category, d.recurring, d.variable,",
   "    d.amount, d.category, d.recurring, d.variable,"],

  // The one pre-existing test nothing could reach: the picker's
  // Android branch. Found by the same run, 2026-10-15.
  ["Android's own cancel is read as a date", "components/DatePicker.tsx",
   'if (!d || (event as { type?: string })?.type === "dismissed") { onClose(); return; }',
   "if (!d) { onClose(); return; }"],

  ["a date reaches the screen as ISO again", "../src/shared/dates.ts",
   "  return `${m}/${d}/${y}`;", "  return iso;"],

  // ---- build 9's device pass -----------------------------------------
  ["the checking bar gives no sign it can be tapped",
   "components/AnchorStrip.tsx", "        {live && (\n          <SymbolView", "        {false && (\n          <SymbolView"],
  ["the edit cue is drawn in the brass accent", "components/AnchorStrip.tsx",
   "            tintColor={T.dim}", "            tintColor={T.brass}"],
  ["the edit cue is offered offline, where it cannot save",
   "components/AnchorStrip.tsx", "  const live = !!onPress && online;", "  const live = !!onPress;"],
  ["the as-of date goes back on the row with the balance",
   "components/AnchorStrip.tsx",
   "<Text style={[styles.asOf, pillIsAction(pill) && styles.action]}>{suffix}</Text>",
   "<Text />"],

  ["the two brand buttons stop sharing a height", "components/SignIn.tsx",
   "    height: BRAND_BUTTON.height,", "    height: undefined,"],
  ["the brand label shrinks back to Google's old 15pt",
   "components/SignIn.tsx",
   "  fontSize: 17,", "  fontSize: 15,"],
  ["Google's mark goes back to the leading edge, off the group",
   "components/SignIn.tsx",
   "    justifyContent: \"center\",\n    gap: BRAND_BUTTON.gap,",
   "    justifyContent: \"center\",\n    gap: 0,"],
  ["Apple's mark is drawn by us rather than by the system",
   "components/SignIn.tsx", '      name="apple.logo"', '      name="applelogo"'],
  ["tapping off the field no longer puts the keyboard away",
   "components/SignIn.tsx", "        onPress={Keyboard.dismiss}", "        onPress={() => {}}"],

  // The four SwipeToDelete entries that used to sit here went with the
  // component in build 10 — the gesture was replaced by a visible ✕
  // (see below), so there is nothing left for them to break.
  ["removing the last bill row leaves the step with none",
   "../src/engine/setup.ts", "  return left.length ? left : [emptyBillRow(today)];", "  return left;"],
  ["a bill row other than the one swiped is removed",
   "../src/engine/setup.ts", "  const left = rows.filter((_, i) => i !== index);",
   "  const left = rows.filter((_, i) => i !== index + 1);"],

  // Written AFTER the first build 9 run, which reported two tests
  // nothing could kill. This is one of them made honest. The other
  // asserted an ABSENCE — that the bottom sheet has no grabber any
  // more — and the only mutation that would have killed it is one
  // that adds back the testID it looks for, which tests the marker
  // and not the behavior. That test was deleted instead.
  ["the first-date row goes back to monthly only", "components/Setup.tsx",
   "                            <DateRow\n                              label={account.group === \"debt\"\n                                ? COPY.contributions.startLabelDebt\n                                : COPY.contributions.startLabel}\n                              value={row.start}\n                              minimum={todayISO}\n                              onChange={(v) => setRow({ start: v })}\n                              accessibilityLabel={`${account.name} first contribution`}\n                            />\n",
   "                            {row.cadence === \"monthly\" && (\n                            <DateRow\n                              label={account.group === \"debt\"\n                                ? COPY.contributions.startLabelDebt\n                                : COPY.contributions.startLabel}\n                              value={row.start}\n                              minimum={todayISO}\n                              onChange={(v) => setRow({ start: v })}\n                              accessibilityLabel={`${account.name} first contribution`}\n                            />\n                            )}\n"],

  // ---- build 10's device pass ----------------------------------------
  //
  // One per behavior the pass changed, and the two with no renderer
  // test are deliberately absent rather than faked: the icon's gates
  // live in scripts/make_app_icon.mjs and are proved by running it
  // (an ios.icon put back, and the build 6 gradient rendered), and
  // the web's half of items 4, 5, 6 and 7 is driven in a real browser
  // because this repo has no DOM renderer suite.

  // 2 — the owner's word on the checking bar.
  // Now a mutation of the SHARED suffix, since both clients draw it
  // from one place — which is also the point of that refactor.
  ["the checking bar says \"verified\" again", "../src/content/connect.ts",
   '  manual: (date: string) => `as of ${date}`,',
   '  manual: (date: string) => `verified ${date}`,'],
  ["a savings card stops saying when it was logged",
   "../mobile/app/(tabs)/dashboard.tsx",
   "{latest ? `logged ${fmtDate(latest.date)}`",
   "{latest ? `as of ${fmtDate(latest.date)}`"],

  // 3 — the wheel commits on Done and on nothing else.
  ["the day wheel commits the moment it stops scrolling",
   "components/DayPicker.tsx",
   "        onValueChange={(v) => setDraft(Number(v))}",
   "        onValueChange={(v) => { setDraft(Number(v)); onPick(Number(v)); onClose(); }}"],
  ["Cancel commits the draft it was meant to throw away",
   "components/DayPicker.tsx",
   "          onPress={onClose}\n          accessibilityRole=\"button\"\n          accessibilityLabel=\"Cancel\"",
   "          onPress={() => { onPick(draft); onClose(); }}\n          accessibilityRole=\"button\"\n          accessibilityLabel=\"Cancel\""],
  ["Done closes without committing", "components/DayPicker.tsx",
   "          onPress={() => { onPick(draft); onClose(); }}\n          accessibilityRole=\"button\"\n          accessibilityLabel={label}",
   "          onPress={onClose}\n          accessibilityRole=\"button\"\n          accessibilityLabel={label}"],

  // 4 — a visible ✕ on every row of both lists.
  ["the remove control does nothing", "components/Setup.tsx",
   "      onPress={() => { Keyboard.dismiss(); onPress(); }}\n      hitSlop={8}",
   "      onPress={() => {}}\n      hitSlop={8}"],
  ["removing an account row leaves the group with none",
   "../src/engine/setup.ts",
   "  const left = rows.filter((_, i) => i !== index);\n  return left.length ? left : [emptyAccountRow()];",
   "  const left = rows.filter((_, i) => i !== index);\n  return left;"],
  ["an account row other than the one pressed is removed",
   "../src/engine/setup.ts",
   "export function removeAccountRow(rows: AccountRow[], index: number): AccountRow[] {\n  const left = rows.filter((_, i) => i !== index);",
   "export function removeAccountRow(rows: AccountRow[], index: number): AccountRow[] {\n  const left = rows.filter((_, i) => i !== index + 1);"],
  ["the account ✕ always removes from savings, whichever group it is in",
   "components/Setup.tsx",
   "                                  [g.key]: removeAccountRow(d.accounts[g.key], idx),",
   "                                  savings: removeAccountRow(d.accounts.savings, idx),"],

  // 5 — the step's order, the engine's order, and no brands.
  ["the accounts step goes back to savings first",
   "../src/content/setup.ts",
   "  { key: \"investment\", label: \"Investments\", kindNote: \"Value the market moves — saved as Investment\", placeholder: \"e.g. Roth IRA, 401k, HSA\" },\n  { key: \"savings\", label: \"Savings\", kindNote: \"Cash you control — saved as Savings\", placeholder: \"e.g. Emergency fund\" },",
   "  { key: \"savings\", label: \"Savings\", kindNote: \"Cash you control — saved as Savings\", placeholder: \"e.g. Emergency fund\" },\n  { key: \"investment\", label: \"Investments\", kindNote: \"Value the market moves — saved as Investment\", placeholder: \"e.g. Roth IRA, 401k, HSA\" },"],
  ["the engine collects savings first, against the step's order",
   "../src/engine/setup.ts",
   'export const SETUP_GROUPS = ["investment", "savings", "debt"] as const;',
   'export const SETUP_GROUPS = ["savings", "investment", "debt"] as const;'],
  ["the savings placeholder names a bank again",
   "../src/content/setup.ts",
   'placeholder: "e.g. Emergency fund"', 'placeholder: "e.g. First National"'],

  // 6 — who did the work.
  ["the finish screen takes the credit back",
   "../src/content/setup.ts", "`You've added ${n} recurring item", "`We've added ${n} recurring item"],

  // 7 — where the tour puts you down.
  ["Done leaves you on whichever tab the last card was over",
   "components/Tour.tsx",
   "onPress={() => { if (last) { feel.medium(); leave(); } else go(i + 1); }}",
   "onPress={() => { if (last) { feel.medium(); onClose(); } else go(i + 1); }}"],
  ["Skip leaves you wherever you quit",
   "components/Tour.tsx",
   "<Pressable onPress={leave} style={styles.skip}",
   "<Pressable onPress={onClose} style={styles.skip}"],
  // THE WHOLE STRING, not a prefix of it. The first version of this
  // entry replaced the opening clause and left the rest of the
  // sentence dangling, so `tour.ts` failed to PARSE — jest reported a
  // suite-level error with no per-test lines, the runner saw no "✕"
  // to attribute, and the test this was written for came back as one
  // nothing could kill. A mutation has to break the behavior, not the
  // file.
  ["the Dashboard stop stops naming what is on the Dashboard",
   "../src/content/tour.ts",
   "    body: \"Everything you have and everything you owe: checking, savings, investments and debt. Nothing here is projected — it's what's true today, built only from balances you've logged. Log them again whenever and over time the Dashboard screen will show you how these balances have been trending.\",",
   "    body: \"Not a forecast: what's actually true right now. Your net position, your checking balance, and each account's balance as you log it.\","],

  // Written AFTER the first build 10 run, which reported three tests
  // nothing could kill. All three were written that day, and all
  // three gaps were real: nothing moved the tour's ROUTES, nothing
  // hid the ✕ at one row, and the Dashboard-body entry above was
  // breaking the parser rather than the copy.
  ["the tour stops routing to the tab each card is about",
   "components/Tour.tsx",
   "    setI(next);\n    router.replace(ROUTE[TOUR_STOPS[next]!.tab]! as never);\n  };",
   "    setI(next);\n  };"],
  ["the bill ✕ is hidden at one row, the way the web's used to be",
   "components/Setup.tsx",
   "                        <Remove\n                          label={`Remove bill ${idx + 1}`}\n                          onPress={() => set(\"bills\", removeBillRow(d.bills, idx, todayISO))}\n                        />",
   "                        {d.bills.length > 1 && (<Remove\n                          label={`Remove bill ${idx + 1}`}\n                          onPress={() => set(\"bills\", removeBillRow(d.bills, idx, todayISO))}\n                        />)}"],

  // 8 — the one navigation control outside the tab bar.
  ["the settings button is silent again", "components/Chrome.tsx",
   "        onPress={() => { feel.selection(); setScreen(\"settings\"); }}",
   "        onPress={() => { setScreen(\"settings\"); }}"],

  // 5 (build 13) — the readout sits over its point.
  ["the readout is clamped to the view instead of the plot",
   "../mobile/lib/readout.ts", "  const min = pad;\n  const max = width - pad - textW;",
   "  const min = 0;\n  const max = width - textW;"],
  ["the readout is positioned by its left edge, not its center",
   "../mobile/lib/readout.ts", "  return Math.max(min, Math.min(max, pointX - textW / 2));",
   "  return Math.max(min, Math.min(max, pointX));"],
  ["a readout wider than the plot inverts the clamp and goes off the other side",
   "../mobile/lib/readout.ts", "  if (max <= min) return min;", "  // mutated"],
  ["the readout goes back to a fixed box the text floats inside",
   "lib/charts.tsx", "  const left = readoutLeft(sx, readoutW, width, PAD);",
   "  const left = Math.max(0, Math.min(width - 150, sx - 75));"],

  // ---- build 12's device pass ----------------------------------------
  //
  // Items 3 and 6 have no entry here and that is not an oversight.
  // Item 3 is the WEB's tour ending, and this repo has no DOM
  // renderer suite — it is driven in a real browser instead. Item 6
  // is a shell-level gate with its own plain-node suite
  // (tests/personal-gate.test.mjs), which this runner already
  // executes as part of NODE_SUITES, so breaking it here would be
  // caught by that rather than by anything renderer-shaped.

  // 1 — the checking bar hugs its balance and stops at the button.
  ["the checking bar runs the full width again", "components/AnchorStrip.tsx",
   "    maxWidth: \"100%\",", "    marginRight: 0,"],
  ["the slot stretches its child instead of letting it be narrow",
   "components/AnchorStrip.tsx",
   "  slot: { marginLeft: 16, marginRight: 60, marginBottom: 8, alignItems: \"flex-start\" },",
   "  slot: { marginLeft: 16, marginRight: 60, marginBottom: 8 },"],
  ["the box carries its own margin, so the cap and the edge disagree",
   "components/AnchorStrip.tsx",
   "    maxWidth: \"100%\",\n    paddingHorizontal: 12,",
   "    maxWidth: \"100%\", marginLeft: 16,\n    paddingHorizontal: 12,"],
  ["nothing reserves the space the settings button floats in",
   "components/AnchorStrip.tsx",
   "  slot: { marginLeft: 16, marginRight: 60,", "  slot: { marginLeft: 16, marginRight: 0,"],

  // 2 — the picker panels match the fields.
  ["the calendar panel is cut off at the bottom again",
   "components/DatePicker.tsx",
   "  wrap: { backgroundColor: T.surface, borderRadius: 12,",
   "  wrap: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,"],
  ["the day wheel's panel is cut off at the bottom again",
   "components/DayPicker.tsx",
   "    backgroundColor: T.surface, borderRadius: 12,",
   "    backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,"],
  ["the panels are rounder than the fields they sit between",
   "components/DayPicker.tsx",
   "    backgroundColor: T.surface, borderRadius: 12,",
   "    backgroundColor: T.surface, borderRadius: 20,"],

  // 4 — the tour runs once per ACCOUNT.
  ["finishing setup does not record that the tour has run",
   "../src/engine/setup.ts",
   "export function markTourSeen(state: BudgetState): BudgetState {\n  return { ...state, settings: { ...state.settings, hasSeenTour: true } };",
   "export function markTourSeen(state: BudgetState): BudgetState {\n  return state;"],
  ["Skip marks the tour seen, so skipping the wizard loses it for good",
   "../src/engine/setup.ts",
   "export function markSetupSeen(state: BudgetState): BudgetState {\n  return { ...state, settings: { ...state.settings, hasSeenOnboarding: true } };",
   "export function markSetupSeen(state: BudgetState): BudgetState {\n  return { ...state, settings: { ...state.settings, hasSeenOnboarding: true, hasSeenTour: true } };"],
  ["the tour replays every time Setup is re-run", "components/Chrome.tsx",
   "    if (firstTime) setTouring(true);", "    setTouring(true);"],
  ["the flag is read after the write that sets it", "components/Chrome.tsx",
   "    const firstTime = !state?.settings.hasSeenTour;",
   "    const firstTime = !state?.settings.hasSeenOnboarding;"],
  ["an existing account is sprung with the tour on its next Setup",
   "../src/engine/stateShape.ts",
   "    settings.hasSeenTour = settings.hasSeenOnboarding;",
   "    settings.hasSeenTour = false;"],
  ["a deliberate 'not yet' is overwritten by the migration",
   "../src/engine/stateShape.ts",
   "  if (parsed.settings?.hasSeenTour === undefined) {",
   "  if (true) {"],

  // 5 — the session lives in the Keychain.
  ["the chunk size stops clearing the Keychain's byte limit",
   "lib/chunks.ts", "export const CHUNK_CHARS = 600;", "export const CHUNK_CHARS = 2000;"],
  // Written after the first build 12 run, which reported "a session
  // too big for one Keychain item round-trips through several" as a
  // test nothing could kill. It was real: the test expected
  // `ceil(length / CHUNK_CHARS)` chunks, so raising CHUNK_CHARS moved
  // the expectation with it — the constant checked against itself.
  // The byte bound is a literal now, and THIS is the mutation for the
  // other half of that test: a split that does not split.
  ["the session is written whole, over the Keychain's limit",
   "lib/chunks.ts",
   "  const out: string[] = [];\n  for (let i = 0; i < value.length; i += CHUNK_CHARS) out.push(value.slice(i, i + CHUNK_CHARS));\n  return out;",
   "  return [value];"],
  ["a half-written manifest reads as zero chunks instead of nothing",
   "lib/chunks.ts", "  return Number.isInteger(n) && n > 0 && n < 10000 ? n : null;",
   "  return Number.isInteger(n) && n >= 0 && n < 10000 ? n : null;"],
  ["an empty value stops being distinguishable from no value",
   "lib/chunks.ts", '  if (value.length === 0) return [""];', "  if (value.length === 0) return [];"],
  ["the update signs everybody out: no fallback to the old store",
   "lib/secureStorage.ts",
   "    const legacy = await AsyncStorage.getItem(key);\n    if (legacy == null) return null;",
   "    const legacy = null as string | null;\n    if (legacy == null) return null;"],
  ["the plaintext copy is left behind after the session moves",
   "lib/secureStorage.ts", "    await AsyncStorage.removeItem(key);\n    return legacy;", "    return legacy;"],
  ["a shrinking session leaves orphan chunks for the next read",
   "lib/secureStorage.ts",
   "    for (let i = parts.length; i < before; i++) {\n      await SecureStore.deleteItemAsync(chunkKey(key, i), opts);\n    }",
   "    // mutated"],
  ["a torn write hands supabase-js half a session",
   "lib/secureStorage.ts", "        if (part == null) return null;", "        if (part == null) continue;"],
  ["signing out leaves the old plaintext session on the device",
   "lib/secureStorage.ts",
   "    // AsyncStorage too, always: an install that signs out before it\n    // ever reads must not leave the old plaintext copy behind.\n    await AsyncStorage.removeItem(key);",
   "    // mutated"],
  ["a platform with no Keychain takes the whole client down",
   "lib/secureStorage.ts",
   "    if (!(await secureAvailable())) return AsyncStorage.getItem(key);",
   "    if (false) return AsyncStorage.getItem(key);"],

  // ---- the 2026-10-17 OTA batch ---------------------------------------
  //
  // Nine items, and the first of them was a bug a device found: a
  // device boolean answering an account question. Every entry here
  // breaks one thing the batch's tests claim.

  // 1. setup and the guide are decided by the ACCOUNT.
  ["a device flag answers for every account again, which is the bug",
   "lib/dismissal.ts",
   "  return list.includes(userId);", "  return list.length > 0;"],
  ["dismissing twice writes the account twice",
   "lib/dismissal.ts",
   "  return [...list.filter((id) => id !== userId), userId].slice(-DISMISSAL_CAP);",
   "  return [...list, userId].slice(-DISMISSAL_CAP);"],
  ["the dismissal list grows without bound",
   "lib/dismissal.ts",
   "  return [...list.filter((id) => id !== userId), userId].slice(-DISMISSAL_CAP);",
   "  return [...list.filter((id) => id !== userId), userId];"],
  ["a wipe clears the flow for every account on the phone",
   "lib/dismissal.ts",
   "  return list.filter((id) => id !== userId);", "  return [];"],
  ["the Ledger's guide goes back to a device-wide answer",
   "app/(tabs)/index.tsx",
   "  const guide = showFirstRun(state!, dismissedBy(prefs.firstRunDismissedBy, userId));",
   "  const guide = showFirstRun(state!, prefs.firstRunDismissedBy.length > 0);"],
  ["old boolean preferences come back as lists that are not lists",
   "lib/prefs.ts",
   "  Array.isArray(v) ? v.filter((x): x is string => typeof x === \"string\") : [];",
   "  (v as string[]) ?? [];"],

  // 2. About and the tour are two rows.
  ["Settings' tour row opens About instead of the tour",
   "components/Chrome.tsx",
   "              onStartTour={() => { setScreen(null); setTouring(true); }}",
   "              onStartTour={() => setScreen(\"about\")}"],

  // 3. the Ledger's date column.
  ["the Ledger's column goes back to a full date",
   "../src/shared/dates.ts",
   "  return `${MONTH_NAMES[Number(m) - 1]!.slice(0, 3)} ${Number(d)}`;",
   "  return `${m}/${d}/${iso.slice(0, 4)}`;"],
  ["a single-digit day gets its leading zero back",
   "../src/shared/dates.ts",
   "  return `${MONTH_NAMES[Number(m) - 1]!.slice(0, 3)} ${Number(d)}`;",
   "  return `${MONTH_NAMES[Number(m) - 1]!.slice(0, 3)} ${d}`;"],

  // 4. the calendar, rebuilt around the running balance.
  ["a calendar cell shows the balance BEFORE the day instead of after",
   "../src/engine/calendar.ts",
   "    while (i < sorted.length && sorted[i]!.date <= date) { running = sorted[i]!.balance; i++; }",
   "    while (i < sorted.length && sorted[i]!.date < date) { running = sorted[i]!.balance; i++; }"],
  ["the forecast is drawn over days the anchor already accounts for",
   "../src/engine/calendar.ts",
   "    const outsideForecast = date < anchor || date > horizon;",
   "    const outsideForecast = date > horizon;"],
  ["the forecast is drawn past the end of the Ledger window",
   "../src/engine/calendar.ts",
   "    const outsideForecast = date < anchor || date > horizon;",
   "    const outsideForecast = date < anchor;"],
  ["today is derived from the balance's as-of date",
   "../src/engine/calendar.ts",
   "      isToday: date === today,", "      isToday: date === anchor,"],
  ["the month list drops today when the ledger starts later",
   "../src/engine/calendar.ts",
   "  let last = todayKey;", "  let last = \"0000-00\";"],
  ["the month list skips the months before today",
   "../src/engine/calendar.ts",
   "  let first = monthKeyOf(anchor) < todayKey ? monthKeyOf(anchor) : todayKey;",
   "  let first = todayKey;"],
  ["a busy day is marked by how many rows it has, not that it has any",
   "../src/engine/calendar.ts",
   "      busy: rows.length > 0,", "      busy: rows.length > 1,"],
  ["the cell number bands before it rounds",
   "../src/engine/calendar.ts",
   "  const one = Math.round(x * 10) / 10;\n  if (one < 100) return one.toFixed(1);",
   "  const one = x;\n  if (one < 100) return one.toFixed(1);"],
  ["the phone's cell grows a dollar sign and cents",
   "../src/engine/calendar.ts",
   "  if (v < 10_000) return sign + v.toLocaleString(\"en-US\");\n  const k = shorten(v / 1000);",
   "  if (true) return cellAmountFull(n);\n  const k = shorten(v / 1000);"],
  ["the phone's calendar opens on the ledger's first month, not today",
   "components/CalendarView.tsx",
   "  const [monthKey, setMonthKey] = useState(today.slice(0, 7));\n  const [picked, setPicked] = useState<string>(today);",
   "  const [monthKey, setMonthKey] = useState(months[0] ?? today.slice(0, 7));\n  const [picked, setPicked] = useState<string>(\"\");"],
  ["the phone's calendar takes today from the anchor",
   "components/CalendarView.tsx",
   "  const today = new Date().toISOString().slice(0, 10);",
   "  const today = anchor;"],
  ["the day detail stops leading with the balance",
   "components/CalendarView.tsx",
   "          {detail.balance != null ? (", "          {false ? ("],

  // 5. setup: a bill that varies, and On my payday.
  ["a bill marked as varying is filed as a fixed one",
   "../src/engine/setup.ts",
   "      ...(b.varies ? { variable: true } : {}),", "      // mutated"],
  ["every bill is filed as one that varies",
   "../src/engine/setup.ts",
   "      ...(b.varies ? { variable: true } : {}),", "      variable: true,"],
  ["the varies box starts ticked",
   "../src/engine/setup.ts",
   "  return { name: \"\", amount: \"\", day: defaultBillDay(today), varies: false };",
   "  return { name: \"\", amount: \"\", day: defaultBillDay(today), varies: true };"],
  ["On my payday is ignored, and the row keeps its own answers",
   "../src/engine/setup.ts",
   "  if (row.onPayday && paycheck) {", "  if (false && paycheck) {"],
  ["On my payday fires with no paycheck behind it",
   "../src/engine/setup.ts",
   "  if (row.onPayday && paycheck) {\n    return { amount: amt, cadence: paycheck.cadence, start: paycheck.next };",
   "  if (row.onPayday) {\n    return { amount: amt, cadence: paycheck?.cadence ?? \"monthly\", start: paycheck?.next ?? today };"],
  ["On my payday is offered with no paycheck entered",
   "../src/engine/setup.ts",
   "  if (positive(amount) == null) return null;\n  return { cadence, next: payday >= today ? payday : today };",
   "  return { cadence, next: payday >= today ? payday : today };"],
  ["a payday already gone is offered as the next one",
   "../src/engine/setup.ts",
   "  return { cadence, next: payday >= today ? payday : today };",
   "  return { cadence, next: payday };"],
  ["ticking On my payday leaves the two controls it answered on screen",
   "components/Setup.tsx",
   "                        {!(paycheck && row.onPayday) && (",
   "                        {true && ("],
  ["the varies box stops reaching its own row",
   "components/Setup.tsx",
   "                        onChange={(v) => set(\"bills\", d.bills.map((r, j) => (j === idx ? { ...r, varies: v } : r)))}",
   "                        onChange={(v) => set(\"bills\", d.bills.map((r) => ({ ...r, varies: v })))}"],
  ["the accounts step goes back to a title you have to already understand",
   "../src/content/setup.ts",
   "    title: \"What investments, savings accounts, and debts do you want to track?\",",
   "    title: \"What else do you track?\","],

  // 6. the tour's two sentences.
  ["the Ledger stop stops asking for the one-offs setup cannot make",
   "../src/content/tour.ts",
   " After you finish setup, add any one-off transactions you know are coming up — and keep adding and updating them over time. The forecast is only as accurate as what's in it.\",",
   "\","],

  // 7. the account card's stacked buttons.
  ["Log loses the one accent on the card",
   "app/(tabs)/dashboard.tsx",
   "  logPrimary: { borderColor: T.brass },", "  logPrimary: { borderColor: T.border },"],
  ["Log's label loses it too",
   "app/(tabs)/dashboard.tsx",
   "  logTextPrimary: { color: T.brass },", "  logTextPrimary: { color: T.dim },"],
  ["Edit goes back beside Log instead of under it",
   "app/(tabs)/dashboard.tsx",
   "  cardActions: { alignSelf: \"flex-start\", alignItems: \"stretch\", gap: 6 },",
   "  cardActions: { flexDirection: \"row\", alignSelf: \"flex-start\", gap: 6 },"],

  // 8. the Planned spending caption.
  ["the caption goes back to saying what it is not",
   "../src/content/spending.ts",
   "    `Projected spending based on the transactions you've entered from ${from} – ${to}.`,",
   "    `Projected from your rules for ${from} – ${to} — not what you've logged. Income is excluded.`,"],

  // The version footer, which is how a tester says which JS they have.
  ["an over-the-air update claims to be the bundled one",
   "lib/version.ts",
   "  if (Updates.isEmbeddedLaunch) return \"Update: bundled with this build\";",
   "  if (true) return \"Update: bundled with this build\";"],
  ["the bundled JS reports the embedded bundle's id as an update",
   "lib/version.ts",
   "  if (Updates.isEmbeddedLaunch) return \"Update: bundled with this build\";",
   "  // mutated"],
  ["the build line stops naming the runtime an update has to match",
   "lib/version.ts",
   "  const runtime = (Updates.runtimeVersion ?? \"\").slice(0, 8) || \"—\";",
   "  const runtime = \"—\";"],

  // ---- the 2026-10-17 OTA 2 batch -------------------------------------

  // 1. the web sign-outs: scope, which is the whole bug.
  ["signing out revokes every session the user has, on every device",
   "../src/shared/signOutScope.ts",
   'export const SIGN_OUT_SCOPE = { scope: "local" } as const;',
   'export const SIGN_OUT_SCOPE = { scope: "global" } as const;'],
  ["the phone's Sign out takes the default scope again",
   "components/Settings.tsx",
   "            onPress={() => supabase.auth.signOut(SIGN_OUT_SCOPE)}",
   "            onPress={() => supabase.auth.signOut()}"],

  // 2. the calendar's second round.
  ["a day's net is re-added from its rows instead of read off the balances",
   "../src/engine/calendar.ts",
   "      net: outsideForecast || rows.length === 0 ? null : round(running - before),",
   "      net: outsideForecast || rows.length === 0 ? null : round(rows.reduce((t, r) => t + (r.direction === \"in\" ? r.amount : -r.amount), 0)) + 0.01,"],
  ["a quiet day prints a net of zero instead of nothing",
   "../src/engine/calendar.ts",
   "      net: outsideForecast || rows.length === 0 ? null : round(running - before),",
   "      net: outsideForecast ? null : round(running - before),"],
  ["every day with anything on it counts as money out",
   "../src/engine/calendar.ts",
   '      hasOut: rows.some((r) => r.direction === "out"),',
   "      hasOut: rows.length > 0,"],
  ["money in is never distinguished from money out",
   "../src/engine/calendar.ts",
   '      hasIn: rows.some((r) => r.direction === "in"),',
   "      hasIn: false,"],
  ["the net loses its sign", "../src/engine/calendar.ts",
   '  return `${r < 0 ? "\\u2212" : "+"}$${Math.abs(r).toLocaleString("en-US")}`;',
   '  return `$${Math.abs(r).toLocaleString("en-US")}`;'],
  ["the phone's net loses its sign", "../src/engine/calendar.ts",
   '  return `${r < 0 ? "\\u2212" : "+"}${body}`;', "  return body;"],
  ["a net of exactly zero is reported as money in",
   "../src/engine/calendar.ts",
   '  if (r === 0) return "$0";', "  // mutated"],
  ["the phone's balance goes back to being the muted number",
   "components/CalendarView.tsx",
   "  bal: { color: T.text, fontSize: 11, lineHeight: 14, marginTop: 1, fontVariant: [\"tabular-nums\"] },",
   "  bal: { color: T.dim, fontSize: 11, lineHeight: 14, marginTop: 1, fontVariant: [\"tabular-nums\"] },"],
  ["the phone's day number is as loud as the balance",
   "components/CalendarView.tsx",
   "  dayNum: { color: T.faint, fontSize: 11, lineHeight: 14 },",
   "  dayNum: { color: T.text, fontSize: 11, lineHeight: 14 },"],
  ["the green dot is red too", "components/CalendarView.tsx",
   "                {c.hasIn && <View style={[styles.dot, { backgroundColor: T.income }]} />}",
   "                {c.hasIn && <View style={[styles.dot, { backgroundColor: T.expense }]} />}"],
  ["the out dot is dropped", "components/CalendarView.tsx",
   "                {c.hasOut && <View style={[styles.dot, { backgroundColor: T.expense }]} />}",
   "                {/* mutated */}"],
  ["every day grows a dot", "components/CalendarView.tsx",
   "                {c.hasOut && <View style={[styles.dot", "                {true && <View style={[styles.dot"],
  ["the phone's net is not colored by its sign", "components/CalendarView.tsx",
   "                  style={[styles.net, { color: c.net < 0 ? T.expense : T.income }]}",
   "                  style={styles.net}"],
  ["the dots' meaning is left to color alone on the phone",
   "components/CalendarView.tsx",
   '    if (c.hasIn) parts.push("money in");\n    if (c.hasOut) parts.push("money out");',
   "    // mutated"],

  // 3. copy.
  ["the Dashboard stop says 'on one screen' again",
   "../src/content/tour.ts",
   '    body: "Everything you have and everything you owe: checking, savings, investments and debt. Nothing here is projected',
   '    body: "Everything you have and everything you owe, on one screen: checking, savings, investments and debt, and what they come to together. Nothing here is projected'],
  ["the log sheet stops naming the account", "../src/content/logBalance.ts",
   "  `Log the current balance of ${account}`;", '  "Log a balance";'],
  ["the phone's log sheet goes back to a title about nothing",
   "app/(tabs)/dashboard.tsx",
   '          title={LOG_BALANCE_TITLE(cats.find((c) => c.id === logging)?.name ?? "this account")}',
   '          title="Log a balance"'],
  ["the tour row is called Take the tour again", "components/Settings.tsx",
   '<Row label="Tour" sub="A walk through the four tabs. Takes a minute." onPress={onStartTour} />',
   '<Row label="Take the tour" sub="A walk through the four tabs. Takes a minute." onPress={onStartTour} />'],

  // 4. the add-another buttons.
  ["the add-another button spans the screen again", "components/Setup.tsx",
   '  addMoreBtn: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 8, paddingHorizontal: 2 },',
   "  addMoreBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 2 },"],

  // ---- the 2026-10-17 OTA 3 batch: the calendar's history ------------

  ["the past is filled in by running the rules backwards",
   "../src/engine/calendar.ts",
   "      balance: outsideForecast ? null : running,", "      balance: running,"],
  ["a logged reading is ignored, so the past goes blank again",
   "../src/engine/calendar.ts",
   "    const logged = loggedOn.get(date) ?? null;", "    const logged = null;"],
  ["a day holding a real reading is faded like an empty one",
   "../src/engine/calendar.ts",
   "      dim: outsideForecast && logged == null,", "      dim: outsideForecast,"],
  ["the months holding the history are unreachable",
   "../src/engine/calendar.ts",
   "  for (const snap of snapshots) {\n    const k = monthKeyOf(snap.date);",
   "  for (const snap of []) {\n    const k = monthKeyOf(snap.date);"],
  ["two readings on one date keep the first instead of the last",
   "../src/engine/calendar.ts",
   "  for (const snap of snapshots) loggedOn.set(snap.date, snap.amount);",
   "  for (const snap of snapshots) if (!loggedOn.has(snap.date)) loggedOn.set(snap.date, snap.amount);"],
  ["the phone draws a logged reading as a forecast",
   "components/CalendarView.tsx",
   "              {c.balance == null && c.logged != null && (", "              {false && ("],
  ["the panel calls a logged reading a forecast",
   "components/CalendarView.tsx",
   "          ) : detail.logged != null ? (", "          ) : false ? ("],
  ["a logged day is never named as one to a screen reader",
   "components/CalendarView.tsx",
   "  else if (c.logged != null) parts.push(`${COPY.loggedBalance} ${money(c.logged)}`);",
   "  // mutated"],
  ["a quiet day's balance is dimmed again",
   "components/CalendarView.tsx",
   "                <Text style={styles.bal} numberOfLines={1}>\n                  {cellAmountCompact(c.balance)}\n                </Text>",
   "                <Text style={[styles.bal, !c.busy && { color: T.dim }]} numberOfLines={1}>\n                  {cellAmountCompact(c.balance)}\n                </Text>"],
  ["the logged label and the forecast one are the same sentence",
   "../src/content/calendar.ts",
   '  loggedBalance: "Logged balance:",', '  loggedBalance: "Balance after:",'],
  ["a past logged cell grows a tag back, in a box with no room for one",
   "components/CalendarView.tsx",
   "                <Text style={styles.bal} numberOfLines={1}>\n                  {cellAmountCompact(c.logged)}\n                </Text>",
   "                <><Text style={styles.bal} numberOfLines={1}>{cellAmountCompact(c.logged)}</Text><Text style={styles.bal}>logged</Text></>"],

  // ---- the 2026-10-19 batch: row identity, variable bills, the loan bar ----

  // 1. a Budget row is an item, not a name.
  ["the Budget keys its rows by name again", "../src/engine/compute.ts",
   "      b.items[e.srcId] = {\n        name: e.name,\n        val: (b.items[e.srcId]?.val || 0) - e.amount,",
   "      b.items[e.name] = {\n        name: e.name,\n        val: (b.items[e.name]?.val || 0) - e.amount,"],
  ["one-time income is keyed by name again", "../src/engine/compute.ts",
   "          b.otherItems[e.srcId] = {\n            name: e.name,",
   "          b.otherItems[e.name] = {\n            name: e.name,"],
  ["a row loses the label it is printed with", "../src/engine/compute.ts",
   "        expenseItems[id] = { name: obj.name, val: -obj.val,",
   "        expenseItems[id] = { name: id, val: -obj.val,"],
  ["every occurrence becomes its own row", "../src/engine/generate.ts",
   "    srcId: src.id,", '    srcId: src.id + "@" + date,'],
  ["the layout dedupes rows by name again", "../src/engine/budgetLayout.ts",
   "      if (!seen.has(id)) { seen.add(id); sectionItems[secKey].push({ key: id, name: obj.name }); }",
   "      if (!seen.has(obj.name)) { seen.add(obj.name); sectionItems[secKey].push({ key: id, name: obj.name }); }"],
  ["the phone looks a row's figures up by its label", "app/(tabs)/budget.tsx",
   "          values: (c) => Math.abs(c.expenseItems[r.key]?.val ?? 0),",
   "          values: (c) => Math.abs(c.expenseItems[r.name]?.val ?? 0),"],
  ["the phone prints the row's key instead of its name", "app/(tabs)/budget.tsx",
   "          key: `e-${r.key}`, label: r.name,", "          key: `e-${r.key}`, label: r.key,"],
  ["reordering moves every item sharing a name", "../src/engine/mutate.ts",
   "  const patch = (it: any) => (orderOf.has(it.id) ? { ...it, order: orderOf.get(it.id) } : it);",
   "  const patch = (it: any) => (orderOf.has(it.name) ? { ...it, order: orderOf.get(it.name) } : it);"],
  ["the up/down arrows swap by name again", "../src/engine/mutate.ts",
   "    if (it.id === idA) return { ...it, order: orderB };\n    if (it.id === idB) return { ...it, order: orderA };",
   "    if (it.name === idA) return { ...it, order: orderB };\n    if (it.name === idB) return { ...it, order: orderA };"],

  // 2. a bill that varies is called one.
  ["the varies flag never reaches the event", "../src/engine/generate.ts",
   '    variable: "variable" in src ? !!src.variable : false,', "    variable: false,"],
  ["a bill that varies is labeled fixed anyway", "../src/engine/model.ts",
   '    const kind = opts.variable ? "Variable bill" : "Fixed bill";',
   '    const kind = "Fixed bill";'],
  ["the label never pluralizes", "../src/engine/model.ts",
   '    return opts.plural ? kind + "s" : kind;', "    return kind;"],
  ["the CSV stops asking whether the bill varies", "../src/engine/csv.ts",
   "      categoryLabelOf(r.category, { variable: r.variable }, cats),",
   "      categoryLabelOf(r.category, {}, cats),"],
  ["the spending mix labels every bill the bucket's way", "../src/engine/compute.ts",
   "        parentLabel: categoryLabelOf(key, { variable: it.variable }, cats),",
   "        parentLabel: d.label,"],
  ["a single row is labeled as though it were a group", "../src/engine/compute.ts",
   "        parentLabel: categoryLabelOf(key, { variable: it.variable }, cats),",
   "        parentLabel: categoryLabelOf(key, { plural: true, variable: it.variable }, cats),"],
  ["the mix merges two rules that share a name", "../src/engine/compute.ts",
   "      const at = byItem.get(e.srcId);", "      const at = byItem.get(e.name);"],

  // 3. the contribution form's date field.
  ["a contribution is logged as of a date rather than on one",
   "../src/content/logBalance.ts", '  contribution: "On",', '  contribution: "As of",'],
  ["the date label is hard-coded back onto the sheet", "components/LogBalance.tsx",
   "          <Text style={styles.label}>{dateLabel}</Text>",
   '          <Text style={styles.label}>As of</Text>'],
  ["the date control tells a screen reader something else than the label says",
   "components/LogBalance.tsx",
   "            accessibilityLabel={`${dateLabel} ${fmtDate(date)}. Change the date.`}",
   "            accessibilityLabel={`As of ${fmtDate(date)}. Change the date.`}"],
  ["the contribution sheet stops asking for its own label", "app/(tabs)/dashboard.tsx",
   "          dateLabel={DATE_LABEL.contribution}", "          dateLabel={DATE_LABEL.balance}"],

  // 4. the loan bar cannot rise for owing more.
  ["a new high-water balance raises the paid-off bar", "../src/engine/loans.ts",
   "  const bestOwed = peakAt < 0 ? null : Math.min(...amounts.slice(peakAt));",
   "  const bestOwed = amounts.length ? Math.min(...amounts) : null;"],
  ["the bar measures from the FIRST time it hit the peak", "../src/engine/loans.ts",
   "  const peakAt = amounts.lastIndexOf(peak);", "  const peakAt = amounts.indexOf(peak);"],

  // ---- the floating tab bar (2026-10-19, second batch) ----
  ["the last row goes back under the floating tab bar", "lib/tabInset.ts",
   "  return useSafeAreaInsets().bottom + gap;", "  return gap;"],
  ["the last row ends up touching the glass", "lib/tabInset.ts",
   "  return useSafeAreaInsets().bottom + gap;", "  return useSafeAreaInsets().bottom;"],
  ["the last row sits flush against the bar", "lib/tabInset.ts",
   "export const TAB_CONTENT_GAP = 16;", "export const TAB_CONTENT_GAP = 0;"],
  ["the calendar's list stops clearing the bar", "app/(tabs)/index.tsx",
   "          contentContainerStyle={{ paddingBottom: tabInset }}\n          renderSectionHeader={() => null}",
   "          renderSectionHeader={() => null}"],
  ["the ledger's list stops clearing the bar", "app/(tabs)/index.tsx",
   "          contentContainerStyle={{ paddingBottom: tabInset }}\n          refreshControl=",
   "          refreshControl="],
  ["the Budget's grid runs to the bottom edge again", "app/(tabs)/budget.tsx",
   "      contentContainerStyle={{ paddingBottom: tabInset }}\n", ""],
  ["the Dashboard goes back to a hand-picked 36", "app/(tabs)/dashboard.tsx",
   "      contentContainerStyle={[styles.pad, { paddingBottom: tabInset }]}",
   "      contentContainerStyle={[styles.pad, { paddingBottom: 36 }]}"],
  ["the Spending tab goes back to a hand-picked 40", "app/(tabs)/spending.tsx",
   "      contentContainerStyle={[styles.pad, { paddingBottom: tabInset }]}",
   "      contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}"],
  ["the calendar pads itself as well, so the gap is counted twice",
   "components/CalendarView.tsx", "    <ScrollView>",
   "    <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>"],

  // ---- setup and tour polish (2026-10-19, third batch) ----
  // The copy mutations are one per sentence the owner dictated: these
  // are the exact words, so a drift back is a defect like any other.
  ["the payday help argues with the label above it", "../src/content/setup.ts",
   '    paydayHelp: "If you were paid today, select today.",',
   '    paydayHelp: "Not the last one \u2014 the next one. If you were paid today, say today.",'],
  ["the rent step stops saying you can walk past it", "../src/content/setup.ts",
   ' without re-entering it. Skip this if you don\'t have rent or mortgage payments.",',
   ' without re-entering it.",'],
  ["the rent day field forgets the mortgage", "../src/content/setup.ts",
   '    dayLabel: "What day of the month is your rent/mortgage payment due?",',
   '    dayLabel: "What day of the month is your rent due?",'],
  ["the bills step goes back to the old sentence", "../src/content/setup.ts",
   "anything that is a monthly cost.", "anything that comes due each month."],
  ["the bills step buries the example mid-sentence", "../src/content/setup.ts",
   "for bills that change month to month (e.g. electric).",
   "for ones like electric that change month to month."],
  ["the contributions step asks you to report on yourself", "../src/content/setup.ts",
   '    title: "Want to put in money regularly?",',
   '    title: "Are you putting money in regularly?",'],
  ["the Ledger card says 'rules' again", "../src/content/tour.ts",
   "It's built from the planned transactions you've entered,",
   "It's built from the rules you just entered,"],
  ["the Budget card goes back to its old body", "../src/content/tour.ts",
   "Monthly income and outflow. These are the same transactions/numbers from the Ledger. View where all of your money is going each month.",
   "Income against outflow, projected as far out as you want. Same numbers as the Ledger \u2014 one is day by day, the other month by month."],
  ["the Spending card stops saying what is compared", "../src/content/tour.ts",
   "this is where you can compare what you had planned on spending vs what actually was spent.",
   "this is where the two get compared."],

  // The scroll reset, and the two ways to get it wrong.
  ["a new step keeps the old step's scroll position", "components/Setup.tsx",
   "    scroll.current?.scrollTo({ y: 0, animated: false });\n", ""],
  ["the reset runs on every render, not only a step change", "components/Setup.tsx",
   "    window.current.offset = 0;\n  }, [i]);", "    window.current.offset = 0;\n  });"],
  ["the new step slides up past rows it never had", "components/Setup.tsx",
   "scroll.current?.scrollTo({ y: 0, animated: false });",
   "scroll.current?.scrollTo({ y: 0, animated: true });"],

  // The feel of a sequence.
  ["every setup button feels the same", "components/Setup.tsx",
   "onPress={() => { if (last) feel.success(); else feel.light(); advance(true); }}",
   "onPress={() => { feel.light(); advance(true); }}"],
  ["Continue thumps like the end of the flow", "components/Setup.tsx",
   "onPress={() => { if (last) feel.success(); else feel.light(); advance(true); }}",
   "onPress={() => { feel.success(); advance(true); }}"],
  ["going back feels like going on", "components/Setup.tsx",
   "onPress={() => { feel.selection(); setI(i - 1); }}",
   "onPress={() => { feel.light(); setI(i - 1); }}"],
  ["the last button of setup is as quiet as a step", "components/Setup.tsx",
   "onPress={() => { feel.medium(); onGo(); }}",
   "onPress={() => { feel.light(); onGo(); }}"],
  ["the setup write buzzes on top of the two taps either side of it",
   "components/Chrome.tsx",
   'markSetupSeen(applySetup(s, answers))), "Setup", "none");',
   'markSetupSeen(applySetup(s, answers))), "Setup");'],
  ["the tour feels the same in both directions", "components/Tour.tsx",
   "    if (next > i) feel.light(); else feel.selection();",
   "    feel.light();"],
  ["the tour's Done is just another Next", "components/Tour.tsx",
   "onPress={() => { if (last) { feel.medium(); leave(); } else go(i + 1); }}",
   "onPress={() => { if (last) { feel.light(); leave(); } else go(i + 1); }}"],
  ["medium is just light with another name", "lib/haptics.ts",
   "export const medium = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));",
   "export const medium = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));"],

  // ---- the one-off section's name (2026-10-20) ----
  ["the one-off heading glosses itself again", "../src/engine/budgetLayout.ts",
   '{ key: "oneoff", label: "ONE-OFF" },',
   '{ key: "oneoff", label: "ONE-OFF / SEASONAL" },'],
  ["a pre-rename CSV loses every one-off, in silence", "../src/engine/csvImport.ts",
   'const ONEOFF_SECTION_HEADERS = headersFor("oneoff", LEGACY_ONEOFF_SECTION_LABEL);',
   'const ONEOFF_SECTION_HEADERS = headersFor("oneoff");'],
  // ---- connected checking's copy (2026-10-20) ----
  // The consent screen is the one place in this app where a wrong
  // sentence is a broken promise rather than a typo.
  ["the consent screen hides that Plaid gets more than we use", "../src/content/connect.ts",
   "Plaid will have access to your account and balance info and your contact info — more than Key Budget uses. Plaid's own screen will tell you this too.",
   "Plaid only asks for your checking balance."],
  ["the consent screen stops naming Plaid Portal", "../src/content/connect.ts",
   '"To see or delete what Plaid holds, use Plaid Portal at my.plaid.com.",',
   '"Plaid handles the connection.",'],
  ["disconnecting stops saying the history is kept", "../src/content/connect.ts",
   '  "Disconnecting removes Key Budget\'s access right away. Balances already pulled stay in your history. "',
   '  "Disconnecting removes Key Budget\'s access right away. "'],
  ["the pill claims a sync on a day the number was typed", "../src/content/connect.ts",
   '  loggedToday: () => "logged today",',
   '  loggedToday: () => "synced today",'],
  ["the reconnect pill names the problem instead of the action", "../src/content/connect.ts",
   '  reconnect: () => "Reconnect",',
   '  reconnect: () => "Disconnected",'],
  // ---- the gate, which is the privacy promise in code (2026-10-20) ----
  ["the toggle alone opens Connect, without the allowlist", "../src/shared/connect.ts",
   "  return allowlisted && settings.connectedFeatures;",
   "  return settings.connectedFeatures;"],
  ["the allowlist alone opens Connect, without the user asking", "../src/shared/connect.ts",
   "  return allowlisted && settings.connectedFeatures;",
   "  return allowlisted;"],
  ["the hint is shown to someone who already turned it on", "../src/shared/connect.ts",
   "  return allowlisted && !settings.connectedFeatures && !settings.hideConnectHint;",
   "  return allowlisted && !settings.hideConnectHint;"],
  ["'don't show again' stops meaning anything", "../src/shared/connect.ts",
   "  return allowlisted && !settings.connectedFeatures && !settings.hideConnectHint;",
   "  return allowlisted && !settings.connectedFeatures;"],
  ["connected features default to ON for a new account", "../src/engine/model.ts",
   "        connectedFeatures: false,", "        connectedFeatures: true,"],
  ["the pill claims a sync when the user typed today's number", "../src/shared/connect.ts",
   '  if (snapshotDate === today && (snapshotSource ?? "manual") === "manual") return "loggedToday";',
   '  if (snapshotDate === today && snapshotSource === "manual") return "loggedToday";'],
  ["a dead connection hides behind a manual log", "../src/shared/connect.ts",
   '  if (connection.status === "login_required") return "reconnect";\n  if (!connection.lastSyncedAt) return "manual";',
   '  if (!connection.lastSyncedAt) return "manual";\n  if (connection.status === "login_required") return "reconnect";'],
  ["the client second-guesses the server's staleness window", "../src/shared/connect.ts",
   "  return settings.connectedFeatures && !!connection;",
   "  return settings.connectedFeatures && !!connection && !connection.lastSyncedAt;"],
  ["the daily cap is reported as a failure", "../src/shared/connect.ts",
   '    case "daily_cap": return "You\'ve refreshed a few times today — try again tomorrow";',
   '    case "daily_cap": return null;'],

  ["a pulled reading loses its source on the way to the database", "../src/engine/stateShape.ts",
   "for (const s of list) byDate.set(s.date, s); // later wins, as a correction",
   "for (const s of list) byDate.set(s.date, { id: s.id, date: s.date, amount: s.amount });"],

  ["the importer stops recognizing its own current heading", "../src/engine/csvImport.ts",
   'const headersFor = (key: SectionKey, ...legacy: string[]) => new Set([labelOf(key), ...legacy]);',
   'const headersFor = (key: SectionKey, ...legacy: string[]) => new Set([...legacy, ...(legacy.length ? [] : [labelOf(key)])]);'],

  // ---- the collision rule, which had never fired once (2026-10-21) ----
  // THE FIRST ONE IS THE BUG ITSELF, restored. `{ ...s, amount }`
  // kept whatever `source` was already on the row, so a balance the
  // user typed over a pulled one went on claiming it came from the
  // bank — and the guard in plaid_write_balance, which declines only
  // where the row is NOT plaid, matched every time. Everything about
  // the rule was right except that its precondition was never true.
  ["a manual log goes on claiming it came from the bank", "../src/engine/mutate.ts",
   '    (i === at ? { ...s, amount, source: "manual" as const, externalId: undefined, loggedAt } : s));',
   '    (i === at ? { ...s, amount } : s));'],
  ["a first log of the day does not say who wrote it", "../src/engine/mutate.ts",
   'if (at === -1) return [...list, { id: uid(), date, amount, source: "manual", loggedAt }];',
   'if (at === -1) return [...list, { id: uid(), date, amount, loggedAt }];'],
  ["correcting the bank's number leaves it the bank's", "../src/engine/mutate.ts",
   '    : { ...patch, source: "manual" as const, externalId: undefined, loggedAt: new Date().toISOString() };',
   '    : patch;'],
  ["re-dating a reading rewrites who logged it", "../src/engine/mutate.ts",
   '  const claim = patch.amount === undefined\n    ? patch',
   '  const claim = false\n    ? patch'],
  ["'Use bank balance' is offered when there is nothing to drop", "../src/shared/connect.ts",
   'export const canUseBankBalance = (state: PillState): boolean => state === "loggedToday";',
   'export const canUseBankBalance = (state: PillState): boolean => state !== "manual";'],
  ["the web's long pill forgets when the override was typed", "../src/shared/connect.ts",
   '    case "loggedToday": return `${parts.amount} · ${PILL_SUFFIX_LONG.loggedToday(parts.loggedStamp)}`;',
   '    case "loggedToday": return `${parts.amount} · ${PILL_SUFFIX_LONG.loggedToday(parts.syncedStamp)}`;'],

  // ---- our own writes are not "another device" (2026-10-21) ----
  ["a pull does not claim itself, so the page calls it another device",
   "../src/shared/plaidApi.ts",
   "  return duringPlaidWrite(async () => {\n    const { data, error } = await sb.functions.invoke(\"plaid-balance\"",
   "  return (async () => {\n    const { data, error } = await sb.functions.invoke(\"plaid-balance\""],
  ["the claim is a flag, so an inner call releases the outer one",
   "../src/shared/plaidApi.ts",
   "  writesInFlight += 1;\n  try { return await fn(); } finally { writesInFlight -= 1; }",
   "  writesInFlight = 1;\n  try { return await fn(); } finally { writesInFlight = 0; }"],
  ["a failed call leaves the claim standing forever", "../src/shared/plaidApi.ts",
   "  try { return await fn(); } finally { writesInFlight -= 1; }",
   "  const out = await fn(); writesInFlight -= 1; return out;"],
  ["the focus check stops asking whether the write was ours", "../src/App.jsx",
   "if (!getVersion() || hasPendingSave() || plaidWriteInFlight() || checking) return;",
   "if (!getVersion() || hasPendingSave() || checking) return;"],

  // ---- copy that stopped being true the day Connect shipped (2026-10-21) ----
  ["the landing page promises the app never connects to a bank",
   "../src/components/Landing.jsx",
   "Free. No bank connection required.",
   "Free. No bank connection, ever — it never asks for one."],
  ["the privacy page promises the app never connects to a bank",
   "../src/components/Privacy.jsx",
   "Connecting a bank is optional, off unless",
   "It never connects to your bank, nor unless"],

  // ---- a live bank with the feature off (2026-10-21) ----
  ["a connection is left sitting behind a switch that says off",
   "../src/shared/connect.ts",
   "  return !!connection && !settings.connectedFeatures;",
   "  return false;"],
  ["the restore fires when there is no bank, turning the feature on by itself",
   "../src/shared/connect.ts",
   "  return !!connection && !settings.connectedFeatures;",
   "  return !settings.connectedFeatures;"],
  ["the phone comes back from Hosted Link and never checks the switch",
   "../mobile/components/Connected.tsx",
   "      cameBackConnected.current = row;", "      // mutated"],
  ["the toggle's sub-line drifts back into the phone", "../src/content/connect.ts",
   '  "When on, Key Budget can read your checking balance — and nothing else. "',
   '  "Off by default. When on, Key Budget can read your checking balance — and nothing else. "'],

  // ---- a one-off described as a rule (2026-10-21) ----
  ["a one-time charge offers to edit every one of itself",
   "../mobile/components/ScopeSheet.tsx",
   '        : { text: `Edit ${name}` };',
   '        : { text: `Edit every ${name}`, sub: "Changes the rule, and so every date it generates" };'],
  ["deleting a one-off warns about dates it does not generate",
   "../mobile/components/ScopeSheet.tsx",
   '        : { text: `Delete ${name}`, sub: "Removes this transaction", destructive: true };',
   '        : { text: `Delete ${name}`, sub: "Removes the rule and every date it generates", destructive: true };'],
  ["the one-off confirm promises to remove every date",
   "../mobile/components/ScopeSheet.tsx",
   '        : "This removes it from your ledger.",',
   '        : "This removes the rule and every date it generates, including any dates you gave their own amount.",'],
  ["a repeating rule is described as a single transaction",
   "../mobile/components/ScopeSheet.tsx",
   "    case \"edit-rule\":\n      return recurring",
   "    case \"edit-rule\":\n      return false"],

  // ---- ten Trial Items EVER, and removal does not refund one (2026-10-21) ----
  ["a broken login offers no repair, so the only way back is a second Item",
   "../src/shared/connect.ts",
   '  !!connection && connection.status === "login_required";',
   "  false;"],
  ["the repair is offered on a connection that is working",
   "../src/shared/connect.ts",
   '  !!connection && connection.status === "login_required";',
   "  !!connection;"],
  ["update mode sends products, which Plaid refuses",
   "../supabase/functions/plaid-link-token/index.ts",
   "      access_token: accessToken,",
   "      access_token: accessToken,\n      products: PRODUCTS,"],
  ["a login_required item can be cleared without asking the bank",
   "../supabase/functions/plaid-balance/index.ts",
   '  if (item.status === "login_required" && trigger !== "reconnect") {',
   '  if (false) {'],
  ["the slot ledger learns a user id it would then have to purge",
   "../supabase/plaid.sql",
   "create table if not exists plaid_item_creations (\n  id               bigserial primary key,",
   "create table if not exists plaid_item_creations (\n  id               bigserial primary key,\n  user_id          uuid,"],
  ["nothing counts the Items we created", "../supabase/functions/plaid-exchange/index.ts",
   '  const { error: ledgerError } = await admin.from("plaid_item_creations").insert({',
   '  const { error: ledgerError } = await admin.from("plaid_api_log").insert({'],
  ["leaving stops saying that coming back costs a new connection",
   "../src/content/connect.ts",
   '  + "Connecting again later starts a new connection, not this one. "',
   '  + ""'],
  ["turning the feature off stops saying it too", "../src/content/connect.ts",
   '    + "the same as ones you typed. Connecting again later starts a new connection, not this one.",',
   '    + "the same as ones you typed.",'],
  ["the hidden-rows warning goes back to raw ISO", "../src/components/UpdateBalanceModal.jsx",
   "{HIDDEN.lede(confirming.length, fmtDate(date))}",
   "{HIDDEN.lede(confirming.length, date)}"],
  ["the phone's hidden-rows warning goes back to raw ISO", "../mobile/components/LogBalance.tsx",
   "{HIDDEN.lede(confirming.length, fmtDate(date))}",
   "{HIDDEN.lede(confirming.length, date)}"],

  // ---- is the webhook actually from Plaid (2026-10-21) ----
  // The one piece of code here whose whole job is to say no to
  // something an attacker chose, so every step of it gets broken.
  ["a signature over somebody else's body authenticates ours",
   "../supabase/functions/_shared/webhookVerify.ts",
   '  if (!constantTimeEquals(claimed.toLowerCase(), await sha256Hex(body))) {\n    return { ok: false, reason: "body_mismatch" };\n  }',
   "  // mutated"],
  ["a captured webhook can be replayed tomorrow",
   "../supabase/functions/_shared/webhookVerify.ts",
   "  if (now - iat > WEBHOOK_MAX_AGE_SECONDS) return { ok: false, reason: \"stale\" };",
   "  // mutated"],
  ["a key Plaid retired is still trusted",
   "../supabase/functions/_shared/webhookVerify.ts",
   '  if (jwk.expired_at != null) return { ok: false, reason: "expired_key" };',
   "  // mutated"],
  ["the token names its own algorithm and is believed",
   "../supabase/functions/_shared/webhookVerify.ts",
   '  if (jwtHeader.alg !== "ES256") return { ok: false, reason: `bad_alg:${String(jwtHeader.alg)}` };',
   "  // mutated"],
  ["the hash comparison leaks where it stopped matching",
   "../supabase/functions/_shared/webhookVerify.ts",
   "  let diff = 0;\n  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);\n  return diff === 0;",
   "  return a === b;"],
  ["the body is re-serialized, so the hash is of a string Plaid never sent",
   "../supabase/functions/plaid-exchange/index.ts",
   "      body: raw,", "      body: JSON.stringify(payload),"],
  ["the webhook is not checked at all",
   "../supabase/functions/plaid-exchange/index.ts",
   "    if (!verified.ok) {", "    if (false) {"],

  // ---- a webhook is a backup, not the only way home (2026-10-21) ----
  ["the phone goes back to waiting to be told", "../mobile/components/Connected.tsx",
   "    await recoverLink(supabase as never);\n    let row = await refreshConnection();",
   "    let row = await refreshConnection();"],
  ["foregrounding stops looking for a stranded connection",
   "../mobile/components/Connected.tsx",
   "        if (!connectionNow()) await recoverLink(supabase as never);", "        // mutated"],
  ["a cold start leaves an unfinished session unfinished",
   "../mobile/components/Chrome.tsx",
   "      if (connectedFeatures && allowlistedNow() && !connectionNow()) {", "      if (false) {"],
  ["the web stops recovering a tab closed mid-exchange",
   "../src/components/ConnectedAccount.jsx",
   "      const found = await recoverLink(supabase);", "      const found = { ok: false };"],
  ["a finished session is never marked finished, so Connect stays shut",
   "../supabase/functions/plaid-exchange/index.ts",
   '  await admin.from("plaid_link_sessions")\n    .update({ used_at: new Date().toISOString() })\n    .eq("user_id", userId).is("used_at", null);',
   "  // mutated"],
  ["an arriving webhook leaves no trace", "../supabase/functions/plaid-exchange/index.ts",
   '      await noteInbound(admin, String(payload.webhook_code), verified.reason, String(payload.webhook_type ?? ""));', "      // mutated"],

  // ---- the webhook we were not listening for (2026-10-21) ----
  ["only the sweep-up webhook is handled, so a Hosted Link Item is lost",
   "../supabase/functions/plaid-exchange/index.ts",
   '  } else if (payload.webhook_code === "SESSION_FINISHED" || payload.webhook_code === "ITEM_ADD_RESULT") {',
   '  } else if (payload.webhook_code === "SESSION_FINISHED") {'],
  ["the inbound record drops the webhook type again",
   "../supabase/functions/plaid-exchange/index.ts",
   '      endpoint: `(inbound) ${type ? `${type}/` : ""}${code}`,',
   "      endpoint: `(inbound) ${code}`,"],
  // ---- our own write, re-read immediately (2026-10-21) ----
  ["the reload goes stale again, captured before anyone signed in",
   "../src/App.jsx",
   "    const userId = userIdRef.current;",
   "    const userId = null;", "drive_connected"],
  ["the bar is told to reload and does not", "../src/App.jsx",
   "    await reloadFromServer();\n    // `kept_manual` means", "    // `kept_manual` means", "drive_connected"],
  ["a recovered session leaves the page showing the old number",
   "../src/components/ConnectedAccount.jsx",
   "      await refresh();\n      // AND THE PAGE RE-READS ITS OWN NUMBERS.", "      // AND THE PAGE RE-READS ITS OWN NUMBERS."],

  // ---- one project, two Plaid environments (2026-10-21) ----
  ["sandbox and production share a secret again",
   "../supabase/functions/_shared/plaid.ts",
   '  const name = env === "sandbox" ? "PLAID_SECRET_SANDBOX" : "PLAID_SECRET";',
   '  const name = "PLAID_SECRET";'],
  ["an unrecognized environment is guessed at instead of refused",
   "../supabase/functions/_shared/plaid.ts",
   '    return { missing: [`PLAID_ENV (got "${env}", expected sandbox or production)`] };',
   "    return { config: { clientId, secret: Deno.env.get(\"PLAID_SECRET\") ?? \"\", env, baseUrl: \"https://production.plaid.com\" } };"],
  ["a pull uses the project's environment, not the Item's",
   "../supabase/functions/plaid-balance/index.ts",
   "  const conf = readConfig(item.env ?? undefined);", "  const conf = readConfig();"],
  ["disconnect uses the project's environment, not the Item's",
   "../supabase/functions/plaid-disconnect/index.ts",
   "  const conf = readConfig(item.env ?? undefined);", "  const conf = readConfig();"],
  ["the drain forgets which environment each token came from",
   "../supabase/functions/plaid-disconnect/index.ts",
   "      const conf = readConfig(row.env ?? undefined);", "      const conf = readConfig();"],
  ["a new connection ignores the person's own default",
   "../supabase/functions/plaid-link-token/index.ts",
   "  const env = existing?.env ?? beta?.env ?? defaultEnv();", "  const env = defaultEnv();"],
  ["the Item is stored without the environment its token belongs to",
   "../supabase/functions/plaid-exchange/index.ts",
   "    // STORED WITH THE ITEM, because its token works nowhere else.\n    env,", "    // mutated"],
  ["a queued removal forgets its environment",
   "../supabase/functions/plaid-exchange/index.ts",
   "p_plaid_item_id: item_id, p_env: env,", "p_plaid_item_id: item_id,"],
  ["one key cache for both environments",
   "../supabase/functions/plaid-exchange/index.ts",
   "        const cached = keyCache.get(`${env}:${keyId}`);", "        const cached = keyCache.get(keyId);"],
  ["the removal queue stops taking an environment", "../supabase/plaid.sql",
   "  p_access_token text, p_plaid_item_id text, p_env text default 'production'",
   "  p_access_token text, p_plaid_item_id text, p_env text default null"],
  ["account deletion drops the environment off the Item", "../supabase/plaid.sql",
   "    select tok.secret_id, it.plaid_item_id, coalesce(it.env, 'production')",
   "    select tok.secret_id, it.plaid_item_id, null"],
];

// ---------------------------------------------------------------
// NOTHING ABOVE OR BELOW THIS LINE RUNS ON IMPORT.
//
// It used to. The whole runner was top-level code, so
// `import("./scripts/mutate.mjs")` — typed once to check whether the
// preflight was happy — started the full catalog, and killing it left
// a mutated file on disk: `components/TransactionSheet.tsx` with
// `if (false)` where a mode check had been. Caught in `git status`
// before it was committed, which is luck, not a process.
//
// So: `main()` is a function, it only runs when this file IS the
// program, and every file it writes is restored by a handler that
// fires on the ways a run can end early.
// ---------------------------------------------------------------

// EVERY TEST RUN IS AWAITED, NOT `execSync`, and that is the whole
// difference between a signal handler that works and one that reads
// as if it does.
//
// Node runs a signal handler when the event loop next turns. The loop
// below used to be synchronous from the first mutation to the last —
// `execSync` all the way down — so the loop NEVER turned, and a
// SIGINT sat queued until the entire run finished. Measured on
// 2026-10-20: interrupt a real run and the handler did not fire at
// all; the file was still mutated two minutes later. The handlers
// were there. They could not run.
//
// `await` gives the loop somewhere to turn, so the handler fires
// while jest is still going — and `current` is how it takes jest
// down with it instead of orphaning a test run.
let current = null;

/**
 * Run a command; hand back its output and whether it exited zero.
 *
 * BOTH, because the two callers need different halves. jest's result
 * is read out of the text; a node harness that dies on a TypeError
 * prints no "FAIL" line at all and is only detectable by its exit
 * code. Every command here is already `2>&1`, so stderr is in `out`.
 */
function capture(cmd, cwd) {
  return new Promise((done) => {
    current = exec(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd }, (err, stdout) => {
      current = null;
      done({ out: stdout || err?.stdout || "", ok: !err });
    });
  });
}

// THE REPO ROOT, from this file rather than from the cwd. The node
// suites are written to be run from there — `npm test` runs them
// from there — and running them from mobile/ is running a different
// thing. See runNodeHarness.
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

/**
 * Names of the node-harness checks that FAIL right now, if any.
 *
 * RUN FROM THE REPO ROOT, which they were not. They were run as
 * `node ../tests/x.mjs` from mobile/, so any suite that opens a path
 * relative to the repo root threw ENOENT — and on 2026-10-21
 * `tests/mobile-fields.test.mjs` did exactly that, on EVERY mutation.
 *
 * A CRASH IS NOT A KILL, which is the half that did the damage. A
 * suite that exits non-zero without naming a failed check used to be
 * counted as "the mutation was caught", so a broken harness handed a
 * free kill to every mutation in the run — and because the loop
 * below returns at the first failing suite, the suites after it never
 * ran at all. `tests/mobile-fields.test.mjs` is 16th of 18: the two
 * suites covering every Plaid change, `connect` and `edge-functions`,
 * had never once been run by this script. Three audits reported
 * "every mutation caught" on that basis.
 *
 * So a crash is never silently counted. It is HANDED BACK UNDECIDED,
 * as `crashed`, and decideCrash below settles it — because the first
 * version of this rule stopped the run on every crash, and that threw
 * away the common case. On 2026-10-21 three of four shards died that
 * way within the hour: two on a drive that could not find .env.local
 * (genuinely broken) and one on `setup.test.mjs` throwing a TypeError
 * because THE MUTATION had made the rule it reads undefined. The
 * second is a suite noticing, which is the whole point of the run.
 */
async function runNodeHarness() {
  for (const suite of NODE_SUITES) {
    const { out, ok } = await capture(`node ${suite} 2>&1`, REPO_ROOT);
    if (ok) continue;
    const failed = [...out.matchAll(/^FAIL  (.+)$/gm)].map((m) => `${suite}: ${m[1].trim()}`);
    if (failed.length) return { failed };
    return { failed: [], crashed: { cmd: `node ${suite}`, name: suite, out } };
  }
  return { failed: [] };
}

/**
 * Was that crash the mutation's doing, or is the harness broken?
 *
 * THE DISCRIMINATOR IS A SECOND RUN WITH THE MUTATION PUT BACK, which
 * is the only thing that can tell them apart — the output of a crash
 * looks identical either way. Clean pass means the suite only dies
 * when the code is wrong, which is a kill, and it is named for the
 * throw rather than for a check, because no check was reached.
 * Still dead means the harness is broken and nothing it says is
 * evidence, so the run stops.
 *
 * CALLED AFTER THE RESTORE, never inside the try: re-running with the
 * mutation still applied would just reproduce the crash.
 */
async function decideCrash(crashed) {
  const { ok } = await capture(`${crashed.cmd} 2>&1`, REPO_ROOT);
  if (!ok) return { failed: [], broken: crashed.name, out: crashed.out };
  const threw = /^\s*(?:[A-Za-z]*Error|Assertion\w*):.*$/m.exec(crashed.out);
  return { failed: [`${crashed.name}: crashed — ${threw ? threw[0].trim() : "no check reached"}`] };
}

// THE DIRTY LIST: every file this process has written, mapped to what
// was there before it. One entry at a time in practice — a mutation
// touches one file and is put back before the next one starts — but
// it is a map rather than a pair of variables so that the handlers
// below cannot restore the wrong thing, or half of two things.
const dirty = new Map();

// AND THE SAME LIST ON DISK, because the one signal nothing catches
// is SIGKILL, and `kill -9` on a mutation run is how a file stays
// broken through a reboot. The journal is written before the file is
// and deleted after it is put back, so if it exists at startup the
// last run died badly — and the next run repairs the tree before it
// does anything else.
const JOURNAL = ".mutate-restore.json";

function writeJournal() {
  if (dirty.size === 0) { rmSync(JOURNAL, { force: true }); return; }
  writeFileSync(JOURNAL, JSON.stringify(Object.fromEntries(dirty)));
}

/** Put back whatever a killed run left behind. Returns the files repaired. */
export function recoverJournal() {
  if (!existsSync(JOURNAL)) return [];
  const saved = JSON.parse(readFileSync(JOURNAL, "utf8"));
  for (const [file, orig] of Object.entries(saved)) writeFileSync(file, orig);
  rmSync(JOURNAL, { force: true });
  return Object.keys(saved);
}

function applyMutation(file, orig, find, repl) {
  dirty.set(file, orig);
  writeJournal();
  writeFileSync(file, orig.replace(find, repl));
}

/**
 * Put every mutated file back. Safe to call twice.
 *
 * `announce` is on for every path except the ordinary one at the
 * bottom of the loop, which happens 341 times and would bury the
 * report in its own housekeeping. A restore after a Ctrl-C says so,
 * because a silent one there reads exactly like a run that left the
 * tree dirty.
 */
function restoreAll(why, announce = true) {
  if (dirty.size === 0) return;
  const files = [...dirty.keys()];
  for (const f of files) {
    try { writeFileSync(f, dirty.get(f)); } catch (e) { console.error(`COULD NOT RESTORE ${f}: ${e.message}`); }
  }
  dirty.clear();
  writeJournal();
  if (announce) console.log(`\nrestored ${files.length} mutated file(s) after ${why}: ${files.join(", ")}`);
}

/**
 * Arm the ways a run can end without reaching the end of the loop.
 *
 * SIGKILL AND A POWER CUT ARE NOT ON THIS LIST and cannot be — no
 * process catches SIGKILL. Those are what the journal above and the
 * clean-tree check in scripts/ota.mjs are for: the handlers make the
 * common cases safe, the journal repairs the uncatchable ones on the
 * next run, and the publish gate makes them visible in the meantime.
 *
 * `exit` is the backstop and runs after the others, including after
 * every ordinary `process.exit()` path in `main`. Only synchronous
 * work is allowed in it, which `writeFileSync` is.
 */
function armGuards() {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { current?.kill("SIGKILL"); restoreAll(sig); process.exit(130); });
  }
  process.on("uncaughtException", (e) => { restoreAll("an uncaught exception"); console.error(e); process.exit(1); });
  process.on("unhandledRejection", (e) => { restoreAll("an unhandled rejection"); console.error(e); process.exit(1); });
  process.on("exit", () => restoreAll("exit"));
}

/**
 * PREFLIGHT: every mutation must still find its target, checked
 * BEFORE anything runs. Returns the entries whose target has moved.
 *
 * A SKIP used to be one line in the middle of a hundred, and the
 * standing rule — treat a SKIP as a failure — depended on somebody
 * reading it. On 2026-10-14 eleven mutations went stale in one commit,
 * because the sign-in logic moved to src/ and the seed rule moved into
 * the engine, and the run still ended "every mutation was caught". It
 * had caught eleven fewer things than it said.
 *
 * So a moved target is fatal, and fatal up front: a run that cannot
 * break what it claims to break has nothing to report.
 */
export function preflight(list = MUTATIONS) {
  return list.filter(([, file, find]) => !readFileSync(file, "utf8").includes(find));
}

export { MUTATIONS };

/** @returns the process exit code. Writes files; call it from a program, not a test. */
export async function main(argv = process.argv) {
  const repaired = recoverJournal();
  if (repaired.length) {
    console.log(`A PREVIOUS RUN DIED WITHOUT CLEANING UP. Restored before starting: ${repaired.join(", ")}\n`);
  }

  const stale = preflight();
  if (stale.length) {
    console.log(`${stale.length} MUTATION(S) POINT AT CODE THAT HAS MOVED — fix or drop each one:\n`);
    for (const [label, file] of stale) console.log(`  ${label}  (${file})`);
    console.log("\nNothing was run. A mutation that cannot break anything is not evidence.");
    return 1;
  }

  // --preflight-only answers "is the catalog still pointed at real
  // code" and writes nothing at all. The question that started a
  // 338-mutation run by accident, now with an answer that takes a
  // second and cannot leave a file changed.
  if (argv.includes("--preflight-only")) {
    console.log(`PREFLIGHT OK — all ${MUTATIONS.length} mutations still find their target. Nothing was run, nothing was written.`);
    return 0;
  }

  // DIFF-SCOPED, and the default. `--changed <base>` keeps only the
  // mutations whose target file differs from `base` — the batch's own
  // blast radius — and a run with no argument is the full list, so a
  // release run is the plain command.
  //
  // A path is compared after resolving it, because an entry's file is
  // relative to mobile/ and git reports repo-relative paths.
  const arg = argv.indexOf("--changed");
  let selected = MUTATIONS;
  if (arg !== -1) {
    const base = argv[arg + 1];
    if (!base) { console.log("--changed needs a base, e.g. --changed origin/main"); return 1; }
    const out = execSync(`git -C .. diff --name-only ${base}`, { encoding: "utf8" });
    const changed = new Set(out.split("\n").filter(Boolean));
    const inDiff = (f) => {
      const abs = resolve(process.cwd(), f);
      const repo = relative(resolve(process.cwd(), ".."), abs);
      return changed.has(repo);
    };
    // NEWEST FIRST, and that is about the cap rather than about taste.
    // The list is append-ordered, so the entries written for the batch
    // being audited are at the END of it — and a run that hits the
    // thirty-minute cap stops where it is. Running in list order means
    // the cap cuts exactly the mutations that have never been proved,
    // and keeps the ones that have passed every run for a month. So a
    // scoped run walks it backwards. A full release run does not: it
    // has to finish anyway, and its order is the file's.
    selected = MUTATIONS.filter(([, file]) => inDiff(file)).reverse();
    console.log(`${selected.length} of ${MUTATIONS.length} mutations touch files changed since ${base}`);
    console.log("newest first, so the cap cuts the oldest rather than the newest\n");
    if (selected.length === 0) {
      console.log("Nothing to break. Either the batch changed no file a mutation points at —");
      console.log("which means the batch's new behavior has no mutation yet — or the base is wrong.");
      return 1;
    }
  }

  // ONE MUTATION BY NAME, for proving a single thing. `--only <text>`
  // keeps the entries whose label contains it — written the day the
  // crash rule changed, because "does this one mutation now score as
  // a kill" took a full shard to answer and should take two minutes.
  const onlyArg = argv.indexOf("--only");
  if (onlyArg !== -1) {
    const needle = (argv[onlyArg + 1] ?? "").toLowerCase();
    if (!needle) { console.log("--only needs some text from a mutation's label"); return 1; }
    selected = selected.filter(([label]) => label.toLowerCase().includes(needle));
    if (selected.length === 0) { console.log(`No mutation's label contains "${needle}".`); return 1; }
    console.log(`--only "${needle}": ${selected.length} mutation(s)\n`);
  }

  // ---- SHARDING, for the release run ----
  //
  // `--shard 2/6` keeps every sixth mutation starting at the second.
  // STRIDED AND NOT BLOCKED, so each shard gets a spread of the list
  // rather than one contiguous region: the catalog is grouped by
  // feature, so a block would put every slow renderer mutation in
  // one shard and finish five of them in an hour while the sixth
  // ran all afternoon.
  //
  // Each shard is a SEPARATE WORKTREE, because a mutation writes to
  // a file — six processes mutating one checkout would restore each
  // other's work and report nonsense. mutate_all.mjs sets that up.
  const shardArg = argv.indexOf("--shard");
  let shard = null;
  if (shardArg !== -1) {
    const m = /^(\d+)\/(\d+)$/.exec(argv[shardArg + 1] ?? "");
    if (!m) { console.log("--shard needs i/n, e.g. --shard 2/6"); return 1; }
    const [i, n] = [Number(m[1]), Number(m[2])];
    if (i < 1 || i > n) { console.log(`--shard ${i}/${n} is out of range`); return 1; }
    shard = { i, n };
    selected = selected.filter((_, idx) => idx % n === i - 1);
    console.log(`shard ${i} of ${n}: ${selected.length} mutations`);
  }

  armGuards();

  const killedBy = new Map();
  const survived = [];

  // THE CAP. A run that outlives the reason for it gets stopped and
  // says where it got to; a partial number that arrives is worth more
  // than a complete one nobody waited for.
  //
  // `--cap <minutes>` RAISES IT, and exists for one caller: the
  // sharded release run in mutate_all.mjs, where the whole point is
  // to finish. Thirty minutes stays the default because the thing it
  // protects — a per-batch run nobody is waiting on — is the common
  // case, and a release run is deliberate enough to say so.
  const capArg = argv.indexOf("--cap");
  const CAP_MS = (capArg !== -1 ? Number(argv[capArg + 1]) || 30 : 30) * 60 * 1000;
  const startedAt = Date.now();
  let cappedAfter = null;

  for (const [label, file, find, repl, drive] of selected) {
    if (Date.now() - startedAt > CAP_MS) { cappedAfter = label; break; }
    const orig = readFileSync(file, "utf8");
    let out = "";
    let harness = { failed: [] };
    // THE RESTORE IS IN A `finally`, not after the run. A jest
    // invocation that threw something the old `execSync` call did not
    // wrap, or a harness that blew up, used to skip the restore and
    // leave the file broken for every mutation after it — which reads
    // as "everything from here on was caught".
    try {
      applyMutation(file, orig, find, repl);
      out = (await capture("npx jest --verbose 2>&1")).out;
      // The OTHER suite. `lib/` is imported by the plain-node harness as well
      // as by the renderer, and a mutation this file can only reach through
      // logic would otherwise be reported as surviving while a test in
      // tests/signin.test.mjs was failing loudly one directory up.
      // "Can anything kill these tests" has to mean anything.
      harness = await runNodeHarness();
      // AND A BROWSER DRIVE, for the mutations nothing else can
      // reach. React closure identity, a real document load and a
      // button are not testable from a harness — "Use bank balance
      // never re-read anything" shipped to production precisely
      // because of that. A drive costs forty seconds, so it is
      // named per mutation rather than run for all 400 of them, and
      // only when the cheap suites found nothing: a mutation
      // already caught does not need a second opinion.
      if (drive && !harness.crashed && harness.failed.length === 0) {
        const jestFound = /^\s*✕ /m.test(out);
        if (!jestFound) {
          const { out: d, ok } = await capture(`node scripts/${drive}.mjs 2>&1`, REPO_ROOT);
          const bad = [...d.matchAll(/^FAIL  (.+)$/gm)].map((m) => `${drive}: ${m[1].trim()}`);
          if (bad.length) harness = { failed: bad };
          else if (!ok) harness = { failed: [], crashed: { cmd: `node scripts/${drive}.mjs`, name: `scripts/${drive}.mjs`, out: d } };
        }
      }
    } finally {
      restoreAll(`"${label}"`, false);
    }
    // WITH THE FILE PUT BACK, and only now, a crash can be told from
    // a broken harness. See decideCrash.
    if (harness.crashed) harness = await decideCrash(harness.crashed);
    if (harness.broken) {
      console.log(`\n${harness.broken} DID NOT RUN — it exited non-zero without naming a failed check.`);
      console.log("That is a broken harness, not a caught mutation, and counting it as one");
      console.log(`would hand a free kill to every mutation left. Stopping at "${label}".\n`);
      console.log(harness.out.split("\n").slice(-12).join("\n"));
      return 1;
    }
    // AND THEN CHECK, because a restore that silently did not happen
    // is the failure this whole section exists to prevent.
    if (readFileSync(file, "utf8") !== orig) {
      console.log(`\n${file} IS STILL MUTATED AFTER THE RESTORE. Stopping — run \`git diff\` before anything else.`);
      return 1;
    }

    // LINE-ANCHORED, which it was not. jest prints a failure as
    // `  ✕ name (12 ms)` — but one of this project's own tests is
    // CALLED "the ✕ removes a bill row, and the rest close up", so
    // an unanchored `✕ (.+?) \(` matched the ✕ inside a PASSING
    // test's name and reported a kill on every single run since that
    // test was written. The name it invented never matched the
    // baseline's, either, so the same test was simultaneously
    // credited with every kill and listed as unverified.
    const dead = [...out.matchAll(/^\s*✕ (.+?)(?: \(\d+ ms\))?$/gm)].map((m) => m[1].trim());
    dead.push(...harness.failed);
    for (const d of dead) killedBy.set(d, (killedBy.get(d) ?? 0) + 1);
    if (dead.length === 0) { survived.push(label); console.log(`SURVIVED  ${label}`); }
    else console.log(`killed ${String(dead.length).padStart(2)}  ${label}`);
  }

  // A PARTIAL RUN MUST NOT ANSWER THE SECOND QUESTION, and getting this
  // wrong would be the worst thing in the file. "Which tests can nothing
  // kill" is computed by diffing every test name against the ones that
  // died — which is only meaningful if every mutation ran. A scoped or
  // capped run would list almost the whole suite as unverified, and a
  // report that cries wolf is a report nobody reads.
  const partial = selected.length !== MUTATIONS.length || cappedAfter != null;

  // ONE LINE A MERGER CAN READ. mutate_all.mjs runs six of these and
  // has to add them up; parsing the prose below would be a second
  // implementation of the report.
  if (shard) {
    console.log(`SHARD-RESULT ${JSON.stringify({
      shard: `${shard.i}/${shard.n}`, ran: selected.length - (cappedAfter ? 1 : 0),
      survived, capped: cappedAfter, killedBy: [...killedBy],
    })}`);
  }

  console.log("\nkilled, with how many mutations each test caught:");
  for (const [t, n] of [...killedBy].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${String(n).padStart(2)}x  ${t}`);
  }

  let neverKilled = [];
  if (partial) {
    console.log(`\n${selected.length} of ${MUTATIONS.length} mutations ran, so "which tests can nothing kill"`);
    console.log("is not answered here — that needs the full list. Run it before external testers.");
  } else {
    // THE OTHER DIRECTION, and the more useful one: a test that nothing
    // can kill. Every name in the suite, diffed against the ones that died.
    const { out: baseline } = await capture("npx jest --verbose 2>&1");
    const allTests = [...baseline.matchAll(/[✓✕] (.+?)(?: \(\d+ ms\))?$/gm)].map((m) => m[1].trim());
    neverKilled = allTests.filter((t) => !killedBy.has(t));
    if (neverKilled.length) {
      console.log("\nNO MUTATION KILLED THESE — each is unverified until one is written:");
      neverKilled.forEach((t) => console.log(`  ${t}`));
    } else {
      console.log(`\nAll ${allTests.length} tests die to at least one mutation.`);
    }
  }

  if (cappedAfter) {
    const reached = selected.findIndex(([l]) => l === cappedAfter);
    console.log(`\nSTOPPED AT THE 30-MINUTE CAP after ${reached} of ${selected.length}.`);
    console.log(`The next one would have been: ${cappedAfter}`);
  }
  console.log(survived.length ? `\n${survived.length} MUTATION(S) SURVIVED` : "\nEvery mutation that ran was caught.");
  return survived.length === 0 && neverKilled.length === 0 ? 0 : 1;
}

// THE ONE SIDE EFFECT, and it is guarded. `process.argv[1]` is the
// script node was asked to run; when that is this file, run. When
// this file was imported by something else, define and stop.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
