import { useEffect, useState } from "react";
import {
  Alert,
  LayoutAnimation, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, UIManager, View, useWindowDimensions,
} from "react-native";
import { useBudget } from "../../components/StateProvider";
import LogBalance, { currently } from "../../components/LogBalance";
import BottomSheet from "../../components/BottomSheet";
import LoanSheet from "../../components/LoanSheet";
import {
  updateAccountBalance, addBalanceSnapshot, addContribution,
  updateAccountSnapshot, deleteAccountSnapshot,
  updateBalanceSnapshot, deleteBalanceSnapshot, setupLoan,
} from "../../../src/engine/mutate.ts";
import { Sparkline, HBar } from "../../lib/charts";
import HistoryList from "../../components/HistoryList";
import { T, money } from "../../lib/theme";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import {
  computeNetPosition, computeCategoryHistory, computeLoggedContributions, computeMonthVariance,
} from "../../../src/engine/progress.ts";
import { computeLoanProgress, computeDebtSummary } from "../../../src/engine/loans.ts";
import { primaryAccount, todayISO } from "../../../src/engine/model.ts";
import { accountColor, roleOfTrackerCategory, roleSuffix, LOAN_COLOR, DEGRADED_SOLID } from "../../../src/engine/palette.ts";
import type { BalanceSnapshot, TrackerCategory } from "../../../src/engine/types.ts";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
// The web animates the hero collapse with a grid-rows transition. RN has no
// CSS transitions; LayoutAnimation is the platform's own one-liner for
// exactly this and costs nothing.
const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

const PROVIDER_LABEL: Record<string, string> = { google: "Google", email: "Email", apple: "Apple", github: "GitHub" };
const providerNames = (p?: string[]) =>
  (p ?? []).map((x) => PROVIDER_LABEL[x] ?? x).join(" and ") || "—";

