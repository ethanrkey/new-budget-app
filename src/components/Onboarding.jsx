import { useState } from "react";
import { todayISO } from "../engine/model.ts";
import {
  paycheckRule, rentRule, billRules, groceryRule, balanceAnswer,
  blankAccountRows, incompleteAccountRows, collectAccounts,
} from "../engine/setup.ts";
import {
  SETUP_COPY as COPY, CADENCE_OPTIONS, ACCOUNT_GROUPS, SETUP_STEPS,
} from "../content/setup.ts";
import { useSubmitOnce } from "../useSubmitOnce.js";

// The questions. The WORDS are in src/content/setup.ts and the LOGIC is
// in src/engine/setup.ts, both shared with the phone's flow — what is
// left here is this client's arrangement of them, which is the only
// part that should differ. Moved out 2026-10-13, when the phone got the
// same six steps; before that a sentence or a rule edited here would
// have had to be found and matched by hand on the other side.
//
// Today's date, used for every generic bill. Shown, never hidden.
const defaultBillDay = new Date().getDate();

const STEPS = [...SETUP_STEPS, "done"];

// A short, skippable welcome wizard. Every answer becomes a real
// recurring rule via the same shape the CSV importers produce
// ({ recurring, oneoffs, checkInBalance }), so App.jsx can commit it through
// the exact same importCSV() path — no separate data pipeline to keep in sync.
export default function Onboarding({ initialBalance, onComplete }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [recurring, setRecurring] = useState([]);
  const [checkInBalance, setCheckInBalance] = useState(initialBalance ?? null);

  const [payAmount, setPayAmount] = useState("");
  const [payCadence, setPayCadence] = useState("biweekly");

  const [rentAmount, setRentAmount] = useState("");
  const [rentDay, setRentDay] = useState("1");

  const [bills, setBills] = useState([{ name: "", amount: "", day: String(defaultBillDay) }]);

  const [groceryAmount, setGroceryAmount] = useState("");
  const [groceryCadence, setGroceryCadence] = useState("weekly");

  const [balanceInput, setBalanceInput] = useState(initialBalance != null ? String(initialBalance) : "");
  const [accounts, setAccounts] = useState(blankAccountRows);
  const setAccountRow = (group, i, field, value) =>
    setAccounts((a) => ({ ...a, [group]: a[group].map((r, idx) => (idx === i ? { ...r, [field]: value } : r)) }));
  const addAccountRow = (group) =>
    setAccounts((a) => ({ ...a, [group]: [...a[group], { name: "", amount: "" }] }));
  const step = STEPS[stepIndex];
  const questionSteps = STEPS.length - 1; // exclude "done" from the progress count

  function addRule(rule) {
    setRecurring((r) => [...r, rule]);
  }
  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  const [finishNow] = useSubmitOnce(() => {
    // Read the FIELD, not just the committed state: the two can disagree
    // for a render, and this is the one value the entire forecast is built
    // from. It was silently dropped once already.
    const typed = balanceAnswer(balanceInput);
    const balance = typed != null ? typed : checkInBalance;
    onComplete({ recurring, oneoffs: [], checkInBalance: balance, accounts: collectAccounts(accounts) });
  })

  // Each step is one shared builder plus one line of this client's
  // wiring. Continue appends what the builder returned; Skip appends
  // nothing, which is what makes "Skip discards what was typed" true
  // without either client having to remember it.
  const addIf = (rule) => { if (rule) addRule(rule); };
  function submitPaycheck() {
    addIf(paycheckRule(payAmount, payCadence, todayISO()));
    goNext();
  }
  function submitRent() {
    addIf(rentRule(rentAmount, rentDay, todayISO()));
    goNext();
  }
  function submitBills() {
    for (const rule of billRules(bills, todayISO())) addRule(rule);
    goNext();
  }
  function submitGroceries() {
    addIf(groceryRule(groceryAmount, groceryCadence, todayISO()));
    goNext();
  }
  // The verified balance is the single value the whole forecast builds
  // from, so this step cannot be skipped or fumbled: finishing without it
  // leaves a new user's first ledger projecting from zero, which is what
  // happened for real. `finishNow` also re-reads the input rather than
  // trusting that setCheckInBalance has landed, so there is no path where
  // the number is on screen and not in the result.
  const balanceAmount = balanceAnswer(balanceInput);
  const balanceValid = balanceAmount != null;
  function submitBalance() {
    if (!balanceValid) return;
    setCheckInBalance(balanceAmount);
    goNext();
  }

  function updateBill(i, field, value) {
    setBills((bs) => bs.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)));
  }
  function addBillRow() {
    setBills((bs) => [...bs, { name: "", amount: "", day: String(defaultBillDay) }]);
  }
  function removeBillRow(i) {
    setBills((bs) => bs.filter((_, idx) => idx !== i));
  }

  const field = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    // No backdrop-click dismiss, deliberately — the only ways out are an
    // explicit button, so a stray click can't leave hasSeenOnboarding unset
    // and pop this right back up on the next unrelated state change.
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-gray-200 dark:border-gray-800">
        {step !== "done" && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mr-3">
              <div
                className="h-full bg-gray-900 dark:bg-white transition-all"
                style={{ width: `${((stepIndex + 1) / questionSteps) * 100}%` }}
              />
            </div>
            <button onClick={finishNow} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap">
              {COPY.buttons.skipAll}
            </button>
          </div>
        )}

        {step === "paycheck" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.paycheck.title}</h2>
            <p className="text-sm text-gray-500">{COPY.paycheck.sub}</p>
            <div>
              <label className={label}>{COPY.labels.amount}</label>
              <input className={field} type="number" placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <label className={label}>{COPY.labels.cadence}</label>
              <select className={field} value={payCadence} onChange={(e) => setPayCadence(e.target.value)}>
                {CADENCE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400">{COPY.paycheck.note.web}</p>
            <StepButtons onSkip={goNext} onContinue={submitPaycheck} />
          </div>
        )}

        {step === "rent" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.rent.title}</h2>
            <p className="text-sm text-gray-500">{COPY.rent.sub}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={label}>{COPY.labels.amount}</label>
                <input className={field} type="number" placeholder="0.00" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} autoFocus />
              </div>
              <div className="w-24">
                <label className={label}>{COPY.labels.dueDay}</label>
                <input className={field} type="number" min="1" max="31" value={rentDay} onChange={(e) => setRentDay(e.target.value)} />
              </div>
            </div>
            <StepButtons onSkip={goNext} onContinue={submitRent} />
          </div>
        )}

        {step === "bills" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.bills.title}</h2>
            <p className="text-sm text-gray-500">{COPY.bills.sub}</p>
            <div className="space-y-2">
              {bills.map((b, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <label className="flex-1 min-w-0">
                    <span className="block text-[11px] text-gray-400 mb-0.5">{COPY.labels.name}</span>
                    <input className={field} placeholder="e.g. Spotify" value={b.name} onChange={(e) => updateBill(i, "name", e.target.value)} />
                  </label>
                  <label className="w-24 shrink-0">
                    <span className="block text-[11px] text-gray-400 mb-0.5">{COPY.labels.amount}</span>
                    <input className={field} type="number" placeholder="0.00" value={b.amount} onChange={(e) => updateBill(i, "amount", e.target.value)} />
                  </label>
                  {/* The day is a GUESS — today's date — and it used to be
                      made silently. A date box per row doubles this
                      screen's width on a phone and is where people stop,
                      so the guess is shown instead of asked for. Rent
                      gets its own field because the 1st is usually right
                      and the ledger's ordering actually turns on it. */}
                  {/* Setting the day HERE rather than on a card later:
                      someone doing all of this by hand should knock it out
                      in the one place that is already asking, and a wrong
                      date changes the ledger's ordering and therefore the
                      running balance. Defaults to today, visibly. */}
                  <label className="shrink-0">
                    <span className="block text-[11px] text-gray-400 mb-0.5 whitespace-nowrap">{COPY.labels.dueDayShort}</span>
                    <input
                      className={`${field} w-16`}
                      type="number" min="1" max="31"
                      aria-label="Day of month"
                      value={b.day ?? String(defaultBillDay)}
                      onChange={(e) => updateBill(i, "day", e.target.value)}
                    />
                  </label>
                  {bills.length > 1 && (
                    <button onClick={() => removeBillRow(i)} className="text-gray-300 hover:text-expense px-1" title="Remove">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addBillRow} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
              {COPY.bills.add}
            </button>
            <StepButtons onSkip={goNext} onContinue={submitBills} />
          </div>
        )}

        {step === "groceries" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.groceries.title}</h2>
            <p className="text-sm text-gray-500">{COPY.groceries.sub}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={label}>{COPY.labels.amount}</label>
                <input className={field} type="number" placeholder="0.00" value={groceryAmount} onChange={(e) => setGroceryAmount(e.target.value)} autoFocus />
              </div>
              <div className="flex-1">
                <label className={label}>{COPY.labels.cadence}</label>
                <select className={field} value={groceryCadence} onChange={(e) => setGroceryCadence(e.target.value)}>
                  {CADENCE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <StepButtons onSkip={goNext} onContinue={submitGroceries} />
          </div>
        )}

        {step === "balance" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.balance.title}</h2>
            <p className="text-sm text-gray-500">{COPY.balance.sub}</p>
            <div>
              <label className={label}>{COPY.labels.currentBalance}</label>
              <input className={field} type="number" placeholder="0.00" value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} autoFocus />
            </div>
            {/* No Skip here, deliberately — every other step is optional
                and this one cannot be. A zero is a real answer and can be
                typed; an empty field is not. */}
            <button
              onClick={submitBalance}
              disabled={!balanceValid}
              className="w-full py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-40"
            >
              Continue
            </button>
            {!balanceValid && <p className="text-xs text-gray-400">{COPY.balance.why}</p>}
          </div>
        )}

        {step === "accounts" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.accounts.title}</h2>
            <p className="text-sm text-gray-500">{COPY.accounts.sub}</p>
            {ACCOUNT_GROUPS.map((g) => (
              <div key={g.key}>
                <label className={label}>{g.label}</label>
                <p className="text-xs text-gray-400 mb-1">{g.kindNote}</p>
                <div className="space-y-2">
                  {accounts[g.key].map((row, i) => {
                    const started = row.name.trim() !== "" || row.amount.trim() !== "";
                    const needsName = started && row.name.trim() === "";
                    const needsAmount = started && row.amount.trim() === "";
                    return (
                      <div key={i}>
                        <div className="flex gap-2">
                          {/* Both fields are LABELED. Two anonymous boxes
                              under a section heading is what made a real
                              user type the amount and leave the name
                              blank — a placeholder alone was not enough. */}
                          <label className="flex-1">
                            <span className="block text-[11px] text-gray-400 mb-0.5">{COPY.labels.name}</span>
                            <input
                              className={`${field} ${needsName ? "border-expense" : ""}`}
                              placeholder={g.placeholder}
                              value={row.name}
                              onChange={(e) => setAccountRow(g.key, i, "name", e.target.value)}
                            />
                          </label>
                          <label className="w-32">
                            <span className="block text-[11px] text-gray-400 mb-0.5">
                              {g.key === "debt" ? COPY.labels.owedNow : COPY.labels.balance}
                            </span>
                            <input
                              className={`${field} ${needsAmount ? "border-expense" : ""}`}
                              type="number"
                              placeholder="0.00"
                              value={row.amount}
                              onChange={(e) => setAccountRow(g.key, i, "amount", e.target.value)}
                            />
                          </label>
                        </div>
                        {(needsName || needsAmount) && (
                          <p className="text-xs text-expense mt-1">
                            {needsName ? COPY.accounts.needsName : COPY.accounts.needsAmount}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => addAccountRow(g.key)}
                  className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mt-1"
                >
                  {COPY.accounts.add}
                </button>
              </div>
            ))}
            <button
              onClick={goNext}
              disabled={incompleteAccountRows(accounts).length > 0}
              className="w-full py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-40"
            >
              {COPY.buttons.finish}
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center py-4">
            <h2 className="text-lg font-semibold">{COPY.done.title}</h2>
            <p className="text-sm text-gray-500">
              {recurring.length > 0
                ? COPY.done.withRules(recurring.length)
                : COPY.done.withoutRules}
            </p>
            <button
              onClick={finishNow}
              className="w-full py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90"
            >
              {COPY.done.cta}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepButtons({ onSkip, onContinue, continueLabel = COPY.buttons.continue }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSkip} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
        {COPY.buttons.skip}
      </button>
      <button onClick={onContinue} className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90">
        {continueLabel}
      </button>
    </div>
  );
}
