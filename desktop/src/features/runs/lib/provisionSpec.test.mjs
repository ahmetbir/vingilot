import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProvisionSpec } from "./provisionSpec.ts";

test("buildProvisionSpec produces exactly one write grant", () => {
  const spec = buildProvisionSpec("run-1");
  assert.equal(spec.worktrees.length, 1);
  assert.equal(spec.worktrees[0].access, "write");
});

test("buildProvisionSpec's idempotency key is deterministic on the run id", () => {
  const a = buildProvisionSpec("run-abc");
  const b = buildProvisionSpec("run-abc");
  assert.equal(a.worktrees[0].idempotency_key, b.worktrees[0].idempotency_key);
  assert.equal(a.worktrees[0].idempotency_key, "run-abc");
});

test("buildProvisionSpec targets a single task worktree, keyed per run id", () => {
  const a = buildProvisionSpec("run-a");
  const b = buildProvisionSpec("run-b");
  assert.notEqual(
    a.worktrees[0].idempotency_key,
    b.worktrees[0].idempotency_key,
  );
  assert.equal(a.worktrees[0].repo_id, "buzz");
  assert.equal(a.worktrees[0].target_id, "local");
  assert.equal(a.worktrees[0].role, "task");
});
