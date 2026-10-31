import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Switch, Text, View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { T } from "../lib/theme";
import * as feel from "../lib/haptics";
import { supabase } from "../lib/supabase";
import { useBudget } from "./StateProvider";
import NativeSheet from "./NativeSheet";
import { fmtDate, fmtInstant } from "../../src/shared/dates.ts";
import {
  BETA_NOTE, CONNECT_CONSENT, CONNECT_REFUSED, CONNECT_TOGGLE, CONNECT_TOGGLE_SUB, DISCONNECT_NOTE,
  PLAID_PORTAL_URL, RECONNECT, TOGGLE_OFF_CONFIRM, connectRefusedText,
} from "../../src/content/connect.ts";
import type { Connection } from "../../src/shared/connect.ts";
import { canReconnect, canSeeToggle, shouldRestoreToggle } from "../../src/shared/connect.ts";
import {
  disconnect as apiDisconnect, pullBalance, readConnection, recoverLink, startLink,
} from "../../src/shared/plaidApi.ts";
import { allowlistedNow, connectionNow, setConnection, useConnection } from "../lib/connection";

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
  const { connection, allowlisted, loaded } = useConnection();
  const [consenting, setConsenting] = useState(false);
  const [busy, setBusy] = useState<null | "connecting" | "reconnecting" | "saving" | "disconnecting">(null);

  const refreshConnection = useCallback(async () => {
    const row = await readConnection(supabase as never);
    setConnection(row && { institutionName: row.institutionName, status: row.status, lastSyncedAt: row.lastSyncedAt, mask: row.mask });
    return row;
  }, []);

  useEffect(() => {
    if (!on || !allowlisted) return;
    void refreshConnection();
  }, [on, allowlisted, refreshConnection]);

  // SET BY openLink WHEN HOSTED LINK CAME BACK WITH A LIVE BANK.
  //
  // It cannot be checked inside openLink itself. The last thing that
  // function does is re-sync this device's state from the server,
  // and the `commit` it is holding was bound to the state of the
  // render it started in — so a write made there would be made
  // against the copy the re-sync just replaced. Here it runs on the
  // render AFTER the re-sync, with a `commit` that is looking at the
  // same state the user is.
  // THE ROW ITSELF, not the shared store's copy of it. If the
  // re-synced settings say off, everything that reads the store is
  // already being told there is no connection — including the store,
  // which clears itself when the feature is off. Holding the row we
  // actually read keeps the evidence out of reach of the state it is
  // evidence against.
  const cameBackConnected = useRef<Connection | null>(null);
  useEffect(() => {
    const row = cameBackConnected.current;
    if (!row || !state) return;
    if (shouldRestoreToggle(state.settings, row)) {
      cameBackConnected.current = null;
      void commit((s) => ({ ...s, settings: { ...s.settings, connectedFeatures: true } }),
        "Connected features on", "none");
      return;
    }
    if (state.settings.connectedFeatures) cameBackConnected.current = null;
  }, [state, commit]);

  // COMING BACK TO THE APP IS THE OTHER WAY TO RETURN FROM LINK.
  // Hosted Link runs in an in-app browser, and a user who switches
  // away instead of closing it gets here rather than through
  // openLink's await. Same two questions, same order.
  useEffect(() => {
    if (!allowlisted) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !on) return;
      void (async () => {
        // NO BANK YET? ASK WHETHER ONE IS WAITING. A user who
        // switched away from the in-app browser instead of closing
        // it never reaches openLink's await, and a webhook that was
        // late, lost or refused never arrives at all — either way
        // the Item is live at Plaid and this is the moment to find
        // it. It costs one function call and no Plaid call unless
        // there really is an unfinished session.
        if (!connectionNow()) await recoverLink(supabase as never);
        await refreshConnection();
        await resyncState();
      })();
    });
    return () => { sub.remove(); };
  }, [allowlisted, on, refreshConnection, resyncState]);

  // NOT ON THE LIST: one line saying the feature exists and is a small
  // beta, and nothing to press. Nothing until the allowlist answer is
  // in, so an allowlisted account never flashes the beta note.
  if (!canSeeToggle(allowlistedNow() || allowlisted)) {
    if (!loaded) return null;
    return (
      <>
        <Text style={styles.sectionLabel}>Connected features</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={[styles.rowSub, { flex: 1 }]}>{BETA_NOTE}</Text>
          </View>
        </View>
      </>
    );
  }

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
      TOGGLE_OFF_CONFIRM.title,
      TOGGLE_OFF_CONFIRM.body(connection.institutionName ?? "your bank"),
      [
        { text: TOGGLE_OFF_CONFIRM.keep, style: "cancel" },
        {
          text: TOGGLE_OFF_CONFIRM.turnOff, style: "destructive",
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

  /**
   * Open Hosted Link. `update` reopens the SAME Item.
   *
   * NEVER DISCONNECT-THEN-CONNECT TO FIX A LOGIN. Plaid's Trial is
   * ten Items EVER, `/item/remove` does not give one back, and two
   * Items for the same account count as two — so the repair path has
   * to be update mode or it quietly costs a slot out of ten.
   */
  async function openLink(update = false) {
    setConsenting(false);
    setBusy(update ? "reconnecting" : "connecting");
    const started = await startLink(supabase as never, true, update);
    if ("error" in started || !started.hostedUrl) {
      setBusy(null);
      feel.failure();
      if (update) { Alert.alert("Couldn't reconnect", RECONNECT.failed); return; }
      // THE TWO GUARDRAILS ARE NOT ERRORS and must not read as
      // ones. "Full" and "cooling down" are the Trial's ten Items
      // being looked after; the sentence for each is in
      // content/connect.ts so the phone and the browser cannot
      // disagree about what BETA_FULL means. Anything else is a
      // real failure and still says so.
      const refusal = "error" in started
        ? connectRefusedText(started.error, started.until ? fmtDate(started.until.slice(0, 10)) : null)
        : CONNECT_REFUSED.failed;
      Alert.alert("Couldn't start", refusal);
      return;
    }

    if (update) {
      await WebBrowser.openAuthSessionAsync(started.hostedUrl);
      // NOTHING IS EXCHANGED and no webhook matters here: update mode
      // produces no new Item, and the browser closing tells us
      // nothing either way. A PULL THAT WORKS is the only proof the
      // repair took — and the only thing that clears the status,
      // since `reconnect` is the one trigger allowed past a
      // login_required item. See plaid-balance.
      setBusy("saving");
      const result = await pullBalance(supabase as never, "reconnect");
      await refreshConnection();
      await resyncState();
      setBusy(null);
      if (result?.synced) { feel.success(); Alert.alert("Reconnected", RECONNECT.fixed); }
      else { feel.failure(); Alert.alert("Still disconnected", RECONNECT.stillBroken); }
      return;
    }
    // The browser closing tells us nothing — Hosted Link reports its
    // result to the server, not to us.
    await WebBrowser.openAuthSessionAsync(started.hostedUrl);

    // SO WE ASK PLAID OURSELVES RATHER THAN WAIT TO BE TOLD.
    //
    // This used to re-read our own tables and hope the webhook had
    // beaten the user back to the app. On 2026-10-21 a real TD Bank
    // connection completed at Plaid and the webhook never arrived:
    // the Item was live, the slot was spent, Settings showed
    // "Connect your bank" and the only route the user could see was
    // connecting again — which would have cost a second slot out of
    // ten. `recover` asks /link/token/get for this user's own
    // unfinished session, which is the same question the webhook
    // triggers and the half of that design that was ever
    // trustworthy. NO_OPEN_SESSION just means the webhook won the
    // race, which is the happy path and not an error.
    //
    // Then PULL STRAIGHT AWAY if a bank turned up — connecting and
    // seeing nothing happen is the worst first impression of a
    // feature whose whole promise is that the number keeps itself
    // current. Trigger "open", not "refresh": a brand new Item has
    // never synced, so the staleness check passes on its own and
    // this does not spend one of the four daily refreshes.
    setBusy("saving");
    await recoverLink(supabase as never);
    let row = await refreshConnection();
    if (row) {
      await pullBalance(supabase as never, "open");
      row = await refreshConnection();
      // A LIVE BANK IS THE FEATURE BEING ON. The re-sync below takes
      // this device's settings from the server, and on 2026-10-21 an
      // iOS connection came back from Hosted Link with the bank
      // saved, pulled, and the switch showing off — after which
      // nothing read the connection again, because the switch said
      // there was nothing to read. The effect above puts it back
      // once the re-synced state has landed; see shouldRestoreToggle.
      cameBackConnected.current = row;
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
            <Text style={styles.rowText}>{CONNECT_TOGGLE}</Text>
            {/* BOTH WORDS FROM src/content/connect.ts. This sentence
                was written out here AND in the web's
                ConnectedAccount.jsx, so the owner's one-line edit to
                it was two edits. */}
            <Text style={styles.rowSub}>{CONNECT_TOGGLE_SUB}</Text>
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
            {canReconnect(connection) && (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Your bank needs you to sign in again</Text>
                <Text style={styles.rowSub}>{RECONNECT.why}</Text>
                {/* THE ONLY REPAIR PATH, and it is update mode. A
                    notice saying "until you sign in again" beside no
                    way to do it leaves Disconnect as the obvious
                    move — which costs a second Trial slot for the
                    same bank account. */}
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  onPress={() => { feel.light(); void openLink(true); }}
                  disabled={!!busy}
                  accessibilityRole="button" accessibilityLabel={RECONNECT.action}
                >
                  <Text style={styles.actionText}>{RECONNECT.action}</Text>
                </Pressable>
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
                : busy === "reconnecting" ? RECONNECT.busy
                : busy === "saving" ? "Saving the connection…"
                : "Disconnecting…"}
            </Text>
          </View>
        )}
      </View>

      <ConsentSheet
        open={consenting}
        onCancel={() => { feel.selection(); setConsenting(false); }}
        onContinue={() => { void openLink(false); }}
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
