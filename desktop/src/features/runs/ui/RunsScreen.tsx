// The Projects screen. Its own row holds one thing now: WorkSurface (the
// terminal, and whichever pane the owner has put beside it). WorkspaceNav —
// the projects, and under the open one its worktrees — is still this screen's
// (every prop is live state held here), but it renders inside the app
// sidebar's contextual slot via a portal
// (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2; the column
// history is 2026-08-06-projects-and-terminal.md, narrowed by
// 2026-08-11-one-column-design.md). A persistent ProjectStatusBar names where
// the owner is.
// The project-less landing view is the old Deck (composer + lanes),
// unchanged — nothing is deleted, it just stops being the front door.
//
// Owns the workspace-level polling (runs, worktrees, repos), the
// unreachable-since clock, the STOP-all action, and the home-dir
// resolution every terminal's cwd derives from.
//
// The polls' cadence is not a constant here either: on a machine where nothing
// has ever answered, hammering 127.0.0.1 every 2s forever is noise against a
// port that is not going to be listening (`lib/reachability.ts` decides when
// that settles, and the banner says so in words).
//
// It is also where the collapsible chrome is bound (`lib/useColumns.ts`),
// for the same reason: the flag is per project and must outlive both the
// sidebar it hides and any switch between projects. The pane arrangement
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
// leftmost column, which `WorkspaceNav` already heads itself, and put a second
// `h1` on screen whenever a run was open. What that row was reaching for —
// where am I — is the status bar's job, and the status bar is always there.

import * as React from "react";

