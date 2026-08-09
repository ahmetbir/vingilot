import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveCheatsheetKey,
  resolveOpenCheatsheetKey,
} from "./cheatsheetKeys.ts";

test("primary+/ asks what the keys are", () => {
  assert.deepEqual(resolveCheatsheetKey({ key: "/", primaryModifier: true }), {
    type: "toggle-cheatsheet",
  });
});

test("a shifted slash is the same chord, because on Turkish-Q it is the only one", () => {
  // ⇧7 is "/" on that layout, so the chord arrives with shiftKey set and the
  // key still "/". Refusing ⇧ would leave the sheet unreachable on the one
  // keyboard it was written for.
  assert.deepEqual(
    resolveCheatsheetKey({ key: "/", primaryModifier: true, shiftKey: true }),
    { type: "toggle-cheatsheet" },
  );
  // "?" is not the same chord: it is what a US layout reports for ⇧⌘/, which
  // nobody presses on a layout where ⌘/ is one key — and a `⌘?` on the sheet
  // would be a chord nothing can produce.
  assert.equal(
    resolveCheatsheetKey({ key: "?", primaryModifier: true, shiftKey: true }),
    null,
  );
});

test("⌥⌘/ is nobody's, and is not taken by ignoring ⌥", () => {
  assert.equal(
    resolveCheatsheetKey({ altKey: true, key: "/", primaryModifier: true }),
    null,
  );
});

test("a slash with no primary modifier is a character", () => {
  assert.equal(
    resolveCheatsheetKey({ key: "/", primaryModifier: false }),
    null,
  );
});

test("auto-repeat is not a second press", () => {
  assert.equal(
    resolveCheatsheetKey({ key: "/", primaryModifier: true, repeat: true }),
    null,
  );
});

test("nothing else on the primary modifier is this map's", () => {
  for (const key of ["k", "b", "t", "w", "7", "\\"]) {
    assert.equal(resolveCheatsheetKey({ key, primaryModifier: true }), null);
  }
});

test("Esc closes the open sheet, and a chord does not reach this map", () => {
  assert.deepEqual(
    resolveOpenCheatsheetKey({ key: "Escape", primaryModifier: false }),
    { type: "close-cheatsheet" },
  );
  // ⌘/ has to stay resolvable while the sheet is up — it is what closes it —
  // so every modified key falls through this map untouched.
  assert.equal(
    resolveOpenCheatsheetKey({ key: "Escape", primaryModifier: true }),
    null,
  );
  assert.equal(
    resolveOpenCheatsheetKey({
      altKey: true,
      key: "Escape",
      primaryModifier: false,
    }),
    null,
  );
  assert.equal(
    resolveOpenCheatsheetKey({ key: "Enter", primaryModifier: false }),
    null,
  );
});
