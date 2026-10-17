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
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { SUITES } from "../../scripts/suites.mjs";

// Every plain-node suite, from the one list — see scripts/suites.mjs
// for what went wrong when there were two.
const NODE_SUITES = SUITES;

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
   'onSubmit={() => onSaveDraft(draft)}', 'onSubmit={() => onSaveDraft(blankDraft())}'],
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
   "    income: items.some((i) => directionOf(i.category) === \"in\"),",
   "    income: false,"],
  ["dismissing the guide does nothing", "lib/firstRun.ts",
   "  return !dismissed && stepsRemaining(state) > 0;", "  return stepsRemaining(state) > 0;"],
  ["a done step keeps its button, reading as do-it-again", "components/FirstRun.tsx",
   "          {!done[step.key] && (", "          {true && ("],
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
   "onPress={() => setI(i - 1)}",
   "onPress={() => { setD(blankSetupDraft(todayISO)); setI(i - 1); }}"],
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
   "<AnchorStrip onPress={() => setLogging(true)} />", "<AnchorStrip />"],
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
   "      <Text style={styles.asOf}>as of {fmtDate(account.balanceAsOf)}</Text>",
   "      <Text />"],

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
  ["the checking bar says \"verified\" again", "components/AnchorStrip.tsx",
   "      <Text style={styles.asOf}>as of {fmtDate(account.balanceAsOf)}</Text>",
   "      <Text style={styles.asOf}>verified {fmtDate(account.balanceAsOf)}</Text>"],
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
   "              onPress={() => (last ? leave() : go(i + 1))}",
   "              onPress={() => (last ? onClose() : go(i + 1))}"],
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
   "    body: \"Everything you have and everything you owe, on one screen: checking, savings, investments and debt, and what they come to together. Nothing here is projected — it's what's true today, built only from balances you've logged. Log them again whenever and over time the Dashboard screen will show you how these balances have been trending.\",",
   "    body: \"Not a forecast: what's actually true right now. Your net position, your checking balance, and each account's balance as you log it.\","],

  // Written AFTER the first build 10 run, which reported three tests
  // nothing could kill. All three were written that day, and all
  // three gaps were real: nothing moved the tour's ROUTES, nothing
  // hid the ✕ at one row, and the Dashboard-body entry above was
  // breaking the parser rather than the copy.
  ["the tour stops routing to the tab each card is about",
   "components/Tour.tsx",
   "  const go = (next: number) => {\n    setI(next);\n    router.replace(ROUTE[TOUR_STOPS[next]!.tab]! as never);\n  };",
   "  const go = (next: number) => {\n    setI(next);\n  };"],
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
   "    const dim = date < anchor || date > horizon;",
   "    const dim = date > horizon;"],
  ["the forecast is drawn past the end of the Ledger window",
   "../src/engine/calendar.ts",
   "    const dim = date < anchor || date > horizon;",
   "    const dim = date < anchor;"],
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
   "      busy: byDate.has(date),", "      busy: (byDate.get(date)?.length ?? 0) > 1,"],
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

// PREFLIGHT: every mutation must still find its target, checked BEFORE
// anything runs.
//
// A SKIP used to be one line in the middle of a hundred, and the
// standing rule — treat a SKIP as a failure — depended on somebody
// reading it. On 2026-10-14 eleven mutations went stale in one commit,
// because the sign-in logic moved to src/ and the seed rule moved into
// the engine, and the run still ended "every mutation was caught". It
// had caught eleven fewer things than it said.
//
// So a moved target is fatal, and fatal up front: a run that cannot
// break what it claims to break has nothing to report.
const stale = MUTATIONS.filter(([, file, find]) => !readFileSync(file, "utf8").includes(find));
if (stale.length) {
  console.log(`${stale.length} MUTATION(S) POINT AT CODE THAT HAS MOVED — fix or drop each one:\n`);
  for (const [label, file] of stale) console.log(`  ${label}  (${file})`);
  console.log("\nNothing was run. A mutation that cannot break anything is not evidence.");
  process.exit(1);
}

// DIFF-SCOPED, and the default. `--changed <base>` keeps only the
// mutations whose target file differs from `base` — the batch's own
// blast radius — and `--all` is the full list. A run with no argument
// is the full list too, so a release run is the plain command.
//
// A path is compared after resolving it, because an entry's file is
// relative to mobile/ and git reports repo-relative paths.
const arg = process.argv.indexOf("--changed");
let selected = MUTATIONS;
if (arg !== -1) {
  const base = process.argv[arg + 1];
  if (!base) { console.log("--changed needs a base, e.g. --changed origin/main"); process.exit(1); }
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
    process.exit(1);
  }
}

// THE CAP. A run that outlives the reason for it gets stopped and
// says where it got to; a partial number that arrives is worth more
// than a complete one nobody waited for.
const CAP_MS = 30 * 60 * 1000;
const startedAt = Date.now();
let cappedAfter = null;

for (const [label, file, find, repl] of selected) {
  if (Date.now() - startedAt > CAP_MS) { cappedAfter = label; break; }
  const orig = readFileSync(file, "utf8");
  writeFileSync(file, orig.replace(find, repl));
  let out = "";
  try { out = execSync("npx jest --verbose 2>&1", { encoding: "utf8" }); }
  catch (e) { out = e.stdout || ""; }
  // The OTHER suite. `lib/` is imported by the plain-node harness as well
  // as by the renderer, and a mutation this file can only reach through
  // logic would otherwise be reported as surviving while a test in
  // tests/signin.test.mjs was failing loudly one directory up.
  // "Can anything kill these tests" has to mean anything.
  const node = runNodeHarness();
  writeFileSync(file, orig);          // always restore, pass or fail

  const dead = [...out.matchAll(/\u2715 (.+?) \(/g)].map((m) => m[1]);
  dead.push(...node);
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
  let baseline = "";
  try { baseline = execSync("npx jest --verbose 2>&1", { encoding: "utf8" }); }
  catch (e) { baseline = e.stdout || ""; }
  const allTests = [...baseline.matchAll(/[\u2713\u2715] (.+?)(?: \(\d+ ms\))?$/gm)].map((m) => m[1].trim());
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
process.exit(survived.length === 0 && neverKilled.length === 0 ? 0 : 1);
