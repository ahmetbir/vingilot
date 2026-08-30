// The Deck's three persisted layers — terminal tabs, task chips, splits —
// and every transition between them, as one hook.
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
  runTabCommand: (command: TabCommand) => void;
  runTaskCommand: (command: TaskCommand) => void;
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
      endSessions(change.closed);
    },
    [tabLayout, taskLayout, selectedWorktreeId, endSessions],
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
      endSessions(change.closed);
    },
    [tabLayout, taskLayout, selectedWorktreeId, endSessions],
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

  return {
    changeSplitRatio,
    closeActiveSplit,
    closeSplitHalf,
    closeWorktreesFor,
    dropWorktreesTo,
    ensureSelected,
    runTabCommand,
    runTaskCommand,
    selectedTabs,
    selectedTasks,
    splitActiveTerminal,
    splitLayout,
    tabLayout,
  };
}
