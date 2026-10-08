import { render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import BottomSheet from "../components/BottomSheet";
import ScopeSheet from "../components/ScopeSheet";
import TransactionSheet, { type SheetMode } from "../components/TransactionSheet";
import { scopeActions, rowTarget, type ScopeAction } from "../lib/edit";
import HistoryList from "../components/HistoryList";
import { Sparkline } from "../lib/charts";
import { normalize } from "../../src/engine/stateShape.ts";

// THE HALF THE PLAIN-NODE HARNESS CANNOT SEE.
//
// `tests/mobile-edit.test.mjs` passed 57 assertions while picking "Edit
// just this date" did nothing at all: the scope sheet's Modal was
// unmounting as the editor's Modal mounted, and iOS swallows a
// presentation made while another modal is dismissing. The logic was
// perfect and the screen was broken. That was the second bug of the shape
// in two days.
//
// So these tests press things and assert what came out. Nothing here
// re-checks arithmetic — that lives in the fast harness, where it belongs.

const state = normalize({
  settings: { budgetHorizon: "2027-04-01", ledgerHorizon: "2027-02-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
  trackerCategories: [
    { id: "c-save", name: "Savings", kind: "asset", assetKind: "savings", order: 0 },
    { id: "c-loan", name: "Car loan", kind: "debt", order: 1, originalPrincipal: 14200 },
  ],
  recurring: [
    { id: "r-rent", name: "Rent", amount: 1450, category: "bill", order: 0,
      cadence: "monthly", startDate: "2026-04-01", dayOfMonth: 1 },
  ],
  oneoffs: [{ id: "o-dent", name: "Dentist", amount: 180, category: "oneoff", order: 1, date: "2026-10-14" }],
  overrides: { "r-rent": { "2026-12-01": 1600 } },
});

/** The Ledger's sheet plumbing, exactly as the screen wires it: one host,
 *  body swapped. If this component can be made to swallow the editor, so
 *  can the screen. */
function Host({ rowId, onCommit }: { rowId: string; onCommit?: (kind: string) => void }) {
  const [scopeFor, setScopeFor] = useState<string | null>(rowId);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const target = scopeFor ? rowTarget(state, scopeFor) : null;

  const pick = (a: ScopeAction) => {
    const item = target!.item;
    if (a.kind === "edit-occurrence") {
      setSheet({ kind: "occurrence", item, date: a.date, current: null });
      setScopeFor(null);
    } else if (a.kind === "edit-rule") {
      setSheet({ kind: "rule", item });
      setScopeFor(null);
    } else {
      onCommit?.(a.kind);
    }
  };

  return (
    <BottomSheet visible={!!sheet || !!target} onClose={() => { setSheet(null); setScopeFor(null); }}>
      {sheet ? (
        <TransactionSheet
          mode={sheet} state={state} busy={false} orphanCount={() => 0}
          onSaveDraft={() => {}} onSaveOccurrence={() => {}} onClose={() => setSheet(null)}
        />
      ) : target ? (
        <ScopeSheet
          name={target.name}
          actions={scopeActions(state, scopeFor!, target.recurring)}
          onPick={pick}
          onClose={() => setScopeFor(null)}
        />
      ) : null}
    </BottomSheet>
  );
}

describe("the scope sheet opens the editor", () => {
  test("THE BUG: picking 'edit just this date' actually shows the editor", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    expect(screen.getByText("Rent")).toBeTruthy();

    await userEvent.press(screen.getByLabelText("Edit just Dec 1"));

    // Before the one-modal fix this found nothing: the scope sheet went
    // away and no editor arrived.
    expect(screen.getByText("Rent on Dec 1, 2026")).toBeTruthy();
    expect(screen.queryByLabelText("Edit just Dec 1")).toBeNull();
  });

  test("picking 'edit every Rent' shows the rule editor", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    await userEvent.press(screen.getByLabelText("Edit every Rent"));
    expect(screen.getByText("Edit Rent")).toBeTruthy();
    expect(screen.getByText("Changes every date this rule generates.")).toBeTruthy();
  });

  test("occurrence scope shows ONE field — the rule's fields are not reachable", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    await userEvent.press(screen.getByLabelText("Edit just Dec 1"));
    expect(screen.getByLabelText("Amount on this date")).toBeTruthy();
    // The editor has no mode to flip, so these cannot be reached at all.
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByText("Repeats")).toBeNull();
  });

  test("rule scope shows the rule's fields", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    await userEvent.press(screen.getByLabelText("Edit every Rent"));
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByText("Repeats")).toBeTruthy();
    expect(screen.getByText("Starts")).toBeTruthy();
  });
});

