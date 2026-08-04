// The Runs screen: RunList on the left, DeckPane (nothing selected) or
// RunDetail (a run selected) on the right, StopAllButton in the header,
// UnreachableBanner above the list when the control plane drops. Owns the
// workspace-level polling, the unreachable-since clock, and the STOP-all
// action every child view reads from or drives.
//
// Restyled from vingilot/workbench/src/App.tsx (ADR-001's 2026-08-03
// reversal) — the sibling app is donor code once this lands.

import * as React from "react";

import {
  applyMutations,
  getWorkspace,
  listRuns,
  transitionRun,
} from "@/features/runs/lib/coordinatorClient";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { usePolling } from "@/features/runs/lib/usePolling";
import { DeckPane } from "@/features/runs/ui/DeckPane";
import { RunDetail } from "@/features/runs/ui/RunDetail";
import { RunList } from "@/features/runs/ui/RunList";
import { StopAllButton } from "@/features/runs/ui/StopAllButton";
import { UnreachableBanner } from "@/features/runs/ui/UnreachableBanner";

// Hardcoded dev workspace id — matches the donor App.tsx. A workspace
// picker is a later plan; V1 is single-workspace dev use.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const POLL_INTERVAL_MS = 2000;

export function RunsScreen() {
  const { data, lastOk, reachable, retryNow } = usePolling(
    () => listRuns(WORKSPACE_ID),
    POLL_INTERVAL_MS,
  );
  const runs: RunSummary[] = data ?? [];

  // The moment reachability first flipped false — null while reachable.
  // UnreachableBanner (and the countdown inside it) is a pure function of
  // (reachable, unreachableSince, now); this is the one bit of state that
  // isn't derivable from usePolling's own return.
  const [unreachableSince, setUnreachableSince] = React.useState<Date | null>(
    null,
  );
  React.useEffect(() => {
    if (!reachable) {
      setUnreachableSince((prev) => prev ?? new Date());
    } else {
      setUnreachableSince(null);
    }
  }, [reachable]);

  // A ticking clock so the "next retry in Ns" countdown and the wall-clock
  // budget meter both count down live, not just on the next poll's data
  // change.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(handle);
  }, []);

  // Workspace bootstrap: the dev workspace id is hardcoded above, but the
  // row may not exist yet on a fresh coordinator DB. GET first; if that
  // 404s, POST an (empty) mutation — the mutations endpoint has ensure
  // semantics server-side, so this creates the workspace row as a side
  // effect of its first write.
  React.useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const snapshot = await getWorkspace(WORKSPACE_ID);
      if (cancelled || snapshot.ok) return;
      if (snapshot.kind === "api" && snapshot.status === 404) {
        await applyMutations(WORKSPACE_ID, 0, []);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [stopEngaged, setStopEngaged] = React.useState(false);

  const openRun = React.useCallback((id: string) => setSelectedRunId(id), []);
  const openDeck = React.useCallback(() => setSelectedRunId(null), []);

  async function engageStop() {
    setStopEngaged(true);
    const live = runs.filter(
      (run) => run.status === "running" || run.status === "verifying",
    );
    await Promise.all(
      live.map((run) => transitionRun(run.id, "paused", "stop engaged")),
    );
  }

  function releaseStop() {
    setStopEngaged(false);
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="runs-screen"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <h1 className="text-lg font-semibold">Runs</h1>
        <StopAllButton
          engaged={stopEngaged}
          onEngage={() => void engageStop()}
          onRelease={releaseStop}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="runs"
          className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border/60"
        >
          <UnreachableBanner
            intervalMs={POLL_INTERVAL_MS}
            now={now}
            onRetryNow={retryNow}
            reachable={reachable}
            since={unreachableSince}
          />
          <RunList
            activeRunId={selectedRunId}
            onSelectDeck={openDeck}
            onSelectRun={openRun}
            runs={runs}
            staleAsOf={reachable ? null : lastOk}
            workspaceId={WORKSPACE_ID}
          />
        </aside>
        <main
          aria-label="workspace"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {selectedRunId === null ? (
            <DeckPane
              onOpenRun={openRun}
              reachable={reachable}
              runs={runs}
              workspaceId={WORKSPACE_ID}
            />
          ) : (
            <RunDetail key={selectedRunId} runId={selectedRunId} />
          )}
        </main>
      </div>
    </div>
  );
}
