import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import ExportSheet from "../components/ExportSheet";
import { normalize } from "../../src/engine/stateShape.ts";
import { shared } from "./setup";

// Export, from the press. The bug this guards shipped and was found on a
// device: the CSV was handed to the share sheet as a bare string, so iOS
// had nothing to name the file and "Save to Files" wrote `text`, with no
// extension, which no spreadsheet opens by double-clicking.
//
// So the assertions here are about the NAME and the TYPE, not the
// contents — the contents come from the same engine functions the web
// uses and are tested there. What only exists on this screen is whether
// a real file with a real name reaches the share sheet at all.

const state = normalize({
  settings: { budgetHorizon: "2027-04-01", ledgerHorizon: "2027-02-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
  trackerCategories: [{ id: "c-save", name: "Savings", kind: "asset", assetKind: "savings", order: 0 }],
  recurring: [{ id: "r-rent", name: "Rent", amount: 1450, category: "bill", order: 0, cadence: "monthly", startDate: "2026-04-01", dayOfMonth: 1 }],
});

beforeEach(() => {
  shared.files.length = 0;
  shared.calls.length = 0;
  shared.available = true;
});

const ISO = /^key-budget-(ledger|budget|backup)-\d{4}-\d{2}-\d{2}\.(csv|json)$/;

test("the ledger export is a named .csv file, not a bare string", async () => {
  await render(<ExportSheet state={state} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Ledger (CSV)"));

  await waitFor(() => expect(shared.calls).toHaveLength(1));
  const { uri, options } = shared.calls[0]!;
  const name = uri.split("/").pop()!;

  expect(name).toMatch(ISO);
  expect(name.endsWith(".csv")).toBe(true);
  // The two things iOS actually reads when deciding what the file IS.
  expect(options.mimeType).toBe("text/csv");
  expect(options.UTI).toBe("public.comma-separated-values-text");
});

test("what gets shared is the file that was written, with the CSV in it", async () => {
  await render(<ExportSheet state={state} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Ledger (CSV)"));

  await waitFor(() => expect(shared.calls).toHaveLength(1));
  // A share of an empty or different path is the same bug wearing a
  // better name, so the uri has to be the file that was written.
  expect(shared.files).toHaveLength(1);
  expect(shared.calls[0]!.uri).toBe(shared.files[0]!.path);
  expect(shared.files[0]!.body).toContain("Rent");
});

test("the budget export is its own named .csv", async () => {
  await render(<ExportSheet state={state} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Budget (CSV)"));

  await waitFor(() => expect(shared.calls).toHaveLength(1));
  const name = shared.calls[0]!.uri.split("/").pop()!;
  expect(name).toMatch(/^key-budget-budget-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("the backup is .json with the json type, not a csv with a different name", async () => {
  await render(<ExportSheet state={state} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Full backup (JSON)"));

  await waitFor(() => expect(shared.calls).toHaveLength(1));
  const { uri, options } = shared.calls[0]!;
  expect(uri.split("/").pop()!).toMatch(/^key-budget-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(options.mimeType).toBe("application/json");
  expect(options.UTI).toBe("public.json");
  expect(JSON.parse(shared.files[0]!.body).accounts).toHaveLength(1);
});

test("a device that cannot share says so instead of failing silently", async () => {
  shared.available = false;
  await render(<ExportSheet state={state} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Ledger (CSV)"));

  expect(await screen.findByText(/cannot open a share sheet/i)).toBeOnTheScreen();
  expect(shared.calls).toHaveLength(0);
});
