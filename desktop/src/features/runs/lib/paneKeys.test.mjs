import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveColumnKey } from "./columnKeys.ts";
import { resolveDividerKey, resolvePaneKey } from "./paneKeys.ts";
import {
  MAX_RATIO,
  MIN_RATIO,
  RATIO_STEP,
  RATIO_STEP_COARSE,
} from "./paneModel.ts";
import { resolveKey } from "./terminalKeys.ts";

function chord(over = {}) {
  return {
    altKey: false,
    key: "b",
    primaryModifier: true,
    repeat: false,
    shiftKey: false,
    ...over,
  };
}

test("alt+primary+B hides and restores the right pane", () => {
  assert.deepEqual(resolvePaneKey(chord({ altKey: true })), {
    type: "toggle-right-pane",
  });
  assert.deepEqual(resolvePaneKey(chord({ altKey: true, key: "B" })), {
    type: "toggle-right-pane",
  });
});

test("the composed character macOS makes of alt+b is the same chord", () => {
  assert.deepEqual(resolvePaneKey(chord({ altKey: true, key: "∫" })), {
    type: "toggle-right-pane",
  });
});

test("the chord without alt is the sidebar's, and is left alone", () => {
  assert.equal(resolvePaneKey(chord()), null);
  assert.equal(resolvePaneKey(chord({ shiftKey: true })), null);
  assert.equal(resolvePaneKey(chord({ altKey: true, shiftKey: true })), null);
  assert.equal(
    resolvePaneKey(chord({ altKey: true, primaryModifier: false })),
    null,
  );
  assert.equal(resolvePaneKey(chord({ altKey: true, key: "n" })), null);
});

test("a held chord is not a second press", () => {
  assert.equal(resolvePaneKey(chord({ altKey: true, repeat: true })), null);
});

test("no other map in this island claims the pane chord", () => {
  const held = chord({ altKey: true });
  assert.equal(resolveColumnKey(held), null);
  assert.equal(resolveKey(held), null);
});

test("the pane host does not shadow the column chords", () => {
  assert.deepEqual(resolveColumnKey(chord()), {
    column: "sidebar",
    type: "toggle-column",
  });
  assert.equal(resolvePaneKey(chord()), null);
  assert.deepEqual(resolveColumnKey(chord({ shiftKey: true })), {
    column: "worktrees",
    type: "toggle-column",
  });
  assert.equal(resolvePaneKey(chord({ shiftKey: true })), null);
});

function bare(over = {}) {
  return {
    altKey: false,
    key: "ArrowLeft",
    primaryModifier: false,
    repeat: false,
    shiftKey: false,
    ...over,
  };
}

test("the divider moves on the arrows, both ways", () => {
  assert.deepEqual(resolveDividerKey(bare()), {
    delta: -RATIO_STEP,
    type: "nudge",
  });
  assert.deepEqual(resolveDividerKey(bare({ key: "ArrowRight" })), {
    delta: RATIO_STEP,
    type: "nudge",
  });
});

test("shift crosses the surface faster", () => {
  assert.deepEqual(resolveDividerKey(bare({ shiftKey: true })), {
    delta: -RATIO_STEP_COARSE,
    type: "nudge",
  });
});

test("a held arrow keeps moving the divider — that is what holding it means", () => {
  assert.deepEqual(resolveDividerKey(bare({ repeat: true })), {
    delta: -RATIO_STEP,
    type: "nudge",
  });
});

test("Home and End take the divider to its limits", () => {
  assert.deepEqual(resolveDividerKey(bare({ key: "Home" })), {
    ratio: MIN_RATIO,
    type: "set-ratio",
  });
  assert.deepEqual(resolveDividerKey(bare({ key: "End" })), {
    ratio: MAX_RATIO,
    type: "set-ratio",
  });
});

test("the keyboard reaches the reset a double-click reaches", () => {
  assert.deepEqual(resolveDividerKey(bare({ key: "0" })), {
    type: "reset-ratio",
  });
});

test("Enter collapses and restores, and a held Enter does not", () => {
  assert.deepEqual(resolveDividerKey(bare({ key: "Enter" })), {
    type: "toggle-right-pane",
  });
  assert.equal(resolveDividerKey(bare({ key: "Enter", repeat: true })), null);
});

test("a focused divider does not swallow the app's own chords", () => {
  assert.equal(resolveDividerKey(bare({ primaryModifier: true })), null);
  assert.equal(resolveDividerKey(bare({ altKey: true })), null);
  assert.equal(
    resolveDividerKey(bare({ altKey: true, key: "b", primaryModifier: true })),
    null,
  );
  assert.equal(resolveDividerKey(bare({ key: "j" })), null);
});
