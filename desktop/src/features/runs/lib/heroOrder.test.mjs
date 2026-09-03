import assert from "node:assert/strict";
import { test } from "node:test";

import { neighbourOf, reconcileHeroOrder } from "./heroOrder.ts";

test("a worktree keeps its place, a new one joins at the end", () => {
  const order = ["a", "b"];
  assert.deepEqual(reconcileHeroOrder(order, ["b", "a", "c"], null), [
    "a",
    "b",
    "c",
  ]);
});

test("the worktree just visited joins last, after any other newcomer", () => {
  // Two appeared at once (a restart restoring two strips): the one he pressed
  // goes to the end, so the strip ends where his attention is.
  assert.deepEqual(reconcileHeroOrder([], ["x", "y"], "x"), ["y", "x"]);
});

test("a worktree that left the tab model leaves the strip", () => {
  assert.deepEqual(reconcileHeroOrder(["a", "b", "c"], ["a", "c"], "a"), [
    "a",
    "c",
  ]);
});

test("nothing to do answers with the same array", () => {
  const order = ["a", "b"];
  assert.equal(reconcileHeroOrder(order, ["a", "b"], "b"), order);
  assert.equal(reconcileHeroOrder(order, ["b", "a"], null), order);
});

test("a selected worktree with no strip yet is not invented onto the strip", () => {
  // Visiting opens a strip (`ensureWorktree`); until it has, there is no
  // chip to draw. The order follows the tab model, never leads it.
  assert.deepEqual(reconcileHeroOrder(["a"], ["a"], "z"), ["a"]);
});

test("leaving lands on the chip to the left, else the right, else nowhere", () => {
  assert.equal(neighbourOf(["a", "b", "c"], "b"), "a");
  assert.equal(neighbourOf(["a", "b", "c"], "a"), "b");
  assert.equal(neighbourOf(["a"], "a"), null);
  assert.equal(neighbourOf(["a", "b"], "zzz"), null);
});
