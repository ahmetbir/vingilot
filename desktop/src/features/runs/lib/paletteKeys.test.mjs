import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePaletteKey, resolvePaletteListKey } from "./paletteKeys.ts";

test("primary+k asks for the palette's front door", () => {
  assert.deepEqual(resolvePaletteKey({ key: "k", primaryModifier: true }), {
    door: "go",
    type: "toggle-palette",
  });
});

test("caps lock does not lose the chord", () => {
  assert.deepEqual(resolvePaletteKey({ key: "K", primaryModifier: true }), {
    door: "go",
    type: "toggle-palette",
  });
});

// The two doors added in Task 2 of the IDE plan. Each one asks for the SAME
// action with a different door, which is what says in one assertion that this
// is one palette pointed at three lists rather than three surfaces.
test("primary+p is the files door and shift+primary+p is the commands door", () => {
  assert.deepEqual(resolvePaletteKey({ key: "p", primaryModifier: true }), {
    door: "files",
    type: "toggle-palette",
  });
  assert.deepEqual(
    resolvePaletteKey({ key: "p", primaryModifier: true, shiftKey: true }),
    { door: "commands", type: "toggle-palette" },
  );
  // The caps-lock reading of both, for the reason the K case above exists.
  assert.deepEqual(resolvePaletteKey({ key: "P", primaryModifier: true }), {
    door: "files",
    type: "toggle-palette",
  });
});

test("alt+primary+p is refused, the way alt+primary+k is", () => {
  // The AppKit-synthesis rule: no chord of this island sits on alt+letter, and
  // a map that absorbed one by ignoring the modifier would half-claim a chord
  // nobody checked (`scratchMarkdownKeys.ts`'s header).
  assert.equal(
    resolvePaletteKey({ altKey: true, key: "p", primaryModifier: true }),
    null,
  );
  assert.equal(
    resolvePaletteKey({
      altKey: true,
      key: "p",
      primaryModifier: true,
      shiftKey: true,
    }),
    null,
  );
});

test("p on its own is a letter", () => {
  assert.equal(resolvePaletteKey({ key: "p", primaryModifier: false }), null);
});

test("shift+primary+k is upstream's new-message and stays theirs", () => {
  assert.equal(
    resolvePaletteKey({ key: "k", primaryModifier: true, shiftKey: true }),
    null,
  );
  // Including the reading ⇧ produces for the letter itself.
  assert.equal(
    resolvePaletteKey({ key: "K", primaryModifier: true, shiftKey: true }),
    null,
  );
});

test("alt+primary+k is nobody's here, and this map does not take it", () => {
  assert.equal(
    resolvePaletteKey({ altKey: true, key: "k", primaryModifier: true }),
    null,
  );
});

test("k on its own is a letter", () => {
  assert.equal(resolvePaletteKey({ key: "k", primaryModifier: false }), null);
});

test("a held chord does not reopen the palette thirty times a second", () => {
  assert.equal(
    resolvePaletteKey({ key: "k", primaryModifier: true, repeat: true }),
    null,
  );
});

test("the arrows walk the list and repeat while held", () => {
  assert.deepEqual(resolvePaletteListKey({ key: "ArrowDown" }), {
    delta: 1,
    type: "move",
  });
  assert.deepEqual(resolvePaletteListKey({ key: "ArrowUp" }), {
    delta: -1,
    type: "move",
  });
  assert.deepEqual(resolvePaletteListKey({ key: "ArrowDown", repeat: true }), {
    delta: 1,
    type: "move",
  });
});

test("Enter runs and Escape closes, neither on auto-repeat", () => {
  assert.deepEqual(resolvePaletteListKey({ key: "Enter" }), { type: "run" });
  assert.deepEqual(resolvePaletteListKey({ key: "Escape" }), { type: "close" });
  assert.equal(resolvePaletteListKey({ key: "Enter", repeat: true }), null);
  assert.equal(resolvePaletteListKey({ key: "Escape", repeat: true }), null);
});

test("shift+Enter is not a second Enter", () => {
  assert.equal(resolvePaletteListKey({ key: "Enter", shiftKey: true }), null);
});

test("the list keys fall through whenever a modifier is held", () => {
  // ⌘↵ and ⌥↓ belong to whatever else claims them; a palette that swallowed
  // them would make opening it cost the owner his other chords. ⌘K in
  // particular has to reach `resolvePaletteKey` so the key that opened this
  // closes it.
  assert.equal(
    resolvePaletteListKey({ key: "Enter", primaryModifier: true }),
    null,
  );
  assert.equal(resolvePaletteListKey({ altKey: true, key: "ArrowDown" }), null);
  assert.equal(
    resolvePaletteListKey({ key: "k", primaryModifier: true }),
    null,
  );
});

test("tab, in either direction and while held, comes back to the field", () => {
  // The three states the field-only handler used to lose: ⇥ off the field,
  // ⇧⇥ onto the scrim, and — the one the design produces itself — a click on
  // a blocked row. Resolving ⇥ is what keeps focus somewhere Esc answers for.
  assert.deepEqual(resolvePaletteListKey({ key: "Tab" }), { type: "refocus" });
  assert.deepEqual(resolvePaletteListKey({ key: "Tab", shiftKey: true }), {
    type: "refocus",
  });
  assert.deepEqual(resolvePaletteListKey({ key: "Tab", repeat: true }), {
    type: "refocus",
  });
});

test("a plain letter is what the owner is typing, not a command", () => {
  assert.equal(resolvePaletteListKey({ key: "a" }), null);
  assert.equal(resolvePaletteListKey({ key: " " }), null);
});
