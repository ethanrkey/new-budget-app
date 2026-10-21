import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { T } from "../lib/theme";
import * as feel from "../lib/haptics";
import { supabase } from "../lib/supabase";
import { useBudget } from "./StateProvider";
import NativeSheet from "./NativeSheet";
import { fmtInstant } from "../../src/shared/dates.ts";
import { CONNECT_CONSENT, DISCONNECT_NOTE, PLAID_PORTAL_URL } from "../../src/content/connect.ts";
import { canSeeToggle } from "../../src/shared/connect.ts";
import {
  disconnect as apiDisconnect, pullBalance, readConnection, startLink,
} from "../../src/shared/plaidApi.ts";
import { allowlistedNow, setConnection, useConnection } from "../lib/connection";

// Connected checking, on the phone. The Settings half: the toggle,
// the bank, and the way out.
//
// THE TOGGLE IS THE GATE AND IT IS OFF. Manual entry is the product
// and this is an optional extra — so while the switch is off, there
// is no Connect anywhere, nothing here loads a browser, and the only
// Plaid-shaped thing in the bundle is the word "Plaid" in some copy.
// That is the difference between a feature that is hidden and one
// that is not running.
//
// WHY THE ALLOWLIST IS SEPARATE FROM THE TOGGLE. The allowlist is a
// term of Plaid's plan — live connections are limited to people the
// owner knows — and it is NOT a beta flag that comes off at launch.
// Someone not on it sees this whole section absent, which is
// indistinguishable from the feature not existing, and that is the
// intended experience rather than an accident.
//
// ON IOS, CONNECT OPENS HOSTED LINK IN A BROWSER, because the native
// SDK is native code and there are no EAS builds left this month.
// `expo-web-browser` is already in build 13, so this ships over the
// air. Hosted Link has NO frontend callback — the public_token
// reaches the server through a webhook — so when the browser closes
// there is nothing to hand back and the only correct thing to do is
// re-read our own connection. See supabase/functions/plaid-exchange.

