// The Deck's four layers — terminal tabs, task chips, splits, and the view
// tabs beside them — and every transition between them, as one hook.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet** (the house
// rule: an edit to a file at the ceiling begins with a split, and P2's task
// and split layers are what pushed it over). The seam is the same one
// `usePaletteCommands.ts` used: the screen holds selection and dialogs; what
// moved here is the state that outlives `WorkSurface` (which unmounts on the
// way to the landing view) and the transition table over it. One subject —
// "which shells exist, how they are grouped, and which really closed" — so
// the travel-together rules the three models state (`TabLayoutChange`,
// `DeckChange`, `SplitChange`) are all honoured in one place.
//
// **`endSessions` is the one door to `pty_close` for tab-model closes.** The
// tab model names the tabs it ended; the split model answers with the halves
// those tabs were carrying (`cascadeSplits`), which the tab model has no
// name for; both sets of ptys end together. A caller that closed a tab list
// directly would leave a split half running behind nothing.
//
// **The view layer is the fourth, and it touches no pty at all** (P4.1 items
// 3 and 4). `viewTabs.ts` says why it is a second list rather than a flag on
// the ordinals; what this hook adds is the one rule that joins them: **every
// command that puts a shell on screen clears the showing view**. ⌘T, a tab
// click, ⌥⌘→, closing a tab, switching task — each of them means "I want the
// terminal", so each of them ends with `clearActiveView`. Nothing in the other
// direction: opening a view neither closes, hides, resizes nor reattaches a
// terminal, it only stops being the thing laid out — the state a background
// tab is already in, and the one `terminalFit.ts` reads as "refuse".

import * as React from "react";

import { ptyClose } from "./ptyClient.ts";
import { readSplitLayout, writeSplitLayout } from "./splitStore.ts";
import {
  applyDeckTabCommand,
  applyTaskCommand,
  pruneTasks,
  reconcileTasks,
  type TaskCommand,
  type TaskLayout,
  type WorktreeTaskStrip,
} from "./taskStrip.ts";
import { readTaskLayout, writeTaskLayout } from "./taskStripStore.ts";
import {
  cascadeSplits,
  closeSplit,
  openSplit,
  pruneSplits,
  setSplitRatio,
  type SplitDirection,
  type SplitLayout,
} from "./terminalSplit.ts";
import {
  closeWorktrees,
  dropWorktrees,
  ensureWorktree,
  sessionIdFor,
  type TabCommand,
  type TabLayout,
  type WorktreeTabs,
  worktreeTabs,
} from "./terminalTabs.ts";
import { readTabLayout, writeTabLayout } from "./terminalTabStore.ts";
import {
  clearActiveView,
  closeView,
  emptyViews,
  openView,
  pruneViews,
  selectView,
  type ViewLayout,
  type ViewSubject,
  type WorktreeViews,
  worktreeViews,
} from "./viewTabs.ts";

export interface DeckLayers {
  /** Which worktrees have terminals open and which tabs each holds — the
   * layer `openTerminals` renders from and the sweep is reconciled against. */
  tabLayout: TabLayout;
  /** Every split, keyed by primary session id. */
  splitLayout: SplitLayout;
  /** The selected worktree's strip, or `null` before it has one. */
  selectedTabs: WorktreeTabs | null;
  /** The selected worktree's chips, reconciled against `selectedTabs` on
   * every read (`reconcileTasks` is idempotent and reference-stable). */
  selectedTasks: WorktreeTaskStrip | null;
  /** The selected worktree's view tabs and which of them is showing. Never
   * `null`: a worktree with no views and one nobody has visited are the same
   * answer (`viewTabs.ts`). */
  selectedViews: WorktreeViews;
  runTabCommand: (command: TabCommand) => void;
  runTaskCommand: (command: TaskCommand) => void;
  /** Open a file / commit / diff as a tab beside the shells, or focus the tab
   * already open for it. */
  openViewTab: (subject: ViewSubject) => void;
  selectViewTab: (id: string) => void;
  closeViewTab: (id: string) => void;
  /** Split the ACTIVE tab's terminal — ⌘D/⇧⌘D and the palette rows. */
  splitActiveTerminal: (direction: SplitDirection) => void;
  closeSplitHalf: (primary: string) => void;
  closeActiveSplit: () => void;
  changeSplitRatio: (primary: string, ratio: number) => void;
  /** Give a worktree its first strip — visiting one is what opens it. */
  ensureSelected: (bindingId: string) => void;
  /** The owner removed these worktrees: their shells end now, not at the
   * next poll. */
  closeWorktreesFor: (bindingIds: readonly string[]) => void;
  /** Reconcile against the live worktree set — the polled complement of
   * `closeWorktreesFor`, with `dropWorktrees`' empty-read caution intact. */
  dropWorktreesTo: (live: readonly string[]) => void;
}

