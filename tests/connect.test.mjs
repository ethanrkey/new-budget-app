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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { normalize } from "../src/engine/stateShape.ts";
import { updateAccountBalance, updateAccountSnapshot } from "../src/engine/mutate.ts";
import { primaryAccount } from "../src/engine/model.ts";
import { fmtDate, fmtInstant, fmtShortStamp } from "../src/shared/dates.ts";
import { HIDDEN_ROWS_COPY, WHY_NOT } from "../src/content/logBalance.ts";
import { splitState, assembleState } from "../src/engine/entities.ts";
import {
  CONNECT_CONSENT, CONNECT_HINT, CONNECT_HINT_DISMISS, CONNECT_TOGGLE_SUB, DISCONNECT_NOTE,
  PILL, PILL_SHEET, PLAID_PORTAL_URL, TOGGLE_OFF_CONFIRM,
} from "../src/content/connect.ts";
import {
  pillStateOf, pillTextOf, pillSuffixOf, pillLongOf, pillIsAction, shouldPullOnOpen,
  canOfferConnect, canReconnect, canSeeToggle, canUseBankBalance, shouldOfferHint,
  shouldRestoreToggle, refreshOutcome,
} from "../src/shared/connect.ts";
import { duringPlaidWrite, plaidWriteInFlight, pullBalance } from "../src/shared/plaidApi.ts";

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
eq("disconnecting says all four things: access, history, the cost of coming back, Plaid's copy",
  DISCONNECT_NOTE,
  "Disconnecting removes Key Budget's access right away. Balances already pulled stay in your history. "
  + "Connecting again later starts a new connection, not this one. "
  + "To see or delete what Plaid holds, use Plaid Portal at my.plaid.com.");

console.log("\n== the hint on the Log balance sheet ==");
eq("it offers, and points at Settings",
  CONNECT_HINT, "Want this automatic? Turn on connected features in Settings.");
eq("and it can be turned off for good", CONNECT_HINT_DISMISS, "Don't show again");

console.log("\n== the Checking pill, all five states ==");
eq("not connected", PILL.manual("$1,204.19", "10/17"), "$1,204.19 · as of 10/17");
eq("connected and fresh", PILL.synced("$1,204.19", "8:14 AM"), "$1,204.19 · synced 8:14 AM");
// MANUAL WINS ON THE DAY, and the pill has to say so rather than
// claiming a sync whose number is not the one on screen.
// It used to say "logged today" and nothing else. The day was the
// only fact in it, and the day is the one fact this state already
// guarantees: it exists precisely when the snapshot is today's.
eq("connected, but today's number was typed",
  PILL.loggedToday("$1,204.19", "8:46 PM"), "$1,204.19 · logged 8:46 PM");
eq("a pull is happening right now", PILL.syncing("$1,204.19"), "$1,204.19 · syncing…");
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
  const parts = { amount: "$1,204.19", asOf: "10/17", syncedTime: "8:14 AM",
    syncedWhen: "10/18 7:02 AM", loggedStamp: "8:46 PM" };
  eq("every state maps to the owner's own sentence",
    ["manual", "synced", "syncing", "loggedToday", "stale", "reconnect"].map((st) => pillTextOf(st, parts)),
    ["$1,204.19 · as of 10/17", "$1,204.19 · synced 8:14 AM", "$1,204.19 · syncing…",
     "$1,204.19 · logged 8:46 PM", "$1,204.19 · synced 10/18 7:02 AM", "$1,204.19 · Reconnect"]);
}

// THE PHONE DRAWS THE SAME WORDS IN TWO LINES, because its anchor
// strip was measured at 260pt and the date was given its own line.
// The suffix is the half after the dot, from the same source, so a
// change to the owner's wording cannot reach one client and not the
// other.
{
  const parts = { asOf: "10/17", syncedTime: "8:14 AM", syncedWhen: "10/18 7:02 AM", loggedStamp: "8:46 PM" };
  const states = ["manual", "synced", "syncing", "loggedToday", "stale", "reconnect"];
  eq("the phone's half-line, same words",
    states.map((st) => pillSuffixOf(st, parts)),
    ["as of 10/17", "synced 8:14 AM", "syncing…", "logged 8:46 PM", "synced 10/18 7:02 AM", "Reconnect"]);
  // And the two really are one source: the web's line is the balance,
  // the separator, and exactly this.
  is("the web's line is the balance plus the phone's half",
    states.every((st) => pillTextOf(st, { amount: "$9.00", ...parts }) === `$9.00 · ${pillSuffixOf(st, parts)}`));
}

