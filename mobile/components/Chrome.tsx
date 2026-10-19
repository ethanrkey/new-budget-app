import { createContext, useContext, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { T } from "../lib/theme";
import * as feel from "../lib/haptics";
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
import { dismissedBy, withDismissalBy } from "../lib/dismissal";
import { applySetup, markSetupSeen, markTourSeen, type SetupAnswers } from "../../src/engine/setup.ts";

// WHERE THE WEB'S FIVE HEADER ITEMS LIVE ON A PHONE.
//
// Setup, About, Import, Export, Settings did not fit a header at 390px,
// and the tab bar is spoken for by the four things you DO. So: one
// corner button, and everything you configure or read once sits behind
// it. That is where iOS has trained people to look, and it keeps the
// tabs for navigation rather than for administration.
//
// Import is deliberately absent — picking a CSV on a phone is awkward
// and import is where the duplicate-snapshot bug lived.
//
// SETUP IS NOT BEHIND THE BUTTON FOR A NEW ACCOUNT, it is in front of
// one — see the Setup block below. It is also IN the list, because
// somebody who skipped has to be able to come back to it. Same flow
// either way, and since 2026-10-17 the same PLACE either way: the web
// moved Setup and About off its header into its own Settings.
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
  const { state, userId, commit, online, saving, prefs, setPref } = useBudget();
  const insets = useSafeAreaInsets();
  const value = useMemo(() => ({
    open: () => setScreen("settings"),
    logChecking: () => setLogging(true),
  }), []);

  // PHASE 3: who gets met with the flow. The three conditions and the
  // reason for each are in lib/setup.ts; the short version is that it
  // is a brand-new account that has not already done this on the web.
  //
  // THE DEVICE ANSWER IS ASKED ABOUT THIS ACCOUNT, since 2026-10-17. It
  // used to be a bare boolean, so the first account to finish setup on a
  // phone turned the flow off for every account after it — two brand-new
  // test accounts on the owner's own phone got neither setup nor the
  // tour. See lib/prefs.ts.
  const dismissed = dismissedBy(prefs.setupDismissedBy, userId);
  const runSetup = setupAgain || (!!state && shouldRunSetup(state, dismissed));

  async function finishSetup(answers: SetupAnswers) {
    // READ BEFORE THE WRITE, because the write is what sets it. The
    // tour runs itself once per ACCOUNT, since 2026-10-16: it used to
    // start on every completion, so re-running Setup from Settings
    // replayed it — reported on build 11 — and a device flag would
    // have replayed it on a new phone instead.
    const firstTime = !state?.settings.hasSeenTour;
    // One commit, so a half-applied setup cannot exist: the rules, the
    // anchor, the accounts and BOTH flags land together or not at all.
    // `"none"`: the only write in the app that is felt by the taps
    // either side of it instead of by itself. Finish is a success
    // notification and "Go to my budget" is a medium bump, both on
    // press — a third buzz when the write lands, half a second
    // after the second one, reads as the phone stuttering rather
    // than as confirmation. A FAILED write still buzzes, because
    // that one is news. See mobile/lib/haptics.ts.
    const ok = await commit((s) => markTourSeen(markSetupSeen(applySetup(s, answers))), "Setup", "none");
    if (!ok) return;          // the Done screen stays up; the failure modal explains
    setPref("setupDismissedBy", withDismissalBy(prefs.setupDismissedBy, userId));
    setSetupAgain(false);
    // The web shows the tour straight after the first setup, and the
    // phone has the same four stops in the same words
    // (src/content/tour.ts). Afterwards it is About -> "Take the tour"
    // on both clients.
    if (firstTime) setTouring(true);
  }

  function leaveSetup() {
    // The device pref first, because it always works. Somebody who
    // closed this must not meet it again on the next launch even if
    // the account write cannot land.
    setPref("setupDismissedBy", withDismissalBy(prefs.setupDismissedBy, userId));
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
        // THE SAME TICK A TAB GETS, from 2026-10-15. This button sits
        // in the same corner of the same chrome as the tab bar and
        // does the same kind of thing — it moves you to another
        // screen — and it was the one navigation control in the app
        // that was silent. `selection` is the vocabulary word for
        // "you moved between discrete things"; see lib/haptics.ts,
        // and the tab bar's own screenListeners in (tabs)/_layout.
        onPress={() => { feel.selection(); setScreen("settings"); }}
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
              onStartTour={() => { setScreen(null); setTouring(true); }}
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
