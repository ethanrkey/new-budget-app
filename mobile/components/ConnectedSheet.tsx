import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import * as feel from "../lib/haptics";
import { supabase } from "../lib/supabase";
import NativeSheet from "./NativeSheet";
import { useBudget } from "./StateProvider";
import { fmtDate } from "../../src/shared/dates.ts";
import { PILL_SHEET } from "../../src/content/connect.ts";
import { refreshOutcome, type Connection } from "../../src/shared/connect.ts";
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
export default function ConnectedSheet({ open, connection, onClose, onLogManually }: {
  open: boolean;
  connection: Connection | null;
  onClose: () => void;
  onLogManually: () => void;
}) {
  const { refresh: resyncState } = useBudget();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const syncedAt = connection?.lastSyncedAt ? new Date(connection.lastSyncedAt) : null;
  const when = syncedAt
    ? `${fmtDate(connection!.lastSyncedAt!.slice(0, 10))}, ${syncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "never";

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

  return (
    <NativeSheet visible={open} onClose={onClose} swipeToClose={!busy}>
      <View style={styles.sheet}>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => { void refresh(); }}
          disabled={busy}
          accessibilityRole="button" accessibilityLabel={PILL_SHEET.refresh}
        >
          <Text style={styles.rowText}>{PILL_SHEET.refresh}</Text>
          {busy && <ActivityIndicator color={T.dim} />}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => { feel.light(); onLogManually(); }}
          accessibilityRole="button" accessibilityLabel={PILL_SHEET.manual}
        >
          <Text style={styles.rowText}>{PILL_SHEET.manual}</Text>
        </Pressable>
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
  last: { color: T.faint, fontSize: 12, marginTop: 12 },
  pressed: { opacity: 0.7 },
});
