import { Tabs } from "expo-router";
import { Text } from "react-native";
import type { ColorValue } from "react-native";
import { T } from "../../lib/theme";

// A real bottom tab bar. The single biggest signal that this is an app and
// not a web page in a frame — expo-router gives the native one, with the
// platform's own blur, press states and safe-area inset for free.
const icon = (glyph: string) => ({ color }: { color: ColorValue }) => (
  <Text style={{ color, fontSize: 19 }}>{glyph}</Text>
);

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: T.bg },
        headerTitleStyle: { color: T.text },
        headerShadowVisible: false,
        tabBarActiveTintColor: T.brass,
        tabBarInactiveTintColor: T.faint,
        tabBarStyle: { backgroundColor: T.surface, borderTopColor: T.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Ledger", tabBarIcon: icon("☰") }} />
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarIcon: icon("◎") }} />
      <Tabs.Screen name="budget" options={{ title: "Budget", tabBarIcon: icon("▦") }} />
    </Tabs>
  );
}
