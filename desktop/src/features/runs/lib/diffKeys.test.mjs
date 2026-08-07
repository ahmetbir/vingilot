import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activatesOnEnter,
  isTypingTarget,
  nextFileIndex,
  resolveDiffKey,
} from "./diffKeys.ts";

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

test("Enter on a focused control presses that control, not this list", () => {
  // The listener is on window: while the Diff tab is mounted it sees Enter on
  // the WorkSurface tab strip, on a project row, on the Read button. Taking it
  // there cancels a press the owner meant.
  assert.equal(
    resolveDiffKey(key({ focusActivates: true, key: "Enter" })),
    null,
  );
  // A file row is itself a button, so its own Enter arrives this way too —
  // and opens the file through the row's click handler, not through here.
  assert.deepEqual(
    resolveDiffKey(key({ focusActivates: false, key: "Enter" })),
    {
      type: "open-file",
    },
  );
});

test("a focused button does not take the letters, only Enter", () => {
  // Every row in the list is a button. Surrendering j/k to a focused control
  // would stop the cursor keys the moment the owner clicked a row.
  assert.deepEqual(resolveDiffKey(key({ focusActivates: true, key: "j" })), {
    dir: 1,
    type: "step-file",
  });
  assert.deepEqual(resolveDiffKey(key({ focusActivates: true, key: "k" })), {
    dir: -1,
    type: "step-file",
  });
});

test("what counts as typing, and what counts as pressable", () => {
  const el = (overrides = {}) => ({
    contentEditable: false,
    role: null,
    tagName: "DIV",
    ...overrides,
  });

  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(el({ tagName: "INPUT" })), true);
  assert.equal(isTypingTarget(el({ tagName: "TEXTAREA" })), true);
  assert.equal(isTypingTarget(el({ contentEditable: true })), true);
  assert.equal(isTypingTarget(el({ tagName: "BUTTON" })), false);

  assert.equal(activatesOnEnter(null), false);
  assert.equal(activatesOnEnter(el({ tagName: "BUTTON" })), true);
  assert.equal(activatesOnEnter(el({ tagName: "A" })), true);
  assert.equal(activatesOnEnter(el()), false);
  // A div that says it is a button is one, to the platform and to a screen
  // reader alike — Radix builds half this app's controls that way.
  assert.equal(activatesOnEnter(el({ role: "button" })), true);
  assert.equal(activatesOnEnter(el({ role: "tab" })), true);
  // An explicit role wins over the tag it is written on.
  assert.equal(
    activatesOnEnter(el({ role: "presentation", tagName: "BUTTON" })),
    false,
  );
});