export default function Connected() {
  const { state, commit, refresh: resyncState } = useBudget();
  const on = !!state?.settings.connectedFeatures;

  // ONE CONNECTION, SHARED WITH THE PILL. This screen used to keep
  // its own copy, which meant connecting here updated Settings and
  // left the Checking strip on four tabs still saying "as of" — the
  // pill had no way to learn that a bank now existed until the app
  // was restarted. The store in lib/connection.ts is the one answer
  // and everything that changes it writes there.
  const { connection, allowlisted } = useConnection();
  const [consenting, setConsenting] = useState(false);
  const [busy, setBusy] = useState<null | "connecting" | "saving" | "disconnecting">(null);

  const refreshConnection = useCallback(async () => {
    const row = await readConnection(supabase as never);
    setConnection(row && { institutionName: row.institutionName, status: row.status, lastSyncedAt: row.lastSyncedAt, mask: row.mask });
    return row;
  }, []);

  useEffect(() => {
    if (!on || !allowlisted) return;
    void refreshConnection();
  }, [on, allowlisted, refreshConnection]);

  // Nothing at all for anyone not on the list. Not a disabled row,
  // not an explanation — absent.
  if (!canSeeToggle(allowlistedNow() || allowlisted)) return null;

  async function setToggle(next: boolean) {
    if (next) {
      feel.selection();
      await commit((s) => ({ ...s, settings: { ...s.settings, connectedFeatures: true } }), "Connected features on", "none");
      return;
    }
    // TURNING IT OFF DISCONNECTS, and says so first. The switch is
    // not a visibility control: leaving an Item live at Plaid while
    // the app claims the feature is off would be the worst reading
    // of this screen.
    if (!connection) {
      feel.selection();
      await commit((s) => ({ ...s, settings: { ...s.settings, connectedFeatures: false } }), "Connected features off", "none");
      return;
    }
    feel.warning();
    Alert.alert(
      "Turn off connected features?",
      `This disconnects ${connection.institutionName ?? "your bank"} right away. Balances already pulled stay in your history, the same as ones you typed.`,
      [
        { text: "Keep it on", style: "cancel" },
        {
          text: "Turn off", style: "destructive",
          onPress: () => { void doDisconnect(true); },
        },
      ],
    );
  }

  async function doDisconnect(alsoToggleOff: boolean) {
    setBusy("disconnecting");
    const ok = await apiDisconnect(supabase as never);
    setBusy(null);
    if (!ok) {
      feel.failure();
      Alert.alert("Couldn't disconnect", "Nothing changed. Check your connection and try again.");
      return;
    }
    feel.success();
    setConnection(null);
    if (alsoToggleOff) {
      await commit((s) => ({ ...s, settings: { ...s.settings, connectedFeatures: false } }), "Connected features off", "none");
    }
  }

  async function openLink() {
    setConsenting(false);
    setBusy("connecting");
    const started = await startLink(supabase as never, true);
    if ("error" in started || !started.hostedUrl) {
      setBusy(null);
      feel.failure();
      Alert.alert("Couldn't start", `We couldn't reach the connection service (${"error" in started ? started.error : "no link"}). Try again in a moment.`);
      return;
    }
    // The browser closing tells us nothing — Hosted Link reports its
    // result to the server, not to us. So we re-read, and a session
    // the user abandoned simply leaves nothing to find.
    await WebBrowser.openAuthSessionAsync(started.hostedUrl);
    // The browser closing tells us nothing, so the first question is
    // whether a connection now exists. If it does, PULL STRAIGHT
    // AWAY — connecting and then seeing nothing happen is the worst
    // first impression of a feature whose whole promise is that the
    // number keeps itself current.
    //
    // Trigger "open", not "refresh": a brand new Item has never
    // synced, so the staleness check passes on its own and this does
    // not spend one of the four daily refreshes on the connection.
    setBusy("saving");
    let row = await refreshConnection();
    if (row) {
      await pullBalance(supabase as never, "open");
      row = await refreshConnection();
      await resyncState();
    }
    setBusy(null);
    if (row) feel.success();
  }

  // LOCAL DATE AND LOCAL TIME, from the instant. It used to slice
  // the UTC date off the string and pair it with a local clock.
  const lastSync = connection?.lastSyncedAt ? fmtInstant(connection.lastSyncedAt) : "never";

  return (
    <>
      <Text style={styles.sectionLabel}>Connected features</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowText}>Connect your bank</Text>
            {/* WHAT IT DOES AND WHAT IT DOES NOT, in the same breath.
                A sub-line that only said "keep your balance up to
                date" would be selling. */}
            <Text style={styles.rowSub}>
              Off by default. When on, Key Budget can read your checking balance — and nothing
              else. You can always log balances by hand instead.
            </Text>
          </View>
          <Switch
            value={on}
            onValueChange={(v) => { void setToggle(v); }}
            disabled={!!busy}
            trackColor={{ true: T.brass, false: T.border }}
            accessibilityLabel="Connected features"
          />
        </View>

        {on && !connection && (
          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            onPress={() => { feel.light(); setConsenting(true); }}
            disabled={!!busy}
            accessibilityRole="button" accessibilityLabel="Connect your bank"
          >
            <Text style={styles.actionText}>Connect your bank (Beta)</Text>
            <Text style={styles.rowSub}>Checking only. We&apos;ll show you exactly what this shares first.</Text>
          </Pressable>
        )}

        {on && connection && (
          <>
            {/* THE BANK NAME LIVES HERE AND NOWHERE ELSE, on the
                owner's call: the pill says when, not who. */}
            <View style={styles.row}>
              <Text style={styles.factTerm}>Bank</Text>
              <Text style={styles.factValue} numberOfLines={1}>
                {connection.institutionName ?? "Connected"}{connection.mask ? ` ••${connection.mask}` : ""}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.factTerm}>Last synced</Text>
              <Text style={styles.factValue}>{lastSync}</Text>
            </View>
            {connection.status === "login_required" && (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Your bank needs you to sign in again</Text>
                <Text style={styles.rowSub}>
                  Balances have stopped updating until you reconnect. Everything you have already
                  logged is unaffected.
                </Text>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              onPress={() => {
                feel.warning();
                Alert.alert("Disconnect your bank?", DISCONNECT_NOTE, [
                  { text: "Keep connected", style: "cancel" },
                  { text: "Disconnect", style: "destructive", onPress: () => { void doDisconnect(false); } },
                ]);
              }}
              disabled={!!busy}
              accessibilityRole="button" accessibilityLabel="Disconnect your bank"
            >
              <Text style={[styles.actionText, styles.danger]}>Disconnect</Text>
              {/* THE PORTAL NOTE IS REPEATED HERE rather than
                  cross-referenced. The consent screen is read once, at
                  the beginning; this is read months later by somebody
                  who has decided to leave, and "we told you at the
                  start" is not an answer to them. */}
              <Text style={styles.rowSub}>{DISCONNECT_NOTE}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => { feel.light(); void Linking.openURL(PLAID_PORTAL_URL); }}
              accessibilityRole="link" accessibilityLabel="Open Plaid Portal"
            >
              <Text style={styles.link}>Open Plaid Portal</Text>
            </Pressable>
          </>
        )}

        {/* A NAMED WAIT, not a blank gap. Connecting takes five to
            seven seconds — a Link token, an exchange, three more
            Plaid calls and the first pull — and an empty card for
            that long reads as a failure. */}
        {busy && (
          <View style={styles.waiting}>
            <ActivityIndicator color={T.dim} />
            <Text style={styles.waitingText}>
              {busy === "connecting" ? "Opening your bank…"
                : busy === "saving" ? "Saving the connection…"
                : "Disconnecting…"}
            </Text>
          </View>
        )}
      </View>

      <ConsentSheet
        open={consenting}
        onCancel={() => { feel.selection(); setConsenting(false); }}
        onContinue={() => { void openLink(); }}
      />
    </>
  );
}

