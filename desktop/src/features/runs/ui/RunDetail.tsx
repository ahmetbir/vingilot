// The Run detail pane (Direction B): header chips, budget honesty
// (BudgetBar), the transition history newest-first, and an actions row
// derived from `legalNext` — an illegal action is ABSENT from the row,
// never a disabled button. A 409 from an action is shown inline next to the
// row (data-carrying conflicts get shown, not toasted away).
//
// Restyled from vingilot/workbench/src/run/RunView.tsx (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

import * as React from "react";

import { legalNext } from "@/features/runs/lib/budget";
import {
  getRun,
  listEvidence,
  transitionRun,
} from "@/features/runs/lib/coordinatorClient";
import {
  diffView,
  evidenceView,
  statusClass,
} from "@/features/runs/lib/runModel";
import type {
  DiffLineKind,
  EvidenceKind,
  RunStatus,
  SemanticClass,
} from "@/features/runs/lib/runModel";
import { usePolling } from "@/features/runs/lib/usePolling";
import { BudgetBar } from "@/features/runs/ui/BudgetBar";
import { ModeChip } from "@/features/runs/ui/RunList";
import { Button } from "@/shared/ui/button";

interface RunDetailProps {
  runId: string;
}

const STATUS_TEXT_CLASS: Record<SemanticClass, string> = {
  attn: "text-amber-600 dark:text-amber-400",
  live: "text-emerald-600 dark:text-emerald-400",
  muted: "text-muted-foreground",
  ok: "text-emerald-600 dark:text-emerald-400",
  stop: "text-destructive",
};

/** Label for the button that drives `from -> to`. Most targets are named
 * after the status itself; `running` is the one target that reads
 * differently depending on where it's entered from (a fresh Ready run
 * "Starts", a Paused/Blocked/Verifying one "Resumes"). */
function actionLabel(from: RunStatus, to: RunStatus): string {
  if (to === "running") return from === "ready" ? "Start" : "Resume";
  switch (to) {
    case "verifying":
      return "Verify";
    case "paused":
      return "Pause";
    case "blocked":
      return "Block";
    case "completed":
      return "Complete";
    case "failed":
      return "Fail";
    case "cancelled":
      return "Cancel";
    case "provisioning":
      return "Provision";
    case "ready":
      return "Mark Ready";
    default:
      return to;
  }
}

const EVIDENCE_KIND_CLASS: Record<EvidenceKind, string> = {
  command: "text-foreground",
  commit: "text-emerald-600 dark:text-emerald-400",
  diff: "text-muted-foreground",
  error: "text-destructive",
  note: "text-muted-foreground",
  output: "text-foreground",
};

const DIFF_LINE_CLASS: Record<DiffLineKind, string> = {
  add: "text-emerald-600 dark:text-emerald-400",
  ctx: "text-foreground",
  del: "text-destructive",
  hunk: "font-bold text-muted-foreground",
  meta: "text-muted-foreground",
};

export function RunDetail({ runId }: RunDetailProps) {
  const fetchRun = React.useCallback(() => getRun(runId), [runId]);
  const { data: run, reachable } = usePolling(fetchRun, 2000);
  const fetchEvidence = React.useCallback(() => listEvidence(runId), [runId]);
  const { data: evidenceRows } = usePolling(fetchEvidence, 2000);
  const [pendingTo, setPendingTo] = React.useState<RunStatus | null>(null);
  const [conflict, setConflict] = React.useState<string | null>(null);

  if (run === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        loading run {runId}…
      </div>
    );
  }

  const actions = legalNext(run.status);

  async function act(to: RunStatus) {
    setPendingTo(to);
    setConflict(null);
    const runDetail = run;
    if (!runDetail) return;
    const result = await transitionRun(
      runDetail.id,
      to,
      `manual: ${actionLabel(runDetail.status, to)}`,
    );
    setPendingTo(null);
    if (!result.ok) {
      setConflict(
        result.kind === "unreachable"
          ? "control plane unreachable"
          : result.detail,
      );
    }
  }

  const transitionsNewestFirst = [...run.transitions].sort(
    (a, b) => b.seq - a.seq,
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      data-testid="run-detail"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          className={`shrink-0 rounded-full border border-border px-2 py-0.5 text-2xs uppercase tracking-wide ${STATUS_TEXT_CLASS[statusClass(run.status)]}`}
        >
          {run.status}
        </span>
        <ModeChip mode={run.mode} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {run.objective}
        </h1>
        <span className="shrink-0 text-2xs text-muted-foreground/70">
          {run.id}
        </span>
      </header>

      <BudgetBar now={new Date()} run={run} />

      <div className="flex flex-wrap items-center gap-2">
        {actions.map((to) => (
          <Button
            disabled={pendingTo !== null || !reachable}
            key={to}
            onClick={() => void act(to)}
            size="sm"
            variant="outline"
          >
            {pendingTo === to ? "…" : actionLabel(run.status, to)}
          </Button>
        ))}
        {conflict !== null ? (
          <span className="text-sm text-destructive" role="alert">
            {conflict}
          </span>
        ) : null}
      </div>

      <section>
        <h2 className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Transitions
        </h2>
        {transitionsNewestFirst.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            no transitions yet
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {transitionsNewestFirst.map((transition) => (
              <li
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-sm"
                key={transition.seq}
              >
                <span className="text-muted-foreground/70">
                  {transition.seq}
                </span>
                <span>
                  {transition.from_status} → {transition.to_status}
                </span>
                <span className="text-muted-foreground">
                  {transition.reason}
                </span>
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground/70">
                  {new Date(transition.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="run-evidence">
        <h2 className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Evidence
        </h2>
        {(() => {
          const { rows, truncatedCount } = evidenceView(evidenceRows ?? []);
          if (rows.length === 0) {
            return (
              <p className="mt-2 text-sm text-muted-foreground">
                no evidence yet
              </p>
            );
          }
          return (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs">
              {truncatedCount > 0 ? (
                <p className="text-2xs text-muted-foreground/70">
                  {truncatedCount} earlier row
                  {truncatedCount === 1 ? "" : "s"} not shown
                </p>
              ) : null}
              {rows.map((ev) => (
                <div
                  className={`whitespace-pre-wrap break-words ${EVIDENCE_KIND_CLASS[ev.kind]}`}
                  key={ev.seq}
                >
                  {ev.kind === "command" ? "$ " : ""}
                  {ev.kind === "commit" ? "⎘ " : ""}
                  {ev.content}
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      <section data-testid="run-diff">
        <h2 className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Diff
        </h2>
        {(() => {
          const diffRows = (evidenceRows ?? []).filter(
            (ev) => ev.kind === "diff",
          );
          if (diffRows.length === 0) {
            return (
              <p className="mt-2 text-sm text-muted-foreground">no diff yet</p>
            );
          }
          const latest = diffRows.reduce((a, b) => (b.seq > a.seq ? b : a));
          const { lines, truncated } = diffView(latest.content);
          return (
            <div className="mt-2 flex flex-col gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs">
              {lines.map((line, i) => (
                <div
                  className={`whitespace-pre ${DIFF_LINE_CLASS[line.kind]}`}
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static, positional transcript content
                  key={i}
                >
                  {line.text}
                </div>
              ))}
              {truncated ? (
                <p className="mt-1 text-2xs text-muted-foreground/70">
                  diff truncated — see marker above for the full byte count
                </p>
              ) : null}
            </div>
          );
        })()}
      </section>

      {!reachable ? (
        <p className="text-sm text-muted-foreground" role="status">
          control plane unreachable — showing last-known state
        </p>
      ) : null}
    </div>
  );
}
