import assert from "node:assert/strict";
import { test } from "node:test";

import { reconcileRecent, recentToOffer } from "./recentWorktrees.ts";

test("a visit moves the worktree to the end, most recent last", () => {
  assert.deepEqual(reconcileRecent(["a", "b", "c"], ["a", "b", "c"], "a"), [
    "b",
    "c",
    "a",
  ]);
});

test("a worktree that lost its tabs leaves the memory", () => {
  assert.deepEqual(reconcileRecent(["a", "b", "c"], ["a", "c"], null), [
    "a",
    "c",
  ]);
});

test("worktrees with tabs but no visit count as least recent", () => {
  assert.deepEqual(reconcileRecent(["b"], ["x", "b", "y"], "b"), [
    "x",
    "y",
    "b",
  ]);
});

test("nothing to do answers with the same array", () => {
  const order = ["a", "b"];
  assert.equal(reconcileRecent(order, ["a", "b"], "b"), order);
  assert.equal(reconcileRecent(order, ["b", "a"], null), order);
});

test("a selected worktree with no strip yet is not invented into the memory", () => {
  assert.deepEqual(reconcileRecent(["a"], ["a"], "z"), ["a"]);
});

test("what to offer is most recent first, without the one he is in, capped", () => {
  assert.deepEqual(recentToOffer(["a", "b", "c", "d"], "d"), ["c", "b", "a"]);
  assert.deepEqual(recentToOffer(["a", "b", "c", "d"], "b", 2), ["d", "c"]);
  assert.deepEqual(recentToOffer([], null), []);
});
