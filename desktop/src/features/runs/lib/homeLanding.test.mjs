import assert from "node:assert/strict";
import { test } from "node:test";

import { homeLanding } from "./homeLanding.ts";

const index = new Map([
  ["wt-a", { repo: { id: "repo-1" } }],
  ["wt-b", { repo: { id: "repo-2" } }],
]);

test("the most recent remembered worktree the workspace still holds", () => {
  assert.deepEqual(homeLanding(["wt-a", "wt-b"], index), {
    bindingId: "wt-b",
    repoId: "repo-2",
  });
});

test("a memory of a worktree that is gone is skipped, not landed on", () => {
  assert.deepEqual(homeLanding(["wt-a", "wt-gone"], index), {
    bindingId: "wt-a",
    repoId: "repo-1",
  });
});

test("no memory, or none the workspace knows, is the board", () => {
  assert.equal(homeLanding([], index), null);
  assert.equal(homeLanding(["wt-gone"], index), null);
});
