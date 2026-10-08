import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { loadState, saveState, resetStore } from "../lib/store";
import { supabase, BACKEND, BACKEND_NOTICE } from "../lib/supabase";
import { T } from "../lib/theme";
import SaveFailure from "./SaveFailure";
import UnsavedNotice from "./UnsavedNotice";
import { writeStash, clearStash, readStash, type Stash } from "../lib/stash";
import { loadPrefs, savePrefs, DEFAULT_PREFS, type Prefs } from "../lib/prefs";
import type { BudgetState } from "../../src/engine/types.ts";

type Reason = "conflict" | "offline" | "error";
type Ctx = {
  state: BudgetState | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** Apply a pure mutation and persist it. Rolls the screen back if the
   *  write fails, so what you see is never something the server rejected.
   *  `label` describes the change in the user's words ("Rent on Oct 12")
   *  and is what a recovery notice shows if the app dies mid-write. */
  commit: (fn: (s: BudgetState) => BudgetState, label: string) => Promise<boolean>;
  online: boolean;
  saving: boolean;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
};
const StateCtx = createContext<Ctx>({
  state: null, refresh: async () => {}, refreshing: false,
  commit: async () => false, online: true, saving: false,
  prefs: DEFAULT_PREFS, setPref: () => {},
});
export const useBudget = () => useContext(StateCtx);

export function StateProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, setState] = useState<BudgetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Reason | null>(null);
  const [online, setOnline] = useState(true);
  const [unsaved, setUnsaved] = useState<Stash | null>(null);
  // `null` until read from disk — the app does not render until it is set,
  // so a folded panel never flashes open.
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const pending = useRef<{ fn: (s: BudgetState) => BudgetState; label: string } | null>(null);

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
  useEffect(() => { loadPrefs().then(setPrefs); }, []);

  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...(p ?? DEFAULT_PREFS), [k]: v };
      void savePrefs(next);
      return next;
    });
  }, []);

  // A stash still on disk at launch means a previous session was killed
  // between the optimistic apply and the write landing. It is REPORTED and
  // discarded, never replayed — see lib/stash.ts for why re-applying would
  // be a merge, and why a branch this rare must not be one that writes.
  useEffect(() => {
    let canceled = false;
    readStash(userId).then((s) => { if (!canceled) setUnsaved(s); });
    return () => { canceled = true; };
  }, [userId]);

  const commit = useCallback(async (fn: (s: BudgetState) => BudgetState, label: string) => {
    if (!state) return false;
    const before = state;
    const next = fn(state);

    // THE COPY IS WRITTEN BEFORE THE THING IT COPIES IS AT RISK. Awaited,
    // so the ordering is real rather than hopeful — a few milliseconds of
    // AsyncStorage before the screen updates. A hard kill inside that
    // window still loses the write, which is the documented and accepted
    // cost of not having a synchronous store on this platform.
    await writeStash(userId, label, next);

    // Optimistic, then rolled back on failure. The alternative — waiting
    // on the network before showing the change — makes every entry feel
    // broken on cell service, and a rollback plus a visible popup is
    // honest about what happened.
    setState(next);
    setSaving(true);
    const res = await saveState(userId, next);
    setSaving(false);
    if (res.ok) {
      pending.current = null;
      await clearStash();
      return true;
    }
    setState(before);
    pending.current = { fn, label };
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
  if (!state || !prefs) return <View style={styles.center}><ActivityIndicator color={T.brass} /></View>;

  return (
    <StateCtx.Provider value={{ state, refresh, refreshing, commit, online, saving, prefs, setPref }}>
      {/* A harness left running is otherwise indistinguishable from the
          app being broken. Two different messages, because a local
          Supabase stack holds REAL data over plain http and must not be
          told it is fake — see lib/backend.ts. */}
      {BACKEND_NOTICE && (
        <View style={[styles.banner, BACKEND === "fixture" ? styles.bannerLoud : styles.bannerQuiet]}>
          <Text style={[styles.bannerText, BACKEND === "local" && styles.bannerTextQuiet]}>
            {BACKEND_NOTICE}
          </Text>
        </View>
      )}
      {children}
      <SaveFailure
        reason={failure}
        onDismiss={() => { setFailure(null); pending.current = null; void clearStash(); }}
        onRetry={() => { const p = pending.current; setFailure(null); if (p) commit(p.fn, p.label); }}
        // A conflict means THIS screen is the stale one, so the only
        // honest move is to take the server's copy — never to force.
        onReload={() => { setFailure(null); pending.current = null; void clearStash(); refresh(); }}
      />
      <UnsavedNotice
        stash={unsaved}
        onDiscard={() => { setUnsaved(null); void clearStash(); }}
      />
    </StateCtx.Provider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  err: { color: T.text, fontSize: 17, fontWeight: "600" },
  dim: { color: T.dim, textAlign: "center" },
  link: { color: T.brass, marginTop: 12 },
  banner: { paddingTop: 54, paddingBottom: 6, paddingHorizontal: 12 },
  bannerLoud: { backgroundColor: T.brass },
  bannerQuiet: { backgroundColor: T.surfaceAlt },
  bannerText: { color: "#111827", fontSize: 11, fontWeight: "700", textAlign: "center", letterSpacing: 0.4 },
  bannerTextQuiet: { color: T.dim },
});
