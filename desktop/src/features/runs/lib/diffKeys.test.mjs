import assert from "node:assert/strict";
import { test } from "node:test";
import { nextFileIndex, resolveDiffKey } from "./diffKeys.ts";

function key(overrides = {}) {
  return { inField: false, key: "j", ...overrides };
}

test("j and k step the cursor, Enter opens what it is on", () => {
  assert.deepEqual(resolveDiffKey(key({ key: "j" })), {
    dir: 1,
    type: "step-file",
  });
  assert.deepEqual(resolveDiffKey(key({ key: "k" })), {
    dir: -1,
    type: "step-file",
  });
  assert.deepEqual(resolveDiffKey(key({ key: "Enter" })), {
    type: "open-file",
  });
});

test("a j typed into the base field is a letter, not a movement", () => {
  assert.equal(resolveDiffKey(key({ inField: true, key: "j" })), null);
  // Enter in the field belongs to the field too — it submits the ref.
  assert.equal(resolveDiffKey(key({ inField: true, key: "Enter" })), null);
});

test("a modified j belongs to the app, not to this list", () => {
  assert.equal(resolveDiffKey(key({ primaryModifier: true })), null);
  assert.equal(resolveDiffKey(key({ altKey: true })), null);
  assert.equal(resolveDiffKey(key({ shiftKey: true })), null);
});

test("holding j keeps moving — a cursor costs nothing to move", () => {
  // Unlike terminalKeys.ts, where every chord spawns a shell.
  assert.deepEqual(resolveDiffKey(key({ repeat: true })), {
    dir: 1,
    type: "step-file",
  });
});

test("keys this map has nothing to say about fall through", () => {
  for (const k of ["ArrowDown", "J", "x", " ", "Escape"]) {
    assert.equal(resolveDiffKey(key({ key: k })), null);
  }
});

test("the cursor clamps at both ends instead of wrapping", () => {
  // Wrapping would put the owner at the top of the list without their
  // noticing, reading the wrong file.
  assert.equal(nextFileIndex(0, 3, -1), 0);
  assert.equal(nextFileIndex(2, 3, 1), 2);
  assert.equal(nextFileIndex(1, 3, 1), 2);
  assert.equal(nextFileIndex(1, 3, -1), 0);
});

test("with nothing selected yet, j takes the first file and k the last", () => {
  assert.equal(nextFileIndex(-1, 3, 1), 0);
  assert.equal(nextFileIndex(-1, 3, -1), 2);
});

test("an empty list has no file under the cursor", () => {
  assert.equal(nextFileIndex(-1, 0, 1), -1);
  assert.equal(nextFileIndex(0, 0, -1), -1);
});
