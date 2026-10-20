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

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S) of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