console.log("\n== THE COLLISION, as the owner actually ran it ==");

// THE SEQUENCE THAT FAILED IN SANDBOX ON 2026-10-20, step for step:
// a pull writes today's balance, the user types a different one the
// same evening, a stale pull runs, and the user's number survives.
// It did not. $250 typed at 9:20 PM was $100 again by 9:25.
//
// The cause was one word. `upsertSnapshotByDate` updated the row
// with `{ ...s, amount }`, which kept the `source: "plaid"` the pull
// had put there — so the row the user had just written claimed to
// have come from the bank. Two things followed:
//
//   - the bar said "synced", attributing their figure to Plaid;
//   - plaid_write_balance declines only where the row is NOT plaid,
//     so the guard never fired. The rule was reading a field the
//     manual path never set.
//
// `plaidWrite` below is the SQL guard expressed in JS. It is not the
// real one — that is one statement in supabase/plaid.sql and cannot
// run here — so it is written to the same condition deliberately and
// the comment is the link between them.
const plaidWrite = (snap, amount) => {
  // coalesce(data->>'source', 'manual') = 'plaid'
  const existing = snap ? (snap.source ?? "manual") : null;
  if (snap && existing !== "plaid") return { applied: "kept_manual", snap };
  return { applied: "written", snap: { ...(snap ?? {}), amount, source: "plaid" } };
};

{
  const DAY = "2026-10-20";
  let st = normalize({
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 0, balanceAsOf: "2026-10-01", order: 0 }],
  });

  // 1. The pull at 8:46 PM writes $100 for today.
  st = {
    ...st,
    accountSnapshots: { checking: [{ id: `checking:${DAY}`, date: DAY, amount: 100, source: "plaid", externalId: "pa-1" }] },
    accounts: st.accounts.map((a) => ({ ...a, balance: 100, balanceAsOf: DAY })),
  };
  eq("the pull's reading is the anchor", [primaryAccount(st).balance, primaryAccount(st).balanceAsOf], [100, DAY]);

  // 2. The user types $250 at 9:20 PM, same local day.
  st = updateAccountBalance(st, "checking", 250, DAY);
  const typed = st.accountSnapshots.checking.find((x) => x.date === DAY);
  eq("one row for the day, not two", st.accountSnapshots.checking.length, 1);
  eq("...holding what was typed", typed.amount, 250);
  // THE LINE THE WHOLE BUG TURNED ON.
  eq("...and it says a PERSON wrote it", typed.source, "manual");
  not("...with the bank's account id dropped", !!typed.externalId);
  is("...and the moment it was typed, for the web's bar", typeof typed.loggedAt === "string");
  eq("the anchor is the typed number", primaryAccount(st).balance, 250);

  // AND THE SAME ON A DAY WITH NOTHING IN IT YET, which is the
  // branch the tests above never reached. `upsertSnapshotByDate` has
  // two arms — replace today's row, or append a new one — and only
  // the replacing arm was covered, so dropping `source: "manual"`
  // from the append went unnoticed by all 1,916 checks. A first log
  // of the day is the COMMON case, and an unsourced row reads as
  // `coalesce(data->>'source','manual')` server-side but as nothing
  // at all to the bar, which then has no reason not to say synced.
  const FRESH = "2026-10-22";
  const st2 = updateAccountBalance(st, "checking", 480, FRESH);
  const first = st2.accountSnapshots.checking.find((x) => x.date === FRESH);
  eq("a first log of the day is appended, not merged", st2.accountSnapshots.checking.length, 2);
  eq("...and it too says a PERSON wrote it", first.source, "manual");
  is("...and carries the moment it was typed", typeof first.loggedAt === "string");
  eq("...so the next pull declines it as well", plaidWrite(first, 100).applied, "kept_manual");

  // 3. The forced stale pull runs and must decline.
  const after = plaidWrite(typed, 100);
  eq("the pull is declined, because the row is the user's", after.applied, "kept_manual");
  eq("...and $250 is still there", after.snap.amount, 250);

  // 4. Tomorrow's pull takes over with nothing to undo, which is the
  //    whole reason manual-wins costs at most a day.
  const tomorrow = plaidWrite(null, 310);
  eq("the next day's pull writes freely", [tomorrow.applied, tomorrow.snap.amount], ["written", 310]);
}

