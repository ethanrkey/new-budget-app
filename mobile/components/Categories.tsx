import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import CategorySheet from "./CategorySheet";
import { useBudget } from "./StateProvider";
import {
  categoryRows, deleteWarning, blankCategoryDraft, draftOfCategory, applyCategoryDraft,
  type CategoryDraft,
} from "../lib/categories";
import { deleteCategory, moveCategory } from "../../src/engine/mutate.ts";
import { todayISO } from "../../src/engine/model.ts";

// The accounts you track: savings, investments, loans.
//
// Before this the phone could not create one, rename one, reorder them
// or remove one — the Dashboard listed whatever the web had made and
// the loan card asked for terms with nowhere to put them. A client that
// can now create ACCOUNTS (Google sign-in provisions a user on first
// sign-in) cannot also be a client that cannot create the things an
// account is made of.
//
// Same engine functions as the web: setupAsset, setupLoan,
// deleteCategory, moveCategory. Phone screens only — nothing here
// decides what those functions mean.
//
// No drag-to-reorder, deliberately and for the same reason the web
// disables it on touch: an HTML5 drag never fires from a finger, and a
// long-press reorder inside a scroll view fights the scroll. Arrows
// move one row at a time and cannot be ambiguous.
export default function Categories({ onClose }: { onClose: () => void }) {
  const { state, commit, online, saving } = useBudget();
  const [editing, setEditing] = useState<{ id: string | null; draft: CategoryDraft } | null>(null);

  const rows = categoryRows(state!);
  const today = todayISO();

  async function save(d: CategoryDraft) {
    const id = editing?.id ?? null;
    // The three-way engine branch lives in lib/categories.ts, where a
    // test can reach it — a screen deciding what an engine call means
    // is the thing the engine boundary exists to prevent.
    const ok = await commit(
      (s) => applyCategoryDraft(s, d, id),
      id ? `${d.name.trim()} updated` : `${d.name.trim()} added`
    );
    if (ok) setEditing(null);
  }

  function confirmDelete(rowId: string) {
    const row = rows.find((r) => r.id === rowId)!;
    // The engine does not refuse and does not cascade: tagged items
    // survive as uncategorized. Surprising and correct, so it is said
    // before the tap, with the counts.
    Alert.alert("Delete this account?", deleteWarning(row), [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => void commit((s) => deleteCategory(s, rowId), `${row.name} deleted`),
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>Accounts you track</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.lede}>
          Your savings, investments and loans — the things the Dashboard counts. Transactions you tag
          with one keep their history even if you delete it here.
        </Text>

        {rows.map((r, i) => (
          <View key={r.id} style={styles.row}>
            <View style={styles.arrows}>
              <Pressable
                onPress={() => void commit((s) => moveCategory(s, r.id, -1), `${r.name} moved up`)}
                disabled={i === 0 || !online} hitSlop={6}
                accessibilityRole="button" accessibilityLabel={`Move ${r.name} up`}
              >
                <Text style={[styles.arrow, (i === 0 || !online) && styles.arrowOff]}>▲</Text>
              </Pressable>
              <Pressable
                onPress={() => void commit((s) => moveCategory(s, r.id, 1), `${r.name} moved down`)}
                disabled={i === rows.length - 1 || !online} hitSlop={6}
                accessibilityRole="button" accessibilityLabel={`Move ${r.name} down`}
              >
                <Text style={[styles.arrow, (i === rows.length - 1 || !online) && styles.arrowOff]}>▼</Text>
              </Pressable>
            </View>

            <Pressable
              style={{ flex: 1 }}
              disabled={!online}
              onPress={() => setEditing({
                id: r.id,
                draft: draftOfCategory(state!.trackerCategories.find((c) => c.id === r.id)!, today),
              })}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${r.name}`}
            >
              <Text style={styles.name}>{r.name}</Text>
              <Text style={[styles.sub, r.kind === "debt" && r.sub.includes("no rate") && styles.prompt]}>
                {r.sub}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => confirmDelete(r.id)}
              disabled={!online} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={`Delete ${r.name}`}
            >
              <Text style={[styles.del, !online && styles.arrowOff]}>Delete</Text>
            </Pressable>
          </View>
        ))}

        {rows.length === 0 && (
          <Text style={styles.empty}>
            Nothing tracked yet. Add a savings account, an investment or a loan and it appears on the
            Dashboard.
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [styles.add, pressed && styles.pressed, !online && styles.disabled]}
          disabled={!online}
          onPress={() => setEditing({ id: null, draft: blankCategoryDraft(today) })}
          accessibilityRole="button"
          accessibilityLabel={online ? "Add an account" : "Offline"}
        >
          <Text style={styles.addText}>{online ? "+ Add an account" : "Offline — read only"}</Text>
        </Pressable>
      </ScrollView>

      {editing && (
        <CategorySheet
          title={editing.id ? "Edit account" : "Add an account"}
          draft={editing.draft}
          busy={saving}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { color: T.text, fontSize: 18, fontWeight: "700" },
  done: { color: T.brass, fontSize: 15, fontWeight: "600" },
  list: { padding: 16, paddingBottom: 48, gap: 8 },
  lede: { color: T.faint, fontSize: 12, lineHeight: 17, marginBottom: 6 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minHeight: 64,
  },
  arrows: { gap: 2 },
  arrow: { color: T.dim, fontSize: 11, lineHeight: 14 },
  arrowOff: { color: T.border },
  name: { color: T.text, fontSize: 15, fontWeight: "600" },
  sub: { color: T.faint, fontSize: 12, marginTop: 2 },
  // The loan card's unanswered prompt, echoed in brass so the thing
  // that needs doing looks like a thing that needs doing.
  prompt: { color: T.brass },
  del: { color: T.expense, fontSize: 13 },
  empty: { color: T.faint, fontSize: 13, lineHeight: 19, textAlign: "center", marginVertical: 16 },
  add: {
    marginTop: 10, minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: T.border, backgroundColor: T.surface,
  },
  pressed: { backgroundColor: T.surfaceAlt },
  disabled: { opacity: 0.5 },
  addText: { color: T.text, fontSize: 15, fontWeight: "600" },
});
