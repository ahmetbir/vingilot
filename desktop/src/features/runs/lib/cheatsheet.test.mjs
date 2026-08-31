// The sheet is only worth having if it cannot fall behind the maps it
// describes (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 4). These
// tests are what makes that true rather than intended.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cheatsheet,
  CHORD_ELISION,
  chordKeys,
  chordOf,
  chordRun,
  MENU_CHORDS,
  resolvedChords,
} from "./cheatsheet.ts";

/** Every generated row on the sheet, written as the chords it carries.
 * `elsewhere` is left out because its rows are hand-written and this is the
 * assertion about the generator; a generated row that *landed* there is caught
 * all the same, by going missing from this list. */
function generatedRows() {
  return cheatsheet()
    .filter((section) => section.id !== "elsewhere")
    .flatMap((section) => section.rows.map((row) => row.chords.join(" ")))
    .sort();
}

test("every row the maps generate is on the sheet, whole", () => {
  // The headline. A chord that resolves and is not here is a chord the owner
  // can only find by pressing keys at random, which is the state this whole
  // surface exists to end — and the way it comes back is a map growing a chord
  // while the sheet does not.
  //
  // **It reads rows, and the first version read chord strings, which is not
  // the same check.** Comparing resolved chords against every chord printed
  // anywhere passes while a whole map's rows are missing, because some other
  // row prints the same string: drop every `sheet-open` hit and the sheet
  // loses "close this sheet" entirely, yet `Esc` is still printed by the
  // palette, so nothing fails. A row is `<map>:<action>` — the identity
  // `cheatsheet()` groups by — so grouping the same way and comparing the
  // groups makes a missing row a missing row.
  const byRow = new Map();
  for (const hit of resolvedChords()) {
    const id = `${hit.module}:${hit.action}`;
    byRow.set(id, [...(byRow.get(id) ?? []), hit.chord]);
  }
  const expected = [...byRow.values()].map((chords) => chords.join(" ")).sort();
  assert.deepEqual(generatedRows(), expected);
});

test("every generated row says what it does", () => {
  // A row with no sentence is drawn carrying its own action key, so it is
  // visible rather than silently absent — and this is where that becomes a
  // build failure instead of something shipped.
  const wordless = cheatsheet()
    .filter((section) => section.id !== "elsewhere")
    .flatMap((section) => section.rows)
    .filter((row) => /^[a-z-]+:[a-z-]+(:|$)/.test(row.what))
    .map((row) => `${row.chords.join(" ")} — ${row.what}`);
  assert.deepEqual(wordless, []);
});

test("the island claims nothing the default macOS menu already binds", () => {
  // ⌘W was lost this way once: a chord taken without checking the menu is not
  // shadowed, it never arrives at all, because macOS resolves menu key
  // equivalents before the webview sees the keydown. This is that check, run
  // over the generated set on every build rather than by hand per chord.
  const collisions = resolvedChords()
    .map((hit) => hit.chord)
    .filter((chord) => MENU_CHORDS.includes(chord));
  assert.deepEqual(collisions, []);
});

test("the sheet carries its own chord", () => {
  const rows = cheatsheet().flatMap((section) => section.rows);
  const own = rows.find((row) => row.chords.includes("⌘/"));
  assert.notEqual(own, undefined, "⌘/ is not on the sheet it opens");
  assert.match(own?.what ?? "", /sheet/);
});

test("the chords that are not the island's are on it too", () => {
  const elsewhere = cheatsheet().find((section) => section.id === "elsewhere");
  assert.notEqual(elsewhere, undefined);
  const chords = (elsewhere?.rows ?? []).flatMap((row) => [...row.chords]);
  // Every accelerator of the menu this app deliberately leaves alone, plus the
  // one that behaves differently here than its name says.
  const menuMissing = MENU_CHORDS.filter((chord) => !chords.includes(chord));
  assert.deepEqual(menuMissing, []);
  // And the app's own, which are not the menu's and not the island's: a
  // shortcut the owner presses on this screen and cannot look up is the same
  // failure as an island chord that is missing.
  const appMissing = ["⌃Space", "⌘+", "⌘-", "⌘0", "⌘,", "⌘R"].filter(
    (chord) => !chords.includes(chord),
  );
  assert.deepEqual(appMissing, []);
  // The section's own subtitle, checked rather than asserted: it says the
  // workspace binds none of what is printed here, so no chord the island's
  // maps resolve may appear in it.
  const claimed = resolvedChords()
    .map((hit) => hit.chord)
    .filter((chord) => chords.includes(chord));
  assert.deepEqual(claimed, []);
});

