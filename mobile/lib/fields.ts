import type { TextStyle } from "react-native";

// The one style every TextInput in this app must carry, and the reason
// is a bug in the platform rather than a decision about how fields look.
//
// WHAT GOES WRONG WITHOUT IT. On iOS under the New Architecture, Fabric
// RECYCLES native text-input views between screens, and
// RCTTextInputComponentView's `prepareForRecycle` does not clear the
// field's `defaultTextAttributes`. A style a previous field set and the
// next one does not mention is therefore inherited by whatever view the
// pool hands over — and `letterSpacing` becomes NSKern, which survives.
//
// This app has exactly one field that wants kerning: the six-digit code
// box on the sign-in screen (letterSpacing 8, so the digits read as
// six separate characters). Setup is the screen a new account sees
// IMMEDIATELY AFTER signing in with that code, so its Amount field was
// routinely handed the code box's recycled view and drew its "0.00"
// placeholder as "0 . 0 0".
//
// WHY IT WAS ONLY EVER SEEN ON A REAL BUILD: the jest renderer has no
// view pool, and the dev client's slower mount order tends not to
// recycle across that transition. The style in JS was always correct —
// see the test that asserts it — which is what makes this worth a
// comment rather than a one-word fix.
//
// Upstream: facebook/react-native#42589, closed "cannot reproduce" in
// March 2024 and reported again since against 0.87. The fix every
// report lands on is the same: state the value on EVERY field, so the
// recycled view is always told what it is rather than left with what it
// had. Spread this into each field's style and the stale kern cannot
// survive, because `letterSpacing: 0` is a value and absence is not.
//
// BOTH ATTRIBUTES THIS APP EVER SETS, not just the one that was seen.
// The leak is not specific to kerning — any text attribute one field
// states and the next one omits can ride a recycled view across. This
// app sets exactly two: `letterSpacing` on the code box, and
// `fontVariant` on the code box and on Spending's planned-amount cells.
// Pinning both costs nothing (a field that wants tabular figures spreads
// this first and then says so) and closes the hole rather than the one
// hole somebody noticed.
//
// tests/mobile-fields.test.mjs fails if a TextInput is added without it.
export const FIELD_TEXT: Pick<TextStyle, "letterSpacing" | "fontVariant"> = {
  letterSpacing: 0,
  fontVariant: [],
};
