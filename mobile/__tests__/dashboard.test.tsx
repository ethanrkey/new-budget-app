import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";

// The Dashboard's SHAPE, brought up to the web's on 2026-10-14.
//
// What is asserted here is structure, not arithmetic: the numbers come
// from computeDebtSummary and computeNetPosition, which the engine
// suite covers with real money. What only exists mounted is which
// cards are on screen in which of the three debt states, and whether
// the dashed cards actually open the form.

// `mock` prefix: jest allows a module factory to reference it.
const mockLoaded: { state: unknown } = { state: null };
const mockSaved: unknown[] = [];

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), signOut: jest.fn() } },
  BACKEND: "production",
  BACKEND_NOTICE: null,
}));
jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockLoaded.state),
  saveState: jest.fn(async (_id: string, s: unknown) => { mockSaved.push(s); return { ok: true }; }),
  resetStore: jest.fn(),
}));

const { StateProvider } = require("../components/StateProvider");
const Dashboard = require("../app/(tabs)/dashboard").default;

/** A state with one savings account and `loans` debt categories. */
function fixture(loans: { name: string; owed: number | null }[]) {
  const base = normalize({
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
    trackerCategories: [
      { id: "sav", name: "Ally Savings", order: 0, kind: "asset", assetKind: "savings" },
      ...loans.map((l, i) => ({ id: `loan${i}`, name: l.name, order: i + 1, kind: "debt" })),
    ],
    recurring: [], oneoffs: [],
  });
  const balanceSnapshots: Record<string, unknown[]> = {
    sav: [{ id: "s1", date: "2026-10-01", amount: 8200 }],
  };
  loans.forEach((l, i) => {
    if (l.owed != null) balanceSnapshots[`loan${i}`] = [{ id: `b${i}`, date: "2026-10-01", amount: l.owed }];
  });
  return { ...base, balanceSnapshots };
}

async function mount() {
  await render(
    <StateProvider userId="u1">
      <Dashboard />
    </StateProvider>
  );
  await screen.findByText("Net position");
}

beforeEach(async () => {
  mockSaved.length = 0;
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
});

test("the savings section ends with a card that starts one", async () => {
  mockLoaded.state = fixture([]);
  await mount();

  expect(screen.getByText("Savings & investments")).toBeOnTheScreen();
  // The explanation of what the section is FOR, shared with the web
  // so it cannot drift (src/content/dashboard.ts).
  expect(screen.getByText(/a Roth IRA, a brokerage/)).toBeOnTheScreen();
  await userEvent.press(screen.getByLabelText("+ Add account"));
  expect(await screen.findByText("Add an account")).toBeOnTheScreen();
});

test("with no loans there is nothing to collapse, so there is no overview", async () => {
  mockLoaded.state = fixture([]);
  await mount();

  // An overview of nothing — "$0.00 · 0 loans" — is noise, so the
  // whole debt section is the add card.
  expect(screen.getByText("Loans")).toBeOnTheScreen();
  expect(screen.queryByText("Debt")).toBeNull();
  expect(screen.queryByText(/Show \d+ loan/)).toBeNull();
});

test("collapsed, the debt section is one card that names every loan", async () => {
  mockLoaded.state = fixture([{ name: "Car loan", owed: 9100 }, { name: "Student loan", owed: null }]);
  await mount();

  expect(screen.getByText("Debt")).toBeOnTheScreen();
  // The total AND the one loan's row both say $9,100.00 here, which
  // is correct and makes getByText ambiguous — assert the count
  // rather than weakening the query to the first match.
  expect(screen.getAllByText("$9,100.00")).toHaveLength(2);
  expect(screen.getByText(/2 loans · 1 not logged yet/)).toBeOnTheScreen();

  // Every loan by name, not the first few: capping the list hides
  // exactly the one somebody is looking for.
  expect(screen.getByText("Car loan")).toBeOnTheScreen();
  expect(screen.getByText("Student loan")).toBeOnTheScreen();
  // And a loan with no reading says so. It is not zero, it is unknown.
  expect(screen.getByText("not logged")).toBeOnTheScreen();
});

