import { act, render, screen, userEvent } from "@testing-library/react-native";
import { haptics } from "./setup";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import BottomSheet from "../components/BottomSheet";
import NativeSheet from "../components/NativeSheet";
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

// The contribution list reuses HistoryList with a different noun. The
// shapes are identical and the SENTENCES are not: asking someone to
// confirm deleting a "reading" when they tapped a contribution is
// asking them to approve something other than what they touched.
test("a contribution list says contribution, not reading", async () => {
  const entries = [{ id: "k1", date: "2026-10-01", amount: 300 }];
  await render(
    <HistoryList entries={entries} online kind="contribution" onEdit={() => {}} onDelete={() => {}} />
  );
  expect(screen.getByText("Show contributions (1)")).toBeOnTheScreen();
  expect(screen.queryByText(/Show history/)).toBeNull();
});

test("...and the confirm says it too, which is the point of `kind`", async () => {
  // The list label was the only thing asserted until the mutation
  // audit pointed out that swapping the confirm's title back to
  // "reading" killed nothing. The confirm is where it matters most:
  // asking someone to approve deleting a "reading" when they tapped a
  // contribution is asking them to approve something else.
  const alerts: string[] = [];
  const spy = jest.spyOn(Alert, "alert").mockImplementation((title, body) => {
    alerts.push(`${title} ${body}`);
  });
  const entries = [{ id: "k1", date: "2026-10-01", amount: 300 }];
  await render(
    <HistoryList entries={entries} online kind="contribution" onEdit={() => {}} onDelete={() => {}} />
  );
  await userEvent.press(screen.getByText("Show contributions (1)"));
  await userEvent.press(screen.getByLabelText(/Delete the reading of/));

  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatch(/Delete this contribution\?/);
  expect(alerts[0]).not.toMatch(/reading/);
  spy.mockRestore();
});

test("...and a reading still says reading", async () => {
  const entries = [{ id: "s1", date: "2026-10-01", amount: 8200 }];
  await render(
    <HistoryList entries={entries} online onEdit={() => {}} onDelete={() => {}} />
  );
  expect(screen.getByText("Show history (1)")).toBeOnTheScreen();
});

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

/**
 * The Ledger's sheet plumbing, exactly as the screen wires it.
 *
 * TWO HOSTS SINCE BUILD 9, and that is the whole reason this harness
 * exists: the form moved into a system page sheet while the scope
 * sheet stayed in the bottom one, which puts the original bug back on
 * this one transition — unmount one modal, mount another in the same
 * commit, and iOS swallows the second presentation. So the editor is
 * queued and opened from the scope sheet's `onDismissed`. If this
 * component can be made to swallow the editor, so can the screen.
 */
function Host({ rowId, onCommit }: { rowId: string; onCommit?: (kind: string) => void }) {
  const [scopeFor, setScopeFor] = useState<string | null>(rowId);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [queued, setQueued] = useState<SheetMode | null>(null);
  const target = scopeFor ? rowTarget(state, scopeFor) : null;

  const pick = (a: ScopeAction) => {
    const item = target!.item;
    if (a.kind === "edit-occurrence") {
      setQueued({ kind: "occurrence", item, date: a.date, current: null });
      setScopeFor(null);
    } else if (a.kind === "edit-rule") {
      setQueued({ kind: "rule", item });
      setScopeFor(null);
    } else {
      onCommit?.(a.kind);
    }
  };

  return (
    <>
      <BottomSheet
        visible={!!target}
        onClose={() => { setScopeFor(null); setQueued(null); }}
        onDismissed={() => { if (queued) { setSheet(queued); setQueued(null); } }}
      >
        {target ? (
          <ScopeSheet
            name={target.name}
            actions={scopeActions(state, scopeFor!, target.recurring)}
            onPick={pick}
            onClose={() => setScopeFor(null)}
          />
        ) : null}
      </BottomSheet>
      <NativeSheet visible={!!sheet} onClose={() => setSheet(null)} swipeToClose>
        {sheet ? (
          <TransactionSheet
            mode={sheet} state={state} busy={false} orphanCount={() => 0}
            onSaveDraft={() => {}} onSaveOccurrence={() => {}} onClose={() => setSheet(null)}
          />
        ) : null}
      </NativeSheet>
    </>
  );
}

