import assert from "node:assert/strict";
import { test } from "node:test";
import { readOpenSessions, writeOpenSessions } from "./openSessions.ts";

test("nothing is open before anything is written", () => {
  assert.deepEqual(readOpenSessions(), []);
});

test("the open set outlives the reader that wrote it", () => {
  // The point of the module: RunsScreen unmounts on every route change away
  // from /runs, and the next mount has to pick this list back up or the
  // shells it opened can never be matched against the workspace again.
  writeOpenSessions(["main:repo-a", "wt-7"]);
  assert.deepEqual(readOpenSessions(), ["main:repo-a", "wt-7"]);
});

test("a write replaces the set rather than merging into it", () => {
  writeOpenSessions(["main:repo-a", "wt-7"]);
  writeOpenSessions(["main:repo-a"]);
  assert.deepEqual(readOpenSessions(), ["main:repo-a"]);
});