export default function DashboardScreen() {
  const { state, refresh, refreshing, commit, online, saving, prefs, setPref } = useBudget();
  // null = closed; "checking" = the account; otherwise a category id.
  const [logging, setLogging] = useState<string | null>(null);
  const [contributing, setContributing] = useState<string | null>(null);
  const [editingLoan, setEditingLoan] = useState<TrackerCategory | null>(null);
  const [editing, setEditing] = useState<{ catId: string | null; id: string; amount: number; date: string } | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setSession(data.session)); }, []);
  const { width } = useWindowDimensions();
  const heroOpen = !prefs.heroCollapsed;
  const today = todayISO();
  const net = computeNetPosition(state!);
  const account = primaryAccount(state!);
  const cats = [...state!.trackerCategories].sort((a, b) => a.order - b.order);
  const assets = cats.filter((c) => c.kind !== "debt");
  const debts = cats.filter((c) => c.kind === "debt");
  // Summed the same way computeNetPosition does it — the last LOGGED
  // outstanding of each loan — so this card and the hero's Debt figure
  // can never disagree. A loan with no logged balance contributes
  // nothing and is counted, rather than quietly showing as zero.
  const debtSummary = computeDebtSummary(state!);
  const debtTotal = debtSummary.total;
  const debtUnlogged = debtSummary.unlogged;
  const chartW = width - 64;

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
    >
      {/* FOLDING AWAY HIDES THE NUMBER, which is the whole point of the
          control — someone who would rather not be met by a big red figure
          is not helped by collapsing the three lines under it. Matches the
          web, and the choice is remembered per device. */}
      <Pressable
        style={styles.hero}
        onPress={() => { animate(); setPref("heroCollapsed", heroOpen); }}
        accessibilityRole="button"
        accessibilityLabel={heroOpen ? "Hide net position" : "Show net position"}
      >
        <View style={styles.heroHead}>
          <Text style={styles.label}>Net position</Text>
          <Text style={styles.chev}>{heroOpen ? "⌃" : "⌄"}</Text>
        </View>
        {heroOpen && (
          <Text style={[styles.heroNum, net.net < 0 ? { color: T.expense } : net.net > 0 ? { color: T.income } : null]}>
            {money(net.net)}
          </Text>
        )}
        {heroOpen && (
          <View style={styles.heroRows}>
            <Line k="Checking (verified)" v={money(net.cash)} />
            <Line k="Logged assets" v={money(net.assets)} />
            <Line k="Logged debt" v={`−${money(net.debt).replace("-", "")}`} tone={T.expense} />
            {(net.unloggedAssets > 0 || net.unloggedDebts > 0) && (
              <Text style={styles.caveat}>
                {net.unloggedAssets + net.unloggedDebts} categor
                {net.unloggedAssets + net.unloggedDebts === 1 ? "y has" : "ies have"} no logged balance and
                {" "}count as nothing here, rather than as zero.
              </Text>
            )}
          </View>
        )}
      </Pressable>

      <AccountCard
        name={account.name}
        balance={account.balance}
        asOf={account.balanceAsOf}
        online={online}
        onLog={() => setLogging("checking")}
        history={state!.accountSnapshots?.[account.id] ?? []}
        color={T.text}
        chartW={chartW}
        onEditEntry={(e) => setEditing({ catId: null, id: e.id, amount: e.amount, date: e.date })}
        onDeleteEntry={(e) => void commit(
          (st) => deleteAccountSnapshot(st, account.id, e.id),
          `${account.name} reading of ${money(e.amount)} on ${e.date} deleted`)}
      />

      {/* THE ACCOUNT'S OWN HUE, stored on the category, so it is the same
          color on this card, on its chart line and on its slice of planned
          spending — and the same color on the laptop. Past the eighth
          account there is none left and it falls back to a neutral. */}
      {assets.map((cat) => (
        <AssetCard
          key={cat.id} cat={cat} color={accountColor(cat.hue, true) ?? DEGRADED_SOLID.dark} chartW={chartW} today={today}
          online={online}
          onLog={() => setLogging(cat.id)}
          onLogContribution={() => setContributing(cat.id)}
          onEditEntry={(e) => setEditing({ catId: cat.id, id: e.id, amount: e.amount, date: e.date })}
          onDeleteEntry={(e) => void commit(
            (st) => deleteBalanceSnapshot(st, cat.id, e.id),
            `${cat.name} reading of ${money(e.amount)} on ${e.date} deleted`)}
        />
      ))}
      {/* COLLAPSED BY DEFAULT, like the web. Five loan cards is most of
          the Dashboard, and "what do I owe in total" is the question
          almost every visit is actually asking — the per-loan detail is
          the follow-up, not the opening. The choice is remembered per
          device, which is the point of putting something away. */}
      {debts.length > 0 && (
        <Pressable
          style={styles.debtHead}
          onPress={() => { animate(); setPref("debtsExpanded", !prefs.debtsExpanded); }}
          accessibilityRole="button"
          accessibilityLabel={prefs.debtsExpanded ? "Hide the loans" : `Show ${debts.length} loans`}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Debt</Text>
            <Text style={styles.debtTotal}>{money(debtTotal)}</Text>
            <Text style={styles.dim}>
              {debts.length} loan{debts.length === 1 ? "" : "s"}
              {debtUnlogged > 0 ? ` · ${debtUnlogged} with no logged balance` : ""}
            </Text>
          </View>
          <Text style={styles.chev}>{prefs.debtsExpanded ? "⌃" : "⌄"}</Text>
        </Pressable>
      )}

      {prefs.debtsExpanded && debts.map((cat) => (
        <DebtCard
          key={cat.id} cat={cat} today={today}
          online={online}
          onLog={() => setLogging(cat.id)}
          onEdit={() => setEditingLoan(cat)}
          onEditEntry={(e) => setEditing({ catId: cat.id, id: e.id, amount: e.amount, date: e.date })}
          onDeleteEntry={(e) => void commit(
            (st) => deleteBalanceSnapshot(st, cat.id, e.id),
            `${cat.name} reading of ${money(e.amount)} on ${e.date} deleted`)}
        />
      ))}

      {/* The same three facts the web shows in Settings. There is no
          Settings screen here yet, so they sit with Sign out, which is the
          only other account-level control on the phone. */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Account</Text>
        <Row k="Signed in" v={session?.user?.email ?? "—"} />
        <Row k="Via" v={providerNames(session?.user?.app_metadata?.providers as string[] | undefined)} />
        <Row k="Member since" v={
          session?.user?.created_at
            ? new Date(session.user.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
            : "—"
        } />
      </View>

      {logging && (
        <LogBalance
          title={logging === "checking" ? `Update ${account.name} balance` : "Log a balance"}
          currentLabel={logging === "checking" ? currently(account.balance, account.balanceAsOf) : undefined}
          cta={logging === "checking" ? "Confirm" : "Log balance"}
          warn={logging === "checking"}
          busy={saving}
          onClose={() => setLogging(null)}
          onSubmit={async (amount, date) => {
            const id = logging;
            const label = id === "checking"
              ? `${account.name} balance, as of ${date}`
              : `${cats.find((c) => c.id === id)?.name ?? "Account"} balance, as of ${date}`;
            const okSaved = await commit((s) =>
              id === "checking"
                ? updateAccountBalance(s, primaryAccount(s).id, amount, date)
                : addBalanceSnapshot(s, id, amount, date),
              label
            );
            if (okSaved) setLogging(null);
          }}
        />
      )}

      {/* Contributions are what you ACTUALLY put in — logged one at a
          time, never summed from the ledger, which is a forecast. */}
      {contributing && (
        <LogBalance
          title={`Log a contribution to ${cats.find((c) => c.id === contributing)?.name ?? ""}`}
          cta="Log contribution"
          busy={saving}
          onClose={() => setContributing(null)}
          onSubmit={async (amount, date) => {
            const id = contributing;
            const ok = await commit(
              (st) => addContribution(st, id, amount, date),
              `${cats.find((c) => c.id === id)?.name ?? "Account"} contribution of ${money(amount)} on ${date}`
            );
            if (ok) setContributing(null);
          }}
        />
      )}

      {/* A logged reading you got wrong has to be correctable, which is
          what the web has always allowed. `catId: null` is the checking
          account, whose readings live under accountSnapshots. */}
      <BottomSheet visible={!!editingLoan} onClose={() => setEditingLoan(null)}>
        {editingLoan && (
          <LoanSheet
            cat={editingLoan}
            busy={saving}
            onClose={() => setEditingLoan(null)}
            onSave={async (patch) => {
              const ok = await commit(
                (st) => setupLoan(st, { categoryId: editingLoan.id, ...patch }),
                `${patch.name} terms`
              );
              if (ok) setEditingLoan(null);
            }}
          />
        )}
      </BottomSheet>

      {editing && (
        <LogBalance
          title="Edit this reading"
          currentLabel={`Currently ${money(editing.amount)}, logged ${editing.date}`}
          cta="Save"
          warn={editing.catId === null}
          busy={saving}
          onClose={() => setEditing(null)}
          onSubmit={async (amount, date) => {
            const e = editing;
            const ok = await commit(
              (st) => e.catId === null
                ? updateAccountSnapshot(st, primaryAccount(st).id, e.id, { amount, date })
                : updateBalanceSnapshot(st, e.catId, e.id, { amount, date }),
              `Reading of ${money(amount)} on ${date}`
            );
            if (ok) setEditing(null);
          }}
        />
      )}

      <Text style={styles.signout} onPress={() => supabase.auth.signOut()}>Sign out</Text>
    </ScrollView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.acctRow}>
      <Text style={styles.acctK}>{k}</Text>
      <Text style={styles.acctV} numberOfLines={1}>{v}</Text>
    </View>
  );
}

