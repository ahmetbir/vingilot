import assert from "node:assert/strict";
import { test } from "node:test";
import { unreachableView } from "./reachability.ts";

const T0 = new Date("2026-08-03T12:00:00.000Z");

test("unreachableView: reachable is nothing to render", () => {
  assert.equal(unreachableView(true, T0, T0, 2000), null);
});

test("unreachableView: reachable but since unknown (shouldn't happen, but null-safe)", () => {
  assert.equal(unreachableView(false, null, T0, 2000), null);
});

test("unreachableView: at the moment it flips, a full interval remains", () => {
  const v = unreachableView(false, T0, T0, 2000);
  assert.deepEqual(v, { since: T0, nextRetrySecs: 2 });
});

test("unreachableView: mid-interval countdown rounds up to the next whole second", () => {
  const now = new Date(T0.getTime() + 500);
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.nextRetrySecs, 2); // 1500ms remaining -> ceil(1.5) = 2
});

test("unreachableView: countdown wraps across interval boundaries", () => {
  const now = new Date(T0.getTime() + 2500); // one full interval + 500ms
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.nextRetrySecs, 2);
});

test("unreachableView: just under a tick boundary", () => {
  const now = new Date(T0.getTime() + 1999);
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.nextRetrySecs, 1);
});

test("unreachableView: since is carried through unchanged", () => {
  const now = new Date(T0.getTime() + 10_000);
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.since, T0);
});
