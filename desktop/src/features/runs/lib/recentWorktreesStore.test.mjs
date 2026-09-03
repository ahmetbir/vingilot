import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseRecent,
  readRecent,
  writeRecent,
} from "./recentWorktreesStore.ts";

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

test("the memory round-trips", () => {
  const storage = fakeStorage();
  writeRecent(["a", "b"], storage);
  assert.deepEqual(readRecent(storage), ["a", "b"]);
});

test("malformed or hand-edited storage reads as no memory, never half of one", () => {
  assert.deepEqual(parseRecent('["a", "", "a", 3]'), ["a"]);
  for (const raw of ["not json", "{}", "[1, 2]"]) {
    assert.deepEqual(parseRecent(raw), []);
  }
});

test("storage that throws is no memory, not a broken workspace", () => {
  const hostile = {
    getItem: () => {
      throw new Error("private mode");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.deepEqual(readRecent(hostile), []);
  writeRecent(["a"], hostile);
});
