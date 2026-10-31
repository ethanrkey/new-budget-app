import { act, cleanup, render, screen, waitFor } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { todayISO } from "../../src/engine/model.ts";

// THE PHONE, WITH A BANK BEHIND IT — mounted, the way it opens.
//
// The web has scripts/drive_connected.mjs because the same bug kept
// arriving there: THE SERVER WROTE IT AND THE PAGE DID NOT NOTICE.
// 2026-10-30 it arrived here. A cold start pulled, the pill said
// "synced 7:50 AM", and the number beside it stayed $818.50 until a
// swipe-down showed $3,065.69. Nothing unit-tested could have seen
// that: it is a launch, a store, a provider and a strip agreeing.
//
// The server is stood in for the way the real one behaves: the pull
// WRITES a snapshot into the rows loadState reads, and only a re-read
// shows it.

const OLD = 818.5;
const NEW = 3065.69;
const blank = normalize({});
const withBalance = (amount: number, date: string, source: "manual" | "plaid") => {
  const acct = blank.accounts[0];
  return {
    ...blank,
    settings: { ...blank.settings, hasSeenOnboarding: true, hasSeenTour: true, connectedFeatures: true, hideConnectHint: true },
    accounts: [{ ...acct, balance: amount, balanceAsOf: date }],
    accountSnapshots: { [acct.id]: [{ id: `s-${date}`, date, amount, source }] },
  };
};

// `mock` prefix: jest allows a module factory to reference it.
const mockServer = {
  state: withBalance(OLD, "2026-10-27", "manual") as unknown,
  lastSyncedAt: "2026-10-29T11:00:00.000Z" as string | null,
  pulls: [] as string[],
  // What the next plaid-balance call does: write a balance, or say it
  // is fresh.
  next: "write" as "write" | "fresh" | "write-then-lose-reply",
  // Seconds until the server would pull again, as plaid-balance says.
  nextPullIn: 12 * 3600 as number | null,
  onWrite: () => {},
  holdItems: null as Promise<void> | null,
  noItem: false,
  invoked: 0,
};
mockServer.onWrite = () => { mockServer.state = withBalance(NEW, todayISO(), "plaid"); };

jest.mock("../lib/supabase", () => {
  const table = (t: string) => ({
    select: () => ({
      maybeSingle: async () => {
        if (t === "plaid_beta") return { data: { user_id: "u1" } };
        if (t === "plaid_items" && mockServer.holdItems) { const h = mockServer.holdItems; mockServer.holdItems = null; await h; }
        if (t === "plaid_items" && mockServer.noItem) return { data: null };
        if (t === "plaid_items") return { data: { institution_name: "First Platypus", status: "ok", last_synced_at: mockServer.lastSyncedAt } };
        if (t === "plaid_accounts") return { data: { mask: "0000" } };
        return { data: null };
      },
      eq: () => ({ maybeSingle: async () => ({ data: null }) }),
    }),
  });
  return {
    supabase: {
      auth: { signOut: jest.fn() },
      from: jest.fn(table),
      functions: {
        invoke: jest.fn(async (name: string, opts: { body: { trigger: string } }) => {
          if (name !== "plaid-balance") return { data: {}, error: null };
          mockServer.invoked += 1;
          mockServer.pulls.push(opts.body.trigger);
          const syncedAt = new Date().toISOString();
          if (mockServer.next === "fresh") {
            return { data: { connected: true, status: "ok", synced: false, reason: "fresh",
              last_synced_at: mockServer.lastSyncedAt, next_pull_in_seconds: mockServer.nextPullIn }, error: null };
          }
          // THE WRITE, where loadState will find it — and nowhere else.
          mockServer.onWrite();
          mockServer.lastSyncedAt = syncedAt;
          // The server did the work and the phone never heard: a
          // timeout, a dropped connection, an app suspended mid-call.
          if (mockServer.next === "write-then-lose-reply") return { data: null, error: new Error("network") };
          return { data: { connected: true, status: "ok", synced: true, applied: "written",
            last_synced_at: syncedAt, next_pull_in_seconds: mockServer.nextPullIn }, error: null };
        }),
      },
    },
    BACKEND: "production",
    BACKEND_NOTICE: null,
  };
});
jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockServer.state),
  saveState: jest.fn(async () => ({ ok: true })),
  resetStore: jest.fn(),
}));

const { StateProvider } = require("../components/StateProvider");
const { Chrome } = require("../components/Chrome");
const { Text } = require("react-native");
const connection = require("../lib/connection");
const plaidApi = require("../../src/shared/plaidApi.ts");

const session = { user: { id: "u1", email: "a@b.com", app_metadata: { providers: ["email"] }, created_at: "2026-10-01" } };
// The real foreground path is Chrome's AppState listener; capture it.
const { AppState } = require("react-native");
let appStateHandlers: ((s: string) => void)[] = [];
jest.spyOn(AppState, "addEventListener").mockImplementation((_e: unknown, fn: unknown) => {
  appStateHandlers.push(fn as (s: string) => void);
  return { remove: () => { appStateHandlers = appStateHandlers.filter((h) => h !== fn); } };
});
const foreground = () => { for (const h of appStateHandlers) h("active"); };
const strip = () => screen.getByTestId("anchor-box").props.accessibilityLabel as string;