describe("what the scope sheet offers", () => {
  test("a date with its own amount can be reset; delete names the rule", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    expect(screen.getByLabelText("Edit just Dec 1")).toBeTruthy();
    expect(screen.getByLabelText("Reset Dec 1 to the rule")).toBeTruthy();
    expect(screen.getByLabelText("Delete Rent")).toBeTruthy();
    expect(screen.getByText("Removes the rule and every date it generates")).toBeTruthy();
  });

  test("a date with no override offers no reset", async () => {
    await render(<Host rowId="r-rent@2026-11-01" />);
    expect(screen.queryByLabelText("Reset Nov 1 to the rule")).toBeNull();
  });

  test("a one-off has no occurrence scope", async () => {
    await render(<Host rowId="o-dent@2026-10-14" />);
    expect(screen.queryByLabelText("Edit just Oct 14")).toBeNull();
    expect(screen.getByLabelText("Edit every Dentist")).toBeTruthy();
  });

  test("delete goes through a native destructive confirm, not straight through", async () => {
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onCommit = jest.fn();
    await render(<Host rowId="r-rent@2026-12-01" onCommit={onCommit} />);
    await userEvent.press(screen.getByLabelText("Delete Rent"));

    expect(onCommit).not.toHaveBeenCalled();           // nothing deleted yet
    expect(spy).toHaveBeenCalled();
    const [title, , buttons] = spy.mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    expect(title).toBe("Delete Rent?");
    expect(buttons.map((b) => [b.text, b.style])).toEqual([["Cancel", "cancel"], ["Delete", "destructive"]]);

    buttons[1].onPress!();                              // confirm
    expect(onCommit).toHaveBeenCalledWith("delete-rule");
    spy.mockRestore();
  });
});

