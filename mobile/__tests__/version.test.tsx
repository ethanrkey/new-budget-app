// "Which update am I running?" — the two lines at the foot of Settings.
//
// A tester reporting "I still see the old calendar" is reporting about
// the JavaScript, not the binary, and until 2026-10-17 the app said
// nothing about either. The distinction these two lines draw is the
// one that matters: the build came from TestFlight, and the JS inside
// it may have been replaced over the air since.

const mockUpdates: Record<string, unknown> = { __esModule: true };
jest.mock("expo-updates", () => mockUpdates);
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.0.0" } } }));

const { buildLine, updateLine } = require("../lib/version");

beforeEach(() => {
  for (const k of Object.keys(mockUpdates)) if (k !== "__esModule") delete mockUpdates[k];
});

test("the build line names the version and the runtime it can take updates for", () => {
  mockUpdates.runtimeVersion = "78c21cd112c8724cfb309601209499bcef5c6f02";
  expect(buildLine()).toBe("Key Budget 1.0.0 · runtime 78c21cd1");
});

test("...and says so rather than lying when the runtime is unknown", () => {
  mockUpdates.runtimeVersion = null;
  expect(buildLine()).toBe("Key Budget 1.0.0 · runtime —");
});

test("JS that shipped inside the binary says BUNDLED, not an id", () => {
  // The embedded bundle has an updateId of its own, and printing it
  // would read as "an update has been applied" on a phone where none
  // has. `isEmbeddedLaunch` is the only honest way to tell.
  mockUpdates.isEmbeddedLaunch = true;
  mockUpdates.updateId = "11111111-2222-3333-4444-555555555555";
  mockUpdates.createdAt = new Date("2026-01-01T00:00:00Z");
  expect(updateLine()).toBe("Update: bundled with this build");
});

test("an over-the-air update names its date and its id", () => {
  mockUpdates.isEmbeddedLaunch = false;
  mockUpdates.updateId = "a1b2c3d4-e5f6-4788-9900-aabbccddeeff";
  mockUpdates.createdAt = new Date(2026, 9, 17, 14, 30);
  expect(updateLine()).toBe("Update: 10/17/2026 · a1b2c3d4");
});

test("...and does not invent one when the runtime has no answer", () => {
  mockUpdates.isEmbeddedLaunch = false;
  mockUpdates.updateId = null;
  mockUpdates.createdAt = null;
  expect(updateLine()).toBe("Update: — · —");
});
