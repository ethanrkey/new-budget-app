import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import * as feel from "../lib/haptics";
import { supabase } from "../lib/supabase";
import NativeSheet from "./NativeSheet";
import { useBudget } from "./StateProvider";
import { fmtInstant } from "../../src/shared/dates.ts";
import { PILL_SHEET, RECONNECT } from "../../src/content/connect.ts";
import {
  canReconnect, canUseBankBalance, refreshOutcome, type Connection, type PillState,
} from "../../src/shared/connect.ts";
import { pullBalance } from "../../src/shared/plaidApi.ts";
import { setConnection } from "../lib/connection";

// What the Checking pill opens when there is a bank behind it.
//
// TWO DOORS, AND THE MANUAL ONE IS NOT THE SMALL PRINT. Someone with
// a connected bank still knows things their bank does not — a check
// that has not cleared, cash they just spent — and "Log manually"
// has to be as reachable as it was before they connected. It is the
// same weight as Refresh, in the same list, because manual entry did
// not become a fallback the day they connected.
//
// A REFRESH THAT DOES NOTHING SAYS SO, in words, and never as an
// error. The server declines for four ordinary reasons — too soon,
// already fresh, four times today already, the bank returned
// nothing — and a silent button reads as broken while a red one
// reads as a failure that did not happen. See `refreshOutcome`.
export default function ConnectedSheet({ open, connection, pill, onClose, onLogManually, onReconnect }: {
  open: boolean;
  connection: Connection | null;
  /** Which of the five states the bar is in — decides whether
   *  "Use bank balance" would do anything. */
  pill: PillState;
  onClose: () => void;
  onLogManually: () => void;
  /**
   * Opens Settings, where the repair lives.
   *
   * IT DOES NOT OPEN LINK FROM HERE. Update mode is the only repair
   * path — Plaid's ten Trial Items never come back — and a second
   * component that knows how to open Link is a second place for
   * "which mode?" to be answered wrongly. One door, in Settings.
   */
  onReconnect: () => void;
}) {
  const { refresh: resyncState } = useBudget();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  // LOCAL DATE AND LOCAL TIME, from the instant. This was the third
  // copy of `fmtDate(iso.slice(0, 10))` beside a local clock — a UTC
  // date next to tonight's time — and it survived the 2026-10-20 fix
  // because only two of the three were found. fmtInstant does both
  // halves in one zone.
  const when = connection?.lastSyncedAt ? fmtInstant(connection.lastSyncedAt) : "never";

  async function refresh() {
    setBusy(true);
    setSaid(null);
    const result = await pullBalance(supabase as never, "refresh");
    setBusy(false);
    if (!result) { feel.failure(); setSaid("Couldn't reach your bank just now"); return; }
    if (result.synced) {
      feel.success();
      setConnection(connection && {
        ...connection,
        status: result.status ?? connection.status,
        lastSyncedAt: result.lastSyncedAt ?? connection.lastSyncedAt,
      });
      // THE NUMBER ON SCREEN IS STALE UNTIL THE STATE IS RE-READ.
      // The pull wrote a snapshot server-side; nothing in this app
      // would have noticed.
      await resyncState();
      // `kept_manual` means the write was declined because today's
      // balance is one the user typed. That is the collision rule
      // working, so it is reported as a fact rather than a failure.
      setSaid(result.applied === "kept_manual"
        ? "Your bank matched — today's balance is still the one you logged"
        : null);
      if (result.applied !== "kept_manual") onClose();
      return;
    }
    feel.light();
    setSaid(refreshOutcome(result.reason) ?? "Nothing to update");
  }

  // NO PLAID CALL AND NO COST. The number is already stored from the
  // last pull; this only decides which of two rows wins today.
  async function adopt() {
    setBusy(true);
    setSaid(null);
    const result = await pullBalance(supabase as never, "adopt");
    setBusy(false);
    if (!result?.synced) { feel.failure(); setSaid("Couldn't switch to the bank's balance"); return; }
    feel.success();
    await resyncState();
    onClose();
  }

  return (
    <NativeSheet visible={open} onClose={onClose} swipeToClose={!busy}>
      <View style={styles.sheet}>
        {/* FIRST, AND INSTEAD OF REFRESH, when the bank is asking to
            be signed into again: refreshing a connection in that
            state cannot work, and offering it at the top of the
            list is a button whose only outcome is a failure. */}
        {canReconnect(connection) ? (
          <>
            <Text style={styles.why}>{RECONNECT.why}</Text>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => { feel.light(); onReconnect(); }}
              accessibilityRole="button" accessibilityLabel={RECONNECT.action}
            >
              <Text style={styles.rowText}>{RECONNECT.action}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => { void refresh(); }}
            disabled={busy}
            accessibilityRole="button" accessibilityLabel={PILL_SHEET.refresh}
          >
            <Text style={styles.rowText}>{PILL_SHEET.refresh}</Text>
            {busy && <ActivityIndicator color={T.dim} />}
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => { feel.light(); onLogManually(); }}
          accessibilityRole="button" accessibilityLabel={PILL_SHEET.manual}
        >
          <Text style={styles.rowText}>{PILL_SHEET.manual}</Text>
        </Pressable>
        {/* ONLY WHEN THERE IS SOMETHING TO DROP. Offering this beside
            a number the bank already gave you is a button that claims
            to change something and does not. */}
        {canUseBankBalance(pill) && (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => { void adopt(); }}
            disabled={busy}
            accessibilityRole="button" accessibilityLabel={PILL_SHEET.useBank}
          >
            <Text style={styles.rowText}>{PILL_SHEET.useBank}</Text>
          </Pressable>
        )}
        {said && <Text style={styles.said}>{said}</Text>}
        <Text style={styles.last}>{PILL_SHEET.lastSynced(when)}</Text>
      </View>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, paddingBottom: 28 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  rowText: { color: T.text, fontSize: 16 },
  said: { color: T.dim, fontSize: 13, marginTop: 12, lineHeight: 19 },
  why: { color: T.brass, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  last: { color: T.faint, fontSize: 12, marginTop: 12 },
  pressed: { opacity: 0.7 },
});
