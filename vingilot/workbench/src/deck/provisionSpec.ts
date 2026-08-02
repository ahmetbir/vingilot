// Pure builder for the Deck's provision request. No coordinator-client or
// React imports — colocated tests exercise it directly, and Deck.tsx is the
// only caller.

import type { ProvisionSpec } from "../api/coordinator.ts";

/** Builds the single task-worktree provision spec for a freshly created run.
 * The idempotency key is the run id itself: deterministic, so a retried
 * provision call for the same run is always the same request. Exactly one
 * write grant — the Deck starts a run against one repo target, not a
 * fan-out; multi-worktree provisioning is a later plan. */
export function buildProvisionSpec(runId: string): ProvisionSpec {
  return {
    worktrees: [
      {
        repo_id: "buzz",
        target_id: "local",
        role: "task",
        base_commit: "HEAD",
        access: "write",
        idempotency_key: runId,
      },
    ],
  };
}
