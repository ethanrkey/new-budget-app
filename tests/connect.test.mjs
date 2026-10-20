// Connected checking: the copy, and the one engine change it needed.
//
//   node tests/connect.test.mjs     (runs in `npm test`, so in CI)
//
// NOTHING HERE TALKS TO PLAID. The schema, the RLS and the edge
// functions are Postgres and Deno, and neither runs in this harness;
// they are verified by the sandbox end-to-end and by the two
// `pg_policies` queries written out at the foot of supabase/plaid.sql.
//
// What IS testable from here is the part that would be worst to get
// wrong by accident: the consent copy, and whether a pulled snapshot
// survives the engine as an ordinary one.
//
// THE SENTENCES ARE WRITTEN OUT, not read back from the content file.
// A test that imports the string it is checking passes whatever you
// change it to, which is the opposite of the job.
import { normalize } from "../src/engine/stateShape.ts";
import { splitState, assembleState } from "../src/engine/entities.ts";
import {
  CONNECT_CONSENT, CONNECT_HINT, CONNECT_HINT_DISMISS, DISCONNECT_NOTE,
  PILL, PILL_SHEET, PLAID_PORTAL_URL,
} from "../src/content/connect.ts";
import {
  pillStateOf, pillTextOf, pillSuffixOf, pillIsAction, shouldPullOnOpen, canOfferConnect,
  canSeeToggle, shouldOfferHint, refreshOutcome,
} from "../src/shared/connect.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);
const not = (label, c) => eq(label, !!c, false);

console.log("\n== the consent screen says what is true ==");

eq("the title names the limit, not the feature",
  CONNECT_CONSENT.title, "Connect your bank (balance only)");

eq("what we read, and what we never receive",
  CONNECT_CONSENT.bullets[0],
  "Key Budget only reads your checking balance. Nothing else — we never receive, see, or store your transactions.");

// THE BULLET THIS WHOLE FILE EXISTS FOR. Plaid's own screen names
// more scopes than this app uses, because the Link products array
// cannot be empty and cannot contain `balance`. A consent screen that
// says "Plaid only asks for your balance" would make Plaid's own
// screen look like the lie.
eq("Plaid's access is stated as wider than ours, because it is",
  CONNECT_CONSENT.bullets[1],
  "Your bank connection is handled by Plaid. Plaid will have access to your account and balance info and your contact info — more than Key Budget uses. Plaid's own screen will tell you this too.");
is("...and it says outright that it is more than we use",
  CONNECT_CONSENT.bullets[1].includes("more than Key Budget uses"));

eq("the login never reaches us",
  CONNECT_CONSENT.bullets[2],
  "Your bank login goes to Plaid and your bank. Key Budget never sees it.");

// DISCONNECTING KEEPS THE HISTORY, and the screen says so before the
// user connects rather than after they leave. A balance already
// pulled is their own record of their own money.
eq("disconnecting is immediate, and keeps what was pulled",
  CONNECT_CONSENT.bullets[3],
  "Disconnect anytime in Settings. That removes Key Budget's access right away. Balances already pulled stay in your history, the same as ones you typed.");

// Their rights against PLAID, which this app cannot exercise for
// them. Without this the screen quietly implies disconnecting here is
// the end of it.
eq("Plaid Portal is named, because we cannot delete Plaid's copy",
  CONNECT_CONSENT.bullets[4],
  "To see or delete what Plaid holds, use Plaid Portal at my.plaid.com.");

eq("five bullets and no more", CONNECT_CONSENT.bullets.length, 5);
eq("the footer credits Plaid", CONNECT_CONSENT.footer, "Connections are handled by Plaid.");
is("...and links to their end-user policy",
  CONNECT_CONSENT.footerLinkUrl.startsWith("https://plaid.com/legal"));
eq("the buttons are Continue and Not now",
  [CONNECT_CONSENT.confirm, CONNECT_CONSENT.cancel], ["Continue", "Not now"]);

