import assert from "node:assert/strict";
import test from "node:test";

import { stageTabPath, tabsToClose } from "./tabMenu.ts";

const ORDER = ["term:1", "term:2", "view:file:src/main.rs", "view:history"];

test("the three close scopes are one function on the row the owner sees", () => {
  assert.deepEqual(tabsToClose(ORDER, "term:2", "this"), ["term:2"]);
  assert.deepEqual(tabsToClose(ORDER, "term:2", "others"), [
    "term:1",
    "view:file:src/main.rs",
    "view:history",
  ]);
  assert.deepEqual(tabsToClose(ORDER, "term:2", "right"), [
    "view:file:src/main.rs",
    "view:history",
  ]);
  // The rightmost tab has nothing to its right, which is the honest answer
  // rather than a disabled row that reads as broken.
  assert.deepEqual(tabsToClose(ORDER, "view:history", "right"), []);
  // A target that is not in the row names nothing at all.
  assert.deepEqual(tabsToClose(ORDER, "term:9", "others"), []);
});

test("copy path copies what the tab is a view OF", () => {
  const cwd = "/Users/x/code/repo";
  // A file: the checkout joined to the worktree-relative path, because a bare
  // `src/main.rs` pasted into a shell elsewhere is a path to nothing.
  assert.equal(
    stageTabPath(cwd, { kind: "file", line: 40, path: "src/main.rs" }),
    "/Users/x/code/repo/src/main.rs",
  );
  // A trailing slash on the checkout must not double.
  assert.equal(
    stageTabPath("/Users/x/code/repo/", {
      kind: "file",
      line: null,
      path: "src/main.rs",
    }),
    "/Users/x/code/repo/src/main.rs",
  );
  // A commit is its full hash — what `git show` takes, not the label's
  // abbreviation.
  assert.equal(
    stageTabPath(cwd, {
      hash: "abc123def456",
      kind: "commit",
      short: "abc123d",
    }),
    "abc123def456",
  );
  // The worktree diff is the ref it is a diff against.
  assert.equal(
    stageTabPath(cwd, { base: "origin/main", kind: "diff" }),
    "origin/main",
  );
  // History and every shell are simply here.
  assert.equal(stageTabPath(cwd, { kind: "history" }), cwd);
  assert.equal(stageTabPath(cwd, null), cwd);
});

test("a worktree with no directory has nothing to copy, and says so", () => {
  // Never the empty string: pasting nothing reads as "it worked".
  assert.equal(stageTabPath(null, null), null);
  assert.equal(stageTabPath(null, { kind: "history" }), null);
  // A file still has its own relative path, which is better than nothing.
  assert.equal(
    stageTabPath(null, { kind: "file", line: null, path: "src/main.rs" }),
    "src/main.rs",
  );
});
