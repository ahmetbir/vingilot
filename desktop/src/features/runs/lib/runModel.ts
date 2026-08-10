// Domain types + pure view logic shared by the Projects screen's list, deck, and
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

export type EvidenceKind =
  | "command"
  | "output"
  | "error"
  | "note"
  | "diff"
  | "commit";

export interface EvidenceRow {
  seq: number;
  kind: EvidenceKind;
  content: string;
  created_at: string;
}

/** Rows shown at once in the Evidence pane before a truncation marker takes
 * over. Chosen to match the executor's own per-command chunking headroom
 * (Task 2/3), not any UI constraint. */
export const EVIDENCE_DISPLAY_CAP = 200;

export interface EvidenceViewModel {
  /** Display order: oldest first, newest last — matches the executor's
   * append order (seq ascending), which is also read-time chronological. */
  rows: EvidenceRow[];
  /** Count of earlier rows dropped to respect EVIDENCE_DISPLAY_CAP. Zero
   * means nothing was truncated. */
  truncatedCount: number;
}

/** Pure render-model for the Evidence pane: orders rows oldest-to-newest by
 * seq, then caps the display to the newest EVIDENCE_DISPLAY_CAP rows,
 * reporting how many earlier rows were dropped. */
export function evidenceView(rows: EvidenceRow[]): EvidenceViewModel {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  if (sorted.length <= EVIDENCE_DISPLAY_CAP) {
    return { rows: sorted, truncatedCount: 0 };
  }
  const truncatedCount = sorted.length - EVIDENCE_DISPLAY_CAP;
  return { rows: sorted.slice(truncatedCount), truncatedCount };
}

/** What a run's status says about the owner's attention, and the only place
 * that says it. The run rail groups by this and `attentionSignal.ts` derives
 * the worktree dot from it; two copies of "paused means he is needed" is how a
 * dot comes to disagree with the rail above it about the same run.
 *
 * `idle` covers `draft` as well as the three terminal statuses: a draft run has
 * never been dispatched, so nothing is happening on its behalf. */
export type RunAttention = "waiting" | "active" | "idle";

/** Exhaustive on purpose — a status added to the coordinator fails this switch
 * to compile rather than falling silently into `idle`, which is how a surface
 * starts making a claim about a state nobody mapped. */
export function runAttention(status: RunStatus): RunAttention {
  switch (status) {
    case "paused":
    case "blocked":
      return "waiting";
    case "provisioning":
    case "ready":
    case "running":
    case "verifying":
      return "active";
    case "draft":
    case "completed":
    case "failed":
    case "cancelled":
      return "idle";
  }
}

const RECENT_CAP = 10;

/** Groups runs for the list. Exhaustive over every RunStatus by construction:
 * `runAttention` is total, and its third answer is this list's "recent". */
export function railGroups(runs: RunSummary[]): {
  needsYou: RunSummary[];
  live: RunSummary[];
  recent: RunSummary[];
} {
  const needsYou: RunSummary[] = [];
  const live: RunSummary[] = [];
  const recentAll: RunSummary[] = [];

  for (const r of runs) {
    const attention = runAttention(r.status);
    if (attention === "waiting") needsYou.push(r);
    else if (attention === "active") live.push(r);
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

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffViewModel {
  lines: DiffLine[];
  /** True when the executor's own truncation marker (bound_diff in
   * coordinator/executor/src/lib.rs) is present in the raw diff — the
   * evidence was cut short and the marker names the real, untruncated byte
   * count. */
  truncated: boolean;
}

const TRUNCATION_MARKER = /^\.\.\. \[truncated, \d+ bytes total\]$/;

/** Classifies a raw unified-diff `kind=diff` evidence body into colorable
 * lines. `+++`/`---` file headers are `meta` (checked before the single-char
 * `+`/`-` prefixes, which would otherwise misclassify them as add/del); `@@`
 * hunk headers are `hunk`; a bare `+`/`-` prefix is add/del; everything else
 * (context lines, including ones starting with a literal space) is `ctx`.
 * Detects the executor's truncation marker (bound_diff in
 * coordinator/executor/src/lib.rs) and reports it via `truncated`. An empty
 * diff yields no lines. */
export function diffView(raw: string): DiffViewModel {
  if (raw === "") return { lines: [], truncated: false };
  let truncated = false;
  const lines = raw.split("\n").map((text): DiffLine => {
    if (TRUNCATION_MARKER.test(text)) {
      truncated = true;
      return { kind: "meta", text };
    }
    if (text.startsWith("+++") || text.startsWith("---")) {
      return { kind: "meta", text };
    }
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "del", text };
    return { kind: "ctx", text };
  });
  return { lines, truncated };
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
