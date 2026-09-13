import { useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { computeCategoryProgress, computeCategoryHistory, computeContributionsByYear, computeNetPosition, computeMonthVariance } from "../engine/progress.js";
import { computeLoanProgress, computeLoanHistory, isLoanConfigured } from "../engine/loans.js";
import { paletteColor, primaryAccount, todayISO } from "../engine/model.js";
import UpdateBalanceModal from "./UpdateBalanceModal.jsx";
import LoanSetupModal from "./LoanSetupModal.jsx";
import AssetSetupModal from "./AssetSetupModal.jsx";

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

function prettyDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function shortDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric" });
}
function sortedSnaps(list) {
  return [...(list || [])].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
}

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 flex flex-col gap-4";
const LABEL = "text-[11px] font-medium uppercase tracking-wider text-gray-500";
const BTN = "text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition";

// The "reality layer": what's actually in your accounts, what you actually
// put in, and how that compares to what the transaction log alone would
// project. Ledger/Budget stay pure forecasting. Every card is ONE thing.
// A loan is a debt-kind category (engine/loans.js) — set up here, never via
// the transaction editor. Variable spending lives on its own tab.
export default function Dashboard({
  state, isDark,
  onAddSnapshot, onUpdateSnapshot, onDeleteSnapshot,
  onUpdateAccountBalance, onUpdateAccountSnapshot, onDeleteAccountSnapshot,
  onSetupLoan, onSetupAsset,
}) {
  const today = todayISO(); // real clock — the reality layer's "now"
  const account = primaryAccount(state);
  const cats = [...state.trackerCategories].sort((a, b) => a.order - b.order);
  const assetCats = cats.filter((c) => c.kind !== "debt");
  const debtCats = cats.filter((c) => c.kind === "debt");
  const net = computeNetPosition(state);
  const [logFor, setLogFor] = useState(null);     // category currently logging a balance
  const [loanModal, setLoanModal] = useState(null); // null | { cat?: category } (cat absent = brand-new loan)
  const [assetModal, setAssetModal] = useState(false);

  const logCat = logFor ? cats.find((c) => c.id === logFor) : null;
  const logLatest = logCat ? sortedSnaps(state.balanceSnapshots?.[logCat.id]).at(-1) : null;

  return (
    <div className="space-y-5">
      <Hero net={net} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CheckingCard
          account={account}
          snapshots={sortedSnaps(state.accountSnapshots?.[account.id])}
          isDark={isDark}
          onUpdate={onUpdateAccountBalance}
          onUpdateSnapshot={(id, patch) => onUpdateAccountSnapshot(account.id, id, patch)}
          onDeleteSnapshot={(id) => onDeleteAccountSnapshot(account.id, id)}
        />

        {assetCats.map((cat) => (
          <AssetCard
            key={cat.id}
            category={cat}
            isDark={isDark}
            progress={computeCategoryProgress(state, cat.id, today)}
            history={computeCategoryHistory(state, cat.id)}
            contributions={computeContributionsByYear(state, cat.id, today)}
            today={today}
            onLog={() => setLogFor(cat.id)}
            onUpdateSnapshot={(id, patch) => onUpdateSnapshot(cat.id, id, patch)}
            onDeleteSnapshot={(id) => onDeleteSnapshot(cat.id, id)}
          />
        ))}

        <AddAssetCard onAdd={() => setAssetModal(true)} />

        {debtCats.map((cat) =>
          isLoanConfigured(cat) ? (
            <LoanCard
              key={cat.id}
              category={cat}
              isDark={isDark}
              state={state}
              today={today}
              progress={computeLoanProgress(state, cat, today)}
              history={computeLoanHistory(state, cat)}
              onLog={() => setLogFor(cat.id)}
              onEdit={() => setLoanModal({ cat })}
              onUpdateSnapshot={(id, patch) => onUpdateSnapshot(cat.id, id, patch)}
              onDeleteSnapshot={(id) => onDeleteSnapshot(cat.id, id)}
            />
          ) : (
            <SetupLoanCard key={cat.id} category={cat} isDark={isDark} onSetup={() => setLoanModal({ cat })} />
          )
        )}

        <AddLoanCard onAdd={() => setLoanModal({})} />
      </div>

      {logCat && (
        <UpdateBalanceModal
          account={{ name: logCat.name, balance: logLatest?.amount ?? 0, balanceAsOf: logLatest?.date ?? "never" }}
          onConfirm={(amount, date) => { onAddSnapshot(logCat.id, amount, date); setLogFor(null); }}
          onClose={() => setLogFor(null)}
        />
      )}

      {assetModal && (
        <AssetSetupModal
          isDark={isDark}
          onSave={(payload) => { onSetupAsset(payload); setAssetModal(false); }}
          onClose={() => setAssetModal(false)}
        />
      )}

      {loanModal && (
        <LoanSetupModal
          initial={loanModal.cat ?? null}
          isDark={isDark}
          onSave={(payload) => { onSetupLoan(payload); setLoanModal(null); }}
          onClose={() => setLoanModal(null)}
        />
      )}
    </div>
  );
}

