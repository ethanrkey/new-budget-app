import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack, ThemeProvider, DarkTheme } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { StateProvider } from "../components/StateProvider";
import { Chrome } from "../components/Chrome";
import SignIn from "../components/SignIn";
import { T } from "../lib/theme";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    // SafeAreaProvider at the root, not per screen: without it the notch
    // eats the header and the whole thing reads as broken before anyone
    // has looked at a single number.
    // ThemeProvider with DarkTheme, and the reason is narrow rather
    // than architectural: react-navigation's DEFAULT theme has a white
    // background, so switching tabs on iOS 26 flashes white behind the
    // transition. One import fixes it. On SDK 56+ the provider comes
    // from expo-router itself, so there is no second navigation
    // package to keep in step.
    <SafeAreaProvider>
      <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <View style={styles.root}>
        {!ready ? (
          <View style={styles.center}><ActivityIndicator color={T.brass} /></View>
        ) : !session ? (
          <SignIn />
        ) : (
          <StateProvider userId={session.user.id}>
            <Chrome session={session}>
              <Stack screenOptions={{ headerShown: false }} />
            </Chrome>
          </StateProvider>
        )}
      </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
