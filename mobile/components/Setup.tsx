import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DatePicker from "./DatePicker";
import type { NativeMethods } from "react-native";
import { T } from "../lib/theme";
import {
  blankSetupDraft, rulesForStep, canAdvance, accountRowErrors, setupAnswers,
  scrollToReveal, stepsFor, contributionRowAt, type SetupDraft, type SetupStepKey,
} from "../lib/setup";
import {
  SETUP_COPY as COPY, CADENCE_OPTIONS, ACCOUNT_GROUPS, WEEKDAY_OPTIONS,
} from "../../src/content/setup.ts";
import { emptyBillRow, contributionTargets } from "../../src/engine/setup.ts";
import { fmtDate } from "../../src/shared/dates.ts";
import type { SetupAnswers, SetupCadence } from "../../src/engine/setup.ts";
import type { BudgetItem } from "../../src/engine/types.ts";

// The phone's setup, at parity with the web's — six questions, same
// order, same output.
//
// WHY THIS EXISTS, given that the phone already has the three-step
// guide. Most App Store users will never open the web app, so the
// phone's setup cannot be the lesser version; that is the user's
// reasoning and it overrides an earlier call for a signpost instead of
// a wizard. The guide is still right for someone who skips this, and
// it is what Skip lands on — see lib/setup.ts and the Ledger screen.
//
// THE ANSWER TO DRIFT IS SHARED LOGIC, NOT A SHARED SCREEN. Every word
// comes from src/content/setup.ts and every rule from
// src/engine/setup.ts, both of which the web calls too. What is below
// is arrangement: a phone-shaped sequence of the same six questions,
// with a footer you can reach with a thumb and a keyboard that does
// not cover the field being typed into.
//
// WHAT A PHONE FLOW HAS THAT THE WEB'S DOES NOT: Back. A wizard on a
// 390pt screen shows one question at a time, so a typo two steps ago
// is unreachable without it — which is why the whole draft is held at
// once rather than committed step by step.
// WHAT THE KEYBOARD HIDES, AND WHO PUTS IT BACK.
//
// Reported from a device on the paycheck step: amount, frequency, and
// then the payday control is below the fold with the number pad up and
// nothing says it is there. "I tried to tap it, couldn't, then
// realized I had to scroll."
//
// So every focusable thing on every step reports itself here when it
// takes focus, and the step scrolls it clear. The arithmetic is
// scrollToReveal in lib/setup.ts, where it can be checked without a
// phone; this is only the plumbing that measures and calls it.
//
// `measureLayout` is guarded because it does not exist under the test
// renderer — a field that cannot be measured simply is not scrolled,
// which is what happened before any of this.
type Measurable = { measureLayout?: NativeMethods["measureLayout"] };
const RevealCtx = createContext<(node: Measurable | null) => void>(() => {});
const useReveal = () => useContext(RevealCtx);

