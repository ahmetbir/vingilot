import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetView, legalNext } from "./budget.ts";

// The exact legal-edge set from the coordinator's domain.rs `LEGAL_EDGES`
// (ADR-002 §Run transitions) — kept as a literal copy here so a change to
// either side without the other breaks this test, mirroring the Rust
// exhaustive sweep test in coordinator/coordinator/src/domain.rs.
const LEGAL_EDGES = [
  ["draft", "provisioning"],
  ["draft", "cancelled"],
  ["provisioning", "ready"],
  ["provisioning", "failed"],
  ["provisioning", "cancelled"],
  ["ready", "running"],
  ["ready", "cancelled"],
  ["running", "verifying"],
  ["running", "paused"],
  ["running", "blocked"],
  ["running", "failed"],
  ["running", "cancelled"],
  ["verifying", "completed"],
  ["verifying", "running"],
  ["verifying", "blocked"],
  ["verifying", "failed"],
  ["verifying", "cancelled"],
  ["paused", "running"],
  ["paused", "failed"],
  ["paused", "cancelled"],
  ["blocked", "running"],
  ["blocked", "failed"],
  ["blocked", "cancelled"],
];

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

test("legalNext: exhaustive over every status matches the domain table exactly", () => {
  for (const from of ALL_STATUSES) {
    const expected = LEGAL_EDGES.filter(([f]) => f === from)
      .map(([, to]) => to)
      .sort();
    const actual = [...legalNext(from)].sort();
    assert.deepEqual(actual, expected, `legalNext(${from})`);
  }
});

test("legalNext: terminal states have no legal edges", () => {
  assert.deepEqual(legalNext("completed"), []);
  assert.deepEqual(legalNext("failed"), []);
  assert.deepEqual(legalNext("cancelled"), []);
});

function run(overrides) {
  return {
    id: "r1",
    parent_run_id: null,
    objective: "obj",
    mode: "delegated",
    status: "running",
    wall_limit_secs: null,
    wall_started_at: null,
    tokens_observed: 0,
    tokens_observed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("budgetView: never-started run has no wall meter at all", () => {
  const now = new Date("2026-01-01T00:01:00Z");
  const view = budgetView(run({ wall_started_at: null }), now);
  assert.equal(view.wall, null);
});

test("budgetView: null tokens_observed_at renders no tokens meter — a capability with no data renders nothing, not zero", () => {
  const now = new Date("2026-01-01T00:01:00Z");
  const view = budgetView(
    run({ tokens_observed_at: null, tokens_observed: 0 }),
    now,
  );
  assert.equal(view.tokens, null);
});

test("budgetView: wall meter reports elapsed/limit and clamps pct at the boundary", () => {
  const startedAt = "2026-01-01T00:00:00Z";
  const atCap = new Date("2026-01-01T00:01:00Z"); // exactly 60s later
  const view = budgetView(
    run({ wall_started_at: startedAt, wall_limit_secs: 60 }),
    atCap,
  );
  assert.ok(view.wall !== null);
  assert.equal(view.wall.pct, 1);
  assert.equal(view.wall.label, "60s / 60s");
});

test("budgetView: wall meter past the cap stays clamped at 1, never overflows", () => {
  const startedAt = "2026-01-01T00:00:00Z";
  const wayPast = new Date("2026-01-01T00:05:00Z");
  const view = budgetView(
    run({ wall_started_at: startedAt, wall_limit_secs: 60 }),
    wayPast,
  );
  assert.equal(view.wall.pct, 1);
});

test("budgetView: unlimited wall clock (no cap) still renders elapsed time with 0 pct", () => {
  const startedAt = "2026-01-01T00:00:00Z";
  const later = new Date("2026-01-01T00:00:30Z");
  const view = budgetView(
    run({ wall_started_at: startedAt, wall_limit_secs: null }),
    later,
  );
  assert.ok(view.wall !== null);
  assert.equal(view.wall.pct, 0);
  assert.equal(view.wall.label, "30s");
});

test("budgetView: tokens meter renders once an observation has landed, prefixed for the ≈ estimate", () => {
  const observedAt = "2026-01-01T00:00:50Z";
  const now = new Date("2026-01-01T00:01:00Z");
  const view = budgetView(
    run({ tokens_observed: 4200, tokens_observed_at: observedAt }),
    now,
  );
  assert.ok(view.tokens !== null);
  assert.match(view.tokens.label, /^≈/);
  assert.match(view.tokens.label, /4200/);
});
