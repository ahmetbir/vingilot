import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCardKey } from "./cardKeys.ts";

test("the arrows move a focused card either way", () => {
  assert.deepEqual(
    resolveCardKey({ key: "ArrowLeft", primaryModifier: false }),
    {
      dir: -1,
      type: "move-card",
    },
  );
  assert.deepEqual(
    resolveCardKey({ key: "ArrowRight", primaryModifier: false }),
    { dir: 1, type: "move-card" },
  );
});

test("a modifier does not take the arrow away", () => {
  // What the handler this replaced did: the key was read and the modifiers
  // were not. Kept, because narrowing it would change what a chord does on the
  // way to making the sheet able to see it — and the sheet folds these back
  // onto the bare ← and → rather than printing eight of each.
  assert.deepEqual(
    resolveCardKey({
      altKey: true,
      key: "ArrowLeft",
      primaryModifier: true,
      shiftKey: true,
    }),
    { dir: -1, type: "move-card" },
  );
});

test("nothing else on a card is this map's", () => {
  // A card's title is a button, so ↵ and Space belong to it, and ↑/↓ belong to
  // whatever scrolls. A map that claimed them would take them from the
  // platform.
  for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Escape", "j"]) {
    assert.equal(resolveCardKey({ key, primaryModifier: false }), null, key);
  }
});
