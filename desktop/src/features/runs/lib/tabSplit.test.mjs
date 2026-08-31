import assert from "node:assert/strict";
import test from "node:test";

import {
  closeTabSplit,
  emptyTabSplits,
  focusTabSplit,
  halfOf,
  MIN_TAB_SPLIT_RATIO,
  neighbourKey,
  openTabSplit,
  parseStageKey,
  pruneTabSplits,
  reconcileTabSplit,
  setTabSplitRatio,
  stageKey,
  stageOrder,
  tabSplitOf,
} from "./tabSplit.ts";

const WT = "repo:main";

test("a stage key names a tab across both models, and comes back apart", () => {
  assert.equal(stageKey({ kind: "terminal", n: 3 }), "term:3");
  assert.equal(
    stageKey({ id: "file:src/main.rs", kind: "view" }),
    "view:file:src/main.rs",
  );
  assert.deepEqual(parseStageKey("term:3"), { kind: "terminal", n: 3 });
  assert.deepEqual(parseStageKey("view:file:src/main.rs"), {
    id: "file:src/main.rs",
    kind: "view",
  });
  // Injective where it has to be: a view id can hold anything git can name,
  // including something that looks like the other prefix, and the terminal
  // reading is digits only.
  assert.deepEqual(parseStageKey("view:term:3"), {
    id: "term:3",
    kind: "view",
  });
  assert.equal(parseStageKey("term:x"), null);
  assert.equal(parseStageKey("term:"), null);
  assert.equal(parseStageKey("view:"), null);
  assert.equal(parseStageKey("whatever"), null);
});

test("the strip's order is the shells, then the readings", () => {
  assert.deepEqual(
    stageOrder([2, 1, 5], [{ id: "diff:main" }, { id: "history" }]),
    ["term:2", "term:1", "term:5", "view:diff:main", "view:history"],
  );
});

test("a split names the right half, and refuses to name the left one twice", () => {
  const opened = openTabSplit(emptyTabSplits(), WT, "view:diff:main", "term:1");
  assert.deepEqual(tabSplitOf(opened, WT), {
    focus: "right",
    ratio: 0.5,
    secondary: "view:diff:main",
  });
  // One tab cannot be in two halves — a shell certainly cannot, there is one
  // pty and one xterm behind it.
  assert.equal(openTabSplit(opened, WT, "term:1", "term:1"), opened);
});

test("re-aiming a split keeps the divider where the owner put it", () => {
  let layout = openTabSplit(emptyTabSplits(), WT, "term:2", "term:1");
  layout = setTabSplitRatio(layout, WT, 0.3);
  layout = openTabSplit(layout, WT, "view:history", "term:1");
  assert.equal(tabSplitOf(layout, WT)?.ratio, 0.3);
  assert.equal(tabSplitOf(layout, WT)?.secondary, "view:history");
});

test("the ratio is clamped on every write, not only at the divider", () => {
  const layout = openTabSplit(emptyTabSplits(), WT, "term:2", "term:1");
  assert.equal(
    tabSplitOf(setTabSplitRatio(layout, WT, 0.01), WT)?.ratio,
    MIN_TAB_SPLIT_RATIO,
  );
  assert.equal(
    tabSplitOf(setTabSplitRatio(layout, WT, 0.99), WT)?.ratio,
    1 - MIN_TAB_SPLIT_RATIO,
  );
  assert.equal(
    tabSplitOf(setTabSplitRatio(layout, WT, Number.NaN), WT)?.ratio,
    0.5,
  );
  // A worktree with no split has no divider to move.
  const none = emptyTabSplits();
  assert.equal(setTabSplitRatio(none, WT, 0.4), none);
});

test("closing a split ends an arrangement and nothing else", () => {
  const layout = openTabSplit(emptyTabSplits(), WT, "term:2", "term:1");
  const back = closeTabSplit(layout, WT);
  assert.equal(tabSplitOf(back, WT), null);
  // Idempotent, and reference-stable when there was nothing to close, so a
  // caller can skip the write.
  assert.equal(closeTabSplit(back, WT), back);
});

test("focus is what ⌘W acts through, and only a split has two halves", () => {
  const layout = openTabSplit(emptyTabSplits(), WT, "term:2", "term:1");
  assert.equal(
    tabSplitOf(focusTabSplit(layout, WT, "left"), WT)?.focus,
    "left",
  );
  // Already there: reference-stable rather than a fresh object every click.
  const left = focusTabSplit(layout, WT, "left");
  assert.equal(focusTabSplit(left, WT, "left"), left);
  const none = emptyTabSplits();
  assert.equal(focusTabSplit(none, WT, "left"), none);
});

test("which half draws a tab is the one question the stage's layout asks", () => {
  const split = { focus: "right", ratio: 0.5, secondary: "view:diff:main" };
  assert.equal(halfOf(split, "view:diff:main", "term:1"), "right");
  assert.equal(halfOf(split, "term:1", "term:1"), "left");
  assert.equal(halfOf(split, "term:9", "term:1"), null);
  // With no split at all only the strip's own selection is on the stage.
  assert.equal(halfOf(null, "term:1", "term:1"), "left");
  assert.equal(halfOf(null, "view:diff:main", "term:1"), null);
});

test("the left half falls back to the neighbour, the way every close lands", () => {
  const ordered = ["term:1", "term:2", "view:history"];
  assert.equal(neighbourKey(ordered, "term:1"), "term:2");
  assert.equal(neighbourKey(ordered, "term:2"), "view:history");
  // The last tab falls back to the new last one.
  assert.equal(neighbourKey(ordered, "view:history"), "term:2");
  // A stage with one tab on it cannot be split, and says so.
  assert.equal(neighbourKey(["term:1"], "term:1"), null);
  assert.equal(neighbourKey(ordered, "term:404"), null);
});

test("a split whose right half is gone ends rather than drawing a blank", () => {
  const layout = openTabSplit(emptyTabSplits(), WT, "view:history", "term:1");
  assert.equal(tabSplitOf(reconcileTabSplit(layout, WT, ["term:1"]), WT), null);
  // Still live: untouched, so the effect that calls this settles.
  assert.equal(
    reconcileTabSplit(layout, WT, ["term:1", "view:history"]),
    layout,
  );
  const none = emptyTabSplits();
  assert.equal(reconcileTabSplit(none, WT, []), none);
});

test("a worktree that left the workspace takes its arrangement with it", () => {
  let layout = openTabSplit(emptyTabSplits(), WT, "term:2", "term:1");
  layout = openTabSplit(layout, "repo:other", "term:2", "term:1");
  const kept = pruneTabSplits(layout, ["repo:other"]);
  assert.deepEqual(Object.keys(kept), ["repo:other"]);
  // Nothing dropped: the input back, so a caller can skip the write.
  assert.equal(pruneTabSplits(kept, ["repo:other"]), kept);
});
