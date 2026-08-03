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
import { getRun, transitionRun } from "@/features/runs/lib/coordinatorClient";
import { statusClass } from "@/features/runs/lib/runModel";
import type { RunStatus, SemanticClass } from "@/features/runs/lib/runModel";
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

export function RunDetail({ runId }: RunDetailProps) {
  const fetchRun = React.useCallback(() => getRun(runId), [runId]);
  const { data: run, reachable } = usePolling(fetchRun, 2000);
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
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {run.objective}
        </h1>
        <span className="shrink-0 text-3xs text-muted-foreground/70">
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
          <span className="text-xs text-destructive" role="alert">
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
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-xs"
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
                <span className="ml-auto shrink-0 text-3xs text-muted-foreground/70">
                  {new Date(transition.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!reachable ? (
        <p className="text-xs text-muted-foreground" role="status">
          control plane unreachable — showing last-known state
        </p>
      ) : null}
    </div>
  );
}
