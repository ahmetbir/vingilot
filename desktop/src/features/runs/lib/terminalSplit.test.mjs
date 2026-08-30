import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionIdFor } from "./terminalTabs.ts";
import {
  cascadeSplits,
  closeSplit,
  emptySplits,
  isSplitSessionId,
  MIN_SPLIT_RATIO,
  openSplit,
  pruneSplits,
  setSplitRatio,
  splitOf,
  splitSessionId,
} from "./terminalSplit.ts";

test("a half's id can never collide with a tab's", () => {
  // A tab id ends in its ordinal's digits; a half id ends in the suffix.
  // Checked over ids that try to be awkward, including a binding id that
  // contains the suffix itself.
  for (const bindingId of ["local:abc", "main:repo-1", "wt~half", "a#b"]) {
    for (const n of [1, 7, 110]) {
      const tab = sessionIdFor(bindingId, n);
      assert.notEqual(splitSessionId(tab), tab);
      assert.ok(!isSplitSessionId(tab), `tab id read as a half: ${tab}`);
      assert.ok(isSplitSessionId(splitSessionId(tab)));
    }
  }
});

test("splitting makes one half at an even divider", () => {
  const splits = openSplit(emptySplits(), "wt#1", "right");
  assert.deepEqual(splitOf(splits, "wt#1"), { direction: "right", ratio: 0.5 });
});

test("splitting again the same way is a no-op, not a second shell", () => {
  const once = openSplit(emptySplits(), "wt#1", "down");
  assert.equal(openSplit(once, "wt#1", "down"), once);
});

test("the other direction turns the divider and keeps the ratio", () => {
  let splits = openSplit(emptySplits(), "wt#1", "right");
  splits = setSplitRatio(splits, "wt#1", 0.3);
  splits = openSplit(splits, "wt#1", "down");
  assert.deepEqual(splitOf(splits, "wt#1"), { direction: "down", ratio: 0.3 });
});

test("a half cannot be split again", () => {
  const splits = openSplit(emptySplits(), splitSessionId("wt#1"), "right");
  assert.deepEqual(splits, {});
});

test("closing a split names the half's session and only the half's", () => {
  const splits = openSplit(emptySplits(), "wt#1", "right");
  const change = closeSplit(splits, "wt#1");
  assert.deepEqual(change.closed, [splitSessionId("wt#1")]);
  assert.equal(splitOf(change.splits, "wt#1"), null);
});

test("closing a tab with no split closes nothing", () => {
  const splits = openSplit(emptySplits(), "wt#1", "right");
  const change = closeSplit(splits, "wt#2");
  assert.deepEqual(change.closed, []);
  assert.equal(change.splits, splits);
});

test("the divider is clamped so neither shell reaches zero", () => {
  let splits = openSplit(emptySplits(), "wt#1", "right");
  splits = setSplitRatio(splits, "wt#1", 0.01);
  assert.equal(splitOf(splits, "wt#1")?.ratio, MIN_SPLIT_RATIO);
  splits = setSplitRatio(splits, "wt#1", 0.99);
  assert.equal(splitOf(splits, "wt#1")?.ratio, 1 - MIN_SPLIT_RATIO);
  splits = setSplitRatio(splits, "wt#1", Number.NaN);
  assert.equal(splitOf(splits, "wt#1")?.ratio, 0.5);
});

test("a closed tab takes its half with it", () => {
  let splits = openSplit(emptySplits(), "wt#1", "right");
  splits = openSplit(splits, "wt#2", "down");
  const change = cascadeSplits(splits, ["wt#1", "wt#9"]);
  assert.deepEqual(change.closed, [splitSessionId("wt#1")]);
  assert.equal(splitOf(change.splits, "wt#1"), null);
  assert.ok(splitOf(change.splits, "wt#2"));
});

test("a cascade with nothing to say returns the same layout", () => {
  const splits = openSplit(emptySplits(), "wt#1", "right");
  assert.equal(cascadeSplits(splits, []).splits, splits);
  assert.equal(cascadeSplits(splits, ["wt#2"]).splits, splits);
});

test("a stored split whose tab is gone is dropped without closing anything", () => {
  let splits = openSplit(emptySplits(), "wt#1", "right");
  splits = openSplit(splits, "wt#2", "down");
  const pruned = pruneSplits(splits, ["wt#2"]);
  assert.equal(splitOf(pruned, "wt#1"), null);
  assert.ok(splitOf(pruned, "wt#2"));
  assert.equal(pruneSplits(pruned, ["wt#2"]), pruned);
});
