// Native modules the sheets touch, stubbed to the smallest thing that
// makes them real enough to press.
// RNTL v13+ ships its matchers by default; no extend-expect import.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: () => () => {},
  fetch: async () => ({ isConnected: true }),
}));

// The date picker is a native view with no behavior worth faking; the
// tests that matter here never open it.
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");
