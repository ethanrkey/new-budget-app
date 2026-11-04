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

// PLAID'S BROWSER, which can hang (iOS presented nothing and the call
// never returned: 2026-11-03), throw (iOS refused to start it), or
// come back. `dismissAuthSession` ends a hanging one, as on iOS.
const mockBrowser = {
  mode: "hang" as "hang" | "throw" | "back",
  opened: [] as string[],
  dismissed: 0,
  pending: null as null | ((r: { type: string }) => void),
};
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn((url: string) => {
    mockBrowser.opened.push(url);
    if (mockBrowser.mode === "throw") return Promise.reject(new Error("failed to start"));
    if (mockBrowser.mode === "back") return Promise.resolve({ type: "cancel" });
    return new Promise((resolve) => { mockBrowser.pending = resolve; });
  }),
  dismissAuthSession: jest.fn(() => {
    mockBrowser.dismissed += 1;
    const p = mockBrowser.pending; mockBrowser.pending = null; p?.({ type: "dismiss" });
  }),
}));
// Ten seconds of waiting is the product; 1.5 is the test (longer than
// the sheet's 800ms fallback, so the browser has been asked by then).
jest.mock("../../src/shared/connect.ts", () => ({
  ...jest.requireActual("../../src/shared/connect.ts"),
  LINK_OPEN_TIMEOUT_MS: 1500,
}));

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
  notListed: false,
  // What plaid-exchange's recover answers, and how many times it was asked.
  recover: { ok: false, code: "NO_OPEN_SESSION" } as Record<string, unknown>,
  recovers: 0,
};
mockServer.onWrite = () => { mockServer.state = withBalance(NEW, todayISO(), "plaid"); };

