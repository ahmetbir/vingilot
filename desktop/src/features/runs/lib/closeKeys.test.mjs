import assert from "node:assert/strict";
import test from "node:test";

import { resolveCloseKey } from "./closeKeys.ts";
import { resolveKey } from "./terminalKeys.ts";

const cmd = (key, extra = {}) => ({ key, primaryModifier: true, ...extra });

test("⌘W is the island's now, and only ⌘W is", () => {
  assert.deepEqual(resolveCloseKey(cmd("w")), { type: "close-top" });
  // A stuck caps lock reports "W" for the unshifted chord; losing ⌘W to caps
  // lock would be a bug nobody would think to look for.
  assert.deepEqual(resolveCloseKey(cmd("W")), { type: "close-top" });
  assert.equal(resolveCloseKey({ key: "w", primaryModifier: false }), null);
  assert.equal(resolveCloseKey(cmd("q")), null);
});

test("⇧⌘W stays the terminal's, and ⌥⌘W is nobody's", () => {
  // Two W chords, two acts. ⌘W takes the top of the stack; ⇧⌘W closes a
  // terminal tab whatever is stacked over it.
  assert.equal(resolveCloseKey(cmd("w", { shiftKey: true })), null);
  assert.deepEqual(resolveKey(cmd("W", { shiftKey: true })), {
    type: "close-terminal-tab",
  });
  // Claiming ⌥⌘W by accident would take a chord this map's audit never ran
  // for.
  assert.equal(resolveCloseKey(cmd("w", { altKey: true })), null);
  assert.equal(
    resolveCloseKey(cmd("w", { altKey: true, shiftKey: true })),
    null,
  );
});

test("a leaned-on ⌘W is one press, not thirty", () => {
  // It walks a whole stack — a dialog, the palette, the sheet, a scratch shell
  // and a tab — and a held key delivers 15-30 keydowns a second.
  assert.equal(resolveCloseKey(cmd("w", { repeat: true })), null);
});

test("⇧⌘\\ is the tab split, in both of the readings macOS gives it", () => {
  // "|" on a US layout, "\\" where the backslash is not shifted.
  assert.deepEqual(resolveKey(cmd("|", { shiftKey: true })), {
    type: "toggle-tab-split",
  });
  assert.deepEqual(resolveKey(cmd("\\", { shiftKey: true })), {
    type: "toggle-tab-split",
  });
  // Unshifted ⌘\ is the dock's float toggle and is resolved in the work
  // surface, not here — this map must not answer it.
  assert.equal(resolveKey(cmd("\\")), null);
  assert.equal(resolveKey(cmd("|")), null);
  assert.equal(resolveKey(cmd("\\", { altKey: true, shiftKey: true })), null);
  assert.equal(resolveKey(cmd("\\", { repeat: true, shiftKey: true })), null);
});
