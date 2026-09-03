import assert from "node:assert/strict";
import { test } from "node:test";

import { readTabSplits, writeTabSplits } from "./tabSplitStore.ts";

/** A `localStorage` that is only a Map, so a test can read what was really
 * written rather than what the writer believed it wrote. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    read: (key) => map.get(key) ?? null,
  };
}

const KEY = "vingilot-tab-split.v1";

test("a split of two terminals survives, because a pty does", () => {
  const storage = fakeStorage();
  writeTabSplits(
    { wt: { focus: "right", ratio: 0.5, secondary: "term:3" } },
    storage,
  );
  assert.deepEqual(readTabSplits(storage), {
    wt: { focus: "right", ratio: 0.5, secondary: "term:3" },
  });
});

test("a split holding a reading is not written at all", () => {
  // The reason `tabSplit.ts` refused persistence in the first place: a file or
  // a patch restored from disk is last week's reading wearing a live tab's
  // chrome, and its id may name nothing at all.
  const storage = fakeStorage();
  writeTabSplits(
    { wt: { focus: "left", ratio: 0.5, secondary: "view:diff-abc123" } },
    storage,
  );
  assert.equal(storage.read(KEY), "{}");
  assert.deepEqual(readTabSplits(storage), {});
});

test("and one written by another build is dropped on the way in", () => {
  // Both sides filter on purpose. Writing only terminals keeps a reading out
  // of storage; dropping non-terminals on read keeps a hand-edited record, or
  // one from a build that wrote everything, from putting one back.
  const storage = fakeStorage({
    [KEY]: JSON.stringify({
      keeps: { focus: "left", ratio: 0.4, secondary: "term:1" },
      stale: { focus: "left", ratio: 0.5, secondary: "view:gone" },
    }),
  });
  assert.deepEqual(readTabSplits(storage), {
    keeps: { focus: "left", ratio: 0.4, secondary: "term:1" },
  });
});

test("a stored ratio lands inside the same clamp a dragged one does", () => {
  const storage = fakeStorage({
    [KEY]: JSON.stringify({
      wide: { focus: "left", ratio: 0.99, secondary: "term:1" },
      thin: { focus: "left", ratio: 0.01, secondary: "term:2" },
    }),
  });
  const layout = readTabSplits(storage);
  assert.equal(layout.wide.ratio, 0.8);
  assert.equal(layout.thin.ratio, 0.2);
});

test("unreadable storage is no splits, not a broken workspace", () => {
  const hostile = {
    getItem: () => {
      throw new Error("private mode");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.deepEqual(readTabSplits(hostile), {});
  // And the write swallows its own failure: losing the arrangement is
  // survivable, failing the render that produced it is not.
  writeTabSplits(
    { wt: { focus: "left", ratio: 0.5, secondary: "term:1" } },
    hostile,
  );
});

test("malformed records answer with no splits rather than half of one", () => {
  for (const raw of ["not json", "[]", '{"wt":null}', '{"wt":{"ratio":0.5}}']) {
    assert.deepEqual(readTabSplits(fakeStorage({ [KEY]: raw })), {});
  }
});
