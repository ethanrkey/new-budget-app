import Constants from "expo-constants";
import * as Updates from "expo-updates";

// WHICH COPY OF THE APP AM I LOOKING AT?
//
// Two answers, and they are genuinely different ones. The BINARY comes
// from TestFlight and changes only when a new build is submitted; the
// JAVASCRIPT inside it can be replaced over the air at any time after
// that, without the build number moving at all. A tester who says "I
// still see the old calendar" is reporting about the second one, and
// until 2026-10-17 the app said nothing about either.
//
// Both lines are deliberately drab and at the very bottom of Settings.
// This is diagnostic text, not a feature.

/** The runtime's own id for this JS, short enough to read aloud. */
const shortId = (id: string | null): string => (id ? id.replace(/-/g, "").slice(0, 8) : "—");

/** "Key Budget 1.0.0 · runtime 78c21cd1" */
export function buildLine(): string {
  const version = Constants.expoConfig?.version ?? "—";
  // The runtime version is the fingerprint of everything native. Two
  // builds that share it can run each other's JS, which is the whole
  // reason an over-the-air update is possible at all — so it is the
  // number worth printing beside the version, not the build number
  // (which would need another native module to read).
  const runtime = (Updates.runtimeVersion ?? "").slice(0, 8) || "—";
  return `Key Budget ${version} · runtime ${runtime}`;
}

/**
 * "Update: bundled with this build" or "Update: 10/17/2026 · a1b2c3d4".
 *
 * `isEmbeddedLaunch` is the honest distinction: it is true when the JS
 * running is the copy that shipped inside the binary, and false when
 * an over-the-air update has taken over. Saying "bundled" rather than
 * printing the embedded update's own id matters, because that id is
 * stable across every install of the same build and reads as though
 * an update had been applied when none has.
 */
export function updateLine(): string {
  if (Updates.isEmbeddedLaunch) return "Update: bundled with this build";
  const when = Updates.createdAt;
  const stamp = when
    ? `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()}`
    : "—";
  return `Update: ${stamp} · ${shortId(Updates.updateId)}`;
}
