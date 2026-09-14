// ---- Multi-device safety: staleness detection + the recovery copy ----
// The app loads your whole state once and holds it in memory. A second device
// that was already open is therefore holding a copy from BEFORE anything you
// did here — and because a save writes the whole document, that stale copy
// used to be able to overwrite newer data wholesale (no version check, last
// writer wins). That's the same shape as the incident that cost real data.
//
// The fix has two halves. The transport half lives in storage.js: every write
// is conditional on the row still carrying the `updated_at` we loaded, so a
// stale device's write matches zero rows instead of clobbering. This file is
// the pure half — deciding whether what we hold is stale, and building the
// recovery copy that is ALWAYS written before anything replaces what's in
// memory.
import { isPlausibleBackup } from "./backupShape.js";

// A version is the row's `updated_at` string, straight from Postgres. Compared
// as an opaque token, never parsed or ordered: "different" is the only thing
// that matters, and an equality test can't be fooled by clock skew between
// devices the way a newer-than comparison could.
export function isStale(localVersion, serverVersion) {
  if (!localVersion || !serverVersion) return false; // nothing loaded yet, or no row — not a staleness question
  return localVersion !== serverVersion;
}

// What gets stashed in localStorage before an in-memory state is discarded.
// Deliberately self-describing: it has to be recognizable months later by
// someone (or some future build) that has forgotten this feature exists.
export function makeRecoveryEnvelope(state, reason, nowISO) {
  return { kind: "budget-app-recovery", version: 1, reason, savedAt: nowISO, state };
}

// Validate before ever offering a stashed copy back to the user — a corrupt or
// half-written localStorage entry must not be presented as their data. Reuses
// the same plausibility check the JSON-restore path gates on.
export function isRecoveryEnvelope(obj) {
  return (
    !!obj &&
    obj.kind === "budget-app-recovery" &&
    obj.version === 1 &&
    typeof obj.savedAt === "string" &&
    isPlausibleBackup(obj.state)
  );
}
