import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pendingFile,
  requestFile,
  resetFileTargets,
  shouldLand,
  subscribeFileTarget,
  takeFile,
} from "./filesTarget.ts";

const TARGET = { line: 42, path: "src/main.rs", worktree: "/w/one" };

test("a request reaches every subscriber, with the whole target", () => {
  resetFileTargets();
  const seen = [];
  const stop = subscribeFileTarget((request) => seen.push(request));
  requestFile(TARGET);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].worktree, "/w/one");
  assert.equal(seen[0].path, "src/main.rs");
  assert.equal(seen[0].line, 42);
  stop();
});

test("asking twice for the same file is two requests", () => {
  // He clicked the same search hit again. A value that only held the target
  // would make the second click do nothing, which is why `bump` exists.
  resetFileTargets();
  const seen = [];
  const stop = subscribeFileTarget((request) => seen.push(request.bump));
  requestFile(TARGET);
  requestFile(TARGET);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
  stop();
});

test("a request made before the pane exists is waiting for it", () => {
  // The sequence RunsScreen performs: file the target, THEN choose the pane.
  // The pane mounts afterwards and reads what is pending.
  resetFileTargets();
  requestFile(TARGET);
  const pending = pendingFile();
  assert.equal(pending.path, "src/main.rs");
  const taken = takeFile();
  assert.equal(taken.path, "src/main.rs");
  // Consumed: remounting the pane must not re-open a file he has since
  // navigated away from.
  assert.equal(pendingFile(), null);
  assert.equal(takeFile(), null);
});

test("an unsubscribed listener stops being told", () => {
  resetFileTargets();
  let count = 0;
  const stop = subscribeFileTarget(() => {
    count += 1;
  });
  requestFile(TARGET);
  stop();
  requestFile(TARGET);
  assert.equal(count, 1);
});

test("a listener that throws does not stop the others, or the caller", () => {
  // The pane reports its own failures; a subscriber's must not take down the
  // click that led here.
  resetFileTargets();
  const stopBad = subscribeFileTarget(() => {
    throw new Error("boom");
  });
  let reached = false;
  const stopGood = subscribeFileTarget(() => {
    reached = true;
  });
  requestFile(TARGET);
  assert.equal(reached, true);
  stopBad();
  stopGood();
});

test("a line of null is the top of the file, and is carried as null", () => {
  // Not "line 1 emphasised": a file opened from the tree has no interesting
  // line, and inventing one would mark a row he did not ask about.
  resetFileTargets();
  const request = requestFile({ line: null, path: "a.md", worktree: "/w" });
  assert.equal(request.line, null);
});

test("a target for another checkout is not this pane's to land", () => {
  // The branch a single-worktree fixture can never reach, and the one that
  // matters: two checkouts of one project both have `src/main.rs`, so landing
  // on the wrong one silently would be worse than not landing at all. This is
  // exactly what Task 2's search results will produce.
  assert.equal(shouldLand(TARGET, "/w/one"), true);
  assert.equal(shouldLand(TARGET, "/w/two"), false);
  // A near miss is a miss: a prefix is a different directory, not this one.
  assert.equal(shouldLand(TARGET, "/w/one-old"), false);
  assert.equal(shouldLand(TARGET, "/w"), false);
});

test("a pane whose checkout has not resolved lands on nothing", () => {
  // `null` is "no answer", never a wildcard — a pane that took every target
  // while it still could not name its own directory would open a file from
  // whichever worktree asked first.
  assert.equal(shouldLand(TARGET, null), false);
});

test("the reset drops everything, which is the community-switch rule", () => {
  // A module-level value survives React remounting. A target naming a
  // worktree from the community just left must not be waiting when the next
  // one's Files pane mounts.
  let told = 0;
  const stop = subscribeFileTarget(() => {
    told += 1;
  });
  requestFile(TARGET);
  resetFileTargets();
  assert.equal(pendingFile(), null);
  requestFile(TARGET);
  assert.equal(told, 1, "a listener from before the reset is not told again");
  stop();
  resetFileTargets();
});
