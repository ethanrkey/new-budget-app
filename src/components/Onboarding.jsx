import { useState } from "react";
import { uid, todayISO, toISODate } from "../engine/model.js";
import { useSubmitOnce } from "../useSubmitOnce.js";

// Draft copy — expected to be edited. Every string a user reads lives here or
// inline below, so it's easy to find and tweak in one pass.
const COPY = {
  paycheck: {
    title: "What's your take-home pay?",
    sub: "We'll set this up as a recurring paycheck so your Ledger and Budget stay current on their own.",
    note: "Have more than one income source (a second job, side income, a partner's paycheck)? Add just one here — you can add the rest afterward with Quick Entry or the + Add button.",
  },
  rent: {
    title: "What's your rent or mortgage?",
    sub: "This becomes a recurring bill so it shows up every month without re-entering it.",
  },
  bills: {
    title: "Any other regular bills?",
    sub: "Phone, internet, subscriptions — anything that's roughly the same amount every month. Add as many as you want.",
  },
  groceries: {
    title: "About how much do you spend on groceries?",
    sub: "A rough estimate is fine — you can always adjust it later.",
  },
  balance: {
    title: "What's your current bank balance?",
    sub: "This is your starting point — everything else projects forward from here.",
  },
};

const CADENCE_OPTIONS = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
];

const STEPS = ["paycheck", "rent", "bills", "groceries", "balance", "done"];

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

  const [bills, setBills] = useState([{ name: "", amount: "" }]);

  const [groceryAmount, setGroceryAmount] = useState("");
  const [groceryCadence, setGroceryCadence] = useState("weekly");

  const [balanceInput, setBalanceInput] = useState(initialBalance != null ? String(initialBalance) : "");

  const step = STEPS[stepIndex];
  const questionSteps = STEPS.length - 1; // exclude "done" from the progress count

  function addRule(rule) {
    setRecurring((r) => [...r, rule]);
  }
  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  const [finishNow] = useSubmitOnce(() => {
    onComplete({ recurring, oneoffs: [], checkInBalance });
  })

  function submitPaycheck() {
    const amt = Number(payAmount);
    if (payAmount.trim() !== "" && !isNaN(amt) && amt > 0) {
      addRule({
        id: uid(), name: "Paycheck", amount: amt, category: "income",
        cadence: payCadence, startDate: todayISO(), dayOfMonth: new Date().getDate(),
      });
    }
    goNext();
  }
  function submitRent() {
    const amt = Number(rentAmount);
    const day = Math.min(31, Math.max(1, Number(rentDay) || 1));
    if (rentAmount.trim() !== "" && !isNaN(amt) && amt > 0) {
      const d = new Date();
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      addRule({
        id: uid(), name: "Rent", amount: amt, category: "bill",
        cadence: "monthly", startDate: toISODate(d), dayOfMonth: day,
      });
    }
    goNext();
  }
  function submitBills() {
    for (const b of bills) {
      const amt = Number(b.amount);
      if (b.name.trim() && !isNaN(amt) && amt > 0) {
        addRule({
          id: uid(), name: b.name.trim(), amount: amt, category: "bill",
          cadence: "monthly", startDate: todayISO(), dayOfMonth: new Date().getDate(),
        });
      }
    }
    goNext();
  }
  function submitGroceries() {
    const amt = Number(groceryAmount);
    if (groceryAmount.trim() !== "" && !isNaN(amt) && amt > 0) {
      addRule({
        id: uid(), name: "Groceries", amount: amt, category: "bill",
        cadence: groceryCadence, startDate: todayISO(), dayOfMonth: new Date().getDate(),
      });
    }
    goNext();
  }
  function submitBalance() {
    const amt = Number(balanceInput);
    if (balanceInput.trim() !== "" && !isNaN(amt)) setCheckInBalance(amt);
    goNext();
  }

  function updateBill(i, field, value) {
    setBills((bs) => bs.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)));
  }
  function addBillRow() {
    setBills((bs) => [...bs, { name: "", amount: "" }]);
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
              Skip setup
            </button>
          </div>
        )}

        {step === "paycheck" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.paycheck.title}</h2>
            <p className="text-sm text-gray-500">{COPY.paycheck.sub}</p>
            <div>
              <label className={label}>Amount</label>
              <input className={field} type="number" placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <label className={label}>How often?</label>
              <select className={field} value={payCadence} onChange={(e) => setPayCadence(e.target.value)}>
                {CADENCE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400">{COPY.paycheck.note}</p>
            <StepButtons onSkip={goNext} onContinue={submitPaycheck} />
          </div>
        )}

        {step === "rent" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{COPY.rent.title}</h2>
            <p className="text-sm text-gray-500">{COPY.rent.sub}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={label}>Amount</label>
                <input className={field} type="number" placeholder="0.00" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} autoFocus />
              </div>
              <div className="w-24">
                <label className={label}>Due on day</label>
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
                  <input className={field} placeholder="Name (e.g. Spotify)" value={b.name} onChange={(e) => updateBill(i, "name", e.target.value)} />
                  <input className={`${field} w-24`} type="number" placeholder="0.00" value={b.amount} onChange={(e) => updateBill(i, "amount", e.target.value)} />
                  {bills.length > 1 && (
                    <button onClick={() => removeBillRow(i)} className="text-gray-300 hover:text-expense px-1" title="Remove">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addBillRow} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
              + Add another bill
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
                <label className={label}>Amount</label>
                <input className={field} type="number" placeholder="0.00" value={groceryAmount} onChange={(e) => setGroceryAmount(e.target.value)} autoFocus />
              </div>
              <div className="flex-1">
                <label className={label}>How often?</label>
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
              <label className={label}>Current balance</label>
              <input className={field} type="number" placeholder="0.00" value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} autoFocus />
            </div>
            <StepButtons onSkip={goNext} onContinue={submitBalance} continueLabel="Finish" />
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center py-4">
            <h2 className="text-lg font-semibold">All set!</h2>
            <p className="text-sm text-gray-500">
              {recurring.length > 0
                ? `We've added ${recurring.length} recurring item${recurring.length === 1 ? "" : "s"} to get you started. You can edit, delete, or add more anytime.`
                : "No problem — you can add everything yourself whenever you're ready."}
            </p>
            <button
              onClick={finishNow}
              className="w-full py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90"
            >
              Go to my budget
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepButtons({ onSkip, onContinue, continueLabel = "Continue" }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onSkip} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
        Skip
      </button>
      <button onClick={onContinue} className="flex-1 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90">
        {continueLabel}
      </button>
    </div>
  );
}