/**
 * UIKit finishing with the bottom sheet.
 *
 * `Modal.onDismiss` is routed through a native event, so nothing in
 * jest fires it — this stands in for the OS. It is also the honest
 * shape of the dependency: the editor opens when the other sheet is
 * GONE, not when a flag flips.
 *
 * The handler is TAKEN WHILE THE SHEET IS UP and called afterwards,
 * because that is what UIKit does — it is holding the function from
 * before the dismissal started. Under jest the Modal also leaves the
 * tree the moment `visible` is false, so there would be nothing to
 * read it off later. BottomSheet's handler is stable and reads the
 * current one through a ref, which is what makes both of those
 * harmless.
 */
function dismissalOf(testID = "bottom-sheet") {
  const fire = screen.getByTestId(testID).props.onDismiss as (() => void) | undefined;
  return async () => { await act(async () => { fire?.(); }); };
}

describe("the scope sheet opens the editor", () => {
  test("THE BUG: picking 'edit just this date' actually shows the editor", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    expect(screen.getByText("Rent")).toBeTruthy();
    const sheetGone = dismissalOf();

    await userEvent.press(screen.getByLabelText("Edit just 12/01/2026"));
    // Nothing yet, and that is the point: presenting now is the bug.
    expect(screen.queryByText("Rent on 12/01/2026")).toBeNull();
    await sheetGone();

    // Before the sequencing this found nothing: the scope sheet went
    // away and no editor arrived.
    expect(screen.getByText("Rent on 12/01/2026")).toBeTruthy();
    expect(screen.queryByLabelText("Edit just 12/01/2026")).toBeNull();
  });

  test("picking 'edit every Rent' shows the rule editor", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    const sheetGone = dismissalOf();
    await userEvent.press(screen.getByLabelText("Edit every Rent"));
    await sheetGone();
    expect(screen.getByText("Edit Rent")).toBeTruthy();
    expect(screen.getByText("Changes every date this rule generates.")).toBeTruthy();
  });

  test("occurrence scope shows ONE field — the rule's fields are not reachable", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    const sheetGone = dismissalOf();
    await userEvent.press(screen.getByLabelText("Edit just 12/01/2026"));
    await sheetGone();
    expect(screen.getByLabelText("Amount on this date")).toBeTruthy();
    // The editor has no mode to flip, so these cannot be reached at all.
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByText("Repeats")).toBeNull();
  });

  test("rule scope shows the rule's fields", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    const sheetGone = dismissalOf();
    await userEvent.press(screen.getByLabelText("Edit every Rent"));
    await sheetGone();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByText("Repeats")).toBeTruthy();
    expect(screen.getByText("Starts")).toBeTruthy();
  });
});

