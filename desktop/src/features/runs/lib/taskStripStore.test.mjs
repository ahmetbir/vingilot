import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTaskLayout,
  readTaskLayout,
  writeTaskLayout,
} from "./taskStripStore.ts";

function memory() {
  const held = new Map();
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, value),
  };
}

const GOOD = {
  "local:wt-1": {
    groups: [
      { active: 1, id: 1, name: "task 1", tabs: [1, 3] },
      { active: 2, id: 2, name: "task 2", tabs: [2] },
    ],
    nextId: 3,
  },
};

test("a layout round-trips through storage", () => {
  const storage = memory();
  writeTaskLayout(GOOD, storage);
  assert.deepEqual(readTaskLayout(storage), GOOD);
});

test("missing or corrupt storage reads as no tasks", () => {
  assert.deepEqual(parseTaskLayout(null), {});
  assert.deepEqual(parseTaskLayout("nope"), {});
  assert.deepEqual(parseTaskLayout("[1]"), {});
});

test("a strip that fails its own invariants is dropped whole", () => {
  // Duplicate group ids, an active outside the group, an id at nextId — each
  // is storage this build never writes, and a strip half-believed is worse
  // than a strip re-derived from the tab layout (`reconcileTasks`).
  for (const bad of [
    { groups: [{ active: 9, id: 1, name: "t", tabs: [1] }], nextId: 2 },
    {
      groups: [
        { active: 1, id: 1, name: "t", tabs: [1] },
        { active: 2, id: 1, name: "t", tabs: [2] },
      ],
      nextId: 2,
    },
    { groups: [{ active: 1, id: 2, name: "t", tabs: [1] }], nextId: 2 },
    { groups: [{ active: 1, id: 1, name: "", tabs: [1] }], nextId: 2 },
  ]) {
    assert.deepEqual(parseTaskLayout(JSON.stringify({ wt: bad })), {});
  }
});
