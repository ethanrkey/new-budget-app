import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { T, money } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useBudget } from "./StateProvider";
import { wipeToNewAccount } from "../../src/engine/mutate.ts";
import type { Session } from "@supabase/supabase-js";

// Everything the web header holds, behind ONE affordance.
//
// Five glyphs do not fit a phone header and the tab bar is spoken for by
// the four things you DO. So the four tabs stay, and everything you
// configure or read once lives behind the corner button, which is where
// iOS has trained people to look. Same shape as the web's Settings: a
// short list of sections, each opening its own screen.
//
// THE DANGER ZONE IS ON THE ROOT, not behind Account. Apple looks for
// in-app account deletion specifically, and three taps deep is three
// chances to conclude it is not there. The web buries it one level less
// than the phone would have.
const PROVIDER_LABEL: Record<string, string> = { google: "Google", email: "Email", apple: "Apple", github: "GitHub" };

export default function Settings({
  session, onOpenAbout, onOpenExport, onClose,
}: {
  session: Session;
  onOpenAbout: () => void;
  onOpenExport: () => void;
  onClose: () => void;
}) {
  const { state, commit, online, saving } = useBudget();
  const [deletion, setDeletion] = useState<{ purge_after: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  const email = session.user.email ?? "—";
  const providers = (session.user.app_metadata?.providers ?? []) as string[];
  const via = providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" and ") || "—";
  const since = session.user.created_at
    ? new Date(session.user.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "—";

  useEffect(() => {
    let dead = false;
    supabase.from("account_deletions").select("requested_at,purge_after")
      .eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (!dead) setDeletion(data ?? null); });
    return () => { dead = true; };
  }, [session.user.id]);

  const wipe = () =>
    Alert.alert(
      "Wipe all data?",
      "Every rule, one-off and per-date edit; your savings, investment and loan categories and their terms; every logged balance and contribution; and your verified checking balance, back to $0.00. Export a backup first — this cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Wipe everything", style: "destructive", onPress: () => void commit(() => wipeToNewAccount(), "Wiped all data") },
      ]
    );

  const requestDeletion = async () => {
    setDeleting(true);
    setBusyMsg(null);
    const { data, error } = await supabase
      .from("account_deletions")
      .upsert({ user_id: session.user.id }, { onConflict: "user_id" })
      .select("requested_at,purge_after").maybeSingle();
    setDeleting(false);
    if (error) { setBusyMsg(error.message); return; }
    setDeletion(data ?? null);
    setConfirmText("");
  };

  const cancelDeletion = async () => {
    setDeleting(true);
    const { error } = await supabase.from("account_deletions").delete().eq("user_id", session.user.id);
    setDeleting(false);
    if (error) { setBusyMsg(error.message); return; }
    setDeletion(null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>Settings</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <Fact term="Signed in as" value={email} />
          <Fact term="Signed in via" value={via} />
          <Fact term="Member since" value={since} />
          <Pressable
            style={styles.action}
            onPress={() => supabase.auth.signOut()}
            accessibilityRole="button" accessibilityLabel="Sign out"
          >
            <Text style={styles.actionText}>Sign out</Text>
            <Text style={styles.rowSub}>Your data stays on the server, tied to this account.</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>App</Text>
        <View style={styles.card}>
          <Row label="About & tour" sub="What every screen does, and a walk through the four tabs." onPress={onOpenAbout} />
          <Row label="Export" sub="Ledger or Budget as CSV, or the whole account as a JSON backup." onPress={onOpenExport} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>Appearance</Text>
              {/* Stated rather than offered: dark only is a decision, and
                  a toggle that does nothing is worse than its absence. */}
              <Text style={styles.rowSub}>Dark. The phone has one theme on purpose.</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionLabel, styles.danger]}>Danger zone</Text>
        <View style={styles.card}>
          <Pressable style={styles.action} onPress={wipe} disabled={!online || saving}
            accessibilityRole="button" accessibilityLabel="Wipe all data">
            <Text style={[styles.actionText, styles.danger]}>Wipe all data</Text>
            <Text style={styles.rowSub}>
              Resets this account to brand new. {state ? `${state.recurring.length + state.oneoffs.length} transactions and ${state.trackerCategories.length} categories` : "Everything"} goes.
            </Text>
          </Pressable>

          <View style={styles.sep} />

          {deletion ? (
            <View style={styles.action}>
              <Text style={[styles.actionText, styles.danger]}>Deletion scheduled</Text>
              <Text style={styles.rowSub}>
                Your whole account — the sign-in included — is scheduled for deletion on{" "}
                {new Date(deletion.purge_after).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
                You can still cancel.
              </Text>
              <Pressable style={styles.btn} onPress={() => void cancelDeletion()} disabled={deleting}
                accessibilityRole="button" accessibilityLabel="Cancel the deletion">
                <Text style={styles.btnText}>Cancel the deletion</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.action}>
              <Text style={[styles.actionText, styles.danger]}>Delete my account</Text>
              <Text style={styles.rowSub}>
                Schedules everything for deletion in 7 days: the sign-in, every rule, every logged
                balance. Cancellable until then. After that it is gone and there is no backup to
                restore from. Type DELETE to confirm.
              </Text>
              <TextInput
                style={styles.field}
                value={confirmText}
                onChangeText={setConfirmText}
                autoCapitalize="characters"
                placeholder="DELETE"
                placeholderTextColor={T.faint}
                accessibilityLabel="Type DELETE to confirm"
              />
              <Pressable
                style={[styles.btn, styles.btnDanger, (confirmText !== "DELETE" || deleting) && styles.disabled]}
                disabled={confirmText !== "DELETE" || deleting}
                onPress={() => void requestDeletion()}
                accessibilityRole="button" accessibilityLabel="Delete my account"
              >
                <Text style={styles.btnDangerText}>Delete my account</Text>
              </Pressable>
            </View>
          )}
          {busyMsg ? <Text style={styles.err}>{busyMsg}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const Fact = ({ term, value }: { term: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.factTerm}>{term}</Text>
    <Text style={styles.factValue} numberOfLines={1}>{value}</Text>
  </View>
);

const Row = ({ label, sub, onPress }: { label: string; sub: string; onPress: () => void }) => (
  <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}
    accessibilityRole="button" accessibilityLabel={label}>
    <View style={{ flex: 1 }}>
      <Text style={styles.rowText}>{label}</Text>
      <Text style={styles.rowSub}>{sub}</Text>
    </View>
    <Text style={styles.chev}>›</Text>
  </Pressable>
);

