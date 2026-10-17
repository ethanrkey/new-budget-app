import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { T, money } from "../lib/theme";
import * as feel from "../lib/haptics";
import { supabase } from "../lib/supabase";
import { SIGN_OUT_SCOPE } from "../../src/shared/signOutScope.ts";
import { useBudget } from "./StateProvider";
import { wipeToNewAccount } from "../../src/engine/mutate.ts";
import type { Session } from "@supabase/supabase-js";
import { fmtDate } from "../../src/shared/dates.ts";
import { withoutDismissalBy } from "../lib/dismissal";
import { buildLine, updateLine } from "../lib/version";

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
  session, onOpenAbout, onStartTour, onOpenExport, onOpenCategories, onOpenSetup, onClose,
}: {
  session: Session;
  onOpenAbout: () => void;
  onStartTour: () => void;
  onOpenExport: () => void;
  onOpenCategories: () => void;
  onOpenSetup: () => void;
  onClose: () => void;
}) {
  const { state, commit, online, saving, prefs, setPref } = useBudget();
  const [deletion, setDeletion] = useState<{ purge_after: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  const email = session.user.email ?? "—";
  const providers = (session.user.app_metadata?.providers ?? []) as string[];
  const via = providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" and ") || "—";
  const since = session.user.created_at
    ? fmtDate(new Date(session.user.created_at).toISOString().slice(0, 10))
    : "—";

  useEffect(() => {
    let dead = false;
    supabase.from("account_deletions").select("requested_at,purge_after")
      .eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (!dead) setDeletion(data ?? null); });
    return () => { dead = true; };
  }, [session.user.id]);

  const wipe = () => {
    feel.warning();
    return Alert.alert(
      "Wipe all data?",
      "Every rule, one-off and per-date edit; your savings, investment and loan categories and their terms; every logged balance and contribution; and your verified checking balance, back to $0.00. Export a backup first — this cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe everything", style: "destructive",
          onPress: () => {
            // The two device preferences that say "I have already been
            // shown this" go with the data — THIS account's entry in
            // each, not the whole list: another account on this phone
            // did not ask to be shown setup again. `wipeToNewAccount` is
            // `blankState()` for the same reason — a wipe has to mean a
            // new account, or the flags that make one feel used outlive
            // the account they described, and a wiped phone sits on an
            // empty Ledger with nothing offering to set it up.
            setPref("setupDismissedBy", withoutDismissalBy(prefs.setupDismissedBy, session.user.id));
            setPref("firstRunDismissedBy", withoutDismissalBy(prefs.firstRunDismissedBy, session.user.id));
            void commit(() => wipeToNewAccount(), "Wiped all data");
          },
        },
      ]
    );
  };

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
          {/* THE ONE THING ABOUT SIGN-IN THAT CAN FAIL QUIETLY.
              Apple requires that deleting an account also ends Apple's
              side of it, which needs a token filed with the server at
              sign-in. That call is deliberately not awaited — a user
              who just authenticated is signed in — so when it fails
              there is nothing on screen at all. For several days it
              was failing with `invalid_client` and the only record was
              an edge function log. Now it says so, here, where the
              other facts about this sign-in live. */}
          {prefs.appleLinkFailed && (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Apple sign-in isn&apos;t fully linked</Text>
              <Text style={styles.rowSub}>
                You are signed in and everything works. What did not finish is the part that lets
                deleting your account also end Apple&apos;s side of it. Sign out and sign in with
                Apple again to retry; if it keeps happening, email support@keybudget.app.
              </Text>
            </View>
          )}
          <Pressable
            style={styles.action}
            onPress={() => supabase.auth.signOut(SIGN_OUT_SCOPE)}
            accessibilityRole="button" accessibilityLabel="Sign out"
          >
            <Text style={styles.actionText}>Sign out</Text>
            <Text style={styles.rowSub}>Your data stays on the server, tied to this account.</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>App</Text>
        <View style={styles.card}>
          <Row
            label="Accounts you track"
            sub="Savings, investments and loans — add, rename, reorder, or set a loan's terms."
            onPress={onOpenCategories}
          />
          {/* The web keeps a Setup button in its header for the same
              reason: somebody who skipped the six questions, or who
              wiped their data, needs a way back to them. It adds what
              you answer — it does not replace what is already there —
              so it is described as adding rather than as starting
              over. */}
          <Row
            label="Set up your budget"
            sub="The six questions a new account is asked. Answers are added to what you already have."
            onPress={onOpenSetup}
          />
          {/* TWO ROWS, not one, from 2026-10-17. "About & tour" was one
              row that opened About, where the tour was a button — so
              the one thing people come back for was two taps behind a
              label that promised it in one. A row that names two
              things and does one of them is a row that is wrong about
              itself. */}
          <Row label="About" sub="What every screen does, and why it works the way it does." onPress={onOpenAbout} />
          <Row label="Take the tour" sub="A walk through the four tabs. Takes a minute." onPress={onStartTour} />
          <Row label="Export" sub="Ledger or Budget as CSV, or the whole account as a JSON backup." onPress={onOpenExport} />
          {/* NO APPEARANCE ROW. There was one, stating "Dark. The phone
              has one theme on purpose." — a setting with no choice in
              it, which reads as a control that is broken rather than
              as a decision that has been made. Removed 2026-10-15. If
              light mode is ever asked for it comes back as a real
              toggle; until then the absence says more than the
              sentence did. */}
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
                {fmtDate(new Date(deletion.purge_after).toISOString().slice(0, 10))}.
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
                balance. Cancelable until then. After that it is gone and there is no backup to
                restore from. Type DELETE to confirm.
              </Text>
              <TextInput
                style={styles.field}
                value={confirmText}
                // Account deletion has no alert to warn before — the
                // confirmation IS this field. So the moment marked is
                // the one where the button goes live.
                onChangeText={(v) => { if (v === "DELETE" && confirmText !== "DELETE") feel.warning(); setConfirmText(v); }}
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

        {/* WHICH COPY OF THE APP IS THIS? Two lines, because they are
            two different answers and a tester reporting a bug needs
            both: the binary came from TestFlight, the JS may have been
            replaced over the air since. See lib/version.ts. */}
        <View style={styles.footer}>
          <Text style={styles.footText} accessibilityLabel={`Version. ${buildLine()}`}>{buildLine()}</Text>
          <Text style={styles.footText} accessibilityLabel={`Update. ${updateLine()}`}>{updateLine()}</Text>
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
  footer: { paddingTop: 18, paddingBottom: 8, gap: 2, alignItems: "center" },
  footText: { color: T.faint, fontSize: 11 },
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
  notice: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.border,
    paddingTop: 12, marginTop: 4, gap: 4,
  },
  noticeTitle: { color: T.brass, fontSize: 14, fontWeight: "700" },
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
