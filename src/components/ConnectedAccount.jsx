import { useCallback, useEffect, useState } from "react";
import { CONNECT_CONSENT, DISCONNECT_NOTE, PLAID_PORTAL_URL } from "../content/connect.ts";
import { canSeeToggle } from "../shared/connect.ts";
import { disconnect as apiDisconnect, isAllowlisted, readConnection, startLink, finishLink } from "../shared/plaidApi.ts";
import { fmtDate } from "../shared/dates.ts";

// Connected checking, on the web. The Settings → Account half: the
// toggle, the bank, and the way out. The phone's twin is
// mobile/components/Connected.tsx and the words are shared.
//
// THE TOGGLE IS THE GATE AND IT IS OFF. Manual entry is the product;
// this is an optional extra. While the switch is off, nothing here
// requests a Link token, and — the part that actually matters on the
// web — PLAID'S SCRIPT IS NEVER ADDED TO THE PAGE. A hidden feature
// that still ships a third party's JavaScript is not off.
//
// THE SCRIPT IS LOADED AT THE MOMENT OF CONSENT, not at mount and
// not at toggle-on. Someone who turns the feature on and then thinks
// better of it has still not fetched anything from Plaid.
const LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadLinkScript() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) { resolve(window.Plaid); return; }
    const existing = document.querySelector(`script[src="${LINK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Plaid));
      existing.addEventListener("error", reject);
      return;
    }
    const el = document.createElement("script");
    el.src = LINK_SRC;
    el.async = true;
    el.onload = () => resolve(window.Plaid);
    el.onerror = reject;
    document.head.appendChild(el);
  });
}

export default function ConnectedAccount({ supabase, settings, onSetSettings }) {
  const on = !!settings.connectedFeatures;
  const [allowlisted, setAllowlisted] = useState(null);
  const [connection, setConnection] = useState(null);
  const [consenting, setConsenting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  useEffect(() => {
    let dead = false;
    isAllowlisted(supabase).then((ok) => { if (!dead) setAllowlisted(ok); });
    return () => { dead = true; };
  }, [supabase]);

  const refresh = useCallback(async () => {
    const row = await readConnection(supabase);
    setConnection(row);
    return row;
  }, [supabase]);

  useEffect(() => {
    if (!on || !allowlisted) { setConnection(null); return; }
    refresh();
  }, [on, allowlisted, refresh]);

  // Absent for anyone not on the list — not disabled, not explained.
  if (!canSeeToggle(!!allowlisted)) return null;

  async function toggle(next) {
    if (!next && connection) {
      const ok = window.confirm(
        `Turn off connected features?\n\nThis disconnects ${connection.institutionName ?? "your bank"} right away. ` +
        "Balances already pulled stay in your history, the same as ones you typed."
      );
      if (!ok) return;
      await doDisconnect();
    }
    onSetSettings({ connectedFeatures: next });
  }

  async function doDisconnect() {
    setBusy(true);
    const ok = await apiDisconnect(supabase);
    setBusy(false);
    if (!ok) { setSaid("Couldn't disconnect. Nothing changed — try again in a moment."); return; }
    setConnection(null);
    setSaid(null);
  }

  async function openLink() {
    setConsenting(false);
    setBusy(true);
    setSaid(null);
    let Plaid;
    try { Plaid = await loadLinkScript(); }
    catch { setBusy(false); setSaid("Couldn't load the connection window. Try again in a moment."); return; }

    const started = await startLink(supabase, false);
    if ("error" in started) { setBusy(false); setSaid("Couldn't start. Try again in a moment."); return; }

    const handler = Plaid.create({
      token: started.linkToken,
      onSuccess: async (publicToken) => {
        const ok = await finishLink(supabase, publicToken);
        setBusy(false);
        if (!ok) { setSaid("Your bank connected, but we couldn't finish saving it. Try again."); return; }
        await refresh();
      },
      // A user who closes Link has declined. That is an answer, not
      // an error, and it gets no message.
      onExit: () => { setBusy(false); },
    });
    handler.open();
  }

  const lastSync = connection?.lastSyncedAt
    ? `${fmtDate(connection.lastSyncedAt.slice(0, 10))}, ${new Date(connection.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "never";

  return (
    <section className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Connect your bank</h3>
          {/* What it does AND what it does not, in the same breath.
              A line that only said "keep your balance up to date"
              would be selling. */}
          <p className="text-xs text-gray-500 mt-0.5 max-w-sm">
            Off by default. When on, Key Budget can read your checking balance — and nothing else.
            You can always log balances by hand instead.
          </p>
        </div>
        <label className="shrink-0 inline-flex items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={on}
            disabled={busy}
            onChange={(e) => toggle(e.target.checked)}
            className="h-4 w-4"
            aria-label="Connected features"
          />
          {on ? "On" : "Off"}
        </label>
      </div>

      {on && !connection && (
        <button
          onClick={() => setConsenting(true)}
          disabled={busy}
          className="mt-3 text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
        >
          Connect your bank (Beta)
        </button>
      )}

      {on && connection && (
        <dl className="mt-3 text-sm divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-100 dark:border-gray-800">
          {/* THE BANK NAME LIVES HERE AND NOWHERE ELSE, on the
              owner's call: the strip says when, not who. */}
          <div className="flex gap-3 py-2.5">
            <dt className="w-28 shrink-0 text-gray-500">Bank</dt>
            <dd className="truncate">
              {connection.institutionName ?? "Connected"}{connection.mask ? ` ••${connection.mask}` : ""}
            </dd>
          </div>
          <div className="flex gap-3 py-2.5">
            <dt className="w-28 shrink-0 text-gray-500">Last synced</dt>
            <dd>{lastSync}</dd>
          </div>
        </dl>
      )}

      {on && connection?.status === "login_required" && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          Your bank needs you to sign in again. Balances have stopped updating until you reconnect;
          everything you have already logged is unaffected.
        </p>
      )}

      {on && connection && (
        <div className="mt-3 flex items-start justify-between gap-3">
          {/* THE PORTAL NOTE IS REPEATED HERE rather than
              cross-referenced. The consent screen is read once, at
              the beginning; this is read months later by somebody who
              has decided to leave, and "we told you at the start" is
              not an answer to them. */}
          <p className="text-xs text-gray-500 max-w-sm">
            {DISCONNECT_NOTE}{" "}
            <a href={PLAID_PORTAL_URL} target="_blank" rel="noreferrer" className="underline">
              Open Plaid Portal
            </a>
          </p>
          <button
            onClick={() => { if (window.confirm(`Disconnect your bank?\n\n${DISCONNECT_NOTE}`)) doDisconnect(); }}
            disabled={busy}
            className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-red-300 text-red-700 dark:border-red-900 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      )}

      {said && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{said}</p>}

      {consenting && (
        <ConsentDialog onCancel={() => setConsenting(false)} onContinue={openLink} />
      )}
    </section>
  );
}

// Shown IMMEDIATELY BEFORE Link opens and not a moment earlier.
// Every word is in src/content/connect.ts, where a test writes the
// sentences out rather than reading them back; this draws them and
// decides nothing.
function ConsentDialog({ onCancel, onContinue }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-3" onClick={onCancel}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-md shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={CONNECT_CONSENT.title}
      >
        <h2 className="text-lg font-semibold">{CONNECT_CONSENT.title}</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
          {CONNECT_CONSENT.bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="text-gray-400">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          {CONNECT_CONSENT.footer}{" "}
          <a href={CONNECT_CONSENT.footerLinkUrl} target="_blank" rel="noreferrer" className="underline">
            {CONNECT_CONSENT.footerLinkText}
          </a>
        </p>
        {/* "Not now" FIRST and in the quiet style. Continue is not the
            default, is not preselected, and is not larger: a consent
            screen whose layout argues for one answer is asking
            rhetorically. */}
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            {CONNECT_CONSENT.cancel}
          </button>
          <button
            onClick={onContinue}
            className="flex-1 text-sm px-3 py-2 rounded-lg bg-amber-500 text-gray-900 font-semibold hover:bg-amber-400 transition"
          >
            {CONNECT_CONSENT.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
