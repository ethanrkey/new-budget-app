import { NativeTabs } from "expo-router/unstable-native-tabs";
import { T } from "../../lib/theme";
import * as feel from "../../lib/haptics";

// The real UIKit tab bar, not a JavaScript one drawn to look like it.
//
// WHAT CHANGES. The old bar was expo-router's JS `Tabs` with text
// glyphs (☰ ◎ ▦ ◧) for icons, which is a row of characters in a font
// doing an impression of a toolbar. This is `UITabBarController`: the
// system's own blur, its own press feedback, its own safe-area
// handling — and on iOS 26, Liquid Glass, which no JS bar can have
// because the glass has to recolor itself against the content
// scrolling underneath it.
//
// THE IMPORT PATH IS `expo-router/unstable-native-tabs` ON THIS SDK.
// The stable `expo-router/native-tabs` arrives in SDK 58; 54 through
// 57 use the unstable one. Getting this wrong is a module-not-found
// rather than a subtle bug, which is the good kind of mistake.
//
// `tintColor` is the selected color and a flat brass is correct here.
// Expo recommends `DynamicColorIOS` so a tint adapts between light and
// dark; this app is dark only, so there is nothing to adapt to and the
// wrapper would be ceremony. (The same note applies to `iconColor` if
// this ever stops being dark-only.)
//
// `backgroundColor` and `blurEffect` only affect iOS 18 and earlier.
// On 26 the glass is automatic and these are ignored — they are here
// so the bar is not a pale rectangle in a dark app on an older phone.
//
// THE FILL VARIANTS ARE NOT UNIFORM, and that is the SF catalog rather
// than a slip. `tablecells` and `chart.bar` have true `.fill` twins —
// same shape, heavier. `list.bullet` and `chart.line.uptrend.xyaxis`
// do not. The nearest candidates (`list.bullet.rectangle.fill`,
// `chart.line.uptrend.xyaxis.circle.fill`) add a rectangle and a
// circle, which reads as a DIFFERENT icon rather than a selected one —
// worse than no fill. Those two are marked by the tint alone, which is
// what iOS does by default anyway.
//
// EVERY TRIGGER TURNS OFF AUTOMATIC CONTENT INSETS, and the tabs pad
// their own scroll content instead — `lib/tabInset.ts`, which is
// where the reasoning is. The short version: react-native-screens
// quietly flips the first scroll view it can find in each tab to
// `contentInsetAdjustmentBehavior = automatic`, which is one answer
// for the screens it finds and no answer for the ones it does not,
// and nothing in JavaScript can see which happened.
export default function TabLayout() {
  return (
    <NativeTabs
      // One place for all four, rather than a listener per trigger
      // that three of them would eventually be missing. The tab you
      // land on is plainly visible, so this is confirmation of a
      // choice rather than the report of one.
      screenListeners={{ tabPress: () => feel.selection() }}
      tintColor={T.brass}
      backgroundColor={T.surface}
      blurEffect="systemChromeMaterialDark"
    >
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Ledger</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" />
      </NativeTabs.Trigger>

      {/* The pie is gone from this app, so a pie icon for the tab that
          no longer has one would be a small lie. A rising line is what
          the Dashboard actually shows. */}
      <NativeTabs.Trigger name="dashboard" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="budget" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Budget</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "tablecells", selected: "tablecells.fill" }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="spending" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Spending</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