async function mount() {
  await render(
    <StateProvider userId="u1">
      <Chrome session={session}><Text>THE APP</Text></Chrome>
    </StateProvider>
  );
  await screen.findByText("THE APP");
}

beforeEach(() => {
  mockServer.state = withBalance(OLD, "2026-10-27", "manual");
  mockServer.lastSyncedAt = "2026-10-29T11:00:00.000Z";
  mockServer.pulls = [];
  mockServer.next = "write";
  mockServer.nextPullIn = 12 * 3600;
  mockServer.holdItems = null;
  mockServer.noItem = false;
  mockServer.invoked = 0;
  connection.reset();
  plaidApi.forgetPullDeadline();
});
afterEach(cleanup);

describe("a cold start that pulls", () => {
  it("shows the NEW balance without anybody swiping down", async () => {
    await mount();
    await waitFor(() => expect(strip()).toContain("$3,065.69"), { timeout: 3000 });
    expect(strip()).not.toContain("$818.50");
    expect(mockServer.pulls).toEqual(["open"]);
  });

  it("never says 'as of' while it is still finding out — it says syncing", async () => {
    // HOLD THE CONNECTION READ, which is the moment the old code drew
    // the manual label: no row yet, so no bank, so "as of 10/27".
    let release!: () => void;
    mockServer.holdItems = new Promise<void>((r) => { release = r; });
    await mount();
    expect(strip()).toContain("syncing");
    expect(strip()).not.toContain("as of");
    await act(async () => { release(); });
    await waitFor(() => expect(strip()).toContain("$3,065.69"));
  });

  it("an account with the feature on but NOTHING connected reads 'as of' once it knows", async () => {
    mockServer.noItem = true;
    await mount();
    await waitFor(() => expect(strip()).toContain("as of"));
    expect(mockServer.pulls).toEqual([]);
  });
});

describe("a pull whose answer never arrived", () => {
  it("still shows the new balance, because the stamp moved", async () => {
    // What the owner saw on 2026-10-30: the pill moved to "synced
    // 7:50 AM" and the number stayed $818.50 until a swipe.
    mockServer.next = "write-then-lose-reply";
    await mount();
    await waitFor(() => expect(strip()).toContain("$3,065.69"), { timeout: 3000 });
  });

  it("...and so does another device's pull, found on the way back", async () => {
    mockServer.next = "fresh";
    mockServer.nextPullIn = 0;
    await mount();
    await waitFor(() => expect(mockServer.pulls).toEqual(["open"]));
    expect(strip()).toContain("$818.50");
    // The web pulled while the phone was in a pocket.
    mockServer.onWrite();
    mockServer.lastSyncedAt = new Date().toISOString();
    await act(async () => { foreground(); });
    await waitFor(() => expect(strip()).toContain("$3,065.69"));
  });
});

describe("coming back to the foreground", () => {
  it("does not ask the server at all while the server's window has not lapsed", async () => {
    await mount();
    await waitFor(() => expect(strip()).toContain("$3,065.69"));
    const { supabase } = require("../lib/supabase");
    const reads = supabase.from.mock.calls.length;
    await act(async () => { foreground(); });
    expect(mockServer.pulls).toEqual(["open"]);
    expect(supabase.from.mock.calls.length).toBe(reads);
    expect(strip()).not.toContain("syncing");
  });

  it("asks, and shows the new balance, once the window HAS lapsed", async () => {
    mockServer.nextPullIn = 0;
    mockServer.next = "fresh";
    await mount();
    await waitFor(() => expect(mockServer.pulls).toEqual(["open"]));
    mockServer.next = "write";
    await act(async () => { foreground(); });
    await waitFor(() => expect(mockServer.pulls).toEqual(["open", "open"]));
    await waitFor(() => expect(strip()).toContain("$3,065.69"));
  });
});

describe("a swipe over a fresh balance", () => {
  it("asks, and says nothing about syncing", async () => {
    mockServer.next = "fresh";
    await mount();
    await waitFor(() => expect(mockServer.pulls).toEqual(["open"]));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { supabase } = require("../lib/supabase");
    const real = supabase.functions.invoke.getMockImplementation();
    let calling = false;
    supabase.functions.invoke.mockImplementationOnce(async (...a: unknown[]) => { calling = true; await gate; return real(...a); });
    let done!: Promise<unknown>;
    act(() => { done = connection.load({ connectedFeatures: true }, "swipe"); });
    // Checked WHILE THE CALL IS OUT, which is when the old code said
    // "syncing…" over a balance that was fresh the whole time.
    await waitFor(() => expect(calling).toBe(true));
    expect(strip()).not.toContain("syncing");
    await act(async () => { release(); await done; });
    expect(mockServer.pulls).toEqual(["open", "open"]);
    supabase.functions.invoke.mockImplementation(real);
  });
});