// The consent screen, shown IMMEDIATELY BEFORE Link opens and not a
// moment earlier. Every word of it is in src/content/connect.ts,
// where there is a test that writes the sentences out rather than
// reading them back — this file draws them and decides nothing.
function ConsentSheet({ open, onCancel, onContinue }: {
  open: boolean; onCancel: () => void; onContinue: () => void;
}) {
  // NOT SWIPE-DISMISSIBLE. A consent screen is a decision, and "Not
  // now" is a complete answer that has to be given rather than slid
  // past — the same rule SaveFailure and UnsavedNotice follow.
  return (
    <NativeSheet visible={open} onClose={onCancel} swipeToClose={false}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{CONNECT_CONSENT.title}</Text>
        {CONNECT_CONSENT.bullets.map((b) => (
          <View key={b} style={styles.bullet}>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
        <Pressable
          onPress={() => { void Linking.openURL(CONNECT_CONSENT.footerLinkUrl); }}
          accessibilityRole="link" accessibilityLabel={CONNECT_CONSENT.footerLinkText}
        >
          <Text style={styles.footer}>
            {CONNECT_CONSENT.footer} <Text style={styles.link}>{CONNECT_CONSENT.footerLinkText}</Text>
          </Text>
        </Pressable>
        <View style={styles.buttons}>
          {/* "Not now" FIRST and in the quiet style. Continue is not
              the default, is not preselected, and is not larger: a
              consent screen whose layout argues for one answer is a
              consent screen that is asking rhetorically. */}
          <Pressable
            style={({ pressed }) => [styles.btn, styles.ghost, pressed && styles.pressed]}
            onPress={onCancel} accessibilityRole="button" accessibilityLabel={CONNECT_CONSENT.cancel}
          >
            <Text style={styles.ghostText}>{CONNECT_CONSENT.cancel}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.btn, styles.primary, pressed && styles.pressed]}
            onPress={onContinue} accessibilityRole="button" accessibilityLabel={CONNECT_CONSENT.confirm}
          >
            <Text style={styles.primaryText}>{CONNECT_CONSENT.confirm}</Text>
          </Pressable>
        </View>
      </View>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { color: T.faint, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginTop: 14, marginBottom: 4 },
  card: { backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  rowText: { color: T.text, fontSize: 15 },
  rowSub: { color: T.faint, fontSize: 12, lineHeight: 17, marginTop: 2 },
  factTerm: { color: T.dim, fontSize: 13, flex: 1 },
  factValue: { color: T.text, fontSize: 14, flexShrink: 1 },
  action: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  actionText: { color: T.text, fontSize: 15 },
  danger: { color: T.expense },
  link: { color: T.brass, fontSize: 13 },
  notice: { backgroundColor: T.bg, borderRadius: 10, borderWidth: 1, borderColor: T.border, padding: 10, marginVertical: 8 },
  noticeTitle: { color: T.text, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  waiting: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  waitingText: { color: T.dim, fontSize: 14 },
  sheet: { padding: 20, gap: 10 },
  sheetTitle: { color: T.text, fontSize: 19, fontWeight: "700", marginBottom: 4 },
  bullet: { flexDirection: "row", gap: 8 },
  dot: { color: T.faint, fontSize: 14, lineHeight: 21 },
  bulletText: { color: T.dim, fontSize: 14, lineHeight: 21, flex: 1 },
  footer: { color: T.faint, fontSize: 12, marginTop: 6 },
  buttons: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
});