// EDITING A PULLED READING MAKES IT YOURS TOO. Same bug wearing a
// different hat: correcting the bank's number only to have the next
// pull put it back.
{
  const DAY = "2026-10-20";
  let st = normalize({
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 100, balanceAsOf: DAY, order: 0 }],
    accountSnapshots: { checking: [{ id: "s1", date: DAY, amount: 100, source: "plaid", externalId: "pa-1" }] },
  });
  st = updateAccountSnapshot(st, "checking", "s1", { amount: 275 });
  const edited = st.accountSnapshots.checking[0];
  eq("an edited reading is a manual one", [edited.amount, edited.source], [275, "manual"]);
  eq("...and the next pull leaves it alone", plaidWrite(edited, 100).applied, "kept_manual");

  // But a NON-amount edit is not a claim of authorship. Renaming or
  // re-dating does not make the figure yours.
  let st2 = normalize({
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 100, balanceAsOf: DAY, order: 0 }],
    accountSnapshots: { checking: [{ id: "s1", date: DAY, amount: 100, source: "plaid" }] },
  });
  st2 = updateAccountSnapshot(st2, "checking", "s1", { date: "2026-10-19" });
  eq("moving a pulled reading does not reauthor it",
    st2.accountSnapshots.checking[0].source, "plaid");
}

console.log("\n== 'last synced' is local, both halves ==");