describe("what the scope sheet offers", () => {
  test("a date with its own amount can be reset; delete names the rule", async () => {
    await render(<Host rowId="r-rent@2026-12-01" />);
    expect(screen.getByLabelText("Edit just 12/01/2026")).toBeTruthy();
    expect(screen.getByLabelText("Reset 12/01/2026 to the rule")).toBeTruthy();
    expect(screen.getByLabelText("Delete Rent")).toBeTruthy();
    expect(screen.getByText("Removes the rule and every date it generates")).toBeTruthy();
  });

  test("a date with no override offers no reset", async () => {
    await render(<Host rowId="r-rent@2026-11-01" />);
    expect(screen.queryByLabelText("Reset 11/01/2026 to the rule")).toBeNull();
  });

  test("a one-off has no occurrence scope", async () => {
    await render(<Host rowId="o-dent@2026-10-14" />);
    expect(screen.queryByLabelText("Edit just 10/14/2026")).toBeNull();
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
  test("nothing is wrong with a form nobody has filled in yet", async () => {
    // Reported from the phone: the Ledger guide's "Add income" button
    // opened this form onto a red "Give it a name." before a single
    // key was pressed, which reads as the app refusing something
    // nobody asked for. The error belongs to the attempt.
    const onSaveDraft = jest.fn();
    await render(
      <BottomSheet visible onClose={() => {}}>
        <TransactionSheet
          mode={{ kind: "add" }} state={state} busy={false} orphanCount={() => 0}
          onSaveDraft={onSaveDraft} onSaveOccurrence={() => {}} onClose={() => {}}
        />
      </BottomSheet>
    );
    expect(screen.queryByText("Give it a name.")).toBeNull();

    // ...and the button is pressable, because a dead button with no
    // explanation is the thing people tap twice and give up on. The
    // press is what produces the reason.
    expect(screen.getByLabelText("Add")).not.toBeDisabled();
    await userEvent.press(screen.getByLabelText("Add"));
    expect(screen.getByText("Give it a name.")).toBeTruthy();
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  test("opened for income, it opens ON income — and stays there", async () => {
    // The guide's income step opens this form, and it landed on
    // One-off: the default for a form nobody opened for anything.
    await render(
      <BottomSheet visible onClose={() => {}}>
        <TransactionSheet
          mode={{ kind: "add", presetCategory: "income" }} state={state} busy={false}
          orphanCount={() => 0}
          onSaveDraft={() => {}} onSaveOccurrence={() => {}} onClose={() => {}}
        />
      </BottomSheet>
    );
    const selected = () => screen.getByLabelText("Income").props.accessibilityState?.selected;
    expect(selected()).toBe(true);
    expect(screen.getByLabelText("One-off").props.accessibilityState?.selected).toBe(false);

    // Picking a cadence must not quietly turn it into a fixed bill:
    // the caller already answered the category question. Income can
    // be recurring or not, which is what the guide's step now says.
    await userEvent.press(screen.getByLabelText("Monthly"));
    expect(selected()).toBe(true);
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
    await userEvent.press(screen.getByLabelText("Edit the reading of $200.00 on 08/01/2026"));
    expect(onEdit).toHaveBeenCalledWith(snaps[1]);

    await userEvent.press(screen.getByLabelText("Delete the reading of $100.00 on 07/01/2026"));
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
    expect(screen.getByLabelText("Edit the reading of $200.00 on 08/01/2026")).toBeDisabled();
  });

  /**
   * The View the PanResponder is attached to.
   *
   * There is no gesture to fire in this harness — RNTL cannot
   * synthesize a touch stream — so the scrub is driven through the
   * responder props PanResponder installs, which is what the native
   * side would call.
   */
  const scrubSurface = () => screen.getByTestId("sparkline-surface");

  /**
   * A touch event complete enough for PanResponder.
   *
   * PanResponder keeps its own gesture state and reads
   * `event.touchHistory.touchBank` to do it, so the bare
   * `{ nativeEvent: { locationX } }` the component itself uses is not
   * enough to drive it from a test — it throws on `touchBank` of
   * undefined. Only `locationX` reaches our code; the rest is the
   * shape PanResponder insists on.
   */
  let clock = 0;
  const touch = (locationX: number) => (clock += 16, {
    nativeEvent: {
      locationX, pageX: locationX, pageY: 0, identifier: 1, timestamp: clock,
      touches: [{ identifier: 1, pageX: locationX, pageY: 0, locationX, locationY: 0, timestamp: clock }],
      changedTouches: [],
      target: 1,
    },
    touchHistory: {
      touchBank: [
        undefined,
        { touchActive: true, startPageX: locationX, startPageY: 0, startTimeStamp: 0,
          currentPageX: locationX, currentPageY: 0, currentTimeStamp: clock,
          previousPageX: locationX, previousPageY: 0, previousTimeStamp: clock - 16 },
      ],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 1,
      // MONOTONIC, and that is load-bearing. PanResponder ignores a
      // move whose `mostRecentTimeStamp` it has already accounted
      // for, so a fixed zero made every move after the grant a no-op
      // — and the first version of the tick test passed because
      // nothing moved at all.
      mostRecentTimeStamp: clock,
    },
  });

  test("the sparkline scrubs to a reading and names it", async () => {
    await render(<Sparkline points={snaps} color="#8bd4ff" width={240} />);
    // At rest it shows the NEWEST reading, which is the figure on the
    // card. Two tiers since 2026-10-14: the amount at reading size,
    // the date under it.
    expect(screen.getByTestId("sparkline-readout")).toHaveTextContent("$300.00");
    expect(screen.getByText("09/01/2026")).toBeTruthy();
  });

  test("at rest nothing is dimmed and there is no guide line", async () => {
    // Dimming means "there is a selection, and it is here". With no
    // selection the whole series is the subject, so dimming any of it
    // would be saying something untrue about data that exists.
    await render(<Sparkline points={snaps} color="#8bd4ff" width={240} />);
    expect(screen.queryByTestId("sparkline-guide")).toBeNull();
    expect(screen.queryByTestId("sparkline-past")).toBeNull();
    expect(screen.getByTestId("sparkline-upto")).toBeTruthy();
  });

  test("scrubbing splits the line at the finger, and release snaps back to the present", async () => {
    await render(<Sparkline points={snaps} color="#8bd4ff" width={240} />);
    const surface = scrubSurface();

    // Land on the first of three readings. PanResponder is driven
    // through the responder props, because there is no gesture to
    // fire in this harness.
    await act(async () => {
      surface.props.onResponderGrant(touch(0));
    });

    expect(screen.getByTestId("sparkline-readout")).toHaveTextContent("$100.00");
    // Everything after the finger goes quiet; everything up to it does not.
    expect(screen.getByTestId("sparkline-past")).toBeTruthy();
    expect(screen.getByTestId("sparkline-guide")).toBeTruthy();

    // LETTING GO RETURNS TO THE PRESENT. The card's headline number is
    // the current balance, and a readout left showing some date in
    // March quietly disagrees with it — every glance afterwards has to
    // work out which of the two is today's. The reading is a second's
    // drag away, so the chart tells one story when nobody is touching
    // it.
    await act(async () => { surface.props.onResponderRelease(touch(0)); });
    expect(screen.getByTestId("sparkline-readout")).toHaveTextContent("$300.00");
    expect(screen.queryByTestId("sparkline-guide")).toBeNull();
    expect(screen.queryByTestId("sparkline-past")).toBeNull();
  });

  test("one haptic tick per point, not per touch event", async () => {
    haptics.calls.length = 0;
    await render(<Sparkline points={snaps} color="#8bd4ff" width={240} />);
    const surface = scrubSurface();

    await act(async () => { surface.props.onResponderGrant(touch(0)); });
    // Three move events that never leave the first point: one tick so far.
    for (const x of [1, 2, 3]) {
      await act(async () => { surface.props.onResponderMove(touch(x)); });
    }
    expect(haptics.calls).toEqual(["selection"]);

    // Moving to a different point ticks once more. The ticks ARE the
    // series' granularity, which is the one thing here a glance does
    // not give you.
    await act(async () => { surface.props.onResponderMove(touch(239)); });
    expect(haptics.calls).toEqual(["selection", "selection"]);
  });

  test("a single reading draws a point, not a line, and does not crash", async () => {
    await render(<Sparkline points={[snaps[0]]} color="#8bd4ff" width={240} />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

// ---- the form is a system page sheet --------------------------------
//
// Build 8 gave BottomSheet a grabber and a PanResponder; build 9 takes
// both back. On a device the drag only started from the grab bar — a
// responder on the body would fight the ScrollView inside it — and the
// wrapper it needed left a gap under the sheet with the tab bar
// showing through.
//
// UIKit's page sheet does the whole job, so what is left to test is
// that the right thing is ASKED FOR. These are props rather than
// pixels on purpose: `presentationStyle` and `allowSwipeDismissal` are
// instructions to UIKit, and whether they are the right instructions
// is the part this harness can actually answer.
describe("the transaction form is presented as a system sheet", () => {
  function Host({ dirty, onClose }: { dirty: boolean; onClose: () => void }) {
    return <NativeSheet visible onClose={onClose} swipeToClose={!dirty}><Text>BODY</Text></NativeSheet>;
  }

  test("it is a page sheet, which is what covers the tab bar", async () => {
    await render(<Host dirty={false} onClose={() => {}} />);
    const modal = screen.getByTestId("native-sheet");
    expect(modal.props.presentationStyle).toBe("pageSheet");
    // NOT transparent. A page sheet IS the card; RN warns if you ask
    // for both, and the scrim-plus-card structure is what left the gap.
    expect(modal.props.transparent).toBeFalsy();
  });

  test("a clean form may be swiped away", async () => {
    await render(<Host dirty={false} onClose={() => {}} />);
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(true);
  });

  test("a dirty one may not, so UIKit refuses the gesture itself", async () => {
    // `allowSwipeDismissal: false` is isModalInPresentation: true.
    // The sheet rubber-bands back without going anywhere and the
    // attempt arrives as onRequestClose — which is why the guard
    // never has to put a sheet back that already slid away.
    await render(<Host dirty onClose={() => {}} />);
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(false);
  });

  test("either way the attempt comes through the one door", async () => {
    const closed: number[] = [];
    await render(<Host dirty onClose={() => closed.push(1)} />);
    await act(async () => { screen.getByTestId("native-sheet").props.onRequestClose(); });
    expect(closed).toHaveLength(1);
  });

  // There was a fifth test here asserting the bottom sheet has no
  // grabber any more. The audit could not kill it, and the only
  // mutation that would have is one that adds back the testID it
  // looks for — which tests the marker rather than the behavior.
  // Deleted rather than propped up: a test nothing can kill is
  // decoration, which is this suite's own argument. What the grabber
  // was for is covered by the four above.
});

// THE BALANCE SHEETS, which were still a card on a scrim.
//
// Reported 2026-10-17: "can't be swiped away smoothly", which was
// accurate — there was nothing to swipe. Every surface that takes
// typed input is a UIKit page sheet now, with the same guard the
// transaction form has had since build 9. These are props rather
// than pixels for the reason above: `presentationStyle` and
// `allowSwipeDismissal` are instructions to UIKit, and whether they
// are the right instructions is the part this harness can answer.
describe("a balance sheet is a system sheet too", () => {
  const LogBalance = require("../components/LogBalance").default;
  const { DISCARD_BALANCE } = require("../../src/content/logBalance.ts");

  /** The alert, captured with its buttons so one can be pressed. */
  type Btn = { text?: string; onPress?: () => void };
  const alerts: { title?: string; buttons: Btn[] }[] = [];
  let spy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    alerts.length = 0;
    spy = jest.spyOn(Alert, "alert").mockImplementation((title, _body, buttons) => {
      alerts.push({ title: String(title), buttons: (buttons ?? []) as Btn[] });
    });
  });
  afterEach(() => spy.mockRestore());
  const press = (label: string) => {
    const b = alerts.at(-1)!.buttons.find((x) => x.text === label);
    if (!b) throw new Error(`no "${label}" in the alert`);
    b.onPress?.();
  };

  const host = (onClose = () => {}) =>
    render(<LogBalance title="Log the current balance of Ally" cta="Log balance" busy={false}
      onSubmit={() => {}} onClose={onClose} />);

  test("it is a page sheet, which is what covers the tab bar", async () => {
    await host();
    const modal = screen.getByTestId("native-sheet");
    expect(modal.props.presentationStyle).toBe("pageSheet");
    // NOT transparent, and no card of its own — the scrim-plus-card
    // structure is exactly what left the gap under the old one.
    expect(modal.props.transparent).toBeFalsy();
  });

  test("with nothing typed it may be swiped away", async () => {
    await host();
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(true);
  });

  test("an amount typed makes UIKit refuse the gesture", async () => {
    await host();
    await userEvent.type(screen.getByLabelText("Amount"), "40");
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(false);
  });

  test("...INCLUDING a half-typed one, which is the same loss", async () => {
    // A LONE DECIMAL POINT, not "4." — Number("4.") is 4, so a guard
    // written against validity would have passed that and this test
    // would have proved nothing. Number(".") is NaN, which is what
    // somebody part way through a number actually looks like, and
    // losing it to a stray swipe is the same loss as losing a good
    // one. (Found by mutating the guard to fire on `valid`: it
    // survived.)
    await host();
    await userEvent.type(screen.getByLabelText("Amount"), ".");
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(false);
  });

  test("and the refused swipe asks before it throws anything away", async () => {
    const closed: number[] = [];
    await host(() => closed.push(1));
    await userEvent.type(screen.getByLabelText("Amount"), "40");
    await act(async () => { screen.getByTestId("native-sheet").props.onRequestClose(); });

    // Asked, and NOT closed — the sheet is still there behind the alert.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe(DISCARD_BALANCE.title);
    expect(closed).toHaveLength(0);

    // ...and discarding is what closes it.
    await act(async () => { press(DISCARD_BALANCE.discard); });
    expect(closed).toHaveLength(1);
  });

  test("an untouched sheet closes without asking", async () => {
    // A confirm over a sheet nobody typed in is the kind of prompt
    // people learn to dismiss without reading.
    const closed: number[] = [];
    await host(() => closed.push(1));
    await act(async () => { screen.getByTestId("native-sheet").props.onRequestClose(); });
    expect(alerts).toHaveLength(0);
    expect(closed).toHaveLength(1);
  });
});