function Line({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineK}>{k}</Text>
      <Text style={[styles.lineV, tone ? { color: tone } : null]}>{v}</Text>
    </View>
  );
}

function AccountCard({ name, balance, asOf, history, color, chartW, online, onLog, onEditEntry, onDeleteEntry }: {
  name: string; balance: number; asOf: string;
  history: BalanceSnapshot[]; color: string; chartW: number;
  online: boolean; onLog: () => void;
  onEditEntry: (e: BalanceSnapshot) => void; onDeleteEntry: (e: BalanceSnapshot) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel}>{name}</Text>
        {/* Offline is READ-ONLY by decision, so the control is disabled
            rather than queued — there is no write queue and no replay. */}
        <Pressable onPress={onLog} disabled={!online} style={[styles.logBtn, !online && styles.logOff]}>
          <Text style={styles.logText}>{online ? "Update" : "Offline"}</Text>
        </Pressable>
      </View>
      <Text style={styles.cardNum}>{money(balance)}</Text>
      <Text style={styles.dim}>verified {asOf}</Text>
      <Sparkline points={history} color={color} width={chartW} />
      <HistoryList entries={history} online={online} onEdit={onEditEntry} onDelete={onDeleteEntry} />
    </View>
  );
}

function AssetCard({ cat, color, chartW, today, online, onLog, onLogContribution, onEditEntry, onDeleteEntry }: {
  cat: TrackerCategory; color: string; chartW: number; today: string; online: boolean;
  onLog: () => void; onLogContribution: () => void;
  onEditEntry: (e: BalanceSnapshot) => void; onDeleteEntry: (e: BalanceSnapshot) => void;
}) {
  const { state } = useBudget();
  const history = computeCategoryHistory(state!, cat.id);
  const latest = history.length ? history[history.length - 1] : null;
  const contrib = computeLoggedContributions(state!, cat.id, today);
  const year = today.slice(0, 4);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.cardLabel}>{cat.name}</Text>
        {roleSuffix(cat.name, roleOfTrackerCategory(cat)) && (
          <Text style={styles.roleTag}>· {roleSuffix(cat.name, roleOfTrackerCategory(cat))}</Text>
        )}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onLog} disabled={!online} style={[styles.logBtn, !online && styles.logOff]}>
          <Text style={styles.logText}>{online ? "Log" : "Offline"}</Text>
        </Pressable>
      </View>
      <Text style={[styles.cardNum, !latest && { color: T.faint }]}>
        {latest ? money(latest.amount) : "—"}
      </Text>
      <Text style={styles.dim}>
        {latest ? `logged ${latest.date}` : "Add what's in it today and the Dashboard can show you where you stand."}
      </Text>
      <Sparkline points={history.map((h) => ({ date: h.date, amount: h.amount }))} color={color} width={chartW} />

      {/* Contributions are LOGGED, never summed from the ledger — the ledger
          is a forecast, so that figure would be what you planned to put in. */}
      <View style={styles.contrib}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dim}>Contributed {year}</Text>
          {contrib.logged ? (
            <Text style={styles.contribNum}>{money(contrib.byYear[year] ?? 0)}</Text>
          ) : (
            <Text style={styles.contribNone}>Nothing logged yet.</Text>
          )}
        </View>
        {/* A stat with no way to add to it is a dead end — the figure
            implied a control that did not exist. */}
        <Pressable
          onPress={onLogContribution}
          disabled={!online}
          style={[styles.logBtn, !online && styles.logOff]}
          accessibilityRole="button"
          accessibilityLabel="Log contribution"
        >
          <Text style={styles.logText}>{online ? "+ Contribution" : "Offline"}</Text>
        </Pressable>
      </View>
      <HistoryList entries={history} online={online} onEdit={onEditEntry} onDelete={onDeleteEntry} />
    </View>
  );
}

