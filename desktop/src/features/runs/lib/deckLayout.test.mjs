import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deviceId,
  layoutKey,
  readLayout,
  writeLayout,
  applyLayout,
  moveInLayout,
} from "./deckLayout.ts";

// A minimal in-memory storage shim standing in for `localStorage` — these
// tests run under plain node (no DOM), so every storage-touching function
// takes it as an explicit optional param rather than reaching for
// `globalThis.localStorage`.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test("deviceId: stable across repeated calls against the same storage", () => {
  const storage = makeStorage();
  const first = deviceId(storage);
  const second = deviceId(storage);
  assert.equal(first, second);
});

test("deviceId: differs across independent storages", () => {
  const a = deviceId(makeStorage());
  const b = deviceId(makeStorage());
  assert.notEqual(a, b);
});

test("layoutKey: includes both workspace and device id", () => {
  const storage = makeStorage();
  const id = deviceId(storage);
  const key = layoutKey("workspace-1", storage);
  assert.match(key, /workspace-1/);
  assert.match(key, new RegExp(id));
});

test("layoutKey: differs across workspaces for the same device", () => {
  const storage = makeStorage();
  const keyA = layoutKey("workspace-a", storage);
  const keyB = layoutKey("workspace-b", storage);
  assert.notEqual(keyA, keyB);
});

test("readLayout: no stored value → []", () => {
  const storage = makeStorage();
  assert.deepEqual(readLayout("workspace-1", storage), []);
});

test("writeLayout then readLayout round-trips the order", () => {
  const storage = makeStorage();
  writeLayout("workspace-1", ["a", "b", "c"], storage);
  assert.deepEqual(readLayout("workspace-1", storage), ["a", "b", "c"]);
});

test("readLayout: corrupt stored JSON → []", () => {
  const storage = makeStorage();
  const key = layoutKey("workspace-1", storage);
  storage.setItem(key, "not-json{{{");
  assert.deepEqual(readLayout("workspace-1", storage), []);
});

test("readLayout: stored value not an array of strings → []", () => {
  const storage = makeStorage();
  const key = layoutKey("workspace-1", storage);
  storage.setItem(key, JSON.stringify({ nope: true }));
  assert.deepEqual(readLayout("workspace-1", storage), []);
});

test("writeLayout scopes to workspace — a different workspace on the same device stays empty", () => {
  const storage = makeStorage();
  writeLayout("workspace-1", ["a"], storage);
  assert.deepEqual(readLayout("workspace-2", storage), []);
});

const pin = (id, pinnedAt) => ({ id, kind: "run", pinnedAt });

test("applyLayout: splits placed/unplaced, placed follows order's sequence", () => {
  const pins = [
    pin("a", "2026-08-04T10:00:00Z"),
    pin("b", "2026-08-04T10:01:00Z"),
    pin("c", "2026-08-04T10:02:00Z"),
  ];
  const order = ["c", "a"]; // deliberately not pin insertion order
  const { placed, unplaced } = applyLayout(pins, order);
  assert.deepEqual(placed, [
    pin("c", "2026-08-04T10:02:00Z"),
    pin("a", "2026-08-04T10:00:00Z"),
  ]);
  assert.deepEqual(unplaced, [pin("b", "2026-08-04T10:01:00Z")]);
});

test("applyLayout: unplaced pins are appended in pinnedAt order", () => {
  const pins = [
    pin("late", "2026-08-04T12:00:00Z"),
    pin("early", "2026-08-04T09:00:00Z"),
    pin("mid", "2026-08-04T10:30:00Z"),
  ];
  const order = [];
  const { placed, unplaced } = applyLayout(pins, order);
  assert.deepEqual(placed, []);
  assert.deepEqual(
    unplaced.map((p) => p.id),
    ["early", "mid", "late"],
  );
});

test("applyLayout: order entries with no matching pin are ignored", () => {
  const pins = [pin("a", "2026-08-04T10:00:00Z")];
  const order = ["ghost", "a"];
  const { placed, unplaced } = applyLayout(pins, order);
  assert.deepEqual(placed, [pin("a", "2026-08-04T10:00:00Z")]);
  assert.deepEqual(unplaced, []);
});

test("applyLayout: empty pins → empty placed and unplaced regardless of order", () => {
  assert.deepEqual(applyLayout([], ["a", "b"]), { placed: [], unplaced: [] });
});

test("moveInLayout: first item move-left is unchanged", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveInLayout(order, "a", -1), ["a", "b", "c"]);
});

test("moveInLayout: last item move-right is unchanged", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveInLayout(order, "c", 1), ["a", "b", "c"]);
});

test("moveInLayout: middle item moves left", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveInLayout(order, "b", -1), ["b", "a", "c"]);
});

test("moveInLayout: middle item moves right", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveInLayout(order, "b", 1), ["a", "c", "b"]);
});

test("moveInLayout: id absent from order → unchanged (new array, same contents)", () => {
  const order = ["a", "b", "c"];
  const result = moveInLayout(order, "zzz", 1);
  assert.deepEqual(result, order);
});
