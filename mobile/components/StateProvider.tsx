import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { loadState, saveState, resetStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";
import SaveFailure from "./SaveFailure";
import type { BudgetState } from "../../src/engine/types.ts";

type Reason = "conflict" | "offline" | "error";
type Ctx = {
  state: BudgetState | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** Apply a pure mutation and persist it. Rolls the screen back if the
   *  write fails, so what you see is never something the server rejected. */
  commit: (fn: (s: BudgetState) => BudgetState) => Promise<boolean>;
  online: boolean;
  saving: boolean;
};
const StateCtx = createContext<Ctx>({
  state: null, refresh: async () => {}, refreshing: false,
  commit: async () => false, online: true, saving: false,
});
export const useBudget = () => useContext(StateCtx);

export function StateProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, setState] = useState<BudgetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Reason | null>(null);
  const [online, setOnline] = useState(true);
  const pending = useRef<((s: BudgetState) => BudgetState) | null>(null);

  // Offline is READ-ONLY by decision: cached state for viewing, entry
  // controls disabled, no write queue and no replay — so there is no merge
  // algorithm to design. This flag is what the controls read.
  useEffect(() => NetInfo.addEventListener((s) => setOnline(!!s.isConnected)), []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setState(await loadState(userId)); setError(null); }
    catch (e) { setError((e as Error).message); }   // never fall back to a blank state
    finally { setRefreshing(false); }
  }, [userId]);

  useEffect(() => { resetStore(); refresh(); }, [refresh]);

  const commit = useCallback(async (fn: (s: BudgetState) => BudgetState) => {
    if (!state) return false;
    // Optimistic, then rolled back on failure. The alternative — waiting
    // on the network before showing the change — makes every entry feel
    // broken on cell service, and a rollback plus a visible popup is
    // honest about what happened.
    const before = state;
    const next = fn(state);
    setState(next);
    setSaving(true);
    const res = await saveState(userId, next);
    setSaving(false);
    if (res.ok) { pending.current = null; return true; }
    setState(before);
    pending.current = fn;
    setFailure(res.reason);
    return false;
  }, [state, userId]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Couldn&apos;t load your data</Text>
        <Text style={styles.dim}>{error}</Text>
        <Text style={styles.link} onPress={() => supabase.auth.signOut()}>Sign out</Text>
      </View>
    );
  }
  if (!state) return <View style={styles.center}><ActivityIndicator color={T.brass} /></View>;

  return (
    <StateCtx.Provider value={{ state, refresh, refreshing, commit, online, saving }}>
      {children}
      <SaveFailure
        reason={failure}
        onDismiss={() => { setFailure(null); pending.current = null; }}
        onRetry={() => { const fn = pending.current; setFailure(null); if (fn) commit(fn); }}
        // A conflict means THIS screen is the stale one, so the only
        // honest move is to take the server's copy — never to force.
        onReload={() => { setFailure(null); pending.current = null; refresh(); }}
      />
    </StateCtx.Provider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  err: { color: T.text, fontSize: 17, fontWeight: "600" },
  dim: { color: T.dim, textAlign: "center" },
  link: { color: T.brass, marginTop: 12 },
});