function DebtCard({ cat, today, online, onLog, onEdit, onEditEntry, onDeleteEntry }: {
  cat: TrackerCategory; today: string; online: boolean;
  onLog: () => void; onEdit: () => void;
  onEditEntry: (e: BalanceSnapshot) => void; onDeleteEntry: (e: BalanceSnapshot) => void;
}) {
  const { state } = useBudget();
  const history = computeCategoryHistory(state!, cat.id);
  const p = computeLoanProgress(state!, cat, today);
  const monthKey = today.slice(0, 7);
  const payments = state!.recurring.filter((r) => r.category === cat.id);
  const trackable = payments.some((r) => r.variable);
  const logged = payments.map((r) => computeMonthVariance(r, state!.monthlyActuals, monthKey).actual);
  const anyLogged = trackable && logged.some((a) => a != null);
  const paid = logged.reduce((t: number, a) => t + (a ?? 0), 0);

  // THE WEB CARD IN ONE COLUMN — nothing more and nothing less.
  //
  // Out: the history chart. A loan's shape is a line going down, which the
  // numbers under it state better, and the card is long enough already.
  // Out: every projected figure. computeLoanProgress still returns
  // expectedNow and computeLoanHistory still annotates each reading —
  // forecast accuracy is deferred, not canceled — but a projected number
  // printed beside a logged one invites a comparison this app is not yet
  // good enough to stand behind.
  //
  // In: Log balance and Edit, which the savings cards had and loans did
  // not, so a wrong loan balance could only be fixed from a laptop.
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel}>{cat.name}</Text>
        {roleSuffix(cat.name, roleOfTrackerCategory(cat)) && (
          <Text style={styles.roleTag}>· {roleSuffix(cat.name, roleOfTrackerCategory(cat))}</Text>
        )}
        <Text style={styles.loanTag}>Loan</Text>
      </View>

      <Text style={[styles.cardNum, p?.outstanding == null && { color: T.faint }]}>
        {p?.outstanding != null ? money(p.outstanding) : "—"}
      </Text>
      <Text style={styles.dim}>
        {p?.outstanding != null && history.length
          ? `outstanding · logged ${history[history.length - 1]!.date}`
          : "Log what you owe today to see how far along you are."}
      </Text>

      <View style={styles.loanActions}>
        <Pressable onPress={onLog} disabled={!online} style={[styles.logBtn, !online && styles.logOff]}
          accessibilityRole="button" accessibilityLabel={`Log a balance for ${cat.name}`}>
          <Text style={styles.logText}>{online ? "Log balance" : "Offline"}</Text>
        </Pressable>
        <Pressable onPress={onEdit} disabled={!online} style={[styles.logBtn, !online && styles.logOff]}
          accessibilityRole="button" accessibilityLabel={`Edit ${cat.name}`}>
          <Text style={styles.logText}>Edit</Text>
        </Pressable>
      </View>

      {p?.percentPaid != null && (
        <View style={styles.loanBlock}>
          <View style={styles.loanRow}>
            <Text style={styles.loanStrong}>{p.percentPaid}% paid off</Text>
            {/* Once interest has put the balance above what was borrowed,
                the peak owed is the honest basis — "of $2,000" beside a
                $2,302 balance is simply wrong. */}
            {p.aboveOriginal == null && (
              <Text style={styles.dim}>
                of {money(p.basis)}{p.everAboveOriginal ? " at its highest" : ""}
              </Text>
            )}
          </View>
          <HBar pct={p.percentPaid / 100} color={LOAN_COLOR.dark} width={260} />
          {/* Owing more than you borrowed is interest, not broken math. */}
          {p.aboveOriginal != null && (
            <Text style={styles.loanFine}>
              {money(p.outstanding!)} owed · {money(p.original)} borrowed · {money(p.aboveOriginal)} accrued interest
            </Text>
          )}
        </View>
      )}

      {p && (
        <View style={styles.loanBlock}>
          <Text style={styles.loanLabel}>Terms</Text>
          <Text style={styles.loanStrong}>{p.interestRate}% APR · {money(p.original)}</Text>
          <Text style={styles.loanFine}>
            {p.interestStartDate ? `interest from ${p.interestStartDate}` : "interest accruing"}
          </Text>
        </View>
      )}

      <View style={styles.loanBlock}>
        <Text style={styles.loanLabel}>This month</Text>
        {payments.length === 0 ? (
          <Text style={styles.loanFine}>No payments planned yet — add a transaction and pick this loan.</Text>
        ) : trackable ? (
          <Text style={anyLogged ? styles.loanStrong : styles.loanFine}>
            {anyLogged ? `paid ${money(paid)}` : "not logged yet"}
          </Text>
        ) : (
          <Text style={styles.loanFine}>
            {payments.length} payment{payments.length === 1 ? "" : "s"} scheduled
          </Text>
        )}
      </View>

      <HistoryList entries={history} online={online} onEdit={onEditEntry} onDelete={onDeleteEntry} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  pad: { padding: 16, gap: 12, paddingBottom: 36 },
  hero: { backgroundColor: T.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: T.border, gap: 4 },
  heroHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chev: { color: T.faint, fontSize: 15 },
  heroNum: { color: T.text, fontSize: 34, fontWeight: "700", fontVariant: ["tabular-nums"] },
  heroRows: { marginTop: 10, gap: 2 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  lineK: { color: T.dim, fontSize: 13 },
  lineV: { color: T.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  caveat: { color: T.faint, fontSize: 11, lineHeight: 15, marginTop: 6 },
  card: { backgroundColor: T.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: T.border, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardLabel: { color: T.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  cardNum: { color: T.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  dim: { color: T.faint, fontSize: 12, lineHeight: 16 },
  contrib: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 10 },
  debtHead: { backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  debtTotal: { color: T.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"], marginTop: 2 },
  loanTag: { color: T.brass, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, borderWidth: 1, borderColor: T.brass, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: "hidden" },
  loanActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  loanBlock: { marginTop: 12, gap: 3 },
  loanRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 4 },
  loanLabel: { color: T.faint, fontSize: 11 },
  loanStrong: { color: T.text, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  loanFine: { color: T.faint, fontSize: 11, lineHeight: 16, fontVariant: ["tabular-nums"] },
  contribNum: { color: T.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  contribNone: { color: T.faint, fontSize: 12 },
  progress: { gap: 4, marginTop: 4 },
  showBtn: { paddingVertical: 8 },
  showText: { color: T.brass, fontSize: 12 },
  histWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.border, paddingTop: 6 },
  histTap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  histDel: { minHeight: 40, minWidth: 40, alignItems: "center", justifyContent: "center" },
  histDelText: { color: T.expense, fontSize: 15 },
  histRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  histDate: { color: T.faint, fontSize: 12, fontVariant: ["tabular-nums"] },
  histAmt: { color: T.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  acctRow: { flexDirection: "row", gap: 10, paddingVertical: 2 },
  acctK: { color: T.faint, fontSize: 12, width: 92 },
  acctV: { color: T.dim, fontSize: 12, flex: 1 },
  roleTag: { color: T.faint, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  logBtn: { borderWidth: 1, borderColor: T.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  logOff: { opacity: 0.4 },
  logText: { color: T.dim, fontSize: 12 },
  signout: { color: T.brass, textAlign: "center", paddingVertical: 12 },
  ro: { color: T.faint, fontSize: 11, textAlign: "center" },
});