// NOT ONE WORD IMPLYING THIS IS THE BETTER PATH. Manual entry is the
// product; this is an optional extra. A consent screen that sells is
// not a consent screen.
{
  const all = [CONNECT_CONSENT.title, ...CONNECT_CONSENT.bullets, CONNECT_CONSENT.footer,
    CONNECT_HINT, DISCONNECT_NOTE].join(" ").toLowerCase();
  for (const word of ["recommended", "upgrade", "better", "best", "easier", "finally", "stop typing", "no more"]) {
    not(`nothing sells it: "${word}"`, all.includes(word));
  }
}

console.log("\n== the Plaid Portal note is in both places ==");
is("the consent screen names the Portal", CONNECT_CONSENT.bullets.some((b) => b.includes("my.plaid.com")));
is("and so does the note beside Disconnect", DISCONNECT_NOTE.includes("my.plaid.com"));
eq("the Portal URL", PLAID_PORTAL_URL, "https://my.plaid.com");
eq("disconnecting says all three things: access, history, Plaid's copy",
  DISCONNECT_NOTE,
  "Disconnecting removes Key Budget's access right away. Balances already pulled stay in your history. To see or delete what Plaid holds, use Plaid Portal at my.plaid.com.");

console.log("\n== the hint on the Log balance sheet ==");
eq("it offers, and points at Settings",
  CONNECT_HINT, "Want this automatic? Turn on connected features in Settings.");
eq("and it can be turned off for good", CONNECT_HINT_DISMISS, "Don't show again");

console.log("\n== the Checking pill, all five states ==");
eq("not connected", PILL.manual("$1,204.19", "10/17"), "$1,204.19 · as of 10/17");
eq("connected and fresh", PILL.synced("$1,204.19", "8:14 AM"), "$1,204.19 · synced 8:14 AM");
// MANUAL WINS ON THE DAY, and the pill has to say so rather than
// claiming a sync whose number is not the one on screen.
eq("connected, but today's number was typed", PILL.loggedToday("$1,204.19"), "$1,204.19 · logged today");
eq("pulls failing — the last GOOD time, not 'now'",
  PILL.stale("$1,204.19", "10/18 7:02 AM"), "$1,204.19 · synced 10/18 7:02 AM");
// Names the action, not the problem: "disconnected" tells you
// nothing to do about it.
eq("needs reconnect", PILL.reconnect("$1,204.19"), "$1,204.19 · Reconnect");
eq("the sheet's three rows",
  [PILL_SHEET.refresh, PILL_SHEET.manual, PILL_SHEET.lastSynced("8:14 AM")],
  ["Refresh now", "Log manually", "Last synced 8:14 AM"]);
// The balance is in the same place and reads the same way in every
// state. The connection is a detail about where the number came
// from, never a different kind of number.
{
  const every = [PILL.manual("$9.00", "1/2"), PILL.synced("$9.00", "x"), PILL.loggedToday("$9.00"),
    PILL.stale("$9.00", "x"), PILL.reconnect("$9.00")];
  is("every state starts with the balance", every.every((p) => p.startsWith("$9.00 · ")));
}

console.log("\n== a pulled snapshot is an ordinary snapshot ==");

// The whole integration, asserted: the engine round-trips a snapshot
// carrying `source` and `externalId` without knowing what they mean.
// If this breaks, a pulled balance stops being history and starts
// being a parallel system.
{
  const withPull = normalize({
    accounts: [{ id: "acct", name: "Checking", kind: "checking", balance: 0, balanceAsOf: "2026-10-01", order: 0 }],
    accountSnapshots: {
      acct: [
        { id: "a", date: "2026-10-17", amount: 1000 },
        { id: "acct:2026-10-18", date: "2026-10-18", amount: 1204.19, source: "plaid", externalId: "plaid-acct-1" },
      ],
    },
  });
  const back = assembleState(splitState(withPull));
  const pulled = back.accountSnapshots.acct.find((s) => s.date === "2026-10-18");
  eq("source and externalId survive the entity round-trip",
    [pulled?.source, pulled?.externalId], ["plaid", "plaid-acct-1"]);
  eq("...and the manual one beside it is untouched",
    back.accountSnapshots.acct.find((s) => s.date === "2026-10-17")?.source, undefined);

  // THE ANCHOR DOES NOT CARE WHERE A READING CAME FROM. It is
  // max(date), and a pulled reading is a reading.
  eq("the newest reading anchors the forecast, pulled or typed",
    back.accounts[0].balanceAsOf, "2026-10-18");
  eq("...with its amount", back.accounts[0].balance, 1204.19);
}

