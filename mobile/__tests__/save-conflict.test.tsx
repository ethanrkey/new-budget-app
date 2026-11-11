import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { splitState } from "../../src/engine/entities.ts";
import { setMonthlyActual } from "../../src/engine/mutate.ts";

// A FALSE "SOMEONE ELSE CHANGED THIS", AND THE DELETION BEHIND ITS
// DISMISS BUTTON (2026-11-11, the owner's phone).
//
// November's Electric actual, typed on the Spending tab, Done pressed:
// the popup said the change was not saved, with no other device open.
// Done fires submit and then blur, the field saved on both, and two
// commits planned the same write from the same state. The first landed;
// the second hit the row the first had just made and was reported as a
// conflict. Behind Dismiss it was worse: the loser rolled the screen back
// to before the edit while the store kept the winner's state as its
// baseline, so the next edit of anything planned a tombstone for the
// entry. See the spec, "Someone else changed this" with nobody else
// there.
//
// THE REAL STORE (lib/store.ts) against a stand-in budget_entities with
// the server's two rules: an update must name the row's version, and a
// revive only matches a deleted row. Every write is logged, so what is
// asserted is what reached the "server".

type Row = { kind: string; entity_id: string; data: unknown; version: number; schema_version: number; deleted_at: string | null };
const mockDb = { rows: new Map<string, Row>(), log: [] as string[] };

const start = normalize({
  settings: { budgetHorizon: "2027-04-01", ledgerHorizon: "2027-02-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-11-01", order: 0 }],
  recurring: [{ id: "r-el", name: "Electric", amount: 150, category: "bill", order: 0,
    cadence: "monthly", startDate: "2026-09-01", dayOfMonth: 15, variable: true }],
  oneoffs: [],
});

function seed() {
  mockDb.rows.clear();
  mockDb.log.length = 0;
  for (const e of splitState(start)) {
    mockDb.rows.set(`${e.kind}:${e.id}`, {
      kind: e.kind, entity_id: e.id, data: e.data, version: 1, schema_version: e.schemaVersion, deleted_at: null,
    });
  }
}

jest.mock("../lib/supabase", () => {
  const db = mockDb;
  // A round trip, so two saves started together really do overlap.
  const trip = () => new Promise((r) => setTimeout(r, 5));
  const from = () => {
    const f: Record<string, unknown> = {};
    let mode = "select";
    let patch: Record<string, unknown> = {};
    let ins: Row | null = null;
    const b: Record<string, unknown> = {
      select: () => b, is: () => b,
      not: () => { f.onlyDeleted = true; return b; },
      eq: (k: string, v: unknown) => { f[k] = v; return b; },
      update: (p: Record<string, unknown>) => { mode = "update"; patch = p; return b; },
      insert: (r: Row) => { mode = "insert"; ins = r; return b; },
      maybeSingle: async () => {
        await trip();
        if (mode === "insert") {
          const k = `${ins!.kind}:${ins!.entity_id}`;
          if (db.rows.has(k)) { db.log.push(`insert ${k}: exists`); return { data: null, error: { code: "23505", message: "duplicate" } }; }
          db.rows.set(k, { ...ins!, version: 1, deleted_at: null });
          db.log.push(`insert ${k}`);
          return { data: { version: 1 }, error: null };
        }
        const k = `${f.kind}:${f.entity_id}`;
        const row = db.rows.get(k);
        const hit = !!row && (!f.onlyDeleted || row.deleted_at != null)
          && (f.version === undefined || row.version === f.version);
        const what = f.onlyDeleted ? "revive" : "deleted_at" in patch && patch.deleted_at ? "tombstone" : "update";
        db.log.push(`${what} ${k}${hit ? "" : ": 0 rows"}`);
        if (!hit) return { data: null, error: null };
        Object.assign(row!, patch);
        row!.version += 1;
        return { data: { version: row!.version }, error: null };
      },
      then: (res: (v: unknown) => void) =>
        res({ data: [...db.rows.values()].filter((r) => !r.deleted_at), error: null }),
    };
    return b;
  };
  return {
    supabase: { from, auth: { getSession: async () => ({ data: { session: null } }), signOut: jest.fn() } },
    BACKEND: "production",
    BACKEND_NOTICE: null,
  };
});

const { StateProvider, useBudget } = require("../components/StateProvider");
const Spending = require("../app/(tabs)/spending").default;

const NOV = "Actual for Electric in Nov 2026";
const wait = (ms = 120) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const novRow = () => mockDb.rows.get("actual:r-el:2026-11");

beforeEach(seed);

test("Done on a new actual saves it once, and says nothing", async () => {
  await render(<StateProvider userId="u1"><Spending /></StateProvider>);
  await fireEvent.changeText(await screen.findByLabelText(NOV), "161.29");
  const field = screen.getByLabelText(NOV);
  // What iOS does on Done: submit, then blur, in the same moment.
  await act(async () => {
    field.props.onSubmitEditing?.();
    field.props.onBlur?.();
    await new Promise((r) => setTimeout(r, 120));
  });
  expect(mockDb.log).toEqual(["insert actual:r-el:2026-11"]);
  expect(screen.queryByText("Someone else changed this")).toBeNull();
  expect(novRow()?.deleted_at).toBeNull();
});

