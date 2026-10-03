import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { loadState } from "../lib/store";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";
import type { BudgetState } from "../../src/engine/types.ts";

type Ctx = { state: BudgetState | null; refresh: () => Promise<void>; refreshing: boolean };
const StateCtx = createContext<Ctx>({ state: null, refresh: async () => {}, refreshing: false });
export const useBudget = () => useContext(StateCtx);

export function StateProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, setState] = useState<BudgetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setState(await loadState(userId));
      setError(null);
    } catch (e: any) {
      // Never fall back to a blank state. A silent empty render is how the
      // web app once wrote an empty document over real data; the phone is
      // read-only so it cannot do that, but the habit stays.
      setError(e.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load your data</Text>
        <Text style={styles.dim}>{error}</Text>
        <Text style={styles.link} onPress={() => supabase.auth.signOut()}>Sign out</Text>
      </View>
    );
  }
  if (!state) {
    return <View style={styles.center}><ActivityIndicator color={T.brass} /></View>;
  }
  return <StateCtx.Provider value={{ state, refresh, refreshing }}>{children}</StateCtx.Provider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  err: { color: T.text, fontSize: 17, fontWeight: "600" },
  dim: { color: T.dim, textAlign: "center" },
  link: { color: T.brass, marginTop: 12 },
});
