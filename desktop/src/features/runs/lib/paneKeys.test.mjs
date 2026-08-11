import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveColumnKey } from "./columnKeys.ts";
import { resolveDividerKey, resolvePaneKey } from "./paneKeys.ts";
import { RATIO_STEP, RATIO_STEP_COARSE } from "./paneModel.ts";
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

test("alt+primary+B gives the terminal the whole surface, and takes it back", () => {
  assert.deepEqual(resolvePaneKey(chord({ altKey: true })), {
    side: "left",
    type: "solo",
  });
  assert.deepEqual(resolvePaneKey(chord({ altKey: true, key: "B" })), {
    side: "left",
    type: "solo",
  });
});

test("shift is the mirror: the same chord gives the right pane the whole surface", () => {
  // The gesture the four ported panes lost when the tab bar became a split.
  // This file used to refuse ⇧⌥⌘B outright so that claiming it would have to
  // be a decision; this is that decision, and it is the *only* other side the
  // chord can mean.
  assert.deepEqual(resolvePaneKey(chord({ altKey: true, shiftKey: true })), {
    side: "right",
    type: "solo",
  });
});

test("the composed characters macOS makes of the two chords are the same two chords", () => {
  assert.deepEqual(resolvePaneKey(chord({ altKey: true, key: "∫" })), {
    side: "left",
    type: "solo",
  });
  assert.deepEqual(
    resolvePaneKey(chord({ altKey: true, key: "ı", shiftKey: true })),
    { side: "right", type: "solo" },
  );
});

test("the chord without alt is the sidebar's, and is left alone", () => {
  assert.equal(resolvePaneKey(chord()), null);
  assert.equal(resolvePaneKey(chord({ shiftKey: true })), null);
  assert.equal(
    resolvePaneKey(chord({ altKey: true, primaryModifier: false })),
    null,
  );
  assert.equal(resolvePaneKey(chord({ altKey: true, key: "n" })), null);
});

test("no column chord fires on either solo — alt is refused over there", () => {
  // Two listeners, two maps. A ⇧⌘B that also fired on ⇧⌥⌘B would hide the
  // nav column every time the owner maximised a pane.
  const mirror = chord({ altKey: true, shiftKey: true });
  assert.equal(resolveColumnKey(mirror), null);
  assert.equal(resolveKey(mirror), null);
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
    column: "nav",
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

test("Home and End take the divider to its limits, and the limits are the edges", () => {
  // They used to resolve to MIN_RATIO and MAX_RATIO, which are a matter of
  // taste and not a limit of anything: Home left the right pane at 442px of a
  // 1195px surface and called that "its limits". The limit of the left pane
  // getting smaller is the left pane being gone.
  assert.deepEqual(resolveDividerKey(bare({ key: "Home" })), {
    side: "right",
    type: "solo",
  });
  assert.deepEqual(resolveDividerKey(bare({ key: "End" })), {
    side: "left",
    type: "solo",
  });
});

test("the keyboard reaches the reset a double-click reaches", () => {
  assert.deepEqual(resolveDividerKey(bare({ key: "0" })), {
    type: "reset-ratio",
  });
});

test("Enter collapses and restores, and a held Enter does not", () => {
  assert.deepEqual(resolveDividerKey(bare({ key: "Enter" })), {
    side: "left",
    type: "solo",
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
