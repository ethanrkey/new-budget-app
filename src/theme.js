// ---- Per-device theme (light/dark) ----
// Deliberately NOT part of the synced account state (settings.theme) — a
// display preference like "dark mode on my phone, light on my laptop" is
// exactly what localStorage is for: it never leaves this browser/device,
// unlike everything in `state`, which syncs to every device on the account.
//
// settings.theme still exists and still gets written on toggle — it's now
// the ACCOUNT DEFAULT, used only by a device that has never personalized
// its own theme yet (e.g. the first time you sign in somewhere new). Once
// you toggle theme on a specific device, that device's choice is local and
// independent from then on.
const KEY = "budget-app-theme"; // "light" | "dark"

export function getDeviceTheme(accountDefault) {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private browsing, blocked storage, ...) —
    // fall through to the account default / system preference instead of
    // throwing.
  }
  if (accountDefault === "light" || accountDefault === "dark") return accountDefault;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setDeviceTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // worst case: the choice doesn't persist across reloads on this
    // device, but the app keeps working.
  }
}