void money;

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { color: T.text, fontSize: 18, fontWeight: "700" },
  done: { color: T.brass, fontSize: 15, fontWeight: "600" },
  body: { padding: 16, paddingBottom: 48, gap: 6 },
  sectionLabel: { color: T.faint, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginTop: 14, marginBottom: 4 },
  card: { backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, paddingHorizontal: 12 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  pressed: { backgroundColor: T.surfaceAlt },
  rowText: { color: T.text, fontSize: 15 },
  rowSub: { color: T.faint, fontSize: 12, lineHeight: 17, marginTop: 2 },
  chev: { color: T.faint, fontSize: 20 },
  factTerm: { color: T.faint, fontSize: 13, width: 112 },
  factValue: { color: T.text, fontSize: 14, flex: 1 },
  action: { paddingVertical: 12, gap: 2 },
  actionText: { color: T.text, fontSize: 15, fontWeight: "600" },
  danger: { color: T.expense },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: T.border },
  field: { marginTop: 10, backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, color: T.text, fontSize: 15 },
  btn: { marginTop: 10, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" },
  btnText: { color: T.dim, fontSize: 14 },
  btnDanger: { backgroundColor: T.expense, borderColor: T.expense },
  btnDangerText: { color: "#111827", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  err: { color: T.expense, fontSize: 13, paddingVertical: 8 },
});
