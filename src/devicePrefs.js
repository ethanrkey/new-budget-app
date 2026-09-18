// ---- Per-device display preferences ----
// Same reasoning as theme.js: how the UI is arranged on THIS screen is not
// account data. It never leaves this browser, never syncs, and never lands in
// the state blob — so it can't conflict between devices and doesn't count as
// a change worth saving to Supabase.
//
// theme.js stays separate because a theme has real resolution rules (device
// choice -> account default -> system preference). These are plain booleans.
const PREFIX = "budget-app-pref:";

export function getDeviceFlag(name, fallback = false) {
  try {
    const stored = localStorage.getItem(PREFIX + name);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage blocked (private browsing, locked-down browser). Fall through
    // to the default rather than throwing — a preference is never worth
    // breaking a render over.
  }
  return fallback;
}

export function setDeviceFlag(name, value) {
  try {
    localStorage.setItem(PREFIX + name, value ? "1" : "0");
  } catch {
    // Worst case the choice doesn't survive a reload on this device.
  }
}