import { useSidebarNavSlot } from "@/shared/lib/sidebarNavSlot";
import {
  getWorkspace,
  listRuns,
  listWorktrees,
} from "@/features/runs/lib/coordinatorClient";
import {
  groupWorktrees,
  worktreeCwd,
  worktreeSummary,
} from "@/features/runs/lib/projects";
import type { RunSummary } from "@/features/runs/lib/runModel";
import {
  openTerminals,
  worktreeIndex,
} from "@/features/runs/lib/terminalSessions";
import { sessionIdFor } from "@/features/runs/lib/terminalTabs";
import { fileTerminalType } from "@/features/runs/lib/terminalType";
import { useDeckLayers } from "@/features/runs/lib/useDeckLayers";
import { openFileReport } from "@/features/runs/lib/viewTabs";
import type {
  PaneContext,
  PaneFacts,
  PaneId,
} from "@/features/runs/lib/paneModel";
import {
  AGENT_HARNESS_PROBE,
  rightChoices,
} from "@/features/runs/lib/paneModel";
import { ask } from "@/features/runs/lib/askRunner";
import type {
  PaletteChoice,
  PaletteContext,
} from "@/features/runs/lib/paletteSources";
import { useAskPending } from "@/features/runs/lib/useAskPending";
import { useCheatsheet } from "@/features/runs/lib/useCheatsheet";
import { useCrewMint } from "@/features/runs/lib/useCrewMint";
import { useCrewReach } from "@/features/runs/lib/useCrewReach";
import { usePublishWorktreeFocus } from "@/features/runs/lib/usePublishWorktreeFocus";
import { useWorkspaceCloseRequest } from "@/features/runs/lib/useWorkspaceCloseRequest";
import { useWorkspaceDialogs } from "@/features/runs/lib/useWorkspaceDialogs";
import {
  POLL_INTERVAL_MS,
  useControlPlane,
} from "@/features/runs/lib/useControlPlane";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { requestSearchOpen } from "@/features/search/lib/searchRequest";
import { usePalette } from "@/features/runs/lib/usePalette";
import { usePaletteCommands } from "@/features/runs/lib/usePaletteCommands";
import { openDiffTabAct, usePaneActs } from "@/features/runs/lib/usePaneActs";
import {
  openFileFromPalette,
  useWorkspacePalette,
} from "@/features/runs/lib/useWorkspacePalette";
import { useEscapeHatch } from "@/features/runs/lib/useEscapeHatch";
import { useColumns } from "@/features/runs/lib/useColumns";
import { usePaneProbes } from "@/features/runs/lib/usePaneProbes";
import { useSearchChord } from "@/features/runs/lib/useSearchChord";
import { useShowPane } from "@/features/runs/lib/useShowPane";
import { useStopAll } from "@/features/runs/lib/useStopAll";
import { useProjectDocuments } from "@/features/runs/lib/useDocument";
import { usePanes } from "@/features/runs/lib/usePanes";
import { usePolling } from "@/features/runs/lib/usePolling";
import { useActiveTerminalTyping } from "@/features/runs/lib/useActiveTerminalTyping";
import { useAttentionNotices } from "@/features/runs/lib/useAttentionNotices";
import { useLocalProjects } from "@/features/runs/lib/useLocalProjects";
import { useMachineFacts } from "@/features/runs/lib/useMachineFacts";
import type { FileReport } from "@/features/runs/lib/placeMru";
import { usePlaceSwitcher } from "@/features/runs/lib/usePlaceSwitcher";
import { useScratchMarkdown } from "@/features/runs/lib/useScratchMarkdown";
import { useScratchTerminal } from "@/features/runs/lib/useScratchTerminal";
import { useWorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import { useWorktreeSignals } from "@/features/runs/lib/useWorktreeSignals";
import { prunableWorktrees } from "@/features/runs/lib/worktreeAttention";
import {
  unlistedWorktrees,
  withLocalGroups,
} from "@/features/runs/lib/worktreeGit";
import { localBindingId } from "@/features/runs/lib/projects";
import { CommandPalette } from "@/features/runs/ui/CommandPalette";
import { CrewMintDialog } from "@/features/runs/ui/CrewMintDialog";
import { DeckPane } from "@/features/runs/ui/DeckPane";
import { KeyCheatsheet } from "@/features/runs/ui/KeyCheatsheet";
import { PlaceSwitcher } from "@/features/runs/ui/PlaceSwitcher";
import { PlanWorktreeDialog } from "@/features/runs/ui/PlanWorktreeDialog";
import { ProjectStatusBar } from "@/features/runs/ui/ProjectStatusBar";
import { RunDetail } from "@/features/runs/ui/RunDetail";
import { ScratchMarkdown } from "@/features/runs/ui/ScratchMarkdown";
import { TriageBoard } from "@/features/runs/ui/TriageBoard";
import { ControlPlaneBanner } from "@/features/runs/ui/ControlPlaneBanner";
import { paneEntry, paneProbes } from "@/features/runs/ui/paneRegistry";
import { DeckSidebar } from "@/features/runs/ui/DeckSidebar";
import { WorkSurface } from "@/features/runs/ui/WorkSurface";

// Hardcoded dev workspace id — matches the donor App.tsx. A workspace
// picker is a later plan; V1 is single-workspace dev use.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

export function RunsScreen() {
  // The cadence every coordinator poll in the app runs at, held here because the
  // polls below take it and `useControlPlane` decides it from what they report —
  // declared before them, decided after them (that hook's header has the knot).
  const [pollMs, setPollMs] = React.useState(POLL_INTERVAL_MS);
  const {
    data: runsData,
    lastOk,
    reachable,
    retryNow,
  } = usePolling(() => listRuns(WORKSPACE_ID), pollMs);
  const runs: RunSummary[] = runsData ?? [];

  const { data: worktreesData } = usePolling(
    React.useCallback(() => listWorktrees(WORKSPACE_ID), []),
    pollMs,
  );
  const worktrees = worktreesData ?? [];

  const fetchWorkspaceSnapshot = React.useCallback(
    () => getWorkspace(WORKSPACE_ID),
    [],
  );
  const { data: workspaceSnapshot } = usePolling(
    fetchWorkspaceSnapshot,
    pollMs,
  );
  // What to do about a project that just left the list — closing its shells —
  // needs the worktree grouping, which is derived from the list itself, so it
  // cannot be defined above the hook that produces the list. The ref is how
  // that knot is untied: it is assigned once the real callback exists, a few
  // hundred lines down, and read only when a removal actually happens.
  const handleProjectRemovedRef = React.useRef<(repoId: string) => void>(
    () => {},
  );
  const onProjectRemoved = React.useCallback(
    (repoId: string) => handleProjectRemovedRef.current(repoId),
    [],
  );

  // The project list is local and is the authority for what this screen shows
  // (`lib/useLocalProjects.ts`). The workspace document is where it is PUSHED
  // when a coordinator is reachable, and — once, on a machine whose list is
  // still empty — where it is seeded from.
  const projectActions = useLocalProjects({
    onRemoved: onProjectRemoved,
    snapshot: workspaceSnapshot,
    workspaceId: WORKSPACE_ID,
  });
  const repos = projectActions.repos;

  // Which of the two sentences the workspace is entitled to say, how hard it
  // should keep looking, and the once-on-the-way-in bootstrap of the workspace
  // row (`lib/useControlPlane.ts`). Every rule it applies is
  // `lib/reachability.ts`'s.
  const {
    kind: controlPlane,
    now,
    unreachableSince,
  } = useControlPlane({
    lastOk,
    pollMs,
    reachable,
    setPollMs,
    workspaceId: WORKSPACE_ID,
  });

  // The two questions this machine is asked once on the way in — where home is
  // (every terminal's cwd derives from it) and what is keeping terminals alive
  // (`lib/useMachineFacts.ts`, which also carries why a *failure* is an answer).
  const { rootSettled, terminalBacking, worktreeRoot } = useMachineFacts();
  // Where a ⌘K channel row goes — upstream's own navigation, the same call
  // their switcher makes (ADR-001: host their list, do not re-route it).
  const { goChannel, goSettings } = useAppNavigation();

  const [selectedRepoId, setSelectedRepoId] = React.useState<string | null>(
    null,
  );
  const [selectedWorktreeId, setSelectedWorktreeId] = React.useState<
    string | null
  >(null);
  // Landing-mode (project-less) run selection — unchanged from the old
  // screen's behavior.
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  // STOP, split out at the 1000-line ratchet (lib/useStopAll.ts).
  const { engageStop, releaseStop, stopEngaged } = useStopAll(runs);

  // **Idempotent, and that is the whole point.** Choosing a *different*
  // project clears the worktree so the auto-select effect below lands on its
  // primary checkout — that is why disclosing a project immediately shows a
  // terminal. Choosing the project you are already standing in must do
  // neither: this callback has three doors (the nav's project row, the
  // collapsed rail's dot, the palette's `open-project`), all three of which
  // the owner reaches *while inside* the project they name, and clearing the
  // selection there would silently move him off the worktree he has open onto
  // `main`. `ProjectRow.tsx` and the design's §2.1 both promise this is a
  // no-op; the guard is what makes the promise true.
  const selectRepo = React.useCallback(
    (id: string) => {
      if (id === selectedRepoId) return;
      setSelectedRepoId(id);
      setSelectedWorktreeId(null);
    },
    [selectedRepoId],
  );
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

  // Whether the app sidebar is out of the way, and the ⌘B that put it there.
  // Keyed by project rather than held here, so it survives both a project
  // switch and a restart (`lib/useColumns.ts`). ⇧⌘B and the nav's own flag
  // are retired: the workspace nav lives inside that same sidebar now
  // (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2).
  const columns = useColumns({ projectId: selectedRepoId });

  // Where the sidebar wants the workspace nav (`shared/lib/sidebarNavSlot.ts`):
  // only the tree's DOM is portalled out — every prop and the selection
  // ordering (the auto-select effect above) stay this screen's.
  const navSlot = useSidebarNavSlot();

  // The Deck's three persisted layers — terminal tabs, task chips, splits —
  // and every transition between them, including the one door to `pty_close`
  // for tab-model closes (`lib/useDeckLayers.ts`; split out of this file at
  // the 1000-line ratchet). Held here rather than in `WorkSurface` because
  // that component unmounts on the way to the landing view.
  const deck = useDeckLayers(selectedWorktreeId);
  const { runTabCommand, runTaskCommand, selectedTabs, selectedTasks } = deck;

  // The owner just closed a worktree, so its checkout no longer exists: its
  // shells end with it rather than surviving until a poll notices. Selection
  // falls back to nothing, which the effect below turns into the project's own
  // checkout — the one row that is always there.
  const handleWorktreeRemoved = React.useCallback(
    (bindingId: string) => {
      deck.closeWorktreesFor([bindingId]);
      setSelectedWorktreeId((prev) => (prev === bindingId ? null : prev));
    },
    [deck.closeWorktreesFor],
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

  // What is true of every project's worktrees right now — git's numstat, the
  // attention dots this screen's columns draw, the triage board both landing
  // surfaces render, and the row order the ⌘1…9 map follows. All one subject,
  // and it has its own module (which also carries what the numstat costs).
  const signals = useWorktreeSignals(
    repos,
    grouped,
    selectedRepo,
    worktreeRoot,
    runs,
  );
  const repoWorktrees = signals.ordered;

  // Where a notification lands. Both ids together, because `selectRepo` clears
  // the worktree and the effect below would then put him on the project's
  // primary checkout — the app's last state, which is what the notification
  // existed to skip past.
  const openWorktree = React.useCallback((repoId: string, id: string) => {
    setSelectedRepoId(repoId);
    setSelectedWorktreeId(id);
  }, []);

  // The workspace speaking when he is not looking at it (lib/attentionNotice.ts
  // for what it will and will not say; this screen is the only place with both
  // the signals and the selection its rule compares against).
  useAttentionNotices({
    index,
    marks: signals.byWorktree,
    onOpen: openWorktree,
    selectedWorktreeId,
    worktreeRoot,
  });

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
    deck.ensureSelected(selectedWorktreeId);
  }, [selectedWorktreeId, deck.ensureSelected]);

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
    deck.dropWorktreesTo([
      ...index.keys(),
      ...unlistedWorktrees(
        Object.keys(deck.tabLayout),
        worktreeActions.unreadable,
      ),
    ]);
  }, [
    deck.tabLayout,
    deck.dropWorktreesTo,
    index,
    worktreeActions.settled,
    worktreeActions.unreadable,
  ]);

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
      deck.closeWorktreesFor(bindingIds);
      // Standing inside the project that just left: the landing view is the
      // only place left to be.
      if (selectedRepoId === repoId) selectLanding();
    },
    [grouped, deck.closeWorktreesFor, selectedRepoId, selectLanding],
  );
  handleProjectRemovedRef.current = handleProjectRemoved;

  const terminals = React.useMemo(
    () => openTerminals(deck.tabLayout, index, worktreeRoot),
    [deck.tabLayout, index, worktreeRoot],
  );

  const selectedWorktree =
    repoWorktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;
  // Where the selected worktree is on disk — the Diff panel asks git in this
  // directory, and only this screen holds the repo and the worktree root the
  // derivation needs.
  const selectedWorktreeCwd =
    selectedRepo === null || selectedWorktree === null || worktreeRoot === null
      ? null
      : worktreeCwd(selectedRepo, selectedWorktree, worktreeRoot);

  // Handed to the surfaces mounted while this screen is not — the sidebar's
  // Pull requests pane on `/projects` (`shared/lib/worktreeFocus.ts`).
  usePublishWorktreeFocus({
    cwd: selectedWorktreeCwd,
    label:
      selectedWorktree === null
        ? null
        : worktreeSummary(selectedWorktree).label,
    repoName: selectedRepo?.name ?? null,
    settled: rootSettled,
  });

  // The scratch shell and every door into it (`lib/useScratchTerminal.ts`).
  // Held here rather than in `WorkSurface` for the reason the tab layout is:
  // that component unmounts on the way to the landing view, and a shell it
  // forgot on the way out would run with nothing tracking it.
  const scratch = useScratchTerminal({
    cwd: selectedWorktreeCwd,
    cwdPending: !rootSettled,
    worktreeId: selectedWorktreeId,
  });

  // The scratch shell's sibling: one global markdown buffer, ⇧⌘M, kept in a file
  // on this machine (`lib/useScratchMarkdown.ts`). It takes no arguments at all,
  // which is the feature — there is one of it wherever he is, so it needs no
  // worktree, no project and no checkout. The hook binds its own chord, so this
  // surface is reachable from the landing view and the triage board too, neither
  // of which mounts `WorkSurface`.
  const notepad = useScratchMarkdown();

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
    // The project itself, not the worktree under it: what a project carries
    // (its notes, and next its plan) is keyed by the project's own path, which
    // outlives both the worktree and this workspace's name for the repo.
    projectPath: selectedRepo?.path ?? null,
    worktreeId: selectedWorktreeId,
  };
  // Whatever the registry's panes need asked of the world. This screen runs
  // them and knows what none of them is about (lib/usePaneProbes.ts).
  const probe = usePaneProbes(paneProbes(), paneFacts);
  // Whether a turn is already out, from the store both doors into one write to.
  const askInFlight = useAskPending();
  const paneContext: PaneContext = { ...paneFacts, probe };
  // Which pane sits beside the terminal, how wide it is, and whether it is
  // showing — per worktree, and held here rather than in `WorkSurface` for the
  // same reason the tab layout is: that component unmounts on the way to the
  // landing view and would forget the arrangement on the way out.
  const panes = usePanes(selectedWorktreeId);
  // Bringing a pane to him, as opposed to him arranging his own surface — three
  // callers and one gesture (`lib/useShowPane.ts`).
  const showPane = useShowPane({
    choose: panes.choose,
    solo: panes.state.solo,
    toggleSolo: panes.toggleSolo,
  });
  // The open project's notes and plan, opened here rather than in the panes
  // that edit them. The Plan pane's button and the dialog it opens are then
  // reading one value instead of two: the pane's own state and, a debounce
  // later, storage — which briefed a worktree with the text the owner had
  // already replaced (`lib/useDocument.ts`).
  const documents = useProjectDocuments(paneFacts.projectPath);
  // ⌘/, and the palette row that is its second door. Held here rather than in
  // the sheet itself so a close request can take it like any other stacked
  // surface (`lib/closeRequest.ts`).
  const sheet = useCheatsheet();

  // The offer a workspace missing crew is made once (`lib/useCrewMint.ts`).
  // Declared here rather than beside `crewReach` below because it is a dialog:
  // `useWorkspaceDialogs` is what ⌘W and ⌃Tab ask about stacked surfaces, and
  // the one surface that raises itself unasked is the one that must be in that
  // reading.
  const crewMint = useCrewMint();
  // The dialogs the palette and the columns are two doors to, and the one
  // reading of "a dialog is up" that ⌘W and ⌃Tab both ask
  // (`lib/useWorkspaceDialogs.ts`, split out at the 1000-line ratchet).
  const dialogs = useWorkspaceDialogs({
    crew: crewMint,
    dismissRefusal: worktreeActions.dismissRefusal,
    previewPrune: worktreeActions.previewPrune,
  });
  // Which file the workspace has open, for the places a `FileReport` feeds:
  // ⌘K's "current file" row, the escape hatch's Open in editor, `placeMru.ts`.
  //
  // **Derived from the view tabs since P4.1, not reported by a pane.** A file
  // opens as a TAB now (`viewTabs.ts`), so the workspace can see the answer
  // for itself: the tab that is showing is what is open. That is strictly
  // better than the report it replaces — a pane reporting `file-opened` could
  // only speak while it was mounted, which is why it had to send a `null` on
  // every unmount and why "is this report still live" needed a rule of its
  // own. `null` here still means "nothing is open", and it now means it
  // because nothing IS.
  //
  // Memoised on the pair it is made of, because `readFileReport` compares
  // reports by reference: a fresh object every render would read as a fresh
  // report every render.
  // Memoised because `readFileReport` compares reports by reference: a fresh
  // object every render would read as a fresh report every render.
  const selectedViews = deck.selectedViews;
  const openedFile: FileReport | null = React.useMemo(
    () => openFileReport(selectedViews, selectedWorktreeCwd),
    [selectedViews, selectedWorktreeCwd],
  );

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
      // The registry's own column, carried down rather than written here: the
      // palette row is the door for somebody who does not know the chord, and
      // a second list of chords in this file is a list that goes stale.
      chord: entry.chord,
      id: entry.id,
      title: entry.title,
    };
  });

  // The escape hatch, both directions
  // (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1). The two
  // gestures and the one sentence surface they share are
  // `lib/useEscapeHatch.ts`; what this screen contributes is the state they act
  // on — which project is open, which file the viewer reported, and where the
  // executor checks worktrees out.
  const hatch = useEscapeHatch({
    addProject: projectActions.addProject,
    openedFile,
    repoWorktrees,
    repos,
    selectRepo,
    selectWorktree: setSelectedWorktreeId,
    selectedRepo,
    showFiles: () => showPane("files"),
    worktreeRoot,
  });

  // The four sources this screen did not already hold — channels, recent
  // files, this worktree's listing — and the wires that make ⌘K one gesture
  // app-wide (`lib/useWorkspacePalette.ts`, Task 2).
  const workspacePalette = useWorkspacePalette({
    grouped,
    repos,
    selectRepo,
    selectWorktree: setSelectedWorktreeId,
    showFiles: () => showPane("files"),
    stats: signals.stats,
    worktreeCwd: selectedWorktreeCwd,
  });

  // The crew's ⌘K rows, which put the Captain in front of one with this
  // worktree already named (`lib/useCrewReach.ts`). Wiring over machinery that
  // already exists: the rows land in upstream's own composer. The mint half is
  // declared with the dialogs above.
  const crewReach = useCrewReach({
    bindingId: selectedWorktreeId,
    worktreeCwd: selectedWorktreeCwd,
    // The nav's own label for this checkout, not `branch`: the project's
    // primary has no branch in the coordinator's model, and a draft that said
    // "the null worktree" would be this island inventing a second name for a
    // row the column already names.
    worktreeLabel:
      selectedWorktree === null
        ? null
        : worktreeSummary(selectedWorktree).label,
  });

  // Built after the hatch because one row is a reading of what the hatch read:
  // "Install vingilot command…" over a link that is already there would be an
  // offer to do work that is done (`paletteSources.ts`'s `shim`).
  const paletteContext: PaletteContext = {
    channels: workspacePalette.channels,
    crew: crewReach.rows,
    // What a rename row would act on — the deck's own reading of which tab has
    // the stage, the same one ⌘W closes (`useDeckLayers.ts`). The row needs it
    // to say why a reading cannot be renamed; nothing else here reads it.
    focusedTab: deck.focusedStageTab,
    // The file the viewer reported, and only while that report is still a
    // reading of the pane on screen — the same `openedFile` the place switcher
    // reads, not a second answer to "which file is open".
    openFile:
      openedFile !== null && openedFile.worktree === selectedWorktreeCwd
        ? openedFile.path
        : null,
    paneChoices,
    prunable: prunableWorktrees(repoWorktrees).length,
    recentFiles: workspacePalette.recentFiles,
    repos,
    selectedRepoId,
    selectedWorktreeId,
    shim: hatch.shim,
    sidebarCollapsed: columns.sidebarCollapsed,
    solo: panes.state.solo,
    worktreeCwd: selectedWorktreeCwd,
    worktreeCwdPending: !rootSettled,
    worktreeFiles: workspacePalette.worktreeFiles,
    worktrees: repoWorktrees,
  };

  // Every command the palette can produce, run against the actions that
  // already exist — the table itself is `lib/usePaletteCommands.ts`, split out
  // when this file reached the 1000-line ratchet. Nothing new is reachable
  // through it: every field below is a handler some button already calls.
  const runPaletteCommand = usePaletteCommands({
    addProject: projectActions.addProject,
    ask: (cwd, question) => void ask(cwd, question),
    choosePane: (id) => {
      // Narrowed against the registry's own list rather than cast: the command
      // carries a string so `paletteSources.ts` needs no import from the pane
      // registry, and an id that is not a pane must land as nothing.
      const pane: PaneId | undefined = rightChoices().find(
        (known) => known === id,
      );
      if (pane !== undefined) panes.choose(pane);
    },
    installShim: hatch.installShim,
    newTask: () => runTaskCommand({ type: "new-task" }),
    newTerminalTab: () => runTabCommand({ type: "new" }),
    newWorktree: () => dialogs.setCreatingWorktree(true),
    splitTerminal: deck.splitActiveTerminal,
    closeTerminalSplit: deck.closeActiveSplit,
    toggleTabSplit: deck.toggleTabSplit,
    openAppearance: () => void goSettings("appearance"),
    openMessageSearch: requestSearchOpen,
    openChannel: (channelId) => void goChannel(channelId),
    openCheatsheet: sheet.show,
    // ⌘K's door onto the diff tab (P4.6) — the same act the dock's own "Open
    // in tab" asks for, routed through `runPaneAct` so the two land identically.
    openDiffTab: () =>
      openDiffTabAct(selectedWorktree, selectedWorktreeCwd, runPaneAct),
    openFile: (worktree, path, line) =>
      openFileFromPalette(worktree, path, line, () => showPane("files")),
    openInEditor: hatch.openCurrentFileInEditor,
    openLanding: selectLanding,
    openPlanWorktree: () => dialogs.setPlanningWorktree(true),
    openPrune: dialogs.openPrune,
    openScratchMarkdown: notepad.show,
    openScratchTerminal: scratch.open,
    reachCrew: crewReach.reach,
    removeProject: dialogs.setRemovingProject,
    selectRepo,
    selectWorktree: setSelectedWorktreeId,
    selectedRepo,
    selectedWorktreeCwd,
    showPane: (pane) => showPane(pane as PaneId),
    toggleSidebar: columns.toggleSidebar,
    toggleSolo: panes.toggleSolo,
  });

  // What a pane asks the workspace for — the table is `lib/usePaneActs.ts`,
  // split out at the ratchet. Each act lands on the same state the palette's
  // command does: a pane is a second door, not a second implementation.
  const runPaneAct = usePaneActs({
    openPlanWorktree: () => dialogs.setPlanningWorktree(true),
    // Open a reading beside the shells (P4.1). Two things happen beyond the
    // model call, and both are about the tab being *visible*: a dock that has
    // the whole surface (`solo: "right"`, ⌥⌘B's other half) is put back to the
    // split first — a reading behind a surface he cannot see is the toast with
    // extra steps `paneModel.ts` argues against — and a file joins ⌘K's recent
    // rows, which is the one thing the retired `file-opened` report did that
    // deriving the open file cannot.
    openViewTab: (worktree, view) => {
      if (panes.state.solo === "right") panes.toggleSolo("right");
      deck.openViewTab(view);
      if (view.kind === "file") {
        workspacePalette.rememberOpenFile(worktree, view.path);
      }
    },
    rememberOpenFile: workspacePalette.rememberOpenFile,
    // The dock's "type this into a fresh shell" (Start Dev, New terminal
    // here). The text is filed BEFORE the tab command for `filesTarget.ts`'s
    // reason: the consumer (the new tab's Terminal, after its `pty_open`)
    // reads whatever is pending, so the order is what makes it land. The
    // session id is the strip's own next ordinal — the exact id the `new`
    // command will mint (`terminalTabs.ts`'s `nextN`).
    runInNewTerminal: (text) => {
      if (selectedWorktreeId === null || selectedTabs === null) return;
      fileTerminalType(
        sessionIdFor(selectedWorktreeId, selectedTabs.nextN),
        text,
      );
      runTabCommand({ type: "new" });
    },
    showFiles: () => showPane("files"),
  });

  // ⇧⌘F. Choosing a pane already chosen is a no-op, which is what the Search
  // pane's own listener on this chord is for — it re-focuses the field.
  useSearchChord(React.useCallback(() => showPane("search"), [showPane]));

  // Standing in the worktree the plan just opened. The binding id is derived
  // from git's own path (`localBindingId`), so it is the id the row will carry
  // when the fresh listing arrives — no side table, and no wait for a poll.
  const openLocalWorktree = React.useCallback((path: string) => {
    setSelectedWorktreeId(localBindingId(path));
  }, []);

  const palette = usePalette({
    // The same probe reading the Agent pane's availability is built from, so
    // the palette and the pane cannot come to disagree about whether this
    // machine has an agent.
    ask: {
      cwd: paneFacts.cwd,
      cwdPending: paneFacts.cwdPending,
      harness: probe(AGENT_HARNESS_PROBE),
      // Subscribed, not polled: this screen re-renders on a 2s tick, and a
      // guard that is up to two seconds stale is a guard a second question
      // walks straight past.
      inFlight: askInFlight,
    },
    context: paletteContext,
    // Which doors this screen answers to. ⌘P is here and falls through on a
    // screen with no checkout under it (`lib/usePalette.ts`'s `offers`).
    offers: workspacePalette.offers,
    onCommand: runPaletteCommand,
  });

  // The one direction the files listing cannot flow during render: the door and
  // the query live inside the palette, and the listing is an input to it. See
  // `lib/useWorkspacePalette.ts`'s header — deepening is allowed to arrive a
  // render late because it is progressive by construction.
  React.useEffect(() => {
    workspacePalette.setQuery(palette.mode === "files" ? palette.query : "");
  }, [palette.mode, palette.query, workspacePalette.setQuery]);

  // ⌃Tab (`lib/usePlaceSwitcher.ts`). Declared after the palette because of
  // `blocked`: a surface stacked over the workspace is a question the owner has
  // not answered yet, and switching places while one is up would be answering
  // it by walking away. The scratch shell is deliberately not in that list —
  // it is a terminal over the surface rather than a question, and being in a
  // shell is the state this gesture exists for.
  const switcher = usePlaceSwitcher({
    blocked: palette.open || sheet.open || dialogs.anyOpen,
    file: openedFile,
    onSelectWorktree: setSelectedWorktreeId,
    pane: panes.state.right,
    showPane,
    worktreeCwd: selectedWorktreeCwd,
    worktreeId: selectedWorktreeId,
    worktreeIndex: index,
    worktreeRoot,
  });

  // ⌘W and the red button, one rung at a time
  // (`lib/useWorkspaceCloseRequest.ts`, split out of this file at the ratchet;
  // the order and the reasons are `lib/closeRequest.ts`'s). The dialogs go
  // together — the four this screen opens and the crew offer that opens itself
  // — because `useWorkspaceDialogs` holds one reading of them: a ⌘W with only
  // the crew offer on screen must dismiss the question, not be answered by the
  // backend minimizing the window.
  useWorkspaceCloseRequest({
    cheatsheet: { close: sheet.close, open: sheet.open },
    closableTab: {
      close: deck.closeFocusedTab,
      open: deck.focusedTabClosable,
    },
    dialog: { close: dialogs.dismissAll, open: dialogs.anyOpen },
    palette: { close: palette.close, open: palette.open },
    scratch: { close: scratch.close, open: scratch.session !== null },
    scratchMarkdown: { close: notepad.close, open: notepad.open },
  });

  const ownerRun =
    selectedWorktree?.owner_run_id !== null &&
    selectedWorktree?.owner_run_id !== undefined
      ? (runs.find((r) => r.id === selectedWorktree.owner_run_id) ?? null)
      : null;
  // The status bar's quick-action door (redesign P4) — see the hook's own
  // header for why this lives here rather than inside ProjectStatusBar.
  const activeTerminalTyping = useActiveTerminalTyping(
    selectedWorktreeId,
    selectedTabs,
  );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="runs-screen"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* The sidebar's whole Deck region, portalled into the app sidebar's
         * contextual slot rather than rendered into this row — still ONE
         * payload through sidebarNavSlot, and since P4.1 just the mockup's
         * anatomy: this nav, then the chat lists. Files and History left for
         * the dock, which owns them (`SidebarDeckSections.tsx`). */}
        <DeckSidebar
          actions={worktreeActions}
          dialogs={dialogs}
          projectActions={projectActions}
          repos={repos}
          selectRepo={selectRepo}
          selectWorktree={setSelectedWorktreeId}
          selectedRepo={selectedRepo}
          selectedRepoId={selectedRepoId}
          selectedWorktreeId={selectedWorktreeId}
          signals={signals}
          slot={navSlot}
          worktreeRoot={worktreeRoot}
          worktrees={repoWorktrees}
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
              <ControlPlaneBanner
                intervalMs={pollMs}
                kind={controlPlane}
                now={now}
                onRetryNow={retryNow}
                since={unreachableSince}
              />
              {selectedRunId === null ? (
                <DeckPane
                  board={{ model: signals.triage, onOpen: openWorktree }}
                  controlPlane={controlPlane}
                  onOpenRun={openRun}
                  pollMs={pollMs}
                  runs={runs}
                  workspaceId={WORKSPACE_ID}
                />
              ) : (
                <RunDetail key={selectedRunId} runId={selectedRunId} />
              )}
            </main>
          ) : selectedWorktree === null ? (
            // The same board the Deck draws, narrowed to this project —
            // the panel used to say "select a worktree" over nothing.
            <main
              aria-label="workspace"
              className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5"
            >
              <TriageBoard
                model={signals.triage}
                onOpen={openWorktree}
                repoId={selectedRepo.id}
              />
            </main>
          ) : (
            <WorkSurface
              documents={documents}
              onCloseScratch={scratch.close}
              onCloseSplit={deck.closeSplitHalf}
              onCloseView={deck.closeViewTab}
              onPaneAct={runPaneAct}
              onSelectWorktree={setSelectedWorktreeId}
              onSplit={deck.splitActiveTerminal}
              onSplitRatio={deck.changeSplitRatio}
              onTabCommand={runTabCommand}
              onTaskCommand={runTaskCommand}
              onToggleScratch={scratch.toggle}
              paneContext={paneContext}
              panes={panes}
              controlPlane={controlPlane}
              pollMs={pollMs}
              runs={runs}
              scratch={scratch.session}
              selectedWorktreeId={selectedWorktreeId}
              splits={deck.splitLayout}
              stage={deck}
              tabs={selectedTabs}
              tasks={selectedTasks}
              terminals={terminals}
              views={deck.selectedViews}
              worktrees={repoWorktrees}
              workspaceId={WORKSPACE_ID}
            />
          )}
          {selectedRepo === null ? null : (
            <PlanWorktreeDialog
              onCreate={worktreeActions.createWithBrief}
              onOpenChange={dialogs.setPlanningWorktree}
              onOpened={openLocalWorktree}
              open={dialogs.planningWorktree}
              pending={worktreeActions.pending}
              plan={documents.plan.text}
              refusal={worktreeActions.refusal}
              repo={selectedRepo}
              worktreeRoot={worktreeRoot}
            />
          )}
          {/* The scratch markdown buffer, in this box rather than in
           * `WorkSurface` — it needs no worktree, so it has to be able to draw
           * over the landing view and the triage board as well as over the panes.
           * `z-20`, which is the scratch shell's own layer: under the palette,
           * the sheet and the switcher (all `z-30`), over the surface. */}
          {notepad.open ? <ScratchMarkdown buffer={notepad} /> : null}
          {hatch.notice === null ? null : (
            // The escape hatch's one sentence surface (`useEscapeHatch.ts`).
            // Bottom-left rather than centred: it is an answer to something he
            // did, not a question, and the middle of the surface is where the
            // palette and the switcher live. `z-10` — under all four of those,
            // over the panes.
            <p
              className="absolute bottom-2 left-2 z-10 flex max-w-lg items-baseline gap-2 rounded-sm border border-border/60 bg-popover px-2 py-1 text-2xs text-muted-foreground shadow-lg"
              data-testid="escape-hatch-notice"
            >
              <span className="min-w-0">{hatch.notice}</span>
              <button
                aria-label="Dismiss"
                className="ml-auto shrink-0 rounded-sm px-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                data-testid="escape-hatch-notice-dismiss"
                onClick={hatch.dismissNotice}
                type="button"
              >
                ×
              </button>
            </p>
          )}
          {/* Before the palette, so the palette draws over it at the same
           * z — ⌘K over an open sheet is a question about the workspace, and
           * the order here is the order `closeRequest.ts` gives up. */}
          <KeyCheatsheet sheet={sheet} />
          {/* Same box, same z as the palette — see `PlaceSwitcher.tsx`'s
           * header. Before it in the tree so that if the two ever were on
           * screen at once the palette would be the one on top, which is the
           * order `closeRequest.ts` already gives up. */}
          <PlaceSwitcher switcher={switcher} worktrees={repoWorktrees} />
          <CommandPalette palette={palette} />
          {/* The one thing on this screen that opens itself. It draws only on
           * a workspace with no crew and only until it has been answered
           * (`lib/useCrewMint.ts`), so it is last in the tree — over the
           * palette, because it is a question and the palette is not. */}
          <CrewMintDialog crew={crewMint} />
        </div>
      </div>

      {/* STOP rides the status bar, which is the only thing on screen on every
       * screen and every tab — see ProjectStatusBar's own note. */}
      <ProjectStatusBar
        canType={activeTerminalTyping.activeSessionId !== null}
        onEngageStop={() => void engageStop()}
        controlPlane={controlPlane}
        onQuickAction={activeTerminalTyping.typeIntoActiveTerminal}
        onReleaseStop={releaseStop}
        onShowControlPlane={() => void goSettings("home-harbor")}
        onShowHistory={() => showPane("history")}
        repo={selectedRepo}
        run={ownerRun}
        scratchOpen={scratch.session !== null}
        stopEngaged={stopEngaged}
        terminalBacking={terminalBacking}
        worktree={selectedWorktree}
      />
    </div>
  );
}
