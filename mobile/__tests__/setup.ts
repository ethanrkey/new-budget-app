// Native modules the sheets touch, stubbed to the smallest thing that
// makes them real enough to press.
// RNTL v13+ ships its matchers by default; no extend-expect import.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: () => () => {},
  fetch: async () => ({ isConnected: true }),
}));

// The date picker is a native view, but WHETHER IT IS ON SCREEN is the
// thing a dismissal test asserts, so it is faked as a real element with a
// label — and its last props are captured so a test can fire the change
// the native picker would have fired.
export const pickerProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock("@react-native-community/datetimepicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  const { pickerProps: slot } = require("./setup");
  return function MockDateTimePicker(props: Record<string, unknown>) {
    slot.current = props;
    return React.createElement(View, { accessibilityLabel: "Date picker" });
  };
});
