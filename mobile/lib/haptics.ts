import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// The phone's six feelings, named for what they MEAN rather than for
// what the Taptic Engine does.
//
// THE ONE RULE, agreed before any of this was written: NOTHING MAY BE
// ONLY A HAPTIC. Every call below sits beside something you can see —
// a toast, a modal, a number changing, a row ticking off. A buzz is
// confirmation of something already said, never the saying of it.
// Someone with haptics turned off, or holding the phone by the edge,
// or deaf to the difference between two taps, must lose nothing. That
// is also why there is no haptic anywhere in this app that reports a
// state no pixel reports.
//
// WHY A NAMED LAYER AND NOT `Haptics.notificationAsync` AT THE CALL
// SITE. Two reasons, and the second is the real one:
//
//   1. the call is async and nobody should await a buzz, so every
//      call here is fire-and-forget and swallows its own failure — a
//      phone with no Taptic Engine, or a simulator, must never throw
//      into a save path;
//   2. a screen asking for "success" is making a statement about what
//      happened. A screen asking for `NotificationFeedbackType.Success`
//      is making a decision about hardware, and decisions about
//      hardware spread. Keeping the vocabulary SHORT is what stops
//      the next feature inventing a word for itself.
//
// IT WENT FROM FIVE WORDS TO SIX on 2026-10-19, and the rule above
// is why it took a reason rather than a call site. Setup and the
// tour are the two flows in this app that are a SEQUENCE: four to
// seven taps on the same button, and the last tap means something
// the others do not. With five words the only way to say "this one
// finished the sequence" was `success`, which is the thumping
// three-part notification and far too much for the Done button on a
// four-card tour. `medium` is the step between `light` and
// `success`: more than moving on, less than being finished with the
// whole of setup.
//
// iOS ONLY, which is not a portability hedge: Android is never
// shipping (decided 2026-10-09). The guard exists so the jest
// environment and the web build do not call into a native module that
// is not there.
const enabled = Platform.OS === "ios";

const fire = (run: () => Promise<void>) => {
  if (!enabled) return;
  // No await, no catch at the call site, no unhandled rejection.
  void run().catch(() => {});
};

/**
 * Something you asked for happened: a balance logged, a transaction
 * saved, a code accepted, setup finished.
 *
 * Deliberately NOT on every successful write. Reordering a category
 * with an arrow is a successful write and gets `selection`, because a
 * control you can press five times in a row must not thump five
 * times.
 */
export const success = () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/**
 * You are about to be asked to confirm something destructive.
 *
 * Fired BEFORE the alert appears, not after the deletion. By the time
 * something is deleted the warning is late; the moment that is worth
 * marking is the one where the phone is asking you to stop and read.
 */
export const warning = () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** It did not work: a save was rejected, a code was wrong. */
export const failure = () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

/**
 * You moved between discrete things: a tab, a point on a chart.
 *
 * One tick per point while scrubbing — the ticks ARE the data's
 * granularity, which is the one place in this app where a haptic
 * carries information a glance does not.
 */
export const selection = () => fire(() => Haptics.selectionAsync());

/** A small bump for something that completed quietly: a refresh that actually fetched. */
export const light = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/**
 * Bigger than `light`, smaller than `success`: the end of a short
 * sequence. The tour's Done, and "Go to my budget" on setup's last
 * screen — both of which close something, neither of which is the
 * moment the work landed. Setup's own Finish keeps `success`,
 * because that is the tap that writes the account.
 */
export const medium = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
