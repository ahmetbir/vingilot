import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveKey } from "./keys.ts";

test("resolveKey: cmd+K opens the palette when it is closed", () => {
  const action = resolveKey({ key: "k", metaKey: true }, { paletteOpen: false });
  assert.deepEqual(action, { type: "open-palette" });
});

test("resolveKey: cmd+K closes the palette when it is open", () => {
  const action = resolveKey({ key: "k", metaKey: true }, { paletteOpen: true });
  assert.deepEqual(action, { type: "close-palette" });
});

test("resolveKey: cmd+5 selects the 5th rail run", () => {
  const action = resolveKey({ key: "5", metaKey: true }, { paletteOpen: false });
  assert.deepEqual(action, { type: "select-run", n: 5 });
});

test("resolveKey: Escape closes the palette/overlay regardless of meta", () => {
  const action = resolveKey({ key: "Escape", metaKey: false }, { paletteOpen: true });
  assert.deepEqual(action, { type: "close" });
});

test("resolveKey: plain k without meta is not an action", () => {
  const action = resolveKey({ key: "k", metaKey: false }, { paletteOpen: false });
  assert.equal(action, null);
});

test("resolveKey: cmd+0 and cmd+plain-letters are not actions", () => {
  assert.equal(resolveKey({ key: "0", metaKey: true }, { paletteOpen: false }), null);
  assert.equal(resolveKey({ key: "j", metaKey: true }, { paletteOpen: false }), null);
});
