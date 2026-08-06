// The Runs screen: three columns per the layout contract
// (vingilot/docs/plans/2026-08-06-projects-and-terminal.md) — ProjectsNav
// (pick a project or the project-less landing view), WorktreeColumn (that
// project's worktrees, live state), WorkSurface (Terminal default, Diff,
// Evidence, Runs). A persistent ProjectStatusBar names where the owner is.
// The project-less landing view is the old Deck (composer + lanes),
// unchanged — nothing is deleted, it just stops being the front door.
//
// Owns the workspace-level polling (runs, worktrees, repos), the
// unreachable-since clock, the STOP-all action, and the home-dir
// resolution every terminal's cwd derives from.

import { homeDir } from "@tauri-apps/api/path";
import * as React from "react";

import {
  applyMutations,
  getWorkspace,
  listRuns,
  listWorktrees,
  transitionRun,
} from "@/features/runs/lib/coordinatorClient";
import {
  DEFAULT_WORKTREE_ROOT_SUFFIX,
  groupWorktrees,
  readRepos,
} from "@/features/runs/lib/projects";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { usePolling } from "@/features/runs/lib/usePolling";
import { DeckPane } from "@/features/runs/ui/DeckPane";
import { ProjectsNav } from "@/features/runs/ui/ProjectsNav";
import { ProjectStatusBar } from "@/features/runs/ui/ProjectStatusBar";
import { RunDetail } from "@/features/runs/ui/RunDetail";
import { StopAllButton } from "@/features/runs/ui/StopAllButton";
import { UnreachableBanner } from "@/features/runs/ui/UnreachableBanner";
import { WorkSurface } from "@/features/runs/ui/WorkSurface";
import { WorktreeColumn } from "@/features/runs/ui/WorktreeColumn";

// Hardcoded dev workspace id — matches the donor App.tsx. A workspace
// picker is a later plan; V1 is single-workspace dev use.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const POLL_INTERVAL_MS = 2000;

export function RunsScreen() {
  const {
    data: runsData,
    reachable,
    retryNow,
  } = usePolling(() => listRuns(WORKSPACE_ID), POLL_INTERVAL_MS);
  const runs: RunSummary[] = runsData ?? [];

  const { data: worktreesData } = usePolling(
    React.useCallback(() => listWorktrees(WORKSPACE_ID), []),
    POLL_INTERVAL_MS,
  );
  const worktrees = worktreesData ?? [];

  const fetchWorkspaceSnapshot = React.useCallback(
    () => getWorkspace(WORKSPACE_ID),
    [],
  );
  const { data: workspaceSnapshot } = usePolling(
    fetchWorkspaceSnapshot,
    POLL_INTERVAL_MS,
  );
  const repos = React.useMemo(
    () => readRepos(workspaceSnapshot ? workspaceSnapshot.state : null),
    [workspaceSnapshot],
  );
  const grouped = React.useMemo(
    () => groupWorktrees(repos, worktrees),
    [repos, worktrees],
  );

  // The moment reachability first flipped false — null while reachable.
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

  // Home-dir resolution for terminal cwds, once. A non-Tauri context (or
  // any failure) leaves this null — every open terminal shows its waiting
  // state instead of throwing.
  const [worktreeRoot, setWorktreeRoot] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    homeDir()
      .then((home) => {
        if (cancelled) return;
        const base = home.endsWith("/") ? home.slice(0, -1) : home;
        setWorktreeRoot(`${base}/${DEFAULT_WORKTREE_ROOT_SUFFIX}`);
      })
      .catch(() => {
        // Non-Tauri context (e.g. a plain browser preview) — worktreeRoot
        // stays null, terminals stay in their waiting state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedRepoId, setSelectedRepoId] = React.useState<string | null>(
    null,
  );
  const [selectedWorktreeId, setSelectedWorktreeId] = React.useState<
    string | null
  >(null);
  // Landing-mode (project-less) run selection — unchanged from the old
  // screen's behavior.
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [stopEngaged, setStopEngaged] = React.useState(false);

  const selectRepo = React.useCallback((id: string) => {
    setSelectedRepoId(id);
    setSelectedWorktreeId(null);
  }, []);
  // Also clears any open run detail — clicking "Runs" while already on the
  // landing view is the way back to the Deck from a RunDetail, since the
  // old RunList's "+ New run" row (which used to do this) now lives inside
  // WorkSurface's own Runs tab instead.
  const selectLanding = React.useCallback(() => {
    setSelectedRepoId(null);
    setSelectedWorktreeId(null);
    setSelectedRunId(null);
  }, []);
  const openRun = React.useCallback((id: string) => setSelectedRunId(id), []);

  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;
  const repoWorktrees =
    selectedRepoId !== null ? (grouped.byRepo[selectedRepoId] ?? []) : [];

  // Entering a project with no worktree picked yet lands on its primary
  // checkout (or the first worktree, if there's no primary) rather than an
  // empty "select a worktree" state — the terminal that greets you.
  React.useEffect(() => {
    if (selectedRepoId === null || selectedWorktreeId !== null) return;
    const first =
      repoWorktrees.find((wt) => wt.role === "primary") ?? repoWorktrees[0];
    if (first !== undefined) setSelectedWorktreeId(first.binding_id);
  }, [selectedRepoId, selectedWorktreeId, repoWorktrees]);

  const selectedWorktree =
    repoWorktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;
  const ownerRun =
    selectedWorktree?.owner_run_id !== null &&
    selectedWorktree?.owner_run_id !== undefined
      ? (runs.find((r) => r.id === selectedWorktree.owner_run_id) ?? null)
      : null;

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
        <ProjectsNav
          onSelectLanding={selectLanding}
          onSelectRepo={selectRepo}
          repos={repos}
          selectedRepoId={selectedRepoId}
        />

        {selectedRepo === null ? (
          <main
            aria-label="workspace"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <UnreachableBanner
              intervalMs={POLL_INTERVAL_MS}
              now={now}
              onRetryNow={retryNow}
              reachable={reachable}
              since={unreachableSince}
            />
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
        ) : (
          <>
            <WorktreeColumn
              onSelectWorktree={setSelectedWorktreeId}
              repo={selectedRepo}
              selectedWorktreeId={selectedWorktreeId}
              worktrees={repoWorktrees}
            />
            {selectedWorktree === null ? (
              <main
                aria-label="workspace"
                className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground"
              >
                select a worktree
              </main>
            ) : (
              <WorkSurface
                onSelectWorktree={setSelectedWorktreeId}
                reachable={reachable}
                repo={selectedRepo}
                runs={runs}
                selectedWorktreeId={selectedWorktreeId}
                worktreeRoot={worktreeRoot}
                worktrees={repoWorktrees}
                workspaceId={WORKSPACE_ID}
              />
            )}
          </>
        )}
      </div>

      <ProjectStatusBar
        reachable={reachable}
        repo={selectedRepo}
        run={ownerRun}
        worktree={selectedWorktree}
      />
    </div>
  );
}
