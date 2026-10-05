import { useEffect, useState } from "react";
import {
  LayoutAnimation, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, UIManager, View, useWindowDimensions,
} from "react-native";
import { useBudget } from "../../components/StateProvider";
import LogBalance, { currently } from "../../components/LogBalance";
import { updateAccountBalance, addBalanceSnapshot } from "../../../src/engine/mutate.ts";
import { Sparkline, HBar } from "../../lib/charts";
import { T, money } from "../../lib/theme";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import {
  computeNetPosition, computeCategoryHistory, computeLoggedContributions,
} from "../../../src/engine/progress.ts";
import { computeLoanProgress } from "../../../src/engine/loans.ts";
import { primaryAccount, todayISO } from "../../../src/engine/model.ts";
import { roleColor, roleOfTrackerCategory, roleSuffix } from "../../../src/engine/palette.ts";
import type { TrackerCategory } from "../../../src/engine/types.ts";

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
  const { state, refresh, refreshing, commit, online, saving } = useBudget();
  // null = closed; "checking" = the account; otherwise a category id.
  const [logging, setLogging] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setSession(data.session)); }, []);
  const { width } = useWindowDimensions();
  const [heroOpen, setHeroOpen] = useState(true);
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
      <Pressable style={styles.hero} onPress={() => { animate(); setHeroOpen((v) => !v); }}>
        <View style={styles.heroHead}>
          <Text style={styles.label}>Net position</Text>
          <Text style={styles.chev}>{heroOpen ? "⌃" : "⌄"}</Text>
        </View>
        <Text style={[styles.heroNum, net.net < 0 ? { color: T.expense } : net.net > 0 ? { color: T.income } : null]}>
          {money(net.net)}
        </Text>
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
        history={(state!.accountSnapshots?.[account.id] ?? []).map((s) => ({ date: s.date, amount: s.amount }))}
        color={T.text}
        chartW={chartW}
      />

      {assets.map((cat) => (
        <AssetCard key={cat.id} cat={cat} chartW={chartW} today={today}
          online={online} onLog={() => setLogging(cat.id)} />
      ))}
      {debts.map((cat) => (
        <DebtCard key={cat.id} cat={cat} chartW={chartW} today={today}
          online={online} onLog={() => setLogging(cat.id)} />
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
            const okSaved = await commit((s) =>
              id === "checking"
                ? updateAccountBalance(s, primaryAccount(s).id, amount, date)
                : addBalanceSnapshot(s, id, amount, date)
            );
            if (okSaved) setLogging(null);
          }}
        />
      )}

      <Text style={styles.signout} onPress={() => supabase.auth.signOut()}>Sign out</Text>
      <Text style={styles.ro}>Read-only on mobile. Edits still happen on the web.</Text>
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

function History({ entries }: { entries: { date: string; amount: number }[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <View>
      <Pressable onPress={() => { animate(); setOpen((v) => !v); }} style={styles.showBtn}>
        <Text style={styles.showText}>
          {open ? "Hide history" : `Show history (${entries.length})`}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.histWrap}>
          {[...entries].reverse().map((e, i) => (
            <View key={`${e.date}-${i}`} style={styles.histRow}>
              <Text style={styles.histDate}>{e.date}</Text>
              <Text style={styles.histAmt}>{money(e.amount)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AccountCard({ name, balance, asOf, history, color, chartW, online, onLog }: {
  name: string; balance: number; asOf: string;
  history: { date: string; amount: number }[]; color: string; chartW: number;
  online: boolean; onLog: () => void;
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
      <History entries={history} />
    </View>
  );
}

function AssetCard({ cat, chartW, today, online, onLog }: { cat: TrackerCategory; chartW: number; today: string; online: boolean; onLog: () => void }) {
  const { state } = useBudget();
  const color = roleColor(roleOfTrackerCategory(cat), true);
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
      <Text style={[styles.cardNum, { color: latest ? color : T.faint }]}>
        {latest ? money(latest.amount) : "—"}
      </Text>
      <Text style={styles.dim}>
        {latest ? `logged ${latest.date}` : "Add what's in it today and the Dashboard can show you where you stand."}
      </Text>
      <Sparkline points={history.map((h) => ({ date: h.date, amount: h.amount }))} color={color} width={chartW} />

      {/* Contributions are LOGGED, never summed from the ledger — the ledger
          is a forecast, so that figure would be what you planned to put in. */}
      <View style={styles.contrib}>
        <Text style={styles.dim}>Contributed {year}</Text>
        {contrib.logged ? (
          <Text style={styles.contribNum}>{money(contrib.byYear[year] ?? 0)}</Text>
        ) : (
          <Text style={styles.contribNone}>Nothing logged yet.</Text>
        )}
      </View>
      <History entries={history.map((h) => ({ date: h.date, amount: h.amount }))} />
    </View>
  );
}

function DebtCard({ cat, chartW, today, online, onLog }: { cat: TrackerCategory; chartW: number; today: string; online: boolean; onLog: () => void }) {
  const { state } = useBudget();
  const color = roleColor(roleOfTrackerCategory(cat), true);
  const history = computeCategoryHistory(state!, cat.id);
  const p = computeLoanProgress(state!, cat, today);

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
      <Text style={[styles.cardNum, { color: p?.outstanding != null ? color : T.faint }]}>
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
      <History entries={history.map((h) => ({ date: h.date, amount: h.amount }))} />
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
  contrib: { marginTop: 4 },
  contribNum: { color: T.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  contribNone: { color: T.faint, fontSize: 12 },
  progress: { gap: 4, marginTop: 4 },
  showBtn: { paddingVertical: 8 },
  showText: { color: T.brass, fontSize: 12 },
  histWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.border, paddingTop: 6 },
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
