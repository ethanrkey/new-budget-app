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
// Measured 2026-10-15: 136 mutations, 136 killed, 127 renderer tests.
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
  ["sign-in creates an account for a typo", "components/SignIn.tsx",
   "options: { shouldCreateUser: false },", "options: { shouldCreateUser: true },"],
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
  ["a prefilled due day cannot be retyped, because maxLength swallows the key",
   "components/Setup.tsx",
   "        keyboardType=\"number-pad\"\n        selectTextOnFocus",
   "        keyboardType=\"number-pad\""],
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
  ["a contribution is named after nothing", "../src/engine/setup.ts",
   'return a.group === "debt" ? `${a.name} payment` : `To ${a.name}`;', "return a.name;"],
  ["a contribution lands in the wrong category", "../src/engine/setup.ts",
   "    id: uid(), name: contributionName(a), amount: c.amount, category: categoryId,",
   '    id: uid(), name: contributionName(a), amount: c.amount, category: "bill",'],
  ["Skip on the contributions step keeps what was typed", "components/Setup.tsx",
   '    if (step === "contributions" && !keep) set("contributions", {});', "    // mutated"],
  ["the payment day is asked for every cadence", "components/Setup.tsx",
   '                        {row.cadence === "monthly" && (', "                        {true && ("],

  ["TOTAL OUT loses the tint that separates it from the rows above",
   "app/(tabs)/budget.tsx",
   "tone: T.expense, bold: true, fill: T.tintOut, rule: true",
   "tone: T.expense, bold: true, rule: true"],
  ["the totals lose the rule above them", "app/(tabs)/budget.tsx",
   "                  r.rule && styles.ruleAbove,\n                ]}",
   "                ]}"],
  ["the rule is drawn in the hairline's own color, which is not a rule",
   "lib/theme.ts", '  rule: "#374151",', '  rule: "#1f2937",'],

  ["a flick down no longer dismisses the sheet", "components/BottomSheet.tsx",
   "      if (go) close.current();", "      // mutated"],
  ["any nudge dismisses the sheet, including an upward one",
   "components/BottomSheet.tsx",
   "      const go = g.dy > DISMISS_PX || g.vy > DISMISS_VELOCITY;", "      const go = true;"],
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

for (const [label, file, find, repl] of MUTATIONS) {
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
