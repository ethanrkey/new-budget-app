import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONNECT_CONSENT, CONNECT_TOGGLE, CONNECT_TOGGLE_SUB, DISCONNECT_NOTE, PLAID_PORTAL_URL,
  RECONNECT, TOGGLE_OFF_CONFIRM,
} from "../content/connect.ts";
import { canReconnect, canSeeToggle, shouldRestoreToggle } from "../shared/connect.ts";
import {
  disconnect as apiDisconnect, isAllowlisted, pullBalance, readConnection, recoverLink,
  startLink, finishLink,
} from "../shared/plaidApi.ts";
import { fmtInstant } from "../shared/dates.ts";

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

export default function ConnectedAccount({ supabase, settings, onSetSettings, onChanged }) {
  const on = !!settings.connectedFeatures;
  const [allowlisted, setAllowlisted] = useState(null);
  const [connection, setConnection] = useState(null);
  const [consenting, setConsenting] = useState(false);
  const [busy, setBusy] = useState(null);
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
    (async () => {
      const row = await refresh();
      // A SESSION NOBODY FINISHED. Rarer on web than on iOS — the
      // page holds the public_token itself, so there is no webhook
      // in the ordinary path — but a tab closed in the middle of
      // the exchange strands the Item exactly the same way, and a
      // stranded Item on this plan is a slot out of ten with no
      // Disconnect button to reach. Same call the phone makes; it
      // costs nothing when there is nothing unfinished.
      if (row) return;
      const found = await recoverLink(supabase);
      if (!found.ok) return;
      await refresh();
      // AND THE PAGE RE-READS ITS OWN NUMBERS. A recovered session
      // pulls a balance server-side, so the bar is showing a figure
      // from before the connection existed until something reloads
      // the document. `true` because that pull already happened —
      // App must not fire a second one.
      onChanged?.(true);
    })();
  }, [on, allowlisted, refresh, supabase, onChanged]);

  // THE SAME GUARD THE PHONE CARRIES, for the same reason and with
  // the same shape. Finishing a connection ends with App re-reading
  // the whole document from the server, and the toggle that started
  // the flow is saved on a debounce — so for a moment the server's
  // answer to "are connected features on?" can be older than the
  // bank it just connected. A live bank with the feature off is not
  // a state this app has; see shouldRestoreToggle.
  //
  // THE ROW ITSELF is held, not `connection`: the effect above
  // clears that the instant the settings say off, which is exactly
  // the case this is here to notice.
  const connectedRow = useRef(null);
  useEffect(() => {
    const row = connectedRow.current;
    if (!row) return;
    if (shouldRestoreToggle(settings, row)) {
      connectedRow.current = null;
      onSetSettings({ connectedFeatures: true });
      return;
    }
    if (settings.connectedFeatures) connectedRow.current = null;
  }, [settings, onSetSettings]);

  // Absent for anyone not on the list — not disabled, not explained.
  if (!canSeeToggle(!!allowlisted)) return null;

  async function toggle(next) {
    if (!next && connection) {
      const ok = window.confirm(
        `${TOGGLE_OFF_CONFIRM.title}\n\n${TOGGLE_OFF_CONFIRM.body(connection.institutionName ?? "your bank")}`
      );
      if (!ok) return;
      await doDisconnect();
    }
    onSetSettings({ connectedFeatures: next });
  }

  async function doDisconnect() {
    setBusy("disconnecting");
    const ok = await apiDisconnect(supabase);
    setBusy(null);
    if (!ok) { setSaid("Couldn't disconnect. Nothing changed — try again in a moment."); return; }
    setConnection(null);
    setSaid(null);
    onChanged?.(false);
  }

  /**
   * Open Link. `update` reopens the SAME Item rather than making one.
   *
   * NEVER DISCONNECT-THEN-CONNECT TO FIX A LOGIN. Plaid's Trial is
   * ten Items EVER, `/item/remove` does not give one back, and two
   * Items for the same account count as two — so the repair path has
   * to be update mode or it quietly costs a slot out of ten. See
   * canReconnect, and plaid-link-token's update branch.
   */
  async function openLink(update = false) {
    setConsenting(false);
    // NAMED, not `true`. It was `true`, and the fall-through in the
    // spinner below meant opening Link said "Disconnecting…".
    setBusy(update ? "reconnecting" : "connecting");
    setSaid(null);
    let Plaid;
    try { Plaid = await loadLinkScript(); }
    catch { setBusy(null); setSaid("Couldn't load the connection window. Try again in a moment."); return; }

    const started = await startLink(supabase, false, update);
    if ("error" in started) {
      setBusy(null);
      setSaid(update ? RECONNECT.failed : "Couldn't start. Try again in a moment.");
      return;
    }

    if (update) {
      const handler = Plaid.create({
        token: started.linkToken,
        // NOTHING IS EXCHANGED. Update mode hands back a public
        // token that maps to the access token we already hold, so
        // exchanging it would buy nothing and invite a duplicate.
        // The proof that the repair took is a PULL THAT WORKS —
        // which is also the only thing that clears the status, since
        // `reconnect` is the one trigger allowed past a
        // login_required item. See plaid-balance.
        onSuccess: async () => {
          setBusy("saving");
          const result = await pullBalance(supabase, "reconnect");
          await refresh();
          setBusy(null);
          setSaid(result?.synced ? RECONNECT.fixed : RECONNECT.stillBroken);
          onChanged?.(true);
        },
        onExit: () => { setBusy(null); },
      });
      handler.open();
      return;
    }

    const handler = Plaid.create({
      token: started.linkToken,
      onSuccess: async (publicToken) => {
        // FROM HERE IT IS FIVE TO SEVEN SECONDS — an exchange, three
        // more Plaid calls and the first balance pull — and Link has
        // already closed, so without a named wait the user is looking
        // at an unchanged Settings page wondering if it worked.
        setBusy("saving");
        const done = await finishLink(supabase, publicToken);
        if (!done.ok) {
          setBusy(null);
          // THE CODE IS SHOWN, not swallowed. This is allowlist-only
          // and the people who see it are people the owner knows; a
          // bare "try again" cost one round trip through the browser
          // console and the function logs to learn one word.
          setSaid(`Your bank connected, but we couldn't finish saving it (${done.code}). Nothing was kept — try again.`);
          return;
        }
        // PULL STRAIGHT AWAY. Connecting and then seeing nothing
        // happen is the worst possible first impression of a feature
        // whose entire promise is that the number keeps itself up to
        // date — and without this the first balance waits for the
        // next app open.
        //
        // Trigger "open" rather than "refresh" on purpose: a brand
        // new Item has never synced, so the staleness check passes
        // on its own and this does not spend one of the four daily
        // refreshes on the connection itself.
        await pullBalance(supabase, "open");
        connectedRow.current = await refresh();
        setBusy(null);
        // `true`: this flow already pulled, so App must not pull again.
        onChanged?.(true);
      },
      // A user who closes Link has declined. That is an answer, not
      // an error, and it gets no message.
      onExit: () => { setBusy(null); },
    });
    handler.open();
  }

  // LOCAL DATE AND LOCAL TIME. This used to slice the UTC date off
  // the instant and pair it with a local clock, so an 8:46 PM Eastern
  // sync read "10/21/2026, 8:46 PM" — tomorrow beside tonight.
  const lastSync = connection?.lastSyncedAt ? fmtInstant(connection.lastSyncedAt) : "never";

  return (
    <section className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{CONNECT_TOGGLE}</h3>
          {/* BOTH WORDS FROM src/content/connect.ts. This sentence
              was written out here AND in the phone's Connected.tsx,
              so the owner's one-line edit to it was two edits. */}
          <p className="text-xs text-gray-500 mt-0.5 max-w-sm">{CONNECT_TOGGLE_SUB}</p>
        </div>
        <label className="shrink-0 inline-flex items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={on}
            disabled={!!busy}
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
          disabled={!!busy}
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

      {on && canReconnect(connection) && (
        <div className="mt-2">
          <p className="text-xs text-amber-700 dark:text-amber-500 max-w-sm">{RECONNECT.why}</p>
          {/* THE ONLY REPAIR PATH, and it is update mode. A notice
              that says "until you reconnect" beside no way to do it
              leaves Disconnect as the obvious move — which costs a
              second Trial slot for the same bank account. */}
          <button
            onClick={() => openLink(true)}
            disabled={!!busy}
            className="mt-2 text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
          >
            {RECONNECT.action}
          </button>
        </div>
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
            disabled={!!busy}
            className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-red-300 text-red-700 dark:border-red-900 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* A NAMED WAIT WITH A SHAPE, not a blank gap. The block below
          it takes five to seven seconds to appear after Link closes,
          and nothing on screen changing for that long reads as a
          failure. The skeleton is the size of the block that is
          coming, so the page does not jump when it arrives. */}
      {busy && (
        <div className="mt-3" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-transparent animate-spin dark:border-gray-600 dark:border-t-transparent" />
            {busy === "connecting" ? "Opening your bank…"
              : busy === "reconnecting" ? RECONNECT.busy
              : busy === "saving" ? "Saving the connection…"
              : "Disconnecting…"}
          </div>
          {busy === "saving" && (
            <div className="mt-3 space-y-2 border-y border-gray-100 dark:border-gray-800 py-2.5">
              <div className="h-4 w-48 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
              <div className="h-4 w-56 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
          )}
        </div>
      )}

      {/* RED IS FOR THE ONES THAT WENT WRONG. A successful reconnect
          reports through the same line and is not a failure. */}
      {said && (
        <p className={`mt-2 text-xs ${said === RECONNECT.fixed ? "text-gray-500" : "text-red-600 dark:text-red-400"}`}>
          {said}
        </p>
      )}

      {consenting && (
        <ConsentDialog onCancel={() => setConsenting(false)} onContinue={() => openLink(false)} />
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
          {/* THE APP'S OWN GOLD, the two steps of the icon's hue that
              the wordmark and the landing CTA already use. amber-500
              was neither of them and read as orange beside them — the
              only button in the web app wearing a color the app does
              not have. */}
          <button
            onClick={onContinue}
            className="flex-1 text-sm px-3 py-2 rounded-lg bg-[#8e670b] text-white dark:bg-[#eebb4d] dark:text-gray-900 font-semibold hover:opacity-90 transition"
          >
            {CONNECT_CONSENT.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
