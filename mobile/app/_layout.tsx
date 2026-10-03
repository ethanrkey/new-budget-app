import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { StateProvider } from "../components/StateProvider";
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
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {!ready ? (
          <View style={styles.center}><ActivityIndicator color={T.brass} /></View>
        ) : !session ? (
          <SignIn />
        ) : (
          <StateProvider userId={session.user.id}>
            <Stack screenOptions={{ headerShown: false }} />
          </StateProvider>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