export function useDeckLayers(selectedWorktreeId: string | null): DeckLayers {
  // Each layer seeded from and mirrored back into storage: this hook's host
  // is the screen that never unmounts while the workspace is on, and the
  // write is what carries the layout across a restart to meet the tmux
  // sessions that were already surviving one (`terminalTabStore.ts`).
  const [tabLayout, setTabLayout] = React.useState<TabLayout>(readTabLayout);
  React.useEffect(() => {
    writeTabLayout(tabLayout);
  }, [tabLayout]);
  const [taskLayout, setTaskLayout] =
    React.useState<TaskLayout>(readTaskLayout);
  React.useEffect(() => {
    writeTaskLayout(taskLayout);
  }, [taskLayout]);
  const [splitLayout, setSplitLayout] =
    React.useState<SplitLayout>(readSplitLayout);
  React.useEffect(() => {
    writeSplitLayout(splitLayout);
  }, [splitLayout]);
  // The one layer with no store behind it. `viewTabs.ts` says why: a view tab
  // is a read of a file or a patch AS IT IS NOW, and restoring one from
  // storage would put last week's reading on screen wearing a live tab's
  // chrome. It lives as long as the workspace does, which is the life of the
  // reading.
  const [viewLayout, setViewLayout] = React.useState<ViewLayout>(emptyViews);

  // The repair `pruneSplits` documents: a stored split whose primary never
  // became a tab this run (a crash between the two layout writes,
  // hand-edited storage) would otherwise sit in localStorage forever (P2
  // verify, minor 1). Pruned against the ids the tab model can actually
  // produce; `pruneSplits` returns its input untouched when nothing drops,
  // so this settles instead of looping.
  React.useEffect(() => {
    const open: string[] = [];
    for (const [bindingId, worktree] of Object.entries(tabLayout)) {
      for (const n of worktree.tabs) open.push(sessionIdFor(bindingId, n));
    }
    setSplitLayout((prev) => pruneSplits(prev, open));
  }, [tabLayout]);

  // Read through a ref where a close handler needs "the splits as of now"
  // without re-binding on every divider drag.
  const splitsNow = React.useRef(splitLayout);
  splitsNow.current = splitLayout;

  const endSessions = React.useCallback((closed: readonly string[]) => {
    if (closed.length === 0) return;
    const cascade = cascadeSplits(splitsNow.current, closed);
    if (cascade.closed.length > 0) setSplitLayout(cascade.splits);
    for (const sessionId of closed) void ptyClose(sessionId);
    for (const sessionId of cascade.closed) void ptyClose(sessionId);
  }, []);

  // Every shell gesture ends here: the terminals come forward, and whatever
  // was being read stays a tab away. See this file's header.
  const showTerminals = React.useCallback((bindingId: string) => {
    setViewLayout((prev) => clearActiveView(prev, bindingId));
  }, []);

  const runTabCommand = React.useCallback(
    (command: TabCommand) => {
      if (selectedWorktreeId === null) return;
      const change = applyDeckTabCommand(
        tabLayout,
        taskLayout,
        selectedWorktreeId,
        command,
      );
      setTabLayout(change.layout);
      setTaskLayout(change.tasks);
      showTerminals(selectedWorktreeId);
      endSessions(change.closed);
    },
    [tabLayout, taskLayout, selectedWorktreeId, endSessions, showTerminals],
  );

  const runTaskCommand = React.useCallback(
    (command: TaskCommand) => {
      if (selectedWorktreeId === null) return;
      const change = applyTaskCommand(
        tabLayout,
        taskLayout,
        selectedWorktreeId,
        command,
      );
      setTabLayout(change.layout);
      setTaskLayout(change.tasks);
      showTerminals(selectedWorktreeId);
      endSessions(change.closed);
    },
    [tabLayout, taskLayout, selectedWorktreeId, endSessions, showTerminals],
  );

  const openViewTab = React.useCallback(
    (subject: ViewSubject) => {
      if (selectedWorktreeId === null) return;
      setViewLayout((prev) => openView(prev, selectedWorktreeId, subject));
    },
    [selectedWorktreeId],
  );
  const selectViewTab = React.useCallback(
    (id: string) => {
      if (selectedWorktreeId === null) return;
      setViewLayout((prev) => selectView(prev, selectedWorktreeId, id));
    },
    [selectedWorktreeId],
  );
  const closeViewTab = React.useCallback(
    (id: string) => {
      if (selectedWorktreeId === null) return;
      setViewLayout((prev) => closeView(prev, selectedWorktreeId, id));
    },
    [selectedWorktreeId],
  );

  const ensureSelected = React.useCallback((bindingId: string) => {
    setTabLayout((prev) => ensureWorktree(prev, bindingId));
  }, []);

  const closeWorktreesFor = React.useCallback(
    (bindingIds: readonly string[]) => {
      const { closed, layout } = closeWorktrees(tabLayout, bindingIds);
      if (closed.length === 0) return;
      setTabLayout(layout);
      setTaskLayout((prev) => pruneTasks(prev, layout));
      setViewLayout((prev) => pruneViews(prev, Object.keys(layout)));
      endSessions(closed);
    },
    [tabLayout, endSessions],
  );

  const dropWorktreesTo = React.useCallback(
    (live: readonly string[]) => {
      const { closed, layout } = dropWorktrees(tabLayout, live);
      if (closed.length === 0) return;
      setTabLayout(layout);
      setTaskLayout((prev) => pruneTasks(prev, layout));
      setViewLayout((prev) => pruneViews(prev, Object.keys(layout)));
      endSessions(closed);
    },
    [tabLayout, endSessions],
  );

  const selectedTabs =
    selectedWorktreeId === null
      ? null
      : worktreeTabs(tabLayout, selectedWorktreeId);

  const selectedTasks = React.useMemo(() => {
    if (selectedWorktreeId === null || selectedTabs === null) return null;
    return reconcileTasks(
      Object.hasOwn(taskLayout, selectedWorktreeId)
        ? taskLayout[selectedWorktreeId]
        : null,
      selectedTabs,
    );
  }, [selectedWorktreeId, selectedTabs, taskLayout]);

  // The active tab's session id — what ⌘D acts on. Splitting is a fact
  // about a session, so the handlers live beside the ids.
  const activePrimary =
    selectedWorktreeId === null || selectedTabs === null
      ? null
      : sessionIdFor(selectedWorktreeId, selectedTabs.active);
  const splitActiveTerminal = React.useCallback(
    (direction: SplitDirection) => {
      if (activePrimary === null) return;
      setSplitLayout((prev) => openSplit(prev, activePrimary, direction));
    },
    [activePrimary],
  );
  const closeSplitHalf = React.useCallback((primary: string) => {
    const change = closeSplit(splitsNow.current, primary);
    if (change.closed.length === 0) return;
    setSplitLayout(change.splits);
    for (const sessionId of change.closed) void ptyClose(sessionId);
  }, []);
  const closeActiveSplit = React.useCallback(() => {
    if (activePrimary !== null) closeSplitHalf(activePrimary);
  }, [activePrimary, closeSplitHalf]);
  const changeSplitRatio = React.useCallback(
    (primary: string, ratio: number) => {
      setSplitLayout((prev) => setSplitRatio(prev, primary, ratio));
    },
    [],
  );

  const selectedViews = worktreeViews(viewLayout, selectedWorktreeId ?? "");

  return {
    changeSplitRatio,
    closeActiveSplit,
    closeSplitHalf,
    closeViewTab,
    closeWorktreesFor,
    dropWorktreesTo,
    ensureSelected,
    openViewTab,
    runTabCommand,
    runTaskCommand,
    selectViewTab,
    selectedTabs,
    selectedTasks,
    selectedViews,
    splitActiveTerminal,
    splitLayout,
    tabLayout,
  };
}