// ABSENT MEANS MANUAL. Every snapshot written before this feature
// existed has no `source`, and the collision rule in
// plaid_write_balance reads `coalesce(data->>'source','manual')` for
// exactly this reason. A reader that treated undefined as "unknown"
// would let a pull overwrite years of typed history.
{
  const old = normalize({
    accounts: [{ id: "acct", name: "Checking", kind: "checking", balance: 0, balanceAsOf: "2026-01-01", order: 0 }],
    accountSnapshots: { acct: [{ id: "a", date: "2026-10-17", amount: 500 }] },
  });
  eq("a snapshot from before this feature carries no source at all",
    old.accountSnapshots.acct[0].source, undefined);
}

console.log("\n== which pill state, decided once for both clients ==");

const conn = (over = {}) => ({ institutionName: "Example Bank", status: "ok", lastSyncedAt: "2026-10-20T13:14:00Z", ...over });
const TODAY = "2026-10-20";

eq("nothing connected is the ordinary case",
  pillStateOf(null, undefined, "2026-10-17", TODAY), "manual");
eq("connected and synced",
  pillStateOf(conn(), "plaid", TODAY, TODAY), "synced");
// MANUAL WINS, and the pill has to say so: the number beside the word
// came from the user, and "synced" would attribute their figure to
// their bank.
eq("today's number was typed, so it says so",
  pillStateOf(conn(), "manual", TODAY, TODAY), "loggedToday");
eq("...and a snapshot with no source at all counts as typed",
  pillStateOf(conn(), undefined, TODAY, TODAY), "loggedToday");
eq("yesterday's manual log does not claim today",
  pillStateOf(conn(), "manual", "2026-10-19", TODAY), "synced");
eq("pulls failing", pillStateOf(conn({ status: "error" }), "plaid", "2026-10-19", TODAY), "stale");

// WORST NEWS FIRST. Reconnect is the only state that asks for an
// action, so it outranks every description — including a manual log
// made today, which would otherwise hide the fact that the
// connection is dead.
eq("needs reconnect, even on a day the user logged by hand",
  pillStateOf(conn({ status: "login_required" }), "manual", TODAY, TODAY), "reconnect");
eq("...and even when it has never synced",
  pillStateOf(conn({ status: "login_required", lastSyncedAt: null }), "plaid", TODAY, TODAY), "reconnect");
// Connected but never successfully pulled: there is no sync to name,
// so the pill reads exactly as it did before they connected.
eq("connected but never synced reads as manual",
  pillStateOf(conn({ lastSyncedAt: null }), "manual", "2026-10-17", TODAY), "manual");

is("only reconnect is an action", pillIsAction("reconnect"));
for (const st of ["manual", "synced", "loggedToday", "stale"]) {
  not(`...and ${st} is not`, pillIsAction(st));
}

// The state picks the string; neither client assembles its own.
{
  const parts = { amount: "$1,204.19", asOf: "10/17", syncedTime: "8:14 AM", syncedWhen: "10/18 7:02 AM" };
  eq("every state maps to the owner's own sentence",
    ["manual", "synced", "loggedToday", "stale", "reconnect"].map((st) => pillTextOf(st, parts)),
    ["$1,204.19 · as of 10/17", "$1,204.19 · synced 8:14 AM", "$1,204.19 · logged today",
     "$1,204.19 · synced 10/18 7:02 AM", "$1,204.19 · Reconnect"]);
}

