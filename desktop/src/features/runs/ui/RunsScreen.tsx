// The Projects screen: three columns per the layout contract
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
//
// It is also where the collapsible chrome is bound (`lib/useColumns.ts`),
// for the same reason: the flag is per project and must outlive both the
// column it hides and any switch between projects.
//
// It also owns the terminal-tab layout — which worktrees have terminals open
// and which tabs each of them holds — because it is the only component here
// that never unmounts: `WorkSurface` disappears the moment the owner goes back
// to the landing view, so a layout kept there would be forgotten on the way
// out and every shell left running with nothing tracking it. A session is
// killed only when the owner closes its tab or its worktree leaves the
// workspace (`lib/terminalTabs.ts`) — never on a switch, a tab change, or a
// re-render.
//
// The screen has no title bar of its own. Everywhere else in this app an `h1`
// names the thing you are looking at — a channel in `ChatHeader`, a run's
// objective in `RunDetail` — never the screen; a static "Projects" named the
// leftmost column, which `ProjectsNav` already heads itself, and put a second
// `h1` on screen whenever a run was open. What that row was reaching for —
// where am I — is the status bar's job, and the status bar is always there.

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
  worktreeCwd,
} from "@/features/runs/lib/projects";
import {
  ptyBacking,
  ptyClose,
  type PtyBacking,
} from "@/features/runs/lib/ptyClient";
import type { RunSummary } from "@/features/runs/lib/runModel";
import {
  openTerminals,
  worktreeIndex,
} from "@/features/runs/lib/terminalSessions";
import {
  readTabLayout,
  writeTabLayout,
} from "@/features/runs/lib/terminalTabStore";
import {
  applyTabCommand,
  closeWorktrees,
  dropWorktrees,
  ensureWorktree,
  type TabCommand,
  type TabLayout,
  worktreeTabs,
} from "@/features/runs/lib/terminalTabs";
import { useColumns } from "@/features/runs/lib/useColumns";
import { usePolling } from "@/features/runs/lib/usePolling";
import { useProjectActions } from "@/features/runs/lib/useProjectActions";
import { useWorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import {
  useWorktreeStats,
  type WorktreeTarget,
} from "@/features/runs/lib/useWorktreeStats";
import { orderWorktrees } from "@/features/runs/lib/worktreeAttention";
import {
  unlistedWorktrees,
  withLocalGroups,
} from "@/features/runs/lib/worktreeGit";
import { DeckPane } from "@/features/runs/ui/DeckPane";
import { ProjectsNav } from "@/features/runs/ui/ProjectsNav";
import { ProjectStatusBar } from "@/features/runs/ui/ProjectStatusBar";
import { RunDetail } from "@/features/runs/ui/RunDetail";
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

  // What is keeping terminals alive, asked once — the backend probes tmux
  // once per app run, so the answer cannot change under us. Stays null if the
  // call fails (a non-Tauri preview), and the status bar then says nothing
  // about persistence rather than guessing at it.
  const [terminalBacking, setTerminalBacking] =
    React.useState<PtyBacking | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    ptyBacking()
      .then((backing) => {
        if (!cancelled) setTerminalBacking(backing);
      })
      .catch(() => {
        // No backend to ask. Claiming either mode would be a guess.
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
  // Also clears any open run detail — clicking "Deck" while already on the
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

  // Which columns are out of the way, and the ⌘B / ⇧⌘B that put them there.
  // Keyed by project rather than held here, so it survives both a project
  // switch and a restart (`lib/useColumns.ts`).
  const columns = useColumns({
    hasWorktreeColumn: selectedRepo !== null,
    projectId: selectedRepoId,
  });

  // The terminal-tab layout, seeded from and mirrored back into storage
  // (lib/terminalTabStore.ts): this component unmounts on any route change
  // away from /workspace, and a layout that lived only here would be forgotten
  // on the way out — along with any shell whose worktree disappears while the
  // owner is elsewhere. The same write is what carries the strip across an app
  // restart, to meet the tmux sessions that were already surviving one.
  const [tabLayout, setTabLayout] = React.useState<TabLayout>(readTabLayout);
  React.useEffect(() => {
    writeTabLayout(tabLayout);
  }, [tabLayout]);

  // The owner just closed a worktree, so its checkout no longer exists: its
  // shells end with it rather than surviving until a poll notices. Selection
  // falls back to nothing, which the effect below turns into the project's own
  // checkout — the one row that is always there.
  const handleWorktreeRemoved = React.useCallback(
    (bindingId: string) => {
      const { closed, layout } = closeWorktrees(tabLayout, [bindingId]);
      if (closed.length > 0) {
        setTabLayout(layout);
        for (const sessionId of closed) void ptyClose(sessionId);
      }
      setSelectedWorktreeId((prev) => (prev === bindingId ? null : prev));
    },
    [tabLayout],
  );

  const worktreeActions = useWorktreeActions({
    onRemoved: handleWorktreeRemoved,
    repos,
    selectedRepo,
    worktreeRoot,
  });

  // Two sources, one column: the coordinator's rows (a Run's worktrees, with
  // their live status) and git's own listing (everything that exists on disk,
  // including what the owner made himself). `withLocalGroups` folds the second
  // into the first without duplicating what both know about.
  const grouped = React.useMemo(
    () =>
      withLocalGroups(
        repos,
        groupWorktrees(repos, worktrees),
        worktreeActions.byRepo,
        worktreeRoot,
      ),
    [repos, worktrees, worktreeActions.byRepo, worktreeRoot],
  );
  const index = React.useMemo(
    () => worktreeIndex(repos, grouped),
    [repos, grouped],
  );

  const knownWorktrees =
    selectedRepoId !== null ? (grouped.byRepo[selectedRepoId] ?? []) : [];

  // git's own read of the open project's worktrees — what is uncommitted in
  // each, which is what the column orders by. Only the open project: the other
  // projects' rows are not on screen, and this is `git` subprocesses.
  const statTargets = React.useMemo<WorktreeTarget[]>(
    () =>
      selectedRepo === null || worktreeRoot === null
        ? []
        : knownWorktrees.flatMap((wt) => {
            const path = worktreeCwd(selectedRepo, wt, worktreeRoot);
            return path === null ? [] : [{ id: wt.binding_id, path }];
          }),
    [knownWorktrees, selectedRepo, worktreeRoot],
  );
  const worktreeStats = useWorktreeStats(statTargets);

  // One ordering, shared: the column renders it and the ⌘1…9 map is built from
  // it, so the digit beside a row is the digit that selects it.
  const repoWorktrees = React.useMemo(
    () => orderWorktrees(knownWorktrees, worktreeStats),
    [knownWorktrees, worktreeStats],
  );

  // Entering a project with no worktree picked yet lands on its primary
  // checkout (or the first worktree, if there's no primary) rather than an
  // empty "select a worktree" state — the terminal that greets you.
  React.useEffect(() => {
    if (selectedRepoId === null || selectedWorktreeId !== null) return;
    const first =
      repoWorktrees.find((wt) => wt.role === "primary") ?? repoWorktrees[0];
    if (first !== undefined) setSelectedWorktreeId(first.binding_id);
  }, [selectedRepoId, selectedWorktreeId, repoWorktrees]);

  // Visiting a worktree gives it a terminal; nothing here opens a second one
  // on its own.
  React.useEffect(() => {
    if (selectedWorktreeId === null) return;
    setTabLayout((prev) => ensureWorktree(prev, selectedWorktreeId));
  }, [selectedWorktreeId]);

  // The one event that means "really closed" for a whole strip at once: the
  // worktree is gone from the workspace, so no view can ever reattach and its
  // shells would otherwise run unreferenced for the app's lifetime.
  //
  // Not while git has yet to say what worktrees exist. Half the index comes
  // from that listing, and acting on it early would kill, on every single app
  // start, precisely the terminals the saved tab layout exists to bring back.
  //
  // Nor for a project git answered a refusal for — an unmounted volume is not
  // a removed worktree, and `unlistedWorktrees` is what keeps the two apart.
  React.useEffect(() => {
    if (!worktreeActions.settled) return;
    const live = [
      ...index.keys(),
      ...unlistedWorktrees(Object.keys(tabLayout), worktreeActions.unreadable),
    ];
    const { closed, layout } = dropWorktrees(tabLayout, live);
    if (closed.length === 0) return;
    setTabLayout(layout);
    for (const sessionId of closed) void ptyClose(sessionId);
  }, [tabLayout, index, worktreeActions.settled, worktreeActions.unreadable]);

  // The other one: the owner closed a tab. Unlike a worktree switch, that is a
  // real close — the pty is killed and its tmux session ended.
  const runTabCommand = React.useCallback(
    (command: TabCommand) => {
      if (selectedWorktreeId === null) return;
      const { closed, layout } = applyTabCommand(
        tabLayout,
        selectedWorktreeId,
        command,
      );
      setTabLayout(layout);
      for (const sessionId of closed) void ptyClose(sessionId);
    },
    [tabLayout, selectedWorktreeId],
  );

  // A project the owner just forgot. Its worktrees are unreachable now, so
  // their shells end with it rather than surviving until the next poll
  // notices the repo is gone — the binding ids come from `grouped`, which
  // still holds them, because the workspace snapshot this screen polls has
  // not caught up yet. That lag is the whole reason this is explicit rather
  // than left to `dropWorktrees`.
  const handleProjectRemoved = React.useCallback(
    (repoId: string) => {
      const bindingIds = (grouped.byRepo[repoId] ?? []).map(
        (wt) => wt.binding_id,
      );
      const { closed, layout } = closeWorktrees(tabLayout, bindingIds);
      if (closed.length > 0) {
        setTabLayout(layout);
        for (const sessionId of closed) void ptyClose(sessionId);
      }
      // Standing inside the project that just left: the landing view is the
      // only place left to be.
      if (selectedRepoId === repoId) selectLanding();
    },
    [grouped, tabLayout, selectedRepoId, selectLanding],
  );

  const projectActions = useProjectActions({
    onRemoved: handleProjectRemoved,
    workspaceId: WORKSPACE_ID,
  });

  const terminals = React.useMemo(
    () => openTerminals(tabLayout, index, worktreeRoot),
    [tabLayout, index, worktreeRoot],
  );
  const selectedTabs =
    selectedWorktreeId === null
      ? null
      : worktreeTabs(tabLayout, selectedWorktreeId);

  const selectedWorktree =
    repoWorktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;
  // Where the selected worktree is on disk — the Diff panel asks git in this
  // directory, and only this screen holds the repo and the worktree root the
  // derivation needs.
  const selectedWorktreeCwd =
    selectedRepo === null || selectedWorktree === null || worktreeRoot === null
      ? null
      : worktreeCwd(selectedRepo, selectedWorktree, worktreeRoot);
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ProjectsNav
          error={projectActions.error}
          onAddProject={projectActions.addProject}
          onDismissError={projectActions.dismissError}
          onRemoveProject={projectActions.removeProject}
          onSelectLanding={selectLanding}
          onSelectRepo={selectRepo}
          pending={projectActions.pending}
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
              actions={worktreeActions}
              collapsed={columns.worktreesCollapsed}
              onSelectWorktree={setSelectedWorktreeId}
              onToggleCollapsed={columns.toggleWorktrees}
              repo={selectedRepo}
              selectedWorktreeId={selectedWorktreeId}
              stats={worktreeStats}
              worktreeRoot={worktreeRoot}
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
                onTabCommand={runTabCommand}
                reachable={reachable}
                runs={runs}
                selectedWorktreeId={selectedWorktreeId}
                tabs={selectedTabs}
                terminals={terminals}
                worktreeCwd={selectedWorktreeCwd}
                worktrees={repoWorktrees}
                workspaceId={WORKSPACE_ID}
              />
            )}
          </>
        )}
      </div>

      {/* STOP rides the status bar, which is the only thing on screen on every
       * screen and every tab — see ProjectStatusBar's own note. */}
      <ProjectStatusBar
        onEngageStop={() => void engageStop()}
        onReleaseStop={releaseStop}
        reachable={reachable}
        repo={selectedRepo}
        run={ownerRun}
        stopEngaged={stopEngaged}
        terminalBacking={terminalBacking}
        worktree={selectedWorktree}
      />
    </div>
  );
}
