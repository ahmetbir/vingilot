import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSplitLayout,
  readSplitLayout,
  writeSplitLayout,
} from "./splitStore.ts";

function memory() {
  const held = new Map();
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, value),
  };
}

test("a layout round-trips through storage", () => {
  const storage = memory();
  const splits = { "wt#1": { direction: "right", ratio: 0.35 } };
  writeSplitLayout(splits, storage);
  assert.deepEqual(readSplitLayout(storage), splits);
});

test("missing, corrupt, or wrongly-shaped storage reads as no splits", () => {
  assert.deepEqual(parseSplitLayout(null), {});
  assert.deepEqual(parseSplitLayout(""), {});
  assert.deepEqual(parseSplitLayout("not json"), {});
  assert.deepEqual(parseSplitLayout("[1,2]"), {});
  assert.deepEqual(
    parseSplitLayout('{"wt#1":{"direction":"sideways","ratio":0.5}}'),
    {},
  );
});

test("a ratio outside the clamp is refused rather than repaired", () => {
  // A stored ratio this build would never write is corrupt storage; opening
  // a shell at zero pixels because of it is the failure being refused.
  assert.deepEqual(
    parseSplitLayout('{"wt#1":{"direction":"right","ratio":0.05}}'),
    {},
  );
  assert.deepEqual(
    parseSplitLayout('{"wt#1":{"direction":"down","ratio":1.5}}'),
    {},
  );
});

test("one bad entry does not take the good ones with it", () => {
  const parsed = parseSplitLayout(
    '{"wt#1":{"direction":"right","ratio":0.5},"":{"direction":"down","ratio":0.5},"wt#2":{"direction":"nope","ratio":0.5}}',
  );
  assert.deepEqual(parsed, { "wt#1": { direction: "right", ratio: 0.5 } });
});