// ---- Hero: net position ----
function Hero({ net }) {
  const unlogged = net.unloggedAssets + net.unloggedDebts;
  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl px-6 py-6 sm:py-7">
      <div className={LABEL}>Net position</div>
      <div className={`mt-1 text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums ${net.net < 0 ? "text-expense" : ""}`}>
        {money(net.net)}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Stat label="Cash" value={money(net.cash)} />
        <Stat label="Investments & savings" value={money(net.assets)} />
        <Stat label="Debt" value={net.debt > 0 ? `−${money(net.debt)}` : money(0)} />
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Verified checking balance + last logged balance of each savings/investment − last logged balance of each loan.
        {unlogged > 0 && (
          <> <span className="text-gray-500">{unlogged} categor{unlogged === 1 ? "y" : "ies"} not logged yet</span> — counted as $0 until you log a balance.</>
        )}
      </p>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---- Chart ----
// Schwab-style: thin line, recessive axes, hover any point for value + date.
// `data` is [{ date, amount, expected? }]; the projected series is drawn
// dashed and neutral (gray) — for an investment the gap is mostly the
// market, not an error, so it's never colored good/bad.
function ChartTip({ active, payload, label, color }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs shadow-lg">
      <div className="text-gray-500 mb-1">{prettyDate(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.dataKey === "amount" ? color : "#9ca3af" }} />
          <span className="text-gray-500">{p.dataKey === "amount" ? "Actual" : "Projected"}</span>
          <span className="font-medium ml-auto pl-3">{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryChart({ data, color, isDark, projected = false, emptyHint }) {
  const points = data.filter((d) => d.amount != null);
  if (points.length < 2) {
    return (
      <div className="h-40 rounded-xl bg-gray-50 dark:bg-gray-800/40 flex items-center justify-center text-center px-6">
        <p className="text-xs text-gray-400">
          {points.length === 1 ? `One point so far (${shortDate(points[0].date)}). ` : ""}
          {emptyHint}
        </p>
      </div>
    );
  }
  const axis = isDark ? "#6b7280" : "#9ca3af";
  return (
    <div className="h-40 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: axis }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip content={<ChartTip color={color} />} cursor={{ stroke: axis, strokeDasharray: "3 3" }} />
          {projected && <Legend verticalAlign="top" align="right" height={20} iconType="plainline" wrapperStyle={{ fontSize: 11, color: axis }} formatter={(v) => (v === "amount" ? "Actual" : "Projected")} />}
          <Line type="monotone" dataKey="amount" name="amount" stroke={color} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: color }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          {projected && (
            <Line type="monotone" dataKey="expected" name="expected" stroke="#9ca3af" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4, fill: "#9ca3af" }} connectNulls isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Editable history (every logged value stays correctable) ----
function HistoryList({ entries, onUpdate, onDelete, showProjected }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
        {open ? "Hide" : "Show"} history ({entries.length})
      </button>
      {open && (
        <div className="mt-2 border-t border-gray-100 dark:border-gray-800 pt-1">
          {[...entries].reverse().map((h) => (
            <HistoryRow key={h.id} entry={h} showProjected={showProjected} onUpdate={(patch) => onUpdate(h.id, patch)} onDelete={() => onDelete(h.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry, showProjected, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(entry.amount);
  const [draftDate, setDraftDate] = useState(entry.date);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function commit() {
    if (draftAmount !== "" && !isNaN(Number(draftAmount)) && draftDate) onUpdate({ amount: Number(draftAmount), date: draftDate });
    setEditing(false);
  }
  const inp = "px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs";
  return (
    <div className="flex items-center gap-2 text-sm py-1 flex-wrap">
      {editing ? (
        <>
          <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className={inp} />
          <input type="number" autoFocus value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} className={`${inp} w-24`} />
          <button onClick={commit} className="text-xs text-income font-medium">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-400">Cancel</button>
        </>
      ) : (
        <>
          <span className="text-gray-400 w-24 shrink-0 text-xs">{entry.date}</span>
          <button onClick={() => { setDraftAmount(entry.amount); setDraftDate(entry.date); setEditing(true); }} title="Edit" className="font-medium tabular-nums hover:underline decoration-dotted underline-offset-2">
            {money(entry.amount)}
          </button>
          {showProjected && entry.expected != null && (
            <span className="text-xs text-gray-400">projected {money(entry.expected)}</span>
          )}
          <span className="ml-auto" />
          {confirmDelete ? (
            <span className="text-xs text-expense whitespace-nowrap">
              <button onClick={onDelete} className="font-semibold underline">Delete</button>{" · "}
              <button onClick={() => setConfirmDelete(false)} className="underline">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} title="Delete" className="text-gray-300 hover:text-expense text-xs px-1">✕</button>
          )}
        </>
      )}
    </div>
  );
}

// ---- Checking ----
function CheckingCard({ account, snapshots, isDark, onUpdate, onUpdateSnapshot, onDeleteSnapshot }) {
  const color = isDark ? "#e5e7eb" : "#111827"; // neutral — cash has no category color
  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={LABEL}>{account.name}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(account.balance)}</div>
          <div className="text-xs text-gray-500">verified {prettyDate(account.balanceAsOf)}</div>
        </div>
        <button onClick={onUpdate} className={BTN}>Update balance</button>
      </div>
      <HistoryChart data={snapshots.map((s) => ({ date: s.date, amount: s.amount }))} color={color} isDark={isDark}
        emptyHint="Confirm a balance update whenever you check your bank — each one adds a point here." />
      <HistoryList entries={snapshots} onUpdate={onUpdateSnapshot} onDelete={onDeleteSnapshot} />
    </section>
  );
}

// ---- Savings / investment ----
function AssetCard({ category, isDark, progress, history, contributions, today, onLog, onUpdateSnapshot, onDeleteSnapshot }) {
  const color = paletteColor(category.color, isDark);
  const latest = progress.latest;
  const [allYears, setAllYears] = useState(false);
  const thisYear = today.slice(0, 4);
  const years = Object.keys(contributions);

  // Actual = each logged snapshot; projected = what was expected AT that
  // moment (computeCategoryHistory), extended to today's expected-now so the
  // dashed line reaches "now."
  const data = history.map((h) => ({ date: h.date, amount: h.amount, expected: h.expected }));
  if (latest && today > latest.date) data.push({ date: today, expected: progress.expectedNow });
  const gap = latest ? progress.expectedNow - latest.amount : null;

  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`${LABEL} flex items-center gap-1.5`}>
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="truncate">{category.name}</span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums" style={latest ? { color } : undefined}>
            {latest ? money(latest.amount) : <span className="text-gray-300 dark:text-gray-600">—</span>}
          </div>
          <div className="text-xs text-gray-500">{latest ? `logged ${prettyDate(latest.date)}` : "no balance logged yet"}</div>
        </div>
        <button onClick={onLog} className={BTN}>Log balance</button>
      </div>

      <HistoryChart data={data} color={color} isDark={isDark} projected={!!latest}
        emptyHint="Log a balance whenever you check the account — two points make a trend." />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">Contributed {allYears ? "all time" : thisYear}</div>
          <div className="font-semibold tabular-nums">
            {money(allYears ? years.reduce((s, y) => s + contributions[y], 0) : contributions[thisYear] || 0)}
          </div>
          {years.length > 1 && (
            <button onClick={() => setAllYears((v) => !v)} className="text-xs text-gray-400 underline decoration-dotted underline-offset-2">
              {allYears ? "this year" : "all time"}
            </button>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-500">vs. projected</div>
          {gap == null ? (
            <div className="text-xs text-gray-400">Log a balance to compare.</div>
          ) : (
            <>
              <div className="font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                {gap === 0 ? "on projection" : `${money(Math.abs(gap))} ${gap > 0 ? "below" : "above"}`}
              </div>
              <div className="text-xs text-gray-400">projected now {money(progress.expectedNow)}</div>
            </>
          )}
        </div>
      </div>

      <HistoryList entries={history} showProjected onUpdate={onUpdateSnapshot} onDelete={onDeleteSnapshot} />
    </section>
  );
}

// ---- Loan (one card per loan = per debt-kind category) ----
// The LOGGED outstanding balance is the big number (truth). Amortization
// drives the dashed projected line and nothing else on screen —
// "expected remaining vs. actual remaining" appears nowhere by design.
function LoanCard({ category, isDark, state, today, progress, history, onLog, onEdit, onUpdateSnapshot, onDeleteSnapshot }) {
  const color = paletteColor(category.color, isDark);
  const latest = progress.latest;
  const monthKey = today.slice(0, 7);

  const data = history.map((h) => ({ date: h.date, amount: h.amount, expected: h.expected }));
  if (latest && today > latest.date && progress.expectedNow != null) data.push({ date: today, expected: progress.expectedNow });

  // Planned vs. actually paid THIS MONTH — your behavior, summed across every
  // payment tagged to this loan. "Paid" comes from the same monthlyActuals
  // mechanism variable bills use, so only items flagged "Track actual vs.
  // budgeted" can report it.
  const payments = state.recurring.filter((r) => r.category === category.id);
  const variances = payments.map((p) => computeMonthVariance(p, state.monthlyActuals, monthKey));
  const planned = variances.reduce((s, v) => s + v.expected, 0);
  const trackable = payments.some((p) => p.variable);
  const paidValues = variances.filter((v, i) => payments[i].variable && v.actual != null).map((v) => v.actual);
  const paid = paidValues.length ? paidValues.reduce((s, a) => s + a, 0) : null;
  const interestFrom = progress.interestStartDate;

  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`${LABEL} flex items-center gap-1.5`}>
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="truncate">{category.name}</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 normal-case tracking-normal">Loan</span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {latest ? money(latest.amount) : <span className="text-gray-300 dark:text-gray-600">—</span>}
          </div>
          <div className="text-xs text-gray-500">
            {latest ? `outstanding · logged ${prettyDate(latest.date)}` : "no balance logged yet"}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={onLog} className={BTN}>Log balance</button>
          <button onClick={onEdit} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Edit terms</button>
        </div>
      </div>

      {progress.percentPaid != null ? (
        <div>
          <div className="flex justify-between gap-3 text-xs text-gray-500 mb-1.5">
            <span className="font-medium text-gray-700 dark:text-gray-300">{progress.percentPaid}% paid off</span>
            {/* What the bar is measured against. Once interest has ever put
                the balance above what was borrowed, that's the peak owed, not
                the original principal — saying "of $2,000.00" beside a
                $2,302.73 balance is just wrong. */}
            {progress.aboveOriginal == null && (
              <span className="text-right">
                of {money(progress.basis)}{progress.everAboveOriginal ? " at its highest" : ""}
              </span>
            )}
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${progress.percentPaid}%`, backgroundColor: color }} />
          </div>
          {/* Owing more than you borrowed isn't broken math, it's interest —
              so say so, instead of a percentage against a number the balance
              already passed. */}
          {progress.aboveOriginal != null && (
            <div className="mt-1.5 text-xs text-gray-500 tabular-nums">
              {money(progress.outstanding)} owed · {money(progress.original)} borrowed ·{" "}
              {money(progress.aboveOriginal)} accrued interest
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400">Log today&apos;s outstanding balance to see how far along you are.</p>
      )}

      <HistoryChart data={data} color={color} isDark={isDark} projected={!!latest}
        emptyHint="Log the outstanding balance whenever you check it — two points make a trend." />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">Terms</div>
          <div className="font-medium tabular-nums">{progress.interestRate}% APR · {money(progress.original)}</div>
          <div className="text-xs text-gray-400">{interestFrom ? `interest from ${prettyDate(interestFrom)}` : "interest accruing"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">This month</div>
          {payments.length === 0 ? (
            <div className="text-xs text-gray-400">No payments planned yet — add a transaction and pick this loan.</div>
          ) : (
            <>
              <div className="font-medium tabular-nums">planned {money(planned)}</div>
              {trackable && (
                <div className="text-xs text-gray-400">{paid == null ? "paid: not logged yet" : `paid ${money(paid)}`}</div>
              )}
            </>
          )}
        </div>
      </div>

      <HistoryList entries={history} showProjected onUpdate={onUpdateSnapshot} onDelete={onDeleteSnapshot} />
    </section>
  );
}

function SetupLoanCard({ category, isDark, onSetup }) {
  const color = paletteColor(category.color, isDark);
  return (
    <section className={`${CARD} border-dashed`}>
      <div className={`${LABEL} flex items-center gap-1.5`}>
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="truncate">{category.name}</span>
      </div>
      <p className="text-sm text-gray-500">
        Not set up yet — add its original amount, rate, and what you owe today to see the balance, progress, and projection.
      </p>
      <button onClick={onSetup} className={`${BTN} self-start`}>Set up loan</button>
    </section>
  );
}

function AddAssetCard({ onAdd }) {
  return (
    <section className={`${CARD} border-dashed justify-center items-start`}>
      <div className={LABEL}>Savings &amp; investments</div>
      <p className="text-sm text-gray-500">A savings account, a Roth, a brokerage — anything you want a balance, a history, and a contribution trend for.</p>
      <button onClick={onAdd} className={BTN}>+ Add account</button>
    </section>
  );
}

function AddLoanCard({ onAdd }) {
  return (
    <section className={`${CARD} border-dashed justify-center items-start`}>
      <div className={LABEL}>Loans</div>
      <p className="text-sm text-gray-500">Car loan, mortgage, student loan — a loan is its own category; payments tag to it like Roth contributions tag to Roth.</p>
      <button onClick={onAdd} className={BTN}>+ Add loan</button>
    </section>
  );
}