export default function Setup({
  busy, onComplete, onSkip,
}: {
  busy: boolean;
  /** Finished: everything typed, in the shape applySetup takes. */
  onComplete: (answers: SetupAnswers) => void;
  /** Left early. The guide picks up from wherever this stopped. */
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [i, setI] = useState(0);
  // The step LIST, not the constant: the contributions step is only
  // shown when the accounts step produced something to ask about.
  // It is last, so a list that grows while somebody types on the
  // accounts step never moves the step they are on.
  const [pickingPayday, setPickingPayday] = useState(false);
  const [d, setD] = useState<SetupDraft>(() => blankSetupDraft(todayISO));
  // Rules collected by the steps already passed. Keyed by step so going
  // BACK and forward again replaces that step's rules instead of
  // adding a second paycheck — the bug a Back button creates for free.
  const [collected, setCollected] = useState<Partial<Record<SetupStepKey, BudgetItem[]>>>({});
  const [done, setDone] = useState(false);

  // The scroll window: where it sits and how tall it is once the
  // keyboard has taken its share. Both are refs rather than state —
  // nothing renders differently because of them, and a setState on
  // every scroll frame would re-render the whole wizard.
  const scroll = useRef<ScrollView>(null);
  const payday = useRef<View>(null);
  const content = useRef<View>(null);
  const window = useRef({ offset: 0, height: 0 });

  const reveal = useCallback((node: Measurable | null) => {
    if (!node?.measureLayout || !content.current) return;
    node.measureLayout(content.current, (_x, y, _w, height) => {
      const to = scrollToReveal({ y, height }, window.current);
      if (to != null) scroll.current?.scrollTo({ y: to, animated: true });
    }, () => {});
  }, []);

  const STEPS = stepsFor(d);
  const step = STEPS[i]!;
  const set = <K extends keyof SetupDraft>(k: K, v: SetupDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const rules = STEPS.flatMap((s) => collected[s] ?? []);
  const contributing = contributionTargets(d.accounts);
  const last = i === STEPS.length - 1;
  const rowErrors = accountRowErrors(d);

  function advance(keep: boolean) {
    // Continue keeps what this step built; Skip keeps nothing. One
    // line, because the builders already decided what a blank field
    // means — see src/engine/setup.ts.
    setCollected((c) => ({ ...c, [step]: keep ? rulesForStep(step, d, todayISO) : [] }));
    // The contributions step's answers are read off the draft at the
    // end rather than committed when the step is passed, so Skip has
    // to clear them — otherwise it would quietly keep what was typed,
    // which is the one thing Skip must never do.
    if (step === "contributions" && !keep) set("contributions", {});
    if (last) setDone(true);
    else setI(i + 1);
  }

  return (
    <RevealCtx.Provider value={reveal}>
    <Modal visible animationType="slide" onRequestClose={onSkip} transparent={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.wrap, { paddingTop: insets.top + 8 }]}
      >
        {done ? (
          <Done count={rules.length} busy={busy} onGo={() => onComplete(setupAnswers(rules, d))} />
        ) : (
          <>
            {/* The progress bar is a count AND a bar. A bar alone on a
                phone reads as "loading"; the number says how much of
                somebody's evening this is going to be. */}
            <View style={styles.head}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${((i + 1) / STEPS.length) * 100}%` }]} />
              </View>
              <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" accessibilityLabel={COPY.buttons.skipAll}>
                <Text style={styles.skipAll}>{COPY.buttons.skipAll}</Text>
              </Pressable>
            </View>
            <Text style={styles.count}>Step {i + 1} of {STEPS.length}</Text>

            <ScrollView
              ref={scroll}
              testID="setup-scroll"
              keyboardShouldPersistTaps="handled"
              // Flick the keyboard away by dragging the content, which
              // is how every other iOS form behaves.
              keyboardDismissMode="interactive"
              // Belt and braces for the KeyboardAvoidingView above: if
              // the padding under-compensates, the inset still lets the
              // content scroll past the keyboard instead of ending at it.
              automaticallyAdjustKeyboardInsets
              scrollEventThrottle={16}
              onScroll={(e) => { window.current.offset = e.nativeEvent.contentOffset.y; }}
              onLayout={(e) => { window.current.height = e.nativeEvent.layout.height; }}
            >
              <View ref={content} style={styles.body}>
              {step === "paycheck" && (
                <Question title={COPY.paycheck.title} sub={COPY.paycheck.sub}>
                  <Money label={COPY.labels.amount} value={d.payAmount} onChange={(v) => set("payAmount", v)} autoFocus />
                  <Cadence label={COPY.labels.cadence} value={d.payCadence} onChange={(v) => set("payCadence", v)} />

                  {/* ASKED, NOT ASSUMED — see src/content/setup.ts.
                      A date that has gone cannot be chosen: the picker
                      is clamped to today and paycheckRule clamps
                      again, because two guards on the one number the
                      whole forecast counts forward from is cheap. */}
                  <Text style={styles.label}>{COPY.paycheck.paydayLabel}</Text>
                  <Pressable
                    ref={payday}
                    style={[styles.input, styles.pickRow]}
                    onPress={() => { Keyboard.dismiss(); reveal(payday.current); setPickingPayday(true); }}
                    accessibilityRole="button"
                    accessibilityLabel={`${COPY.paycheck.paydayLabel} ${fmtDate(d.payday)}. Change the date.`}
                  >
                    {/* It LOOKS like a control now. A date in a box that
                        is the same shape as the text fields above it
                        reads as something already filled in, which is
                        half of why it was not tapped. */}
                    <Text style={styles.inputText}>{fmtDate(d.payday)}</Text>
                    <Text style={styles.pickCue}>Change ›</Text>
                  </Pressable>
                  <Text style={styles.note}>{COPY.paycheck.paydayHelp}</Text>
                  {pickingPayday && (
                    <DatePicker
                      value={d.payday}
                      minimum={todayISO}
                      onPick={(v) => set("payday", v < todayISO ? todayISO : v)}
                      onClose={() => setPickingPayday(false)}
                    />
                  )}
                  {/* The one string that differs between clients, and it
                      differs because the control it names does. */}
                  <Text style={styles.note}>{COPY.paycheck.note.mobile}</Text>
                </Question>
              )}

              {step === "rent" && (
                <Question title={COPY.rent.title} sub={COPY.rent.sub}>
                  <Money label={COPY.labels.amount} value={d.rentAmount} onChange={(v) => set("rentAmount", v)} autoFocus />
                  <Day label={COPY.labels.dueDay} value={d.rentDay} onChange={(v) => set("rentDay", v)} />
                </Question>
              )}

              {step === "bills" && (
                <Question title={COPY.bills.title} sub={COPY.bills.sub}>
                  {d.bills.map((b, idx) => (
                    <View key={idx} style={styles.billRow}>
                      <View style={styles.grow}>
                        <Field
                          label={COPY.labels.name}
                          placeholder="e.g. Spotify"
                          value={b.name}
                          onChange={(v) => set("bills", d.bills.map((r, j) => (j === idx ? { ...r, name: v } : r)))}
                          accessibilityLabel={`Bill ${idx + 1} name`}
                        />
                      </View>
                      <View style={styles.amountCol}>
                        <Money
                          label={COPY.labels.amount}
                          value={b.amount}
                          onChange={(v) => set("bills", d.bills.map((r, j) => (j === idx ? { ...r, amount: v } : r)))}
                          accessibilityLabel={`Bill ${idx + 1} amount`}
                        />
                      </View>
                      <View style={styles.dayCol}>
                        <Day
                          label={COPY.labels.dueDayShort}
                          value={b.day}
                          onChange={(v) => set("bills", d.bills.map((r, j) => (j === idx ? { ...r, day: v } : r)))}
                          accessibilityLabel={`Bill ${idx + 1} due day`}
                        />
                      </View>
                    </View>
                  ))}
                  <Pressable
                    onPress={() => set("bills", [...d.bills, emptyBillRow(todayISO)])}
                    accessibilityRole="button" accessibilityLabel={COPY.bills.add} hitSlop={8}
                  >
                    <Text style={styles.addMore}>{COPY.bills.add}</Text>
                  </Pressable>
                </Question>
              )}

              {step === "groceries" && (
                <Question title={COPY.groceries.title} sub={COPY.groceries.sub}>
                  <Money label={COPY.labels.amount} value={d.groceryAmount} onChange={(v) => set("groceryAmount", v)} autoFocus />
                  <Cadence label={COPY.labels.cadence} value={d.groceryCadence} onChange={(v) => set("groceryCadence", v)} />
                  {/* A DAY OF THE WEEK, not a date — see groceryRule.
                      Seven chips share one row, so they are short and
                      the full name is what a screen reader says. */}
                  <Weekday label={COPY.groceries.dayLabel} value={d.groceryDay} onChange={(v) => set("groceryDay", v)} />
                </Question>
              )}

              {step === "balance" && (
                <Question title={COPY.balance.title} sub={COPY.balance.sub}>
                  <Money label={COPY.labels.currentBalance} value={d.balance} onChange={(v) => set("balance", v)} autoFocus />
                  {/* No Skip on this step, so the reason is on screen
                      rather than implied by a dead button. */}
                  {!canAdvance("balance", d) && <Text style={styles.why}>{COPY.balance.why}</Text>}
                </Question>
              )}

              {step === "accounts" && (
                <Question title={COPY.accounts.title} sub={COPY.accounts.sub}>
                  {ACCOUNT_GROUPS.map((g) => (
                    <View key={g.key} style={styles.group}>
                      <Text style={styles.groupLabel}>{g.label}</Text>
                      <Text style={styles.groupNote}>{g.kindNote}</Text>
                      {d.accounts[g.key].map((row, idx) => {
                        const err = rowErrors[`${g.key}:${idx}`];
                        const setRow = (field: "name" | "amount", v: string) =>
                          set("accounts", {
                            ...d.accounts,
                            [g.key]: d.accounts[g.key].map((r, j) => (j === idx ? { ...r, [field]: v } : r)),
                          });
                        return (
                          <View key={idx} style={styles.acctRow}>
                            <View style={styles.row}>
                              {/* BOTH fields are labeled. Two anonymous
                                  boxes under a heading is what made a
                                  real user type the amount and leave
                                  the name blank. */}
                              <View style={styles.grow}>
                                <Field
                                  label={COPY.labels.name}
                                  placeholder={g.placeholder}
                                  value={row.name}
                                  onChange={(v) => setRow("name", v)}
                                  bad={err === "name"}
                                  accessibilityLabel={`${g.label} ${idx + 1} name`}
                                />
                              </View>
                              <View style={styles.amountCol}>
                                <Money
                                  label={g.key === "debt" ? COPY.labels.owedNow : COPY.labels.balance}
                                  value={row.amount}
                                  onChange={(v) => setRow("amount", v)}
                                  bad={err === "amount"}
                                  accessibilityLabel={`${g.label} ${idx + 1} amount`}
                                />
                              </View>
                            </View>
                            {err && (
                              <Text style={styles.rowErr}>
                                {err === "name" ? COPY.accounts.needsName : COPY.accounts.needsAmount}
                              </Text>
                            )}
                          </View>
                        );
                      })}
                      <Pressable
                        onPress={() => set("accounts", { ...d.accounts, [g.key]: [...d.accounts[g.key], { name: "", amount: "" }] })}
                        accessibilityRole="button" accessibilityLabel={`${COPY.accounts.add} ${g.label.toLowerCase()}`} hitSlop={8}
                      >
                        <Text style={styles.addMore}>{COPY.accounts.add}</Text>
                      </Pressable>
                    </View>
                  ))}
                </Question>
              )}
              {step === "contributions" && (
                <Question title={COPY.contributions.title} sub={COPY.contributions.sub}>
                  {contributing.map(({ key, account }) => {
                    const row = contributionRowAt(d, key, todayISO);
                    const setRow = (patch: Partial<typeof row>) =>
                      set("contributions", { ...d.contributions, [key]: { ...row, ...patch } });
                    return (
                      <View key={key} style={styles.group}>
                        <Text style={styles.groupLabel}>{account.name}</Text>
                        <Money
                          label={account.group === "debt"
                            ? COPY.contributions.owedFor(account.name)
                            : COPY.contributions.amountFor(account.name)}
                          value={row.amount}
                          onChange={(v) => setRow({ amount: v })}
                          accessibilityLabel={`${account.name} contribution amount`}
                        />
                        <Cadence
                          label={COPY.labels.cadence}
                          value={row.cadence}
                          onChange={(v) => setRow({ cadence: v })}
                        />
                        {/* Only monthly has a day. A weekly transfer on
                            "the 14th" is not a thing, and a field that
                            cannot mean anything is a field people
                            answer anyway. */}
                        {row.cadence === "monthly" && (
                          <Day
                            label={COPY.contributions.dayLabel}
                            value={row.day}
                            onChange={(v) => setRow({ day: v })}
                            accessibilityLabel={`${account.name} payment day`}
                          />
                        )}
                      </View>
                    );
                  })}
                </Question>
              )}
              </View>
            </ScrollView>

            {/* The footer is fixed and inside the safe area, so the
                thing you press is never under the home indicator and
                never scrolls away under a long accounts step. */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
              {i > 0 && (
                <Pressable
                  style={[styles.btn, styles.ghost]}
                  onPress={() => setI(i - 1)}
                  accessibilityRole="button" accessibilityLabel="Back"
                >
                  <Text style={styles.ghostText}>Back</Text>
                </Pressable>
              )}
              {/* The balance step has no Skip, deliberately: every other
                  question is optional and this one cannot be. */}
              {step !== "balance" && (
                <Pressable
                  style={[styles.btn, styles.ghost]}
                  onPress={() => advance(false)}
                  accessibilityRole="button" accessibilityLabel={COPY.buttons.skip}
                >
                  <Text style={styles.ghostText}>{COPY.buttons.skip}</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.btn, styles.primary, !canAdvance(step, d) && styles.off]}
                disabled={!canAdvance(step, d)}
                onPress={() => advance(true)}
                accessibilityRole="button"
                // The LAST step, not a named one: whether that is
                // accounts or contributions depends on whether there
                // was anything to ask about.
                accessibilityLabel={last ? COPY.buttons.finish : COPY.buttons.continue}
              >
                <Text style={styles.primaryText}>
                  {last ? COPY.buttons.finish : COPY.buttons.continue}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
    </RevealCtx.Provider>
  );
}

function Done({ count, busy, onGo }: { count: number; busy: boolean; onGo: () => void }) {
  return (
    <View style={styles.done}>
      <Text style={styles.doneTitle}>{COPY.done.title}</Text>
      <Text style={styles.doneBody}>
        {count > 0 ? COPY.done.withRules(count) : COPY.done.withoutRules}
      </Text>
      <Pressable
        style={[styles.btn, styles.primary, styles.wide, busy && styles.off]}
        disabled={busy}
        onPress={onGo}
        accessibilityRole="button" accessibilityLabel={COPY.done.cta}
      >
        {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{COPY.done.cta}</Text>}
      </Pressable>
    </View>
  );
}

function Question({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <View style={styles.q}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
      {children}
    </View>
  );
}

function Field({
  label, value, onChange, placeholder, bad, accessibilityLabel, autoFocus,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; bad?: boolean; accessibilityLabel?: string; autoFocus?: boolean;
}) {
  const reveal = useReveal();
  const box = useRef<TextInput>(null);
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={box}
        style={[styles.input, bad && styles.inputBad]}
        value={value}
        onChangeText={onChange}
        onFocus={() => reveal(box.current)}
        placeholder={placeholder}
        placeholderTextColor={T.faint}
        accessibilityLabel={accessibilityLabel ?? label}
        autoFocus={autoFocus}
      />
    </>
  );
}

function Money(p: Omit<Parameters<typeof Field>[0], "placeholder">) {
  const reveal = useReveal();
  const box = useRef<TextInput>(null);
  return (
    <>
      <Text style={styles.label}>{p.label}</Text>
      <TextInput
        ref={box}
        style={[styles.input, p.bad && styles.inputBad]}
        value={p.value}
        onChangeText={p.onChange}
        onFocus={() => reveal(box.current)}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={T.faint}
        accessibilityLabel={p.accessibilityLabel ?? p.label}
        autoFocus={p.autoFocus}
      />
    </>
  );
}

// `selectTextOnFocus` IS NOT POLISH. The field arrives holding two
// digits and `maxLength` is 2, so tapping it and pressing a number does
// NOTHING — the keypress is silently swallowed and the only way to
// change the day is to notice that you have to delete first. Selecting
// the value on focus makes one tap and one digit enough, which is what
// a prefilled two-character field has to do.
function Day(p: Omit<Parameters<typeof Field>[0], "placeholder">) {
  const reveal = useReveal();
  const box = useRef<TextInput>(null);
  return (
    <>
      <Text style={styles.label}>{p.label}</Text>
      <TextInput
        ref={box}
        style={styles.input}
        value={p.value}
        onChangeText={p.onChange}
        onFocus={() => reveal(box.current)}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={2}
        placeholderTextColor={T.faint}
        accessibilityLabel={p.accessibilityLabel ?? p.label}
      />
    </>
  );
}

// Three chips, not a picker. A three-option iOS picker is two taps and
// a spinner to see what a row of chips says at a glance — the same call
// CategorySheet made for its kind picker.
function Cadence({
  label, value, onChange,
}: { label: string; value: SetupCadence; onChange: (v: SetupCadence) => void }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {CADENCE_OPTIONS.map((c) => {
          const on = c.value === value;
          return (
            <Pressable
              key={c.value}
              style={[styles.chip, on && styles.chipOn]}
              // PICKING A FREQUENCY PUTS THE KEYBOARD AWAY. It is the
              // step's last typed answer, and on the paycheck step the
              // payday control lives directly underneath — which is
              // exactly where the number pad was, and why somebody
              // tried to tap a date they could not see.
              onPress={() => { Keyboard.dismiss(); onChange(c.value); }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c.label}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

// Seven chips on one row at 390px: 6pt gaps, so each is about 46pt
// wide — above the 44pt target, and the reason the labels are three
// letters rather than the full name the screen reader gets.
function Weekday({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.days}>
        {WEEKDAY_OPTIONS.map((w) => {
          const on = w.value === value;
          return (
            <Pressable
              key={w.value}
              style={[styles.day, on && styles.chipOn]}
              onPress={() => { Keyboard.dismiss(); onChange(w.value); }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={w.full}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{w.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: T.surfaceAlt, overflow: "hidden" },
  fill: { height: 4, backgroundColor: T.brass },
  skipAll: { color: T.faint, fontSize: 13 },
  count: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, paddingHorizontal: 20, paddingTop: 10 },
  body: { padding: 20, paddingBottom: 40 },
  q: { gap: 2 },
  title: { color: T.text, fontSize: 22, fontWeight: "700", lineHeight: 29 },
  sub: { color: T.dim, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 6 },
  note: { color: T.faint, fontSize: 12, lineHeight: 17, marginTop: 14 },
  why: { color: T.faint, fontSize: 12, lineHeight: 17, marginTop: 12 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14 },
  input: {
    backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16,
    minHeight: 48, marginTop: 6,
  },
  inputBad: { borderColor: T.expense },
  inputText: { color: T.text, fontSize: 16 },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickCue: { color: T.brass, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 6, marginTop: 6 },
  days: { flexDirection: "row", gap: 4, marginTop: 6 },
  day: {
    flex: 1, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface,
    borderRadius: 10, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 2,
  },
  chip: {
    flex: 1, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface,
    borderRadius: 10, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  chipOn: { backgroundColor: T.text, borderColor: T.text },
  chipText: { color: T.dim, fontSize: 12, textAlign: "center" },
  chipTextOn: { color: T.bg, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  billRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  grow: { flex: 1 },
  amountCol: { width: 104 },
  dayCol: { width: 62 },
  acctRow: { marginTop: 2 },
  rowErr: { color: T.expense, fontSize: 12, marginTop: 6 },
  group: { marginTop: 22 },
  groupLabel: { color: T.text, fontSize: 15, fontWeight: "700" },
  groupNote: { color: T.faint, fontSize: 12, marginTop: 2 },
  addMore: { color: T.brass, fontSize: 13, marginTop: 12, minHeight: 32, lineHeight: 30 },
  footer: {
    flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.border, backgroundColor: T.bg,
  },
  btn: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  wide: { alignSelf: "stretch", flex: 0 },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  off: { opacity: 0.4 },
  done: { flex: 1, justifyContent: "center", padding: 28, gap: 14 },
  doneTitle: { color: T.text, fontSize: 24, fontWeight: "700", textAlign: "center" },
  doneBody: { color: T.dim, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 10 },
});