test("⌘W is the island's own row now, and still says what it really does", () => {
  // It used to be printed under "elsewhere" — a native gesture this app could
  // only intercept, because the default macOS menu resolved the accelerator
  // before the webview saw it. `app_menu.rs` drops that menu item, so the
  // keystroke arrives and `closeKeys.ts` resolves it; the row is generated
  // from that map like every other chord the island owns. Both halves are
  // asserted: that it is generated, and that it still tells the truth about
  // what happens past the bottom of the stack.
  const generated = cheatsheet()
    .filter((section) => section.id !== "elsewhere")
    .flatMap((section) => section.rows)
    .find((row) => row.chords.includes("⌘W"));
  assert.notEqual(generated, undefined, "⌘W is not on the sheet it now owns");
  assert.match(generated?.what ?? "", /minimiz/);
  assert.match(generated?.what ?? "", /never hides/);
  // And it is no longer printed as somebody else's: the "elsewhere" section
  // says the workspace binds none of what is in it.
  const elsewhereRows =
    cheatsheet().find((section) => section.id === "elsewhere")?.rows ?? [];
  assert.equal(
    elsewhereRows.some((row) => row.chords.includes("⌘W")),
    false,
  );
});

test("a chord is written the way this island already writes one", () => {
  assert.equal(
    chordOf({ altKey: true, key: "b", primaryModifier: true, shiftKey: true }),
    "⇧⌥⌘B",
  );
  // The readings the maps accept so a chord survives ⌥ composition and a stuck
  // caps lock are the same chord, not extra ones.
  assert.equal(
    chordOf({ altKey: true, key: "†", primaryModifier: true }),
    "⌥⌘T",
  );
  assert.equal(chordOf({ key: "T", primaryModifier: true }), "⌘T");
  // An unmodified letter is the key as it is: the Diff pane's `j` is not ⇧J.
  assert.equal(chordOf({ key: "j", primaryModifier: false }), "j");
  assert.equal(chordOf({ key: "Escape", primaryModifier: false }), "Esc");
});

test("nine worktree chords are drawn as their two ends", () => {
  const nine = Array.from({ length: 9 }, (_unused, at) => `⌘${at + 1}`);
  assert.deepEqual(chordRun(nine), ["⌘1", "…", "⌘9"]);
  // Only a run: two arrows are two arrows, and three unrelated chords stay
  // three chords rather than becoming a range nobody bound.
  assert.deepEqual(chordRun(["⌥⌘←", "⌥⌘→"]), ["⌥⌘←", "⌥⌘→"]);
  assert.deepEqual(chordRun(["⌘C", "⌘X", "⌘V"]), ["⌘C", "⌘X", "⌘V"]);
});

test("a chord is drawn as one box per modifier and one for the key", () => {
  // The palette's rows are all one letter after their modifiers, so splitting
  // on characters was right there and is wrong here: this sheet carries named
  // keys, and `Esc` in three boxes reads as three keys held together.
  assert.deepEqual(chordKeys("⇧⌥⌘B"), ["⇧", "⌥", "⌘", "B"]);
  assert.deepEqual(chordKeys("Esc"), ["Esc"]);
  assert.deepEqual(chordKeys("⌥⌘←"), ["⌥", "⌘", "←"]);
  assert.deepEqual(chordKeys("⌃⌘F"), ["⌃", "⌘", "F"]);
  assert.deepEqual(chordKeys("j"), ["j"]);
  // The elision is not a key, and it must not come back as one.
  assert.deepEqual(chordKeys(CHORD_ELISION), [CHORD_ELISION]);
});

test("every chord on the sheet is drawable, and none of it is a word in a box", () => {
  // The two failures this guards are the same failure from either side: a
  // chord that split into nothing has no box at all, and one whose key came
  // back with a modifier still glued to it is a word in a box — which is the
  // thing the kbd idiom exists to stop a chord being.
  for (const section of cheatsheet()) {
    for (const row of section.rows) {
      for (const chord of row.chords) {
        const keys = chordKeys(chord);
        assert.notEqual(keys.length, 0, `${chord} draws as nothing`);
        assert.equal(keys.join(""), chord, `${chord} lost or gained a glyph`);
        const key = keys[keys.length - 1] ?? "";
        assert.equal(
          /^[⇧⌥⌘⌃]/.test(key),
          false,
          `${chord} kept a modifier in its key box: ${key}`,
        );
      }
    }
  }
});

test("the ⌘1…⌘9 row still carries all nine", () => {
  // The elision is a drawing. What the test above reads, and what a future
  // reader has to be able to trust, is that the row itself is complete.
  const row = cheatsheet()
    .flatMap((section) => section.rows)
    .find((entry) => entry.chords.includes("⌘5"));
  assert.notEqual(row, undefined);
  assert.deepEqual(
    row?.chords,
    Array.from({ length: 9 }, (_unused, at) => `⌘${at + 1}`),
  );
});
