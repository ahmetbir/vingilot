// Domain types + pure view logic shared by the Runs screen's list, deck, and
// run detail views. No coordinator-client or React imports here — this
// module is the thing coordinatorClient.ts and every UI component agree on.
//
// Ported verbatim from vingilot/workbench/src/model/run.ts (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

export type RunStatus =
  | "draft"
  | "provisioning"
  | "ready"
  | "running"
  | "verifying"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type RunMode = "interactive" | "delegated" | "chat";

export interface RunSummary {
  id: string;
  parent_run_id: string | null;
  objective: string;
  mode: RunMode;
  status: RunStatus;
  wall_limit_secs: number | null;
  wall_started_at: string | null;
  tokens_observed: number;
  tokens_observed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunGrant {
  binding_id: string;
  access: string;
}

export interface RunTransition {
  seq: number;
  from_status: string;
  to_status: string;
  reason: string;
  created_at: string;
}

export interface RunDetail extends RunSummary {
  workspace_id: string;
  grants: RunGrant[];
  transitions: RunTransition[];
}

const NEEDS_YOU: ReadonlySet<RunStatus> = new Set(["paused", "blocked"]);
const LIVE: ReadonlySet<RunStatus> = new Set([
  "running",
  "verifying",
  "provisioning",
  "ready",
]);
// Everything else (draft, completed, failed, cancelled) is "recent" — the
// bucketing below is exhaustive by construction: every status not in
// NEEDS_YOU or LIVE falls through to recent.

const RECENT_CAP = 10;

/** Groups runs for the list. Exhaustive over every RunStatus by construction:
 * anything not in NEEDS_YOU or LIVE falls into "recent". */
export function railGroups(runs: RunSummary[]): {
  needsYou: RunSummary[];
  live: RunSummary[];
  recent: RunSummary[];
} {
  const needsYou: RunSummary[] = [];
  const live: RunSummary[] = [];
  const recentAll: RunSummary[] = [];

  for (const r of runs) {
    if (NEEDS_YOU.has(r.status)) needsYou.push(r);
    else if (LIVE.has(r.status)) live.push(r);
    else recentAll.push(r);
  }

  const byNewest = (a: RunSummary, b: RunSummary) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();

  return {
    needsYou: [...needsYou].sort(byNewest),
    live: [...live].sort(byNewest),
    recent: [...recentAll].sort(byNewest).slice(0, RECENT_CAP),
  };
}

export type SemanticClass = "live" | "ok" | "attn" | "stop" | "muted";

/** Total map from RunStatus to the one semantic hue it is allowed to use. */
export function statusClass(s: RunStatus): SemanticClass {
  switch (s) {
    case "running":
    case "verifying":
      return "live";
    case "completed":
      return "ok";
    case "paused":
    case "blocked":
      return "attn";
    case "failed":
    case "cancelled":
      return "stop";
    case "draft":
    case "provisioning":
    case "ready":
      return "muted";
  }
}

export interface WallClock {
  spentSecs: number;
  limitSecs: number | null;
  exceeded: boolean;
}

/** Null when the run has never started (nothing to render — a capability
 * with no data renders nothing, not zero). */
export function wallClock(r: RunSummary, now: Date): WallClock | null {
  if (r.wall_started_at === null) return null;
  const startedMs = new Date(r.wall_started_at).getTime();
  const spentSecs = Math.max(0, Math.floor((now.getTime() - startedMs) / 1000));
  const limitSecs = r.wall_limit_secs;
  const exceeded = limitSecs !== null && spentSecs >= limitSecs;
  return { spentSecs, limitSecs, exceeded };
}
