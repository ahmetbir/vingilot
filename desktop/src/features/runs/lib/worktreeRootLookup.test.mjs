// The worktree-root memo caches the directory, never the failure
// (`worktreeRootLookup.ts` — the close-request spec's harness is why).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resetWorktreeRootForTests,
  worktreeRootOnce,
} from "./worktreeRootLookup.ts";

test("a success is asked once and remembered", async () => {
  resetWorktreeRootForTests();
  let asked = 0;
  const lookup = () => {
    asked += 1;
    return Promise.resolve("/Users/captain/");
  };
  assert.equal(
    await worktreeRootOnce(lookup),
    "/Users/captain/.vingilot/worktrees",
  );
  assert.equal(
    await worktreeRootOnce(lookup),
    "/Users/captain/.vingilot/worktrees",
  );
  assert.equal(asked, 1);
});

test("a failure answers null and is retried on the next ask", async () => {
  // The defect this file exists for: a memo that held the failure answered a
  // remount from a pre-stub rejection, and no surface could ever resolve a
  // cwd again without an app restart.
  resetWorktreeRootForTests();
  let asked = 0;
  const lookup = () => {
    asked += 1;
    return asked === 1
      ? Promise.reject(new Error("transient"))
      : Promise.resolve("/tmp/home/");
  };
  assert.equal(await worktreeRootOnce(lookup), null);
  assert.equal(await worktreeRootOnce(lookup), "/tmp/home/.vingilot/worktrees");
  assert.equal(asked, 2);
});