// THE PHONE DRAWS THE SAME WORDS IN TWO LINES, because its anchor
// strip was measured at 260pt and the date was given its own line.
// The suffix is the half after the dot, from the same source, so a
// change to the owner's wording cannot reach one client and not the
// other.
{
  const parts = { asOf: "10/17", syncedTime: "8:14 AM", syncedWhen: "10/18 7:02 AM" };
  const states = ["manual", "synced", "loggedToday", "stale", "reconnect"];
  eq("the phone's half-line, same words",
    states.map((st) => pillSuffixOf(st, parts)),
    ["as of 10/17", "synced 8:14 AM", "logged today", "synced 10/18 7:02 AM", "Reconnect"]);
  // And the two really are one source: the web's line is the balance,
  // the separator, and exactly this.
  is("the web's line is the balance plus the phone's half",
    states.every((st) => pillTextOf(st, { amount: "$9.00", ...parts }) === `$9.00 · ${pillSuffixOf(st, parts)}`));
}

console.log("\n== the gate, which is two questions and not one ==");

const SET = (over = {}) => ({ connectedFeatures: false, hideConnectHint: false, ...over });

// Allowlisted is Plaid's Trial term; the toggle is the user's choice.
// Neither one alone opens the door.
not("not allowlisted, toggle on -> nothing", canOfferConnect(SET({ connectedFeatures: true }), false));
not("allowlisted, toggle off -> nothing", canOfferConnect(SET(), true));
is("both -> Connect is offered", canOfferConnect(SET({ connectedFeatures: true }), true));
is("the toggle itself follows the allowlist only", canSeeToggle(true));
not("...and is absent otherwise", canSeeToggle(false));

// A user who is not allowlisted must not be able to tell the
// difference between "not on the list" and "no such feature".
not("no hint for someone who cannot have it", shouldOfferHint(SET(), false));
is("the hint goes to someone who could turn it on and has not", shouldOfferHint(SET(), true));
not("...not to someone who already did", shouldOfferHint(SET({ connectedFeatures: true }), true));
not("...and not to someone who said don't show again", shouldOfferHint(SET({ hideConnectHint: true }), true));

console.log("\n== pulling on open ==");
not("nothing to pull with the feature off", shouldPullOnOpen(SET(), conn()));
not("nothing to pull with no connection", shouldPullOnOpen(SET({ connectedFeatures: true }), null));
is("otherwise ask the server", shouldPullOnOpen(SET({ connectedFeatures: true }), conn()));
// THE CLIENT DOES NOT SECOND-GUESS THE 12-HOUR WINDOW. The server
// owns that clock, per account, so one pull serves every device —
// and this codebase does not trust device clocks (syncGuard.ts). A
// client that skipped the call because its own clock said "too soon"
// is the one way to end up with a balance nobody ever refreshed.
is("even when the last sync was a minute ago — the server decides",
  shouldPullOnOpen(SET({ connectedFeatures: true }), conn({ lastSyncedAt: new Date().toISOString() })));

console.log("\n== a refresh that does nothing says what, exactly ==");
// None of these is an error. The button did nothing because nothing
// needed doing. "Failed" would be wrong; silence reads as a dead
// button.
eq("a double tap", refreshOutcome("just_now"), "Refreshed just now");
eq("already fresh", refreshOutcome("fresh"), "Already up to date");
eq("the daily cap, said without scolding",
  refreshOutcome("daily_cap"), "You've refreshed a few times today — try again tomorrow");
eq("the bank returned nothing", refreshOutcome("no_balance"), "Your bank didn't return a balance");
eq("a reason we do not have a sentence for says nothing at all",
  refreshOutcome("something_new"), null);
eq("...and so does no reason", refreshOutcome(undefined), null);

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S) of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
