import { wallClock } from "../model/run.ts";
import type { RunSummary } from "../model/run.ts";

interface StatusBarProps {
  workspaceId: string;
  activeRun: RunSummary | null;
  reachable: boolean;
  lastOk: Date | null;
}

/** "Vingilot · <workspace> · <active run + status> · <budget> · <sync dot>" */
export function StatusBar({ workspaceId, activeRun, reachable, lastOk }: StatusBarProps) {
  const wc = activeRun ? wallClock(activeRun, new Date()) : null;
  const budgetLabel =
    wc === null ? "—" : wc.limitSecs !== null ? `${wc.spentSecs}s / ${wc.limitSecs}s` : `${wc.spentSecs}s`;

  return (
    <>
      <span className="vg-status__brand">Vingilot</span>
      <span aria-hidden="true">·</span>
      <span>{workspaceId}</span>
      <span aria-hidden="true">·</span>
      <span>{activeRun ? `${activeRun.objective} · ${activeRun.status}` : "no active run"}</span>
      <span aria-hidden="true">·</span>
      <span>{budgetLabel}</span>
      <span aria-hidden="true">·</span>
      <span
        className={reachable ? "vg-sync-dot vg-sync-dot--ok" : "vg-sync-dot vg-sync-dot--stale"}
        role="status"
        aria-label={
          reachable ? "control plane reachable" : `control plane unreachable, last ok ${lastOk?.toISOString() ?? "never"}`
        }
      />
    </>
  );
}
