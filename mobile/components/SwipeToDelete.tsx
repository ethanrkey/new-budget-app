import { useCallback, useRef } from "react";
import {
  Animated, LayoutAnimation, PanResponder, Pressable, StyleSheet, Text, View,
} from "react-native";
import { T } from "../lib/theme";

// Swipe a row left to delete it.
//
// THE BUG THIS EXISTS FOR, from the build 8 device pass: "+ Add
// another bill" rows could not be removed. The web had an ✕ from the
// start; the phone had nothing, so a row added by mistake was a row
// you finished setup with.
//
// WHY THIS IS HAND-BUILT and the sheet's drag is not. The sheet got a
// PanResponder in build 8 and build 9 takes it back, because iOS has
// a real sheet presentation that does the same job properly. There is
// no equivalent for a row inside a ScrollView: `UITableView`'s swipe
// actions are not reachable from React Native, and the community
// answer — gesture-handler's ReanimatedSwipeable — would mean a
// Reanimated worklet pipeline, a GestureHandlerRootView at the app
// root and a babel plugin, all for one gesture on one step of setup.
// That is a lot of new machinery to put in front of a build. So this
// is ~40 lines of core RN doing exactly what the platform row does:
// drag reveals a destructive action, past half of it snaps open, past
// a long way deletes outright.
//
// THE DELETE BUTTON IS ALWAYS IN THE TREE, behind the row rather than
// conditionally rendered. That is what makes it reachable by
// VoiceOver without performing a gesture, and it is what a test
// presses when it is checking the removal rather than the swipe.
//
// LayoutAnimation, not an exit animation on this row: the row is
// about to be unmounted by its parent, so what wants animating is the
// GAP closing. iOS runs it natively with no setup, which Android
// would need a flag for — and there is no Android.
const ACTION = 88;
/** Past this and the swipe itself is the delete, like Mail's. */
const FULL = 200;

export default function SwipeToDelete({
  onDelete, label, children,
}: {
  onDelete: () => void;
  /** What the destructive button says it is removing, for VoiceOver. */
  label: string;
  children: React.ReactNode;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const open = useRef(false);

  const settle = (to: number) => {
    open.current = to !== 0;
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  };

  // THE HANDLER IS READ THROUGH A REF, and this is not defensive
  // style — the first version of this file was wrong without it.
  // `PanResponder.create` runs once, inside `useRef`, so every
  // callback it was given is the one from the FIRST render and keeps
  // whatever that render had closed over. The caller's `onDelete`
  // closes over the bill list, so bill 3's swipe removed an index
  // from the two-row list that existed when bill 3's row was created,
  // and two rows disappeared instead of one. The button next to it
  // was right the whole time, because `onPress` is re-read on every
  // render — which is exactly why the gesture needed its own test.
  const latest = useRef(onDelete);
  latest.current = onDelete;
  const remove = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    latest.current();
  }, []);

  const pan = useRef(
    PanResponder.create({
      // HORIZONTAL AND DELIBERATE. The row lives in a vertical
      // ScrollView, so a gesture is only taken when it is clearly
      // sideways — eight points of travel and twice as much of it
      // across as down. A looser test steals the scroll.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_e, g) => {
        const at = (open.current ? -ACTION : 0) + g.dx;
        // Never to the right of closed: there is nothing over there.
        x.setValue(Math.min(0, Math.max(-(ACTION + 90), at)));
      },
      onPanResponderRelease: (_e, g) => {
        const at = (open.current ? -ACTION : 0) + g.dx;
        if (at <= -FULL) { remove(); return; }
        settle(at <= -ACTION / 2 ? -ACTION : 0);
      },
      onPanResponderTerminate: () => settle(open.current ? -ACTION : 0),
    }),
  ).current;

  return (
    <View style={styles.clip}>
      <View style={styles.actionLayer} pointerEvents="box-none">
        <Pressable
          style={styles.action}
          onPress={remove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
        >
          <Text style={styles.actionText}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View
        testID={`swipe-${label}`}
        style={[styles.row, { transform: [{ translateX: x }] }]}
        {...pan.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  actionLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "flex-end", justifyContent: "center" },
  action: {
    width: ACTION, height: "100%", borderRadius: 12,
    backgroundColor: T.expense, alignItems: "center", justifyContent: "center",
  },
  actionText: { color: "#111827", fontSize: 14, fontWeight: "700" },
  // Opaque, so the destructive layer behind it is genuinely hidden
  // until the row moves off it.
  row: { backgroundColor: T.bg },
});