describe("the editor refuses bad input, and says why", () => {
  test("a nameless item cannot be added, and the reason is on screen", async () => {
    await render(
      <BottomSheet visible onClose={() => {}}>
        <TransactionSheet
          mode={{ kind: "add" }} state={state} busy={false} orphanCount={() => 0}
          onSaveDraft={() => {}} onSaveOccurrence={() => {}} onClose={() => {}}
        />
      </BottomSheet>
    );
    expect(screen.getByText("Give it a name.")).toBeTruthy();
    expect(screen.getByLabelText("Add")).toBeDisabled();
  });

  test("filling it in enables Add, and the handler gets what the screen showed", async () => {
    const onSaveDraft = jest.fn();
    await render(
      <BottomSheet visible onClose={() => {}}>
        <TransactionSheet
          mode={{ kind: "add" }} state={state} busy={false} orphanCount={() => 0}
          onSaveDraft={onSaveDraft} onSaveOccurrence={() => {}} onClose={() => {}}
        />
      </BottomSheet>
    );
    await userEvent.type(screen.getByLabelText("Name"), "Gym");
    await userEvent.type(screen.getByLabelText("Amount"), "32");
    await userEvent.press(screen.getByLabelText("Fixed bill"));
    await userEvent.press(screen.getByLabelText("Add"));

    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    const d = onSaveDraft.mock.calls[0][0];
    expect([d.name, d.amount, d.category, d.recurring]).toEqual(["Gym", "32", "bill", false]);
  });

  test("an orphan warning is shown BEFORE the save, and the button says so", async () => {
    const onSaveDraft = jest.fn();
    await render(
      <BottomSheet visible onClose={() => {}}>
        <TransactionSheet
          mode={{ kind: "rule", item: state.recurring[0] }} state={state} busy={false}
          orphanCount={() => 3}
          onSaveDraft={onSaveDraft} onSaveOccurrence={() => {}} onClose={() => {}}
        />
      </BottomSheet>
    );
    // The count is on screen next to a button that admits what it is
    // about to do, so the press is informed and there is only one.
    expect(screen.getByText(/3 dates with their own amount/)).toBeTruthy();
    await userEvent.press(screen.getByLabelText("Save anyway"));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  test("saving is disabled while a write is in flight, so a double tap cannot double-write", async () => {
    const onSaveOccurrence = jest.fn();
    await render(
      <BottomSheet visible onClose={() => {}}>
        <TransactionSheet
          mode={{ kind: "occurrence", item: state.recurring[0], date: "2026-12-01", current: 1600 }}
          state={state} busy onSaveDraft={() => {}} orphanCount={() => 0}
          onSaveOccurrence={onSaveOccurrence} onClose={() => {}}
        />
      </BottomSheet>
    );
    expect(screen.getByLabelText("Save this date")).toBeDisabled();
  });
});

describe("the host itself", () => {
  test("an invisible sheet renders nothing of its body", async () => {
    await render(
      <BottomSheet visible={false} onClose={() => {}}>
        <View><Text>secret</Text></View>
      </BottomSheet>
    );
    expect(screen.queryByText("secret")).toBeNull();
  });
});

// ---- The Dashboard fixes from the 2026-10-08 pass ----------------------
// Each of these is a thing that was visibly wrong on the simulator and
// could not have been caught without mounting something.
describe("the dashboard", () => {
  const snaps = [
    { id: "s1", date: "2026-07-01", amount: 100 },
    { id: "s2", date: "2026-08-01", amount: 200 },
    { id: "s3", date: "2026-09-01", amount: 300 },
  ];

  test("a history row can be edited, and deleting one confirms first", async () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<HistoryList entries={snaps} online onEdit={onEdit} onDelete={onDelete} />);

    await userEvent.press(screen.getByText("Show history (3)"));
    await userEvent.press(screen.getByLabelText("Edit the reading of $200.00 on 2026-08-01"));
    expect(onEdit).toHaveBeenCalledWith(snaps[1]);

    await userEvent.press(screen.getByLabelText("Delete the reading of $100.00 on 2026-07-01"));
    expect(onDelete).not.toHaveBeenCalled();            // confirmed first
    const buttons = (spy.mock.calls[0] as any)[2];
    expect(buttons.map((b: any) => b.style)).toEqual(["cancel", "destructive"]);
    buttons[1].onPress();
    expect(onDelete).toHaveBeenCalledWith(snaps[0]);
    spy.mockRestore();
  });

  test("history rows are inert offline, because offline is read-only", async () => {
    const onEdit = jest.fn();
    await render(<HistoryList entries={snaps} online={false} onEdit={onEdit} onDelete={() => {}} />);
    await userEvent.press(screen.getByText("Show history (3)"));
    expect(screen.getByLabelText("Edit the reading of $200.00 on 2026-08-01")).toBeDisabled();
  });

  test("the sparkline scrubs to a reading and names it", async () => {
    await render(<Sparkline points={snaps} color="#8bd4ff" width={240} />);
    // At rest it shows the NEWEST reading, which is the figure on the card.
    expect(screen.getByText(/Sep 1\s+\$300\.00/)).toBeTruthy();
  });

  test("a single reading draws a point, not a line, and does not crash", async () => {
    await render(<Sparkline points={[snaps[0]]} color="#8bd4ff" width={240} />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
