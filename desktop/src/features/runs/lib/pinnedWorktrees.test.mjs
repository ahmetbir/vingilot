import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePinned, togglePinned } from "./pinnedWorktrees.ts";

test("pressing the pin adds at the end, pressing it again removes", () => {
  assert.deepEqual(togglePinned([], "a"), ["a"]);
  assert.deepEqual(togglePinned(["a"], "b"), ["a", "b"]);
  assert.deepEqual(togglePinned(["a", "b"], "a"), ["b"]);
});

test("storage that is not a list of distinct names is no pins", () => {
  assert.deepEqual(parsePinned('["a", "", "a", 3, "b"]'), ["a", "b"]);
  for (const raw of [null, undefined, "", "{}", "nope", "[1]"]) {
    assert.deepEqual(parsePinned(raw), []);
  }
});
