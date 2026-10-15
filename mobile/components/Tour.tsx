import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { T } from "../lib/theme";
import { TOUR_STOPS } from "../../src/content/tour.ts";

// The web's guided tour, on a phone. Same four stops from
// src/content/tour.ts — the words are not duplicated.
//
// A scrim with a card at the BOTTOM, not the middle: the point of the
// tour is the screen behind it, so the card sits where it covers least
// and the tab actually changes underneath as you advance.
const ROUTE: Record<string, string> = {
  ledger: "/(tabs)", budget: "/(tabs)/budget",
  spending: "/(tabs)/spending", dashboard: "/(tabs)/dashboard",
};

// IT STARTS ON THE LEDGER AND IT ENDS THERE, SINCE 2026-10-15. The
// stops are unchanged — Ledger, Budget, Spending, Dashboard — but
// finishing or skipping puts you back on the Ledger rather than
// leaving you wherever the last card was. The owner's call from build
// 9's device pass: the Ledger is the screen worth landing on after
// setup, and the Dashboard's value is not obvious on the day it has
// one reading in it. Done HERE rather than at the two call sites, so
// a third way to open the tour cannot forget it.
export default function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(() => { router.replace(ROUTE[TOUR_STOPS[0]!.tab]! as never); return 0; });
  const stop = TOUR_STOPS[i]!;
  const last = i === TOUR_STOPS.length - 1;

  const go = (next: number) => {
    setI(next);
    router.replace(ROUTE[TOUR_STOPS[next]!.tab]! as never);
  };

  const leave = () => {
    router.replace(ROUTE.ledger! as never);
    onClose();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={leave}>
      <View style={styles.scrim} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.step}>{i + 1} of {TOUR_STOPS.length}</Text>
          <Text style={styles.title}>{stop.title}</Text>
          <Text style={styles.body}>{stop.body}</Text>
          <View style={styles.row}>
            <Pressable onPress={leave} style={styles.skip} accessibilityRole="button" accessibilityLabel="Skip the tour">
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            {i > 0 && (
              <Pressable onPress={() => go(i - 1)} style={[styles.btn, styles.ghost]} accessibilityRole="button" accessibilityLabel="Back">
                <Text style={styles.ghostText}>Back</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => (last ? leave() : go(i + 1))}
              style={[styles.btn, styles.primary]}
              accessibilityRole="button"
              accessibilityLabel={last ? "Done" : "Next"}
            >
              <Text style={styles.primaryText}>{last ? "Done" : "Next"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  card: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border, padding: 20, paddingBottom: 36, gap: 6 },
  step: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7 },
  title: { color: T.text, fontSize: 18, fontWeight: "700" },
  body: { color: T.dim, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  skip: { minHeight: 44, justifyContent: "center", paddingRight: 6 },
  skipText: { color: T.faint, fontSize: 14 },
  btn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
});
