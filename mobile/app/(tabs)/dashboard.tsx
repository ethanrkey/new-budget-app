import { useEffect, useState } from "react";
import {
  Alert,
  LayoutAnimation, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, UIManager, View, useWindowDimensions,
} from "react-native";
import { useBudget } from "../../components/StateProvider";
import LogBalance, { currently } from "../../components/LogBalance";
import {
  updateAccountBalance, addBalanceSnapshot, addContribution,
  updateAccountSnapshot, deleteAccountSnapshot,
  updateBalanceSnapshot, deleteBalanceSnapshot,
} from "../../../src/engine/mutate.ts";
import { Sparkline, HBar } from "../../lib/charts";
import HistoryList from "../../components/HistoryList";
import { T, money } from "../../lib/theme";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import {
  computeNetPosition, computeCategoryHistory, computeLoggedContributions,
} from "../../../src/engine/progress.ts";
import { computeLoanProgress } from "../../../src/engine/loans.ts";
import { primaryAccount, todayISO } from "../../../src/engine/model.ts";
import { cardColor, roleOfTrackerCategory, roleSuffix, LOAN_LINE } from "../../../src/engine/palette.ts";
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

      {/* Color by card POSITION, cycling — decoration, so five accounts
          are five distinguishable objects. Same function the web calls, so
          the phone and the laptop give an account the same color. */}
      {assets.map((cat, i) => (
        <AssetCard
          key={cat.id} cat={cat} color={cardColor(i, true)} chartW={chartW} today={today}
          online={online}
          onLog={() => setLogging(cat.id)}
          onLogContribution={() => setContributing(cat.id)}
          onEditEntry={(e) => setEditing({ catId: cat.id, id: e.id, amount: e.amount, date: e.date })}
          onDeleteEntry={(e) => void commit(
            (st) => deleteBalanceSnapshot(st, cat.id, e.id),
            `${cat.name} reading of ${money(e.amount)} on ${e.date} deleted`)}
        />
      ))}
      {debts.map((cat) => (
        <DebtCard
          key={cat.id} cat={cat} chartW={chartW} today={today}
          online={online}
          onLog={() => setLogging(cat.id)}
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

function DebtCard({ cat, chartW, today, online, onLog, onEditEntry, onDeleteEntry }: {
  cat: TrackerCategory; chartW: number; today: string; online: boolean; onLog: () => void;
  onEditEntry: (e: BalanceSnapshot) => void; onDeleteEntry: (e: BalanceSnapshot) => void;
}) {
  const { state } = useBudget();
  // No card color for loans, same as the web: the list is long, the cards
  // are labeled, and five hues on it is decoration you have to decode.
  const color = LOAN_LINE;
  const history = computeCategoryHistory(state!, cat.id);
  const p = computeLoanProgress(state!, cat, today);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel}>{cat.name}</Text>
        {roleSuffix(cat.name, roleOfTrackerCategory(cat)) && (
          <Text style={styles.roleTag}>· {roleSuffix(cat.name, roleOfTrackerCategory(cat))}</Text>
        )}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onLog} disabled={!online} style={[styles.logBtn, !online && styles.logOff]}>
          <Text style={styles.logText}>{online ? "Log" : "Offline"}</Text>
        </Pressable>
      </View>
      <Text style={[styles.cardNum, p?.outstanding == null && { color: T.faint }]}>
        {p?.outstanding != null ? money(p.outstanding) : "—"}
      </Text>
      <Text style={styles.dim}>
        {p?.latest ? `owed as of ${p.latest.date}` : "Add what you owe today and the Dashboard can show you where you stand."}
      </Text>

      {p && p.percentPaid != null && (
        <View style={styles.progress}>
          <HBar pct={p.percentPaid / 100} color={color} width={chartW} />
          <Text style={styles.dim}>
            {p.percentPaid}% paid off of {money(p.basis)}
            {p.everAboveOriginal ? " (peak owed)" : ""}
          </Text>
        </View>
      )}
      {p && p.aboveOriginal != null && (
        <Text style={[styles.dim, { color: T.expense }]}>
          {money(p.aboveOriginal)} above what was borrowed — interest has outpaced payments.
        </Text>
      )}
      {p && p.expectedNow != null && p.outstanding != null && (
        <Text style={styles.dim}>
          Projected about {money(p.expectedNow)} by now — you are{" "}
          {p.outstanding <= p.expectedNow ? "ahead" : "behind"}.
        </Text>
      )}

      <Sparkline points={history.map((h) => ({ date: h.date, amount: h.amount }))} color={color} width={chartW} />
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
