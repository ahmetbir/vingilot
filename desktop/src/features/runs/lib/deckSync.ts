// deckSync: the first UI-driven exercise of ADR-002's CAS mutation
// protocol (vingilot/docs/plans/2026-08-04-deck-phase-3.md, "Why now").
// This is a thin, pure-ish orchestrator — no React, no localStorage — that
// does exactly three things in order: read the workspace's current pin set
// and revision, compute the next pin set from it, and write that pin set
// back gated on the revision it read. `expected_revision` is always the
// revision this module just read; a write that omits it is the bug this
// whole plan exists to prevent.
//
// A 409 (someone else wrote first) is never retried blindly — it is
// surfaced as a `conflict` result carrying the winner's revision, state
// hash, and pin set (fetched with one follow-up `GET`, per the plan's
// "Architecture" section), so the caller can render an honest conflict UX
// instead of silently overwriting or looping.

import { getWorkspace, putDeckPins } from "./coordinatorClient.ts";
import { readPins, type Pin } from "./deckPins.ts";

export interface DeckSyncOpts {
  baseUrl?: string;
}

export type DeckSyncResult =
  | { kind: "ok"; revision: number; pins: Pin[] }
  | { kind: "conflict"; revision: number; stateHash: string; theirs: Pin[] }
  | { kind: "unreachable" }
  | { kind: "api"; status: number; error: string; detail: string };

/** Reads the current pin set for `workspaceId`, applies `next` to compute
 * the pin set to write, and writes it through the CAS mutation endpoint
 * with the revision that was just read. Never throws — every failure mode
 * (network-unreachable, API error, CAS conflict) comes back as a typed
 * `DeckSyncResult` for the caller to branch on. */
export async function syncPins(
  workspaceId: string,
  next: (current: Pin[]) => Pin[],
  opts?: DeckSyncOpts,
): Promise<DeckSyncResult> {
  const current = await getWorkspace(workspaceId, opts);
  if (!current.ok) return toUnexpectedResult(current);

  const nextPins = next(readPins(current.value.state));

  const write = await putDeckPins(
    workspaceId,
    current.value.revision,
    nextPins,
    opts,
  );

  if (write.ok) {
    return { kind: "ok", revision: write.value.revision, pins: nextPins };
  }

  if (write.kind !== "conflict") return toUnexpectedResult(write);

  // Stale write: the mutation response doesn't carry the winner's state, so
  // read it fresh rather than guessing at what changed.
  const winner = await getWorkspace(workspaceId, opts);
  if (!winner.ok) return toUnexpectedResult(winner);

  return {
    kind: "conflict",
    revision: winner.value.revision,
    stateHash: winner.value.state_hash,
    theirs: readPins(winner.value.state),
  };
}

function toUnexpectedResult(result: {
  ok: false;
  kind: "conflict" | "unreachable" | "api";
  error?: string;
  detail?: string;
  status?: number;
}): DeckSyncResult {
  if (result.kind === "unreachable") return { kind: "unreachable" };
  if (result.kind === "api") {
    return {
      kind: "api",
      status: result.status ?? 0,
      error: result.error ?? "unknown_error",
      detail: result.detail ?? "",
    };
  }
  // A conflict surfacing here means the *read* (not the write) came back
  // 409, which the coordinator's GET never returns — treat defensively as
  // an API error rather than silently dropping it.
  return {
    kind: "api",
    status: 409,
    error: result.error ?? "unexpected_conflict",
    detail: result.detail ?? "",
  };
}
