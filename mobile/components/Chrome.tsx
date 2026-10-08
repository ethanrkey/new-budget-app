import { createContext, useContext, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { T } from "../lib/theme";
import { useBudget } from "./StateProvider";
import Settings from "./Settings";
import About from "./About";
import ExportSheet from "./ExportSheet";
import BottomSheet from "./BottomSheet";
import Tour from "./Tour";

// WHERE THE WEB'S FIVE HEADER ITEMS LIVE ON A PHONE.
//
// Setup, About, Import, Export, Settings do not fit a header at 390px,
// and the tab bar is spoken for by the four things you DO. So: one
// corner button, and everything you configure or read once sits behind
// it. That is where iOS has trained people to look, and it keeps the
// tabs for navigation rather than for administration.
//
// Import is deliberately absent — picking a CSV on a phone is awkward
// and import is where the duplicate-snapshot bug lived. Setup folds into
// onboarding, which is its own backlog item.
type Screen = "settings" | "about" | null;

const ChromeCtx = createContext<{ open: () => void }>({ open: () => {} });
export const useChrome = () => useContext(ChromeCtx);

export function Chrome({ session, children }: { session: Session; children: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>(null);
  const [exporting, setExporting] = useState(false);
  const [touring, setTouring] = useState(false);
  const { state } = useBudget();
  const insets = useSafeAreaInsets();
  const value = useMemo(() => ({ open: () => setScreen("settings") }), []);

  return (
    <ChromeCtx.Provider value={value}>
      {children}

      {/* The one affordance. Floating over the content rather than in a
          header, because each tab draws its own and a shared header
          would mean four of them agreeing. */}
      <Pressable
        style={[styles.fab, { top: insets.top + 6 }]}
        onPress={() => setScreen("settings")}
        accessibilityRole="button"
        accessibilityLabel="Settings, about and export"
        hitSlop={8}
      >
        <Text style={styles.fabGlyph}>⚙</Text>
      </Pressable>

      <Modal visible={screen !== null} animationType="slide" onRequestClose={() => setScreen(null)}>
        <View style={[styles.sheet, { paddingTop: insets.top }]}>
          {screen === "settings" ? (
            <Settings
              session={session}
              onOpenAbout={() => setScreen("about")}
              onOpenExport={() => setExporting(true)}
              onClose={() => setScreen(null)}
            />
          ) : screen === "about" ? (
            <About
              onStartTour={() => { setScreen(null); setTouring(true); }}
              onClose={() => setScreen("settings")}
            />
          ) : null}
        </View>

        {/* Export is a sheet over whichever screen is up, so dismissing it
            returns you to where you asked from. */}
        <BottomSheet visible={exporting} onClose={() => setExporting(false)}>
          {exporting && state && <ExportSheet state={state} onClose={() => setExporting(false)} />}
        </BottomSheet>
      </Modal>

      {touring && <Tour onClose={() => setTouring(false)} />}
    </ChromeCtx.Provider>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", right: 12, width: 36, height: 36, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    alignItems: "center", justifyContent: "center", zIndex: 20,
  },
  fabGlyph: { color: T.dim, fontSize: 17, lineHeight: 20 },
  sheet: { flex: 1, backgroundColor: T.bg },
});