// THE BUG THIS PINS: both clients built the string as
// `fmtDate(iso.slice(0, 10))` plus a local clock — the UTC DATE
// beside the LOCAL TIME. A sync at 8:46 PM Eastern displayed as
// "10/21/2026, 8:46 PM": tomorrow's date next to tonight's time.
// Half-converted is worse than not converted, because it looks
// converted.
//
// RUN IN A CHILD PROCESS WITH THE ZONE PINNED. `fmtInstant` reads
// the ambient zone, which is its whole job, so the only honest way
// to assert a literal is to fix the zone — and fixing it for the
// whole suite would quietly change what every other date test is
// measuring. One child, one variable, no reach.
{
  const probe = `
    const { fmtInstant, fmtClock } = await import("${new URL("../src/shared/dates.ts", import.meta.url).href}");
    console.log(JSON.stringify([fmtInstant("2026-10-21T00:46:00Z"), fmtClock("2026-10-21T00:46:00Z")]));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8", env: { ...process.env, TZ: "America/New_York" },
  });
  const [shown, clock] = JSON.parse(out);
  eq("an 8:46 PM Eastern sync shows the 20th, not UTC's 21st", shown, "10/20/2026, 8:46 PM");
  eq("...and the clock alone agrees with it", clock, "8:46 PM");
  // The date half and the time half must come from the SAME
  // conversion. This is the assertion the old code would have
  // failed: it took the date from the UTC string and the time from
  // the local clock.
  is("the date half and the time half cannot disagree", shown.endsWith(clock));
}

eq("nothing to show is an em dash, not Invalid Date", fmtInstant(null), "—");
eq("...and so is a string that is not an instant", fmtInstant("not a date"), "—");

console.log("\n== the web's long form, and the phone's short one ==");

// The owner's call 2026-10-20 after seeing both: a browser has room
// for the whole stamp and a phone does not, and "synced 8:14 AM" on
// a tab left open since yesterday is ambiguous in a way it never is
// on a phone you just picked up.
{
  const parts = { amount: "$1,204.19", asOf: "10/17", syncedStamp: "10/20/2026, 8:46 PM", loggedStamp: "10/20/2026, 9:20 PM" };
  eq("every state, in the web's words",
    ["manual", "synced", "loggedToday", "stale", "reconnect"].map((st) => pillLongOf(st, parts)),
    ["$1,204.19 · as of 10/17",
     "$1,204.19 · synced 10/20/2026, 8:46 PM",
     "$1,204.19 · logged 10/20/2026, 9:20 PM",
     "$1,204.19 · synced 10/20/2026, 8:46 PM",
     "$1,204.19 · Reconnect"]);
  // A MANUAL OVERRIDE SHOWS WHEN IT WAS TYPED, which is a different
  // instant from the last sync — the two must not be confused, and
  // the long form is the only place both are visible at once.
  not("the override's stamp is not the sync's",
    pillLongOf("loggedToday", parts) === pillLongOf("synced", parts));
  // Both forms answer the same question; only the rendering differs.
  const short = ["manual", "synced", "loggedToday", "stale", "reconnect"]
    .map((st) => pillSuffixOf(st, { asOf: "10/17", syncedTime: "8:46 PM", syncedWhen: "x" }));
  is("the verb is the same word in both forms",
    short.every((sfx, i) => {
      const long = pillLongOf(["manual", "synced", "loggedToday", "stale", "reconnect"][i], parts);
      return long.includes(sfx.split(" ")[0]);
    }));
}

console.log("\n== 'Use bank balance' is offered only when it would do something ==");
// Beside a number the bank already gave you it is a button that
// claims to change something and does not.
is("offered when today's figure is the user's own", canUseBankBalance("loggedToday"));
for (const st of ["manual", "synced", "stale", "reconnect"]) {
  not(`...and not when it is ${st}`, canUseBankBalance(st));
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

console.log("\n== ten Items EVER, and removal does not give one back ==");
// Plaid's Trial terms, read by the owner on support.plaid.com
// 2026-10-21: no time limit, ten PRODUCTION Items ever, /item/remove
// does NOT free a slot, and two Items for the same bank account
// count as two. Everything in this block exists because of that one
// sentence.

// A broken login is repaired IN PLACE. Disconnect-then-connect would
// work and would cost a second slot out of ten.
is("a bank asking to be signed into again offers a repair",
  canReconnect(conn({ status: "login_required" })));
not("...and a healthy one does not", canReconnect(conn()));
not("...and nor does no connection at all", canReconnect(null));

// The repair must be UPDATE MODE on both clients, and neither may
// invent a second way of doing it.
{
  const linkToken = readFileSync(new URL("../supabase/functions/plaid-link-token/index.ts", import.meta.url), "utf8");
  is("the server has an update-mode branch", linkToken.includes("if (body.update)"));
  // Plaid REJECTS a token carrying both, so this is not tidiness.
  const updateBranch = linkToken.slice(linkToken.indexOf("if (body.update)"), linkToken.indexOf("ALREADY_CONNECTED"));
  is("update mode sends the access token", updateBranch.includes("access_token: accessToken"));
  not("...and does NOT send products, which Plaid refuses", updateBranch.includes("products: PRODUCTS"));
  is("a second Item is refused BEFORE Link opens, not after",
    linkToken.indexOf("ALREADY_CONNECTED") < linkToken.indexOf("linkTokenCreate, {\n    user:"));
  is("an unfinished session reserves the slot", linkToken.includes("ALREADY_STARTING"));

  for (const [who, path] of [
    ["the phone", "../mobile/components/Connected.tsx"],
    ["the web", "../src/components/ConnectedAccount.jsx"],
  ]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    is(`${who} opens Link in update mode to repair`, /startLink\([^)]*update\)/.test(text));
    is(`${who} offers the repair only when the bank asks`, text.includes("canReconnect(connection)"));
  }
}

// A reconnect is proved by a PULL, never by Link saying so.
{
  const balance = readFileSync(new URL("../supabase/functions/plaid-balance/index.ts", import.meta.url), "utf8");
  is("only 'reconnect' gets past a login_required item",
    balance.includes('item.status === "login_required" && trigger !== "reconnect"'));
}

// The slot ledger: a count that survives the disconnect that does
// not give the slot back.
{
  const sql = readFileSync(new URL("../supabase/plaid.sql", import.meta.url), "utf8");
  is("there is a table nothing deletes from", sql.includes("create table if not exists plaid_item_creations"));
  is("...which records the environment, since sandbox Items are free",
    /plaid_item_creations \([\s\S]*?env\s+text not null/.test(sql));
  // Bounded to the table's own parentheses: a loose match finds a
  // user_id three tables further down and passes for the wrong
  // reason.
  const creations = sql.slice(sql.indexOf("create table if not exists plaid_item_creations"));
  not("...and holds no user id, having nothing to purge",
    creations.slice(0, creations.indexOf(");")).includes("user_id"));
  is("the owner has a query for how many of the ten are gone",
    sql.includes("select env, count(*) as items_created"));
  const exchange = readFileSync(new URL("../supabase/functions/plaid-exchange/index.ts", import.meta.url), "utf8");
  is("every created Item is written to it", exchange.includes('from("plaid_item_creations").insert'));
}

console.log("\n== leaving is told what it costs ==");
// "You can always turn it back on" is not quite true on a Trial
// plan: you can, and it spends another of the ten. Someone deciding
// whether to switch it off is entitled to know before, not after.
for (const [what, text] of [
  ["disconnecting", DISCONNECT_NOTE],
  ["turning the feature off", TOGGLE_OFF_CONFIRM.body("First Platypus Bank")],
]) {
  is(`${what} says reconnecting later is a new connection`,
    text.includes("Connecting again later starts a new connection, not this one."));
  is(`${what} still says the history is kept`, text.includes("stay in your history"));
}
eq("the toggle-off confirm names the bank",
  TOGGLE_OFF_CONFIRM.body("First Platypus Bank").includes("disconnects First Platypus Bank right away"), true);

console.log("\n== the hidden-rows warning uses the app's date format ==");
// It was handing in the raw ISO, so the one sentence in that flow
// that names a date read "dated before 2026-10-21" beside rows that
// all said 10/21/2026.
eq("the sentence takes a formatted date and prints it",
  HIDDEN_ROWS_COPY.lede(3, fmtDate("2026-10-21")),
  "3 rows dated before 10/21/2026 will drop off the Ledger:");
for (const [who, path] of [
  ["the phone", "../mobile/components/LogBalance.tsx"],
  ["the web", "../src/components/UpdateBalanceModal.jsx"],
]) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  is(`${who} formats it before handing it over`,
    text.includes("HIDDEN.lede(confirming.length, fmtDate(date))"));
}

console.log("\n== a live bank with the feature off is not a state this app has ==");
// Found on iOS 2026-10-21. Hosted Link hands the user to a browser,
// and coming back re-reads this device's state from the server —
// including settings that can be older than the toggle that started
// the flow. The phone returned with the bank saved and pulled and
// the switch showing off, and because the switch said off nothing
// read the connection again to notice. A disagreement that hides
// the evidence of itself.
is("a connection with the toggle off puts the toggle back",
  shouldRestoreToggle({ connectedFeatures: false }, conn()));
not("...and leaves it alone when it agrees",
  shouldRestoreToggle({ connectedFeatures: true }, conn()));
// THE OTHER DIRECTION IS NOT THE SAME QUESTION. No connection and
// the toggle on is an ordinary state: it is every user who has
// opted in and not yet connected anything.
not("no connection, toggle off — nothing to restore",
  shouldRestoreToggle({ connectedFeatures: false }, null));
not("no connection, toggle on — the normal opted-in state",
  shouldRestoreToggle({ connectedFeatures: true }, null));

// Both clients must consult it, because both end their connect flow
// by replacing local state with the server's copy.
for (const [file, path, handover] of [
  ["the phone", "../mobile/components/Connected.tsx", "cameBackConnected.current = row;"],
  ["the web", "../src/components/ConnectedAccount.jsx", "connectedRow.current = await refresh();"],
]) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  is(`${file} restores the toggle after a connect`, text.includes("shouldRestoreToggle("));
  // AND IS GIVEN THE ROW TO RESTORE IT FROM. Checking only that the
  // predicate is mentioned passes just as happily when the connect
  // flow stops handing the row over — the effect then runs on an
  // empty ref and does nothing, which is the original bug exactly.
  // The mutation runner found this on 2026-10-21, after a fix to the
  // runner itself stopped it crediting kills to a crashing suite.
  is(`...and ${file} hands it the row it actually read`, text.includes(handover));
}

console.log("\n== the toggle's sub-line is written once ==");
// It was written out in both clients, so the owner's one-line edit
// to it on 2026-10-21 was two edits — either of which could have
// been missed, leaving the two screens saying different things
// about what connecting does.
eq("the owner's line, verbatim", CONNECT_TOGGLE_SUB,
  "When on, Key Budget can read your checking balance — and nothing else. "
  + "You can always log balances by hand instead.");
not('"Off by default" is gone, on the owner\'s instruction',
  CONNECT_TOGGLE_SUB.includes("Off by default"));
for (const [file, path] of [
  ["the phone", "../mobile/components/Connected.tsx"],
  ["the web", "../src/components/ConnectedAccount.jsx"],
]) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  is(`${file} draws it from the content file`, text.includes("CONNECT_TOGGLE_SUB"));
  not(`${file} does not keep its own copy`, text.includes("read your checking balance"));
}

console.log("\n== a write of OURS is not 'another device' ==");
// The web keeps a copy of the server's version and, on focus, asks
// whether the row moved while it was away. A pull moves the row from
// an edge function, so for the moment between asking and re-reading
// it has moved for a reason the user is watching happen — and the
// page told them "your data had changed on another device" about
// their own tap. The counter is what the check consults.

{
  const seen = [];
  const caller = {
    functions: {
      invoke: async () => {
        // MID-CALL is the only interesting moment: before and after
        // are easy and were never wrong.
        seen.push(plaidWriteInFlight());
        return { data: { connected: true, synced: true, applied: "written" }, error: null };
      },
    },
  };
  not("nothing claimed at rest", plaidWriteInFlight());
  await pullBalance(caller, "adopt");
  eq("claimed for the length of the call", seen, [true]);
  not("released when it returns", plaidWriteInFlight());

  // A COUNT AND NOT A FLAG. The client holds a claim across its own
  // reload, and the call it makes inside that claim takes a second
  // one; a boolean would have the inner release clear the outer.
  let inner = null;
  await duringPlaidWrite(async () => {
    await pullBalance(caller, "open");
    inner = plaidWriteInFlight();
  });
  is("an inner call finishing does not release the outer claim", inner);
  not("...and the outer one does", plaidWriteInFlight());

  // A THROWN CALL MUST NOT LEAVE THE CLAIM STANDING, or the page
  // would never announce a real change from another device again.
  try {
    await duringPlaidWrite(async () => { throw new Error("network"); });
  } catch { /* expected */ }
  not("released when the call throws", plaidWriteInFlight());
}

// And that the check actually asks. The counter is only worth
// anything if the one place that shows the banner consults it.
{
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const check = app.slice(app.indexOf("async function check()"), app.indexOf('"refreshed"'));
  is("the focus check guards on it", check.includes("plaidWriteInFlight()"));
  is("...and again after the version fetch, since a pull can start mid-check",
    check.split("plaidWriteInFlight()").length - 1 >= 2);
}

console.log("\n== no page still says the app never connects to a bank ==");
// Connecting shipped; the sentences that promised it never would are
// now false, and a privacy page that is false is the worst kind. The
// claim was in two places and only one of them was the obvious one.
{
  for (const page of ["Landing.jsx", "Privacy.jsx"]) {
    const text = readFileSync(new URL(`../src/components/${page}`, import.meta.url), "utf8");
    for (const claim of ["never connects to your bank", "No bank connection, ever", "never asks for one"]) {
      not(`${page} does not say "${claim}"`, text.includes(claim));
    }
  }
  const landing = readFileSync(new URL("../src/components/Landing.jsx", import.meta.url), "utf8");
  is("the landing line is the owner's replacement, verbatim",
    landing.includes("Free. No bank connection required."));
}

// ---- Why Save would not work, said out loud --------------------------
console.log("\n== a dead button with no explanation ==");
{
  // A GOOD VALUE RETURNS NULL, which is also the permission to
  // submit — one expression, so a form cannot disable its button on
  // one rule and refuse the press on another.
  eq("a plain balance is fine", WHY_NOT.balance("40"), null);
  eq("...and so is a negative one — an overdraft is a balance", WHY_NOT.balance("-12.50"), null);
  eq("...and zero", WHY_NOT.balance("0"), null);
  eq("nothing typed asks for it", WHY_NOT.balance(""), "Enter the balance.");
  eq("...and whitespace is nothing typed", WHY_NOT.balance("   "), "Enter the balance.");
  eq("a stray letter is named", WHY_NOT.balance("40o"), "That is not a number.");

  // A CONTRIBUTION OF NOTHING IS NOT A CONTRIBUTION, and the form
  // used to decline zero without a word.
  eq("a contribution needs to be above zero", WHY_NOT.contribution("0"), "Enter an amount more than zero.");
  eq("...and a negative one is refused too", WHY_NOT.contribution("-5"), "Enter an amount more than zero.");
  eq("a real contribution is fine", WHY_NOT.contribution("25"), null);
  eq("nothing typed asks for an amount", WHY_NOT.contribution(""), "Enter an amount.");

  // The event form needs two things and names whichever is missing,
  // not both: a list of everything wrong with a form you have
  // half-filled is a scolding.
  eq("no name is named first", WHY_NOT.event("", "40"), "Give it a name.");
  eq("...then the amount", WHY_NOT.event("Rent", ""), "Enter an amount.");
  eq("a whole row is fine", WHY_NOT.event("Rent", "1500"), null);
  eq("one occurrence needs its own amount", WHY_NOT.occurrence(""), "Enter an amount for this date.");
  eq("...and it may be zero, which is a real override", WHY_NOT.occurrence("0"), null);

  // AND THE BUTTONS THEMSELVES. Disabled only while a write is in
  // flight, which is not a verdict on what has been typed.
  const forms = [
    ["../mobile/components/LogBalance.tsx", "disabled={busy}"],
    ["../mobile/components/ContributionPrompt.tsx", "disabled={busy}"],
    ["../src/components/EventForm.jsx", "disabled={submitted}"],
  ];
  for (const [file, expected] of forms) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    is(`${file.split("/").pop()} disables Save only while saving`, src.includes(expected));
    not(`...and never on what was typed`, /disabled=\{!(valid|why)/.test(src));
    is(`...and asks WHY_NOT instead`, src.includes("WHY_NOT."));
  }
}

// ---- The short stamp: the day, only when it is not today --------------
console.log("\n== how old is this number ==");
{
  // A fixed "now" and instants built from it, so the assertions are
  // about the FORMAT and not about when the suite happened to run.
  const now = new Date(2026, 9, 26, 21, 15);
  const at = (dayOffset, h, min) =>
    new Date(2026, 9, 26 + dayOffset, h, min).toISOString();

  eq("today is just the clock", fmtShortStamp(at(0, 20, 46), now), "8:46 PM");
  eq("yesterday says so in words", fmtShortStamp(at(-1, 20, 46), now), "yesterday, 8:46 PM");
  eq("older takes a date, with no year", fmtShortStamp(at(-6, 20, 46), now), "10/20, 8:46 PM");
  // 11pm and 1am are two hours apart and two different days, and
  // "yesterday" is a claim about the calendar, not about a span.
  eq("eleven at night is yesterday to one in the morning",
    fmtShortStamp(new Date(2026, 9, 25, 23, 30).toISOString(), new Date(2026, 9, 26, 1, 0)),
    "yesterday, 11:30 PM");
  eq("nothing synced yet is a dash", fmtShortStamp(null, now), "—");
  eq("...and so is a string that is not an instant", fmtShortStamp("not a date", now), "—");
  // The web is unchanged and says the whole thing, year included.
  is("the web's stamp still carries the year",
    /\d{4}/.test(fmtInstant(at(-6, 20, 46))));
}

// ---- "syncing…": the one state that is not about the number ----------
console.log("\n== a pull in flight ==");
{
  const conn = (over = {}) => ({ institutionName: "Bank", status: "ok",
    lastSyncedAt: "2026-10-20T12:46:00.000Z", mask: "1234", ...over });
  const TODAY2 = "2026-10-20";
  eq("a pull in flight says so", pillStateOf(conn(), "plaid", TODAY2, TODAY2, true), "syncing");
  // It outranks even Reconnect: that prompt asks for work, and a
  // pull that may be about to succeed is work nobody may need.
  eq("...even over a connection asking to be signed into again",
    pillStateOf(conn({ status: "login_required" }), "plaid", TODAY2, TODAY2, true), "syncing");
  eq("...and over today's typed number",
    pillStateOf(conn(), "manual", TODAY2, TODAY2, true), "syncing");
  // Nothing to sync WITH is not syncing, whatever a caller passes.
  eq("an account with no bank is never syncing",
    pillStateOf(null, "manual", TODAY2, TODAY2, true), "manual");
  // Every existing caller passes four arguments and must be unmoved.
  eq("the flag defaults to off", pillStateOf(conn(), "plaid", TODAY2, TODAY2), "synced");
}

// ---- The swipe asks the same question the app asks on open -----------
console.log("\n== what a swipe down costs ==");
{
  const provider = readFileSync(new URL("../mobile/components/StateProvider.tsx", import.meta.url), "utf8");
  const pull = provider.slice(provider.indexOf("const pullToRefresh"), provider.indexOf("useEffect(() => { resetStore()"));
  // THE POINT OF THE WHOLE BULLET: a swipe must not spend one of
  // the four manual refreshes a day. `load` sends trigger "open",
  // which the server gates on the 12-hour window and never counts.
  is("the swipe goes through the connection load, not a refresh call",
    pull.includes("loadConnection({ connectedFeatures })"));
  is("...and never asks for a 'refresh' trigger", !pull.includes('"refresh"'));
  is("...and reloads even when the bank could not be reached",
    pull.includes("catch { /* reload anyway */ }"));
  const conn = readFileSync(new URL("../mobile/lib/connection.ts", import.meta.url), "utf8");
  is("and the load it calls is the open-trigger one", conn.includes('pullBalance(supabase as never, "open")'));
  // And it reports a write only when there was one. Chrome reloads
  // the whole state on this answer, so a load that always said no
  // would leave the balance stale and a load that always said yes
  // would refetch after every open.
  is("...and reports a write only when the pull synced AND was applied",
    conn.includes('wrote = result.synced && result.applied === "written";'));

  // Coming back to the app is an open, on both clients.
  const chrome = readFileSync(new URL("../mobile/components/Chrome.tsx", import.meta.url), "utf8");
  // ANCHORED ON "active", because the dependency array two lines
  // below the listener also names syncConnection — a looser match
  // went on passing with the body of the listener deleted.
  is("the phone asks again when it comes back to the foreground",
    /next === "active"\) void syncConnection\(\);/.test(chrome));
  is("...and reloads its state when the pull actually wrote",
    chrome.includes("if (wrote) await refresh();"));
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const onReturn = app.slice(app.indexOf("async function onReturn"), app.indexOf("document.addEventListener(\"visibilitychange\", onReturn)"));
  is("the web asks again when the tab comes back", onReturn.includes('pullNow("open")'));
  is("...and not while one of its own writes is outstanding", onReturn.includes("plaidWriteInFlight()"));
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S) of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
