import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readPins,
  withPin,
  withoutPin,
  pinsDiff,
  isRenderableKind,
} from "./deckPins.ts";

test("readPins: null state → []", () => {
  assert.deepEqual(readPins(null), []);
});

test("readPins: empty object → []", () => {
  assert.deepEqual(readPins({}), []);
});

test("readPins: deck.pins not an array → []", () => {
  assert.deepEqual(readPins({ deck: { pins: "nope" } }), []);
});

test("readPins: an element missing kind is dropped, never throws", () => {
  const state = {
    deck: {
      pins: [
        { id: "run-1", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
        { id: "run-2", pinnedAt: "2026-08-04T10:01:00Z" }, // missing kind
        { id: "run-3", kind: "run" }, // missing pinnedAt
        "not-an-object",
        null,
        42,
      ],
    },
  };
  assert.deepEqual(readPins(state), [
    { id: "run-1", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
  ]);
});

test("readPins: valid multi-entry array parses in order", () => {
  const state = {
    deck: {
      pins: [
        { id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
        { id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" },
      ],
    },
  };
  assert.deepEqual(readPins(state), [
    { id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
    { id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" },
  ]);
});

test("readPins: never throws on arbitrary garbage shapes", () => {
  assert.deepEqual(readPins(undefined), []);
  assert.deepEqual(readPins("string"), []);
  assert.deepEqual(readPins(42), []);
  assert.deepEqual(readPins([1, 2, 3]), []);
  assert.deepEqual(readPins({ deck: null }), []);
  assert.deepEqual(readPins({ deck: "nope" }), []);
});

test("withPin: pinning a fresh id appends it", () => {
  const pins = [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }];
  const result = withPin(pins, {
    id: "b",
    kind: "run",
    pinnedAt: "2026-08-04T10:01:00Z",
  });
  assert.deepEqual(result, [
    { id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
    { id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" },
  ]);
});

test("withPin: idempotent — pinning twice keeps one entry with the first pinnedAt", () => {
  const pins = [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }];
  const result = withPin(pins, {
    id: "a",
    kind: "run",
    pinnedAt: "2026-08-04T11:00:00Z",
  });
  assert.deepEqual(result, [
    { id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
  ]);
});

test("withoutPin: removes the matching id, leaves others untouched", () => {
  const pins = [
    { id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
    { id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" },
  ];
  assert.deepEqual(withoutPin(pins, "a"), [
    { id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" },
  ]);
});

test("withoutPin: id absent → unchanged (new array, same contents)", () => {
  const pins = [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }];
  assert.deepEqual(withoutPin(pins, "zzz"), pins);
});

test("pinsDiff: disjoint sets — everything mine is removed, everything theirs is added", () => {
  const mine = [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }];
  const theirs = [{ id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" }];
  assert.deepEqual(pinsDiff(mine, theirs), {
    added: [{ id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" }],
    removed: [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }],
  });
});

test("pinsDiff: overlapping sets — shared ids appear in neither list", () => {
  const mine = [
    { id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
    { id: "shared", kind: "run", pinnedAt: "2026-08-04T10:02:00Z" },
  ];
  const theirs = [
    { id: "shared", kind: "run", pinnedAt: "2026-08-04T10:02:00Z" },
    { id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" },
  ];
  assert.deepEqual(pinsDiff(mine, theirs), {
    added: [{ id: "b", kind: "run", pinnedAt: "2026-08-04T10:01:00Z" }],
    removed: [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }],
  });
});

test("pinsDiff: identical sets → both empty", () => {
  const pins = [{ id: "a", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" }];
  assert.deepEqual(pinsDiff(pins, pins), { added: [], removed: [] });
});

// Audit finding: a pin kind this client cannot render must still SURVIVE a
// read/write round-trip. syncPins writes the whole array back, so dropping an
// unknown kind on read deletes it from shared workspace state — silent data
// loss dressed up as tolerance.
test("readPins preserves pin kinds this client cannot render", () => {
  const state = {
    deck: {
      pins: [
        { id: "r1", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
        { id: "p9", kind: "pr", pinnedAt: "2026-08-04T11:00:00Z" },
        { id: "s3", kind: "surface", pinnedAt: "2026-08-04T12:00:00Z" },
      ],
    },
  };
  const pins = readPins(state);
  assert.deepEqual(
    pins.map((p) => p.id),
    ["r1", "p9", "s3"],
    "a future kind must round-trip, not be dropped",
  );
  assert.equal(isRenderableKind("run"), true);
  assert.equal(isRenderableKind("pr"), false);
});

test("readPins still rejects genuinely malformed pins", () => {
  const state = {
    deck: {
      pins: [
        { id: "ok", kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
        { id: "no-kind", pinnedAt: "2026-08-04T10:00:00Z" },
        { id: "empty-kind", kind: "", pinnedAt: "2026-08-04T10:00:00Z" },
        { kind: "run", pinnedAt: "2026-08-04T10:00:00Z" },
        { id: "no-date", kind: "run" },
      ],
    },
  };
  assert.deepEqual(
    readPins(state).map((p) => p.id),
    ["ok"],
  );
});