test("expanding puts the add card first and the loans after it", async () => {
  mockLoaded.state = fixture([{ name: "Car loan", owed: 9100 }]);
  await mount();

  expect(screen.queryByText("Loans")).toBeNull();            // collapsed: no add card
  await userEvent.press(screen.getByLabelText("Show 1 loan"));

  // The add card is always first and never moves, so expanding does
  // not shuffle the screen around the thing just pressed.
  expect(await screen.findByText("Loans")).toBeOnTheScreen();
  expect(screen.getByLabelText("Minimize")).toBeOnTheScreen();
  expect(screen.queryByText("Debt")).toBeNull();             // the overview is gone
  expect(screen.getAllByText(/Car loan/).length).toBeGreaterThan(0);

  await userEvent.press(screen.getByLabelText("Minimize"));
  expect(await screen.findByText("Debt")).toBeOnTheScreen();
});

test("adding a loan from the collapsed card expands the section too", async () => {
  // A collapsed card that silently grew by one is worse than useless.
  mockLoaded.state = fixture([{ name: "Car loan", owed: 9100 }]);
  await mount();

  await userEvent.press(screen.getByLabelText("+ Add loan"));
  expect(await screen.findByText("Add a loan")).toBeOnTheScreen();
  // The form opens on the debt kind, so it asks a loan's questions.
  expect(screen.getByLabelText("Original amount")).toBeOnTheScreen();

  // AND THE SECTION IS OPEN BEHIND IT, which is what this test is
  // named for and did not actually check until the mutation audit
  // pointed out that nothing could kill it. The new loan lands at the
  // end of the list, and a collapsed card that silently grew by one
  // is worse than useless.
  expect(screen.getByLabelText("Minimize")).toBeOnTheScreen();
  expect(screen.queryByText("Debt")).toBeNull();
});

// ---- the follow-up: what goes IN to the account just added ----------
//
// Setup asks this as a step; the Dashboard asks it one account at a
// time, right after one is created. Same words, same rule builder —
// an account added here and one added during setup have to produce
// the same thing.
describe("after a new account is added", () => {
  async function addSavings(name: string) {
    mockLoaded.state = fixture([]);
    await mount();
    await userEvent.press(screen.getByLabelText("+ Add account"));
    await screen.findByText("Add an account");
    await userEvent.type(screen.getByLabelText("Name"), name);
    await userEvent.type(screen.getByLabelText("Current balance"), "8200");
    await userEvent.press(screen.getByLabelText("Save"));
  }

  test("it offers to schedule a contribution, and the offer can be declined", async () => {
    await addSavings("Ally");
    expect(await screen.findByText("Put money into Ally regularly?")).toBeOnTheScreen();

    // DISMISSIBLE, with a real button. An offer that arrives unasked
    // for and has no visible way out is a demand.
    await userEvent.press(screen.getByLabelText("Not now"));
    expect(screen.queryByText("Put money into Ally regularly?")).toBeNull();
    // Declining writes nothing beyond the account itself.
    const last = mockSaved[mockSaved.length - 1] as { recurring: unknown[] };
    expect(last.recurring).toHaveLength(0);
  });

  test("...and scheduling one writes a rule in that account's own category", async () => {
    await addSavings("Ally");
    await screen.findByText("Put money into Ally regularly?");

    await userEvent.type(screen.getByLabelText("Ally contribution amount"), "300");
    await userEvent.press(screen.getByLabelText("Schedule it"));

    await waitFor(() => {
      const last = mockSaved[mockSaved.length - 1] as {
        recurring: { name: string; amount: number; category: string }[];
        trackerCategories: { id: string; name: string }[];
      };
      expect(last.recurring).toHaveLength(1);
      const ally = last.trackerCategories.find((c) => c.name === "Ally")!;
      expect(last.recurring[0]!.name).toBe("To Ally");
      expect(last.recurring[0]!.amount).toBe(300);
      expect(last.recurring[0]!.category).toBe(ally.id);
    });
  });

  test("a weekly cadence drops the payment day, because it cannot mean anything", async () => {
    await addSavings("Ally");
    await screen.findByText("Put money into Ally regularly?");
    expect(screen.getByLabelText("Ally payment day")).toBeOnTheScreen();
    await userEvent.press(screen.getByLabelText("Every week"));
    expect(screen.queryByLabelText("Ally payment day")).toBeNull();
  });
});
