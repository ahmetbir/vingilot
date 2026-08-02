import { useCallback, useState } from "react";
import { getRun, transitionRun } from "../api/coordinator.ts";
import { usePolling } from "../api/poll.ts";
import { statusClass } from "../model/run.ts";
import type { RunStatus } from "../model/run.ts";
import { ModeChip } from "../shell/RunRail.tsx";
import { BudgetBar } from "./BudgetBar.tsx";
import { legalNext } from "./budget.ts";

interface RunViewProps {
  runId: string;
}

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

/** The Run tab (Direction B): header chips, budget honesty (BudgetBar),
 * the transition history newest-first, and an actions row derived from
 * `legalNext` — an illegal action is ABSENT from the row, never a disabled
 * button. A 409 from an action is shown inline next to the row (data-
 * carrying conflicts get shown, not toasted away). */
export function RunView({ runId }: RunViewProps) {
  const fetchRun = useCallback(() => getRun(runId), [runId]);
  const { data: run, reachable } = usePolling(fetchRun, 2000);
  const [pendingTo, setPendingTo] = useState<RunStatus | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  if (run === null) {
    return <p className="vg-run-stub">loading run {runId}…</p>;
  }

  const runDetail = run;
  const actions = legalNext(runDetail.status);

  async function act(to: RunStatus) {
    setPendingTo(to);
    setConflict(null);
    const result = await transitionRun(runDetail.id, to, `manual: ${actionLabel(runDetail.status, to)}`);
    setPendingTo(null);
    if (!result.ok) {
      setConflict(result.kind === "unreachable" ? "control plane unreachable" : result.detail);
    }
  }

  const transitionsNewestFirst = [...runDetail.transitions].sort((a, b) => b.seq - a.seq);

  return (
    <div className="vg-runview">
      <header className="vg-runview__header">
        <span
          className={`chip chip--enforced vg-runview__status vg-runview__status--${statusClass(run.status)}`}
        >
          {run.status}
        </span>
        <ModeChip mode={run.mode} />
        <h1 className="vg-runview__objective">{run.objective}</h1>
        <span className="vg-runview__id">{run.id}</span>
      </header>

      <BudgetBar run={run} now={new Date()} />

      <div className="vg-runview__actions">
        {actions.map((to) => (
          <button
            key={to}
            type="button"
            className="vg-button"
            disabled={pendingTo !== null || !reachable}
            onClick={() => act(to)}
          >
            {pendingTo === to ? "…" : actionLabel(run.status, to)}
          </button>
        ))}
        {conflict !== null && (
          <span className="vg-runview__conflict" role="alert">
            {conflict}
          </span>
        )}
      </div>

      <section className="vg-runview__transitions">
        <h2 className="vg-deck__lane-title">TRANSITIONS</h2>
        {transitionsNewestFirst.length === 0 ? (
          <p className="vg-deck__empty">no transitions yet</p>
        ) : (
          <ul className="vg-runview__transitions-list">
            {transitionsNewestFirst.map((t) => (
              <li key={t.seq} className="vg-runview__transition-row">
                <span className="vg-rail__meta">{t.seq}</span>
                <span className="vg-runview__transition-edge">
                  {t.from_status} → {t.to_status}
                </span>
                <span className="vg-runview__transition-reason">{t.reason}</span>
                <span className="vg-rail__meta">{new Date(t.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!reachable && (
        <p className="vg-deck__error" role="status">
          control plane unreachable — showing last-known state
        </p>
      )}
    </div>
  );
}