// THE FIELD WAS ONE WAY IN; THIS IS THE GENERAL ONE. Any two commits
// asked for together — a double tap, two handlers — must not race.
function Twice({ go }: { go: (c: ReturnType<typeof useBudget>["commit"]) => void }) {
  const { commit, state } = useBudget();
  const nov = state?.monthlyActuals?.["r-el"]?.["2026-11"];
  return <Text testID="nov" onPress={() => go(commit)}>{nov == null ? "none" : String(nov)}</Text>;
}

test("two commits asked for together run one after the other, each from the state the last left", async () => {
  const results: boolean[] = [];
  const go = (commit: ReturnType<typeof useBudget>["commit"]) => {
    const set = (s: never) => setMonthlyActual(s, "r-el", "2026-11", 161.29);
    void commit(set, "Electric").then((r: boolean) => results.push(r));
    void commit(set, "Electric").then((r: boolean) => results.push(r));
  };
  await render(<StateProvider userId="u1"><Twice go={go} /></StateProvider>);
  await act(async () => { screen.getByTestId("nov").props.onPress(); });
  await wait();
  // The second found the change already made, so it had nothing to send.
  expect(mockDb.log).toEqual(["insert actual:r-el:2026-11"]);
  expect(results).toEqual([true, true]);
  expect(screen.getByTestId("nov").props.children).toBe("161.29");
  expect(screen.queryByText("Someone else changed this")).toBeNull();
});

test("an existing actual changed twice in a row is two updates, not a conflict", async () => {
  const go = (commit: ReturnType<typeof useBudget>["commit"]) => {
    void commit((s: never) => setMonthlyActual(s, "r-el", "2026-11", 100), "a");
    void commit((s: never) => setMonthlyActual(s, "r-el", "2026-11", 120), "b");
  };
  await render(<StateProvider userId="u1"><Twice go={go} /></StateProvider>);
  await act(async () => { screen.getByTestId("nov").props.onPress(); });
  await wait();
  expect(mockDb.log).toEqual(["insert actual:r-el:2026-11", "update actual:r-el:2026-11"]);
  expect(screen.getByTestId("nov").props.children).toBe("120");
  expect(screen.queryByText("Someone else changed this")).toBeNull();
});

test("A REAL CONFLICT: Reload is the only way out, and nothing is written until it is pressed", async () => {
  await render(<StateProvider userId="u1"><Spending /></StateProvider>);
  // October saved from this phone first, so it has a row and a version.
  await fireEvent.changeText(await screen.findByLabelText("Actual for Electric in Oct 2026"), "140");
  await act(async () => { screen.getByLabelText("Actual for Electric in Oct 2026").props.onBlur(); });
  await wait();
  expect(mockDb.log).toEqual(["insert actual:r-el:2026-10"]);

  // Another device changes October.
  const oct = mockDb.rows.get("actual:r-el:2026-10")!;
  oct.data = { ...(oct.data as object), amount: 145 };
  oct.version += 1;

  await fireEvent.changeText(screen.getByLabelText("Actual for Electric in Oct 2026"), "150");
  await act(async () => { screen.getByLabelText("Actual for Electric in Oct 2026").props.onBlur(); });
  await wait();
  expect(screen.getByText("Someone else changed this")).toBeOnTheScreen();
  // No Dismiss to leave the screen on a picture the server has moved past.
  expect(screen.queryByText("Dismiss")).toBeNull();

  // And the store will not write from that picture, whatever is asked:
  // the November entry below would have been planned from stale state.
  mockDb.log.length = 0;
  const { saveState } = require("../lib/store");
  const refused = await saveState("u1", setMonthlyActual(start, "r-el", "2026-11", 99));
  expect(refused).toEqual({ ok: false, reason: "conflict" });
  expect(mockDb.log).toEqual([]);

  // Reload takes the server's copy, and writing works again after it.
  await userEvent.press(screen.getByText("Reload"));
  await wait();
  expect(screen.queryByText("Someone else changed this")).toBeNull();
  expect(screen.getByLabelText("Actual for Electric in Oct 2026").props.value).toBe("145");
  await fireEvent.changeText(screen.getByLabelText(NOV), "161.29");
  await act(async () => { screen.getByLabelText(NOV).props.onBlur(); });
  await wait();
  expect(mockDb.log).toEqual(["insert actual:r-el:2026-11"]);
});

test("a dropped connection still offers Dismiss, which only ever applied to that", async () => {
  const SaveFailure = require("../components/SaveFailure").default;
  await render(<SaveFailure reason="offline" onRetry={() => {}} onDismiss={() => {}} onReload={() => {}} />);
  expect(screen.getByText("Dismiss")).toBeOnTheScreen();
  expect(screen.getByText("Try again")).toBeOnTheScreen();
});
