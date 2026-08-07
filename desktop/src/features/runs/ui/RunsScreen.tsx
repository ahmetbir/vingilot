// The Projects screen: three columns per the layout contract
// (vingilot/docs/plans/2026-08-06-projects-and-terminal.md) — ProjectsNav
// (pick a project or the project-less landing view), WorktreeColumn (that
// project's worktrees, live state), WorkSurface (the terminal, and whichever
// pane the owner has put beside it). A persistent ProjectStatusBar names where
// the owner is.
// The project-less landing view is the old Deck (composer + lanes),
// unchanged — nothing is deleted, it just stops being the front door.
//
// Owns the workspace-level polling (runs, worktrees, repos), the
// unreachable-since clock, the STOP-all action, and the home-dir
// resolution every terminal's cwd derives from.
//
// It is also where the collapsible chrome is bound (`lib/useColumns.ts`),
// for the same reason: the flag is per project and must outlive both the
// column it hides and any switch between projects. The pane arrangement
// (`lib/usePanes.ts`) is held here on the same argument, one key finer — per
// worktree rather than per project.
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
  type Repo,
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
import type {
  PaneContext,
  PaneFacts,
  PaneId,
} from "@/features/runs/lib/paneModel";
import { rightChoices } from "@/features/runs/lib/paneModel";
import type { PaletteCommand } from "@/features/runs/lib/paletteModel";
import type {
  PaletteChoice,
  PaletteContext,
} from "@/features/runs/lib/paletteSources";
import { usePalette } from "@/features/runs/lib/usePalette";
import { useColumns } from "@/features/runs/lib/useColumns";
import { usePaneProbes } from "@/features/runs/lib/usePaneProbes";
import { usePanes } from "@/features/runs/lib/usePanes";
import { usePolling } from "@/features/runs/lib/usePolling";
import { useProjectActions } from "@/features/runs/lib/useProjectActions";
import { useWorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import {
  useWorktreeStats,
  type WorktreeTarget,
} from "@/features/runs/lib/useWorktreeStats";
import {
  orderWorktrees,
  prunableWorktrees,
} from "@/features/runs/lib/worktreeAttention";
import {
  unlistedWorktrees,
  withLocalGroups,
} from "@/features/runs/lib/worktreeGit";
import { CommandPalette } from "@/features/runs/ui/CommandPalette";
import { DeckPane } from "@/features/runs/ui/DeckPane";
import { ProjectsNav } from "@/features/runs/ui/ProjectsNav";
import { ProjectStatusBar } from "@/features/runs/ui/ProjectStatusBar";
import { RunDetail } from "@/features/runs/ui/RunDetail";
import { UnreachableBanner } from "@/features/runs/ui/UnreachableBanner";
import { paneEntry, paneProbes } from "@/features/runs/ui/paneRegistry";
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
  // Whether the lookup above has *finished*, however it finished. A failure is
  // an answer, and one that never arrives is not: without this, a rejected
  // homeDir() reads for the rest of the session as "still waiting", and the
  // panes tell the owner to wait for a checkout nothing is going to name.
  const [rootSettled, setRootSettled] = React.useState(false);
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
      })
      .finally(() => {
        if (!cancelled) setRootSettled(true);
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

  // What the panes are allowed to know about the worktree under them
  // (lib/paneModel.ts). `cwdPending` is the distinction that keeps a pane from
  // telling the owner his worktree has no checkout when all that has happened
  // is that the home-directory lookup above has not answered yet — and it is
  // `rootSettled`, not `worktreeRoot === null`, because that lookup can also
  // *fail*, and a failure is an answer. Reading it as "still waiting" left the
  // Diff and Agent panes telling the owner to wait for something that was
  // never coming.
  const paneFacts: PaneFacts = {
    cwd: selectedWorktreeCwd,
    cwdPending: !rootSettled,
    ownerRunId: selectedWorktree?.owner_run_id ?? null,
    worktreeId: selectedWorktreeId,
  };
  // Whatever the registry's panes need asked of the world. This screen runs
  // them and knows what none of them is about (lib/usePaneProbes.ts).
  const probe = usePaneProbes(paneProbes(), paneFacts);
  const paneContext: PaneContext = { ...paneFacts, probe };
  // Which pane sits beside the terminal, how wide it is, and whether it is
  // showing — per worktree, and held here rather than in `WorkSurface` for the
  // same reason the tab layout is: that component unmounts on the way to the
  // landing view and would forget the arrangement on the way out.
  const panes = usePanes(selectedWorktreeId);

  // The three dialogs the palette is a second door to. Held here rather than
  // in the columns that used to own them, so both doors open the *same*
  // dialog: a "New worktree…" the palette opened and a "+ New worktree" the
  // column opened must not be two dialogs that can be on screen at once.
  const [creatingWorktree, setCreatingWorktree] = React.useState(false);
  const [prunePreview, setPrunePreview] = React.useState<string[] | null>(null);
  const [removingProject, setRemovingProject] = React.useState<Repo | null>(
    null,
  );

  const previewPrune = worktreeActions.previewPrune;
  const openPrune = React.useCallback(() => {
    void (async () => {
      const entries = await previewPrune();
      // A preview that names nothing is not a dialog — there is nothing to
      // approve. The refusal, if git gave one, is already on screen.
      if (entries !== null && entries.length > 0) setPrunePreview(entries);
    })();
  }, [previewPrune]);

  // The panes the palette may offer, with each pane's own availability asked
  // through the registry's own rule — the same call `WorkSurface` makes for
  // the picker, so the two surfaces cannot come to disagree about whether a
  // pane can work here. Recomputed per render rather than memoised: it is four
  // synchronous rules over a context that is itself rebuilt every render, so a
  // memo would have nothing stable to key on and would only look like one.
  const paneChoices: PaletteChoice[] = rightChoices().map((id) => {
    const entry = paneEntry(id);
    return {
      availability: entry.availability(paneContext),
      icon: entry.icon,
      id: entry.id,
      title: entry.title,
    };
  });

  const paletteContext: PaletteContext = {
    hasWorktreeColumn: selectedRepo !== null,
    paneChoices,
    prunable: prunableWorktrees(repoWorktrees).length,
    repos,
    selectedRepoId,
    selectedWorktreeId,
    sidebarCollapsed: columns.sidebarCollapsed,
    solo: panes.state.solo,
    worktrees: repoWorktrees,
    worktreesCollapsed: columns.worktreesCollapsed,
  };

  // Every command the palette can produce, run against the actions that
  // already exist. Nothing new is reachable from here — a palette that could
  // do something no button could would be a second implementation of it.
  const runPaletteCommand = React.useCallback(
    (command: PaletteCommand) => {
      switch (command.type) {
        case "open-landing":
          selectLanding();
          return;
        case "open-project":
          selectRepo(command.repoId);
          return;
        case "open-worktree":
          setSelectedWorktreeId(command.bindingId);
          return;
        case "choose-pane": {
          // Narrowed against the model's own list rather than cast: the
          // command carries a string so `paletteSources.ts` needs no import
          // from the pane registry, and an id that is not a pane must land as
          // nothing rather than as a lookup on a key that does not exist.
          const pane: PaneId | undefined = rightChoices().find(
            (id) => id === command.pane,
          );
          if (pane !== undefined) panes.choose(pane);
          return;
        }
        case "new-worktree":
          setCreatingWorktree(true);
          return;
        case "new-terminal-tab":
          runTabCommand({ type: "new" });
          return;
        case "add-project":
          projectActions.addProject();
          return;
        case "remove-project":
          // Straight to the same confirm the × on a project row opens. The
          // palette never removes anything itself: the exact words of that
          // interruption are a tested promise (`lib/repoChoice.ts`).
          if (selectedRepo !== null) setRemovingProject(selectedRepo);
          return;
        case "prune-worktrees":
          openPrune();
          return;
        case "toggle-sidebar":
          columns.toggleSidebar();
          return;
        case "toggle-worktrees":
          columns.toggleWorktrees();
          return;
        case "toggle-solo":
          panes.toggleSolo(command.side);
          return;
      }
    },
    [
      columns.toggleSidebar,
      columns.toggleWorktrees,
      openPrune,
      panes.choose,
      panes.toggleSolo,
      projectActions.addProject,
      runTabCommand,
      selectedRepo,
      selectLanding,
      selectRepo,
    ],
  );

  const palette = usePalette({
    context: paletteContext,
    onCommand: runPaletteCommand,
  });

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
          confirming={removingProject}
          error={projectActions.error}
          onAddProject={projectActions.addProject}
          onConfirmingChange={setRemovingProject}
          onDismissError={projectActions.dismissError}
          onRemoveProject={projectActions.removeProject}
          onSelectLanding={selectLanding}
          onSelectRepo={selectRepo}
          pending={projectActions.pending}
          repos={repos}
          selectedRepoId={selectedRepoId}
        />

        {/* Everything right of the project nav, in a box the palette can be
         * centred in. The palette is positioned rather than portalled for
         * exactly this: it belongs over the surface the owner is working on,
         * not over a window that is mostly chrome he is not looking at. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
                creating={creatingWorktree}
                onCreatingChange={setCreatingWorktree}
                onOpenPrune={openPrune}
                onPrunePreviewChange={setPrunePreview}
                onSelectWorktree={setSelectedWorktreeId}
                onToggleCollapsed={columns.toggleWorktrees}
                prunePreview={prunePreview}
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
                  paneContext={paneContext}
                  panes={panes}
                  reachable={reachable}
                  runs={runs}
                  selectedWorktreeId={selectedWorktreeId}
                  tabs={selectedTabs}
                  terminals={terminals}
                  worktrees={repoWorktrees}
                  workspaceId={WORKSPACE_ID}
                />
              )}
            </>
          )}
          <CommandPalette palette={palette} />
        </div>
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