jest.mock("../lib/supabase", () => {
  const table = (t: string) => ({
    select: () => ({
      maybeSingle: async () => {
        if (t === "plaid_beta") return { data: mockServer.notListed ? null : { user_id: "u1" } };
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
          if (name === "plaid-exchange") { mockServer.recovers += 1; return { data: mockServer.recover, error: null }; }
          if (name === "plaid-link-token") { mockServer.minted += 1; return { data: mockServer.linkToken, error: null }; }
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
  mockServer.notListed = false;
  mockServer.recover = { ok: false, code: "NO_OPEN_SESSION" };
  mockServer.recovers = 0;
  mockServer.minted = 0;
  mockServer.linkToken = { ok: true, link_token: "lt-1", hosted_link_url: "https://hosted.plaid.com/lt-1" };
  mockBrowser.mode = "hang";
  mockBrowser.opened = [];
  mockBrowser.dismissed = 0;
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
    await act(async () => { done = connection.load({ connectedFeatures: true }, "swipe"); });
    // Checked WHILE THE CALL IS OUT, which is when the old code said
    // "syncing…" over a balance that was fresh the whole time.
    await waitFor(() => expect(calling).toBe(true));
    expect(strip()).not.toContain("syncing");
    await act(async () => { release(); await done; });
    expect(mockServer.pulls).toEqual(["open", "open"]);
    supabase.functions.invoke.mockImplementation(real);
  });
});

describe("Settings, for an account not on the allowlist", () => {
  const Connected = require("../components/Connected").default;
  const NOTE = "Bank connection — in a small private beta for now. Everything else works by hand, exactly as it does today.";
  async function mountSettings() {
    await render(
      <StateProvider userId="u1">
        <Chrome session={session}><Connected /></Chrome>
      </StateProvider>
    );
  }

  it("says the feature is a small private beta, and offers nothing to press", async () => {
    mockServer.notListed = true;
    await mountSettings();
    expect(await screen.findByText(NOTE)).toBeTruthy();
    expect(screen.queryByText("Connect your bank")).toBeNull();
  });

  it("an allowlisted account sees the toggle and never the note", async () => {
    await mountSettings();
    expect(await screen.findByText("Connect your bank")).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

// 2026-11-03: Capital One finished at Plaid, Settings said "Connect your
// bank" again over the unfinished session, and the tester tapped it
// twice more. While a session is still being saved, Settings says so,
// keeps asking, and offers nothing that starts a second Link.
describe("Settings, while a connection is still finishing", () => {
  const Connected = require("../components/Connected").default;
  const CONNECT = "Connect your bank (Beta)";
  const FINISHING = "Finishing your connection…";
  const soon = () => new Date(Date.now() + 20 * 60_000).toISOString();
  async function mountSettings() {
    await render(
      <StateProvider userId="u1">
        <Chrome session={session}><Connected /></Chrome>
      </StateProvider>
    );
  }

  it("says it is finishing and hides Connect", async () => {
    mockServer.noItem = true;
    mockServer.recover = { ok: false, code: "ITEM_NOT_READY", pending_until: soon() };
    await mountSettings();
    expect(await screen.findByText(FINISHING)).toBeTruthy();
    expect(screen.getByText(/You don't need to connect again/)).toBeTruthy();
    expect(screen.queryByText(CONNECT)).toBeNull();
  });

  it("offers Connect when nothing is unfinished", async () => {
    mockServer.noItem = true;
    await mountSettings();
    expect(await screen.findByText(CONNECT)).toBeTruthy();
    expect(screen.queryByText(FINISHING)).toBeNull();
  });

  it("offers Connect again once the session has run out", async () => {
    mockServer.noItem = true;
    mockServer.recover = { ok: false, code: "ITEM_NOT_READY", pending_until: new Date(Date.now() - 1000).toISOString() };
    await mountSettings();
    expect(await screen.findByText(CONNECT)).toBeTruthy();
    expect(screen.queryByText(FINISHING)).toBeNull();
  });

  it("coming back to the app asks again, and shows the bank when it lands", async () => {
    mockServer.noItem = true;
    mockServer.recover = { ok: false, code: "ITEM_NOT_READY", pending_until: soon() };
    await mountSettings();
    await screen.findByText(FINISHING);
    const before = mockServer.recovers;
    // Saved, server-side, while the phone was away.
    mockServer.recover = { ok: true, connected: true, institution_name: "First Platypus", synced: true };
    mockServer.noItem = false;
    mockServer.next = "fresh";
    await act(async () => { foreground(); });
    expect(await screen.findByText("First Platypus ••0000")).toBeTruthy();
    expect(mockServer.recovers).toBeGreaterThan(before);
    expect(screen.queryByText(FINISHING)).toBeNull();
    expect(screen.queryByText(CONNECT)).toBeNull();
  });

  it("keeps asking every 20 seconds while it is open", async () => {
    // Only the interval is faked, from before it is set up; everything
    // the render and findBy wait on stays real.
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "Date", "performance", "hrtime",
      "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      mockServer.noItem = true;
      mockServer.recover = { ok: false, code: "ITEM_NOT_READY", pending_until: soon() };
      await mountSettings();
      await screen.findByText(FINISHING);
      const before = mockServer.recovers;
      await act(async () => { jest.advanceTimersByTime(20_000); });
      await act(async () => { jest.advanceTimersByTime(20_000); });
      expect(mockServer.recovers - before).toBe(2);
      expect(screen.getByText(FINISHING)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Connect, when Plaid does not open (2026-11-03, sandbox)", () => {
  const Connected = require("../components/Connected").default;
  const CONNECT = "Connect your bank (Beta)";
  async function mountSettings() {
    await render(
      <StateProvider userId="u1">
        <Chrome session={session}><Connected /></Chrome>
      </StateProvider>
    );
  }
  // Returns the sheet's onDismiss, taken while it is still mounted: in
  // a test nothing calls it, so the 800ms fallback stands in unless a
  // test calls it itself.
  async function tapConnect(): Promise<() => void> {
    const { fireEvent } = require("@testing-library/react-native");
    fireEvent.press(await screen.findByText(CONNECT));
    const cont = await screen.findByText("Continue");
    const sheet = screen.getAllByTestId("native-sheet", { includeHiddenElements: true }).find((n) => n.props.onDismiss);
    fireEvent.press(cont);
    return () => sheet?.props.onDismiss();
  }

  it("says Opening Plaid…, not Opening your bank…", async () => {
    mockServer.noItem = true;
    await mountSettings();
    await tapConnect();
    expect(await screen.findByText("Opening Plaid…")).toBeTruthy();
    expect(screen.queryByText("Opening your bank…")).toBeNull();
  });

  it("opens the browser only once the consent sheet has slid away", async () => {
    mockServer.noItem = true;
    await mountSettings();
    const dismissed = await tapConnect();
    await waitFor(() => expect(mockServer.minted).toBe(1));
    // Token in hand, sheet still dismissing: nothing is presented yet.
    expect(mockBrowser.opened).toEqual([]);
    await act(async () => { dismissed(); });
    await waitFor(() => expect(mockBrowser.opened).toEqual(["https://hosted.plaid.com/lt-1"]));
  });

  it("stops the spinner after the timeout and offers Try again, which opens it again", async () => {
    mockServer.noItem = true;
    await mountSettings();
    await tapConnect();
    // The browser call never returns, as on the owner's phone.
    expect(await screen.findByText("Plaid didn't open.", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("Opening Plaid…")).toBeNull();
    expect(screen.queryByText(CONNECT)).toBeNull();
    const { fireEvent } = require("@testing-library/react-native");
    mockBrowser.mode = "back";
    const dismissedBefore = mockBrowser.dismissed;
    const openedBefore = mockBrowser.opened.length;
    await act(async () => { fireEvent.press(screen.getByText("Try again")); });
    // Any hanging session is ended first, so iOS does not refuse the new one.
    await waitFor(() => expect(mockBrowser.opened.length).toBe(openedBefore + 1));
    expect(mockBrowser.dismissed).toBeGreaterThan(dismissedBefore);
    expect(mockServer.minted).toBe(2);
    await waitFor(() => expect(screen.queryByText("Plaid didn't open.")).toBeNull());
  });

  it("a browser that was asked to open and hung is ended by Try again", async () => {
    mockServer.noItem = true;
    await mountSettings();
    await tapConnect();
    await waitFor(() => expect(mockBrowser.opened.length).toBe(1), { timeout: 3000 });
    expect(await screen.findByText("Plaid didn't open.", {}, { timeout: 3000 })).toBeTruthy();
    const { fireEvent } = require("@testing-library/react-native");
    mockBrowser.mode = "back";
    await act(async () => { fireEvent.press(screen.getByText("Try again")); });
    await waitFor(() => expect(mockBrowser.opened.length).toBe(2));
    // The old one was dismissed and stood down: one recover from Try
    // again's return, none from the stale attempt's.
    expect(mockBrowser.pending).toBeNull();
    await waitFor(() => expect(screen.queryByText("Plaid didn't open.")).toBeNull());
  });

  it("a browser that refuses to start says so at once", async () => {
    mockServer.noItem = true;
    mockBrowser.mode = "throw";
    await mountSettings();
    await tapConnect();
    expect(await screen.findByText("Plaid didn't open.")).toBeTruthy();
    expect(screen.getByText(/Nothing was connected/)).toBeTruthy();
  });

  it("an open session with no result is not Finishing: Connect shows right away", async () => {
    mockServer.noItem = true;
    // What the server now answers for a session Plaid has nothing for.
    mockServer.recover = { ok: false, code: "NO_RESULT" };
    await mountSettings();
    expect(await screen.findByText(CONNECT)).toBeTruthy();
    expect(screen.queryByText("Finishing your connection…")).toBeNull();
  });
});
