import assert from "node:assert/strict";
import { test } from "node:test";
import { railGroups, statusClass, wallClock } from "./runModel.ts";

const ALL_STATUSES = [
  "draft",
  "provisioning",
  "ready",
  "running",
  "verifying",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];

function run(overrides) {
  return {
    id: "r-1",
    parent_run_id: null,
    objective: "do a thing",
    mode: "delegated",
    status: "draft",
    wall_limit_secs: null,
    wall_started_at: null,
    tokens_observed: 0,
    tokens_observed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("railGroups buckets every one of the 10 statuses exhaustively", () => {
  const runs = ALL_STATUSES.map((status, i) =>
    run({ id: `r-${i}`, status, updated_at: `2026-01-01T00:00:0${i}Z` }),
  );
  const { needsYou, live, recent } = railGroups(runs);

  const needsYouIds = new Set(needsYou.map((r) => r.id));
  const liveIds = new Set(live.map((r) => r.id));
  const recentIds = new Set(recent.map((r) => r.id));

  for (const r of runs) {
    const inNeedsYou = needsYouIds.has(r.id);
    const inLive = liveIds.has(r.id);
    const inRecent = recentIds.has(r.id);
    const bucketCount = [inNeedsYou, inLive, inRecent].filter(Boolean).length;
    assert.equal(
      bucketCount,
      1,
      `status ${r.status} must land in exactly one bucket, landed in ${bucketCount}`,
    );
  }

  assert.deepEqual(
    new Set(["paused", "blocked"]),
    new Set(runs.filter((r) => needsYouIds.has(r.id)).map((r) => r.status)),
  );
  assert.deepEqual(
    new Set(["running", "verifying", "provisioning", "ready"]),
    new Set(runs.filter((r) => liveIds.has(r.id)).map((r) => r.status)),
  );
  assert.deepEqual(
    new Set(["draft", "completed", "failed", "cancelled"]),
    new Set(runs.filter((r) => recentIds.has(r.id)).map((r) => r.status)),
  );
});

test("railGroups caps recent at newest 10", () => {
  const runs = Array.from({ length: 15 }, (_, i) =>
    run({
      id: `r-${i}`,
      status: "completed",
      updated_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }),
  );
  const { recent } = railGroups(runs);
  assert.equal(recent.length, 10);
  // newest first
  assert.equal(recent[0].id, "r-14");
});

test("statusClass is total over all 10 statuses", () => {
  for (const status of ALL_STATUSES) {
    const cls = statusClass(status);
    assert.ok(
      ["live", "ok", "attn", "stop", "muted"].includes(cls),
      `status ${status} -> ${cls}`,
    );
  }
});

test("wallClock is null when never started", () => {
  const r = run({
    status: "ready",
    wall_limit_secs: 60,
    wall_started_at: null,
  });
  assert.equal(wallClock(r, new Date("2026-01-01T00:01:00Z")), null);
});

test("wallClock reports exceeded exactly at the boundary", () => {
  const r = run({
    status: "running",
    wall_limit_secs: 60,
    wall_started_at: "2026-01-01T00:00:00Z",
  });

  const before = wallClock(r, new Date("2026-01-01T00:00:59Z"));
  assert.equal(before.exceeded, false);
  assert.equal(before.limitSecs, 60);
  assert.equal(before.spentSecs, 59);

  const atBoundary = wallClock(r, new Date("2026-01-01T00:01:00Z"));
  assert.equal(atBoundary.exceeded, true);
  assert.equal(atBoundary.spentSecs, 60);

  const noLimit = wallClock(
    run({ status: "running", wall_started_at: "2026-01-01T00:00:00Z" }),
    new Date("2026-01-01T00:05:00Z"),
  );
  assert.equal(noLimit.limitSecs, null);
  assert.equal(noLimit.exceeded, false);
});
