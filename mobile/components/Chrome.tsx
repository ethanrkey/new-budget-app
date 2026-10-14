import { createContext, useContext, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { T } from "../lib/theme";
import { useBudget } from "./StateProvider";
import Settings from "./Settings";
import About from "./About";
import Categories from "./Categories";
import AnchorStrip from "./AnchorStrip";
import ExportSheet from "./ExportSheet";
import BottomSheet from "./BottomSheet";
import Tour from "./Tour";
import LogBalance, { currently } from "./LogBalance";
import { updateAccountBalance } from "../../src/engine/mutate.ts";
import { primaryAccount, ledgerHorizonOf } from "../../src/engine/model.ts";
import { rowsHiddenByAnchor } from "../../src/engine/compute.ts";
import Setup from "./Setup";
import { shouldRunSetup } from "../lib/setup";
import { applySetup, markSetupSeen, type SetupAnswers } from "../../src/engine/setup.ts";

// WHERE THE WEB'S FIVE HEADER ITEMS LIVE ON A PHONE.
//
// Setup, About, Import, Export, Settings do not fit a header at 390px,
// and the tab bar is spoken for by the four things you DO. So: one
// corner button, and everything you configure or read once sits behind
// it. That is where iOS has trained people to look, and it keeps the
// tabs for navigation rather than for administration.
//
// Import is deliberately absent — picking a CSV on a phone is awkward
// and import is where the duplicate-snapshot bug lived.
//
// SETUP IS NOT BEHIND THE BUTTON FOR A NEW ACCOUNT, it is in front of
// one — see the Setup block below. It is also IN the list, because the
// web keeps a Setup button in its header and somebody who skipped has
// to be able to come back to it. Same flow either way.
type Screen = "settings" | "about" | "categories" | null;

const ChromeCtx = createContext<{ open: () => void; logChecking: () => void }>({
  open: () => {}, logChecking: () => {},
});
export const useChrome = () => useContext(ChromeCtx);

export function Chrome({ session, children }: { session: Session; children: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>(null);
  const [exporting, setExporting] = useState(false);
  const [touring, setTouring] = useState(false);
  // Asked for from Settings, as opposed to met on arrival.
  const [setupAgain, setSetupAgain] = useState(false);
  // The checking log, hosted HERE rather than on a tab, because the
  // control that opens it is on every tab — see AnchorStrip.
  const [logging, setLogging] = useState(false);
  const { state, commit, online, saving, prefs, setPref } = useBudget();
  const insets = useSafeAreaInsets();
  const value = useMemo(() => ({
    open: () => setScreen("settings"),
    logChecking: () => setLogging(true),
  }), []);

  // PHASE 3: who gets met with the flow. The three conditions and the
  // reason for each are in lib/setup.ts; the short version is that it
  // is a brand-new account that has not already done this on the web.
  const runSetup = setupAgain || (!!state && shouldRunSetup(state, prefs.setupDismissed));

  async function finishSetup(answers: SetupAnswers) {
    // One commit, so a half-applied setup cannot exist: the rules, the
    // anchor, the accounts and the flag land together or not at all.
    const ok = await commit((s) => markSetupSeen(applySetup(s, answers)), "Setup");
    if (!ok) return;          // the Done screen stays up; the failure modal explains
    setPref("setupDismissed", true);
    setSetupAgain(false);
    // The web shows the tour straight after setup, and the phone has
    // the same four stops in the same words (src/content/tour.ts).
    setTouring(true);
  }

  function leaveSetup() {
    // The device pref first, because it always works. Somebody who
    // closed this must not meet it again on the next launch even if
    // the account write cannot land.
    setPref("setupDismissed", true);
    setSetupAgain(false);
    // The account flag only when there is a network to write it on. A
    // Skip is not worth a failure modal, and the device pref has
    // already done the job that matters on this phone.
    if (online) void commit(markSetupSeen, "Setup skipped");
  }

  return (
    <ChromeCtx.Provider value={value}>
      {/* Above everything, on every tab: the one number the rest are
          computed forward from. See AnchorStrip. */}
      <View style={{ paddingTop: insets.top + 10 }}>
        <AnchorStrip onPress={() => setLogging(true)} />
      </View>
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
              onOpenCategories={() => setScreen("categories")}
              onOpenSetup={() => { setScreen(null); setSetupAgain(true); }}
              onOpenExport={() => setExporting(true)}
              onClose={() => setScreen(null)}
            />
          ) : screen === "about" ? (
            <About
              onStartTour={() => { setScreen(null); setTouring(true); }}
              onClose={() => setScreen("settings")}
            />
          ) : screen === "categories" ? (
            // Back to Settings rather than out, matching About: these
            // are rooms off one hallway, and closing the hallway from
            // inside a room is disorienting.
            <Categories onClose={() => setScreen("settings")} />
          ) : null}
        </View>

        {/* Export is a sheet over whichever screen is up, so dismissing it
            returns you to where you asked from. */}
        <BottomSheet visible={exporting} onClose={() => setExporting(false)}>
          {exporting && state && <ExportSheet state={state} onClose={() => setExporting(false)} />}
        </BottomSheet>
      </Modal>

      {/* Over everything, including the tab bar and the settings
          button: a new account has nothing to look at behind it, and a
          half-visible app underneath would read as a thing to dismiss.
          Skipping lands on the Ledger's three-step guide, which
          already computes exactly what is still outstanding — so
          quitting partway has a resume state for free. */}
      {runSetup && <Setup busy={saving} onComplete={finishSetup} onSkip={leaveSetup} />}

      {/* ONE host for the checking log, reached from the strip on any
          tab, from the Dashboard's card and from the first-run guide.
          It used to be written out on two screens with the same title,
          the same warning and the same mutator — which is two places
          for that warning to drift. */}
      {logging && state && (
        <LogBalance
          title={`Update ${primaryAccount(state).name} balance`}
          currentLabel={currently(primaryAccount(state).balance, primaryAccount(state).balanceAsOf)}
          cta="Confirm"
          warn
          busy={saving}
          // Only the CHECKING balance moves the forecast's starting
          // point, so only this one asks. A tracked account's reading
          // hides nothing.
          hiddenRows={(date) => rowsHiddenByAnchor(state, date, ledgerHorizonOf(state))}
          onClose={() => setLogging(false)}
          onSubmit={async (amount, date) => {
            const ok = await commit(
              (s) => updateAccountBalance(s, primaryAccount(s).id, amount, date),
              `${primaryAccount(state).name} balance, as of ${date}`
            );
            if (ok) setLogging(false);
          }}
        />
      )}

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
