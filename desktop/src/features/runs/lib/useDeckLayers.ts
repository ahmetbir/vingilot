// The Deck's five layers — terminal tabs, task chips, terminal splits, the
// view tabs beside them, and the TAB SPLIT over both tab lists — and every
// transition between them, as one hook.
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
//
// **The fifth layer is the TAB SPLIT, and it owns no tabs** (redesign P4.7;
// owner: "iki tab yan yana acabilmeliyim filan"). `tabSplit.ts` holds one key
// per worktree — which tab the RIGHT half of the stage draws — beside the two
// lists that own tabs, never inside them. That is what keeps the pty-safety
// invariant structural rather than promised: there is no list to move a tab
// *out of*, so "this tab is now in the other half" cannot be spelled as a
// removal and an insertion, which is what would give a live terminal a new
// parent, a new xterm and a fresh attach. Every act below therefore leaves
// `tabLayout` alone unless the owner really closed something, and the split's
// own state changes two CSS numbers on a box that never moves in the tree.
//
// One rule joins the two: **the tab a close acts on is the tab in the focused
// half**. `focusedStageTab` is the single reading of that, and ⌘W
// (`closeKeys.ts`), the context menu's Close and a middle-click all go through
// it — three doors, one answer.

import * as React from "react";

import { ptyClose } from "./ptyClient.ts";
import { readSplitLayout, writeSplitLayout } from "./splitStore.ts";
import {
  closeTabSplit,
  focusTabSplit,
  neighbourKey,
  openTabSplit,
  parseStageKey,
  pruneTabSplits,
  reconcileTabSplit,
  setTabSplitRatio,
  type StageTab,
  stageKey,
  stageOrder,
  type TabSplitHalf,
  type TabSplitLayout,
  type TabSplitState,
  tabSplitOf,
} from "./tabSplit.ts";
import { readTabSplits, writeTabSplits } from "./tabSplitStore.ts";
import {
  applyDeckTabCommand,
  applyTaskCommand,
  pruneTasks,
  reconcileTasks,
  stripView,
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
  activeView,
  clearActiveView,
  closeView,
  emptyViews,
  moveView,
  openView,
  pruneViews,
  selectView,
  type ViewLayout,
  type ViewSubject,
  type WorktreeViews,
  worktreeViews,
} from "./viewTabs.ts";

/** The tab-split layer's whole surface, as one thing to pass down.
 *
 * Split out of `DeckLayers` because `WorkSurface` needs exactly this and
 * nothing else about the deck: eleven more props on a component that already
 * takes thirty would be eleven more chances for the screen and the surface to
 * disagree about which tab is focused. `DeckLayers` extends it, so the screen
 * still passes the deck itself. */
export interface StageTabs {
  /** The selected worktree's tab split, or `null` when one tab has the stage. */
  tabSplit: TabSplitState | null;
  /** Every tab in the strip, in the order the owner sees them — the shells of
   * the active task, then the readings. What the context menu's "others" and
   * "to the right" are computed over, and what a drag reorders within. */
  stageTabs: readonly string[];
  /** The tab the LEFT half draws — the strip's own selection, as a stage key,
   * and `null` on a worktree with no strip yet. One reading of it, because the
   * stage's layout, the strip's lit tab and ⌘W all ask. */
  primaryStageTab: string | null;
  /** The tab in the focused half: what ⌘W, a middle-click and the menu's Close
   * all act on. */
  focusedStageTab: StageTab | null;
  /** Whether closing the focused tab would REMOVE something — false for a lone
   * terminal tab, whose close ends a shell and spawns a fresh one
   * (`terminalTabs.ts`'s `closeTab`). ⌘W must never spend a tmux session to
   * hand back an empty prompt. */
  focusedTabClosable: boolean;
  /** Close the tab in the focused half, through the ordinary close path for
   * whichever kind it is. */
  closeFocusedTab: () => void;
  /** Close a named set of tabs — the context menu's three close scopes, which
   * `tabMenu.ts` turns into keys. */
  closeStageTabs: (keys: readonly string[]) => void;
  /** Put a tab on the stage. Selecting the tab already in the right half moves
   * the keyboard there rather than pulling it back to the left. */
  selectStageTab: (key: string) => void;
  /** ⇧⌘\ — split the stage between two tabs, or put it back. */
  toggleTabSplit: () => void;
  /** Put this tab in the right half beside whatever the left one is drawing. */
  splitTabOut: (key: string) => void;
  /** A drag landed on a half: draw this tab there. */
  moveTabToHalf: (key: string, half: TabSplitHalf) => void;
  focusTabHalf: (half: TabSplitHalf) => void;
  changeTabSplitRatio: (ratio: number) => void;
  /** A drag landed on another tab in the strip: put this one where that one
   * sits, or at the end when `before` is `null`. */
  reorderStageTab: (key: string, before: string | null) => void;
}

export interface DeckLayers extends StageTabs {
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
  // The fifth layer, and the one whose persistence is conditional. Half of
  // what a tab split can hold IS a view, and a reading restored from disk
  // would name something that no longer exists — but a split whose right half
  // is a TERMINAL has nothing to go stale, because the pty outlives the window
  // and the ordinal is its stable name. So the store keeps the terminal ones
  // and drops the rest, on write and again on read (`tabSplitStore.ts`).
  const [tabSplitLayout, setTabSplitLayout] =
    React.useState<TabSplitLayout>(readTabSplits);
  React.useEffect(() => {
    writeTabSplits(tabSplitLayout);
  }, [tabSplitLayout]);

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
      // **Except a rename** (P4.5). Every other command here means "I want the
      // terminal", which is what earns the header's clear-the-view rule; a
      // rename is a label written on a tab, and a reading that vanished off
      // the stage because the owner named a shell behind it would be this
      // rule applied to a gesture it was never about.
      if (command.type !== "rename") showTerminals(selectedWorktreeId);
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
      if (command.type !== "rename-task") showTerminals(selectedWorktreeId);
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
      setTabSplitLayout((prev) => pruneTabSplits(prev, Object.keys(layout)));
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
      setTabSplitLayout((prev) => pruneTabSplits(prev, Object.keys(layout)));
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

  // ── The tab split ────────────────────────────────────────────────────────
  //
  // Everything below is derived from state that already existed. The split
  // adds one key and one ratio; which tab the LEFT half draws is still the
  // strip's own selection, unchanged and unaware — which is why none of this
  // can move a tab between models, and therefore why none of it can move a
  // terminal between parents.
  const tabSplit = tabSplitOf(tabSplitLayout, selectedWorktreeId);
  const showingView = activeView(selectedViews);
  const primaryKey =
    showingView !== null
      ? stageKey({ id: showingView.id, kind: "view" })
      : selectedTabs === null
        ? null
        : stageKey({ kind: "terminal", n: selectedTabs.active });
  // The row the owner sees: the active task's shells, then the readings.
  const stageTabs = React.useMemo(() => {
    if (selectedTabs === null) return [];
    const shown =
      selectedTasks === null
        ? selectedTabs
        : stripView(selectedTabs, selectedTasks);
    return stageOrder(shown.tabs, selectedViews.tabs);
  }, [selectedTabs, selectedTasks, selectedViews]);

  // **The one repair.** A secondary that is not an open tab any more (its
  // reading was closed, its shell ended, its task changed under it) would draw
  // a blank column beside the work; a secondary that has become the left half's
  // tab too would leave the left half drawing nothing at all. Either way the
  // stage goes back to one tab. `reconcileTabSplit` returns its input untouched
  // when nothing is wrong, so this settles instead of looping.
  React.useEffect(() => {
    if (selectedWorktreeId === null) return;
    setTabSplitLayout((prev) => {
      const split = tabSplitOf(prev, selectedWorktreeId);
      if (split === null) return prev;
      if (split.secondary === primaryKey) {
        return closeTabSplit(prev, selectedWorktreeId);
      }
      return reconcileTabSplit(prev, selectedWorktreeId, stageTabs);
    });
  }, [selectedWorktreeId, stageTabs, primaryKey]);

  const focusedKey =
    tabSplit !== null && tabSplit.focus === "right"
      ? tabSplit.secondary
      : primaryKey;
  const focusedStageTab =
    focusedKey === null ? null : parseStageKey(focusedKey);
  const focusedTabClosable =
    focusedStageTab === null
      ? false
      : focusedStageTab.kind === "view" || (selectedTabs?.tabs.length ?? 0) > 1;

  /** Close one tab by key, through the ordinary path for its kind. Every rule
   * those paths keep — the strip is never left empty, a closed ordinal is
   * never reused, a half's shell ends with its tab — is kept for free. */
  const closeStageTab = React.useCallback(
    (key: string) => {
      const tab = parseStageKey(key);
      if (tab === null) return;
      if (tab.kind === "view") closeViewTab(tab.id);
      else runTabCommand({ n: tab.n, type: "close" });
    },
    [closeViewTab, runTabCommand],
  );

  const closeFocusedTab = React.useCallback(() => {
    if (focusedKey !== null) closeStageTab(focusedKey);
  }, [focusedKey, closeStageTab]);

  const closeStageTabs = React.useCallback(
    (keys: readonly string[]) => {
      for (const key of keys) closeStageTab(key);
    },
    [closeStageTab],
  );

  const selectStageTab = React.useCallback(
    (key: string) => {
      if (selectedWorktreeId === null) return;
      // The tab already in the right half: move the keyboard there rather than
      // pulling it back across the divider. Clicking a tab you are looking at
      // must never rearrange the stage.
      if (tabSplit !== null && key === tabSplit.secondary) {
        setTabSplitLayout((prev) =>
          focusTabSplit(prev, selectedWorktreeId, "right"),
        );
        return;
      }
      const tab = parseStageKey(key);
      if (tab === null) return;
      setTabSplitLayout((prev) =>
        focusTabSplit(prev, selectedWorktreeId, "left"),
      );
      if (tab.kind === "view") selectViewTab(tab.id);
      else runTabCommand({ n: tab.n, type: "select" });
    },
    [selectedWorktreeId, tabSplit, selectViewTab, runTabCommand],
  );

  /** Put a tab in the right half.
   *
   * Splitting the tab the LEFT half is drawing is the common case (⇧⌘\ with no
   * argument), and it is the only one that has to move anything: one tab cannot
   * be in two halves — a shell certainly cannot, there is one pty and one xterm
   * behind it — so the left half falls back to the neighbour, exactly the way
   * every close in this app lands. With nothing to fall back to the stage has
   * one tab on it and the act is refused, which is the honest answer. */
  const splitTabOut = React.useCallback(
    (key: string) => {
      if (selectedWorktreeId === null || primaryKey === null) return;
      if (key !== primaryKey) {
        setTabSplitLayout((prev) =>
          openTabSplit(prev, selectedWorktreeId, key, primaryKey),
        );
        return;
      }
      const landing = neighbourKey(stageTabs, key);
      if (landing === null) return;
      const tab = parseStageKey(landing);
      if (tab === null) return;
      if (tab.kind === "view") selectViewTab(tab.id);
      else runTabCommand({ n: tab.n, type: "select" });
      setTabSplitLayout((prev) =>
        openTabSplit(prev, selectedWorktreeId, key, landing),
      );
    },
    [selectedWorktreeId, primaryKey, stageTabs, selectViewTab, runTabCommand],
  );

  const toggleTabSplit = React.useCallback(() => {
    if (selectedWorktreeId === null) return;
    if (tabSplit !== null) {
      setTabSplitLayout((prev) => closeTabSplit(prev, selectedWorktreeId));
      return;
    }
    if (primaryKey !== null) splitTabOut(primaryKey);
  }, [selectedWorktreeId, tabSplit, primaryKey, splitTabOut]);

  const moveTabToHalf = React.useCallback(
    (key: string, half: TabSplitHalf) => {
      if (selectedWorktreeId === null) return;
      if (half === "right") {
        splitTabOut(key);
        return;
      }
      // Dragged back to the left half: it becomes the selection, and if it was
      // the right half's tab the stage has nothing left to draw there, so the
      // split ends — VS Code's own answer to an emptied group.
      const wasSecondary = tabSplit !== null && key === tabSplit.secondary;
      selectStageTab(key);
      if (wasSecondary) {
        setTabSplitLayout((prev) => closeTabSplit(prev, selectedWorktreeId));
      }
    },
    [selectedWorktreeId, tabSplit, splitTabOut, selectStageTab],
  );

  const focusTabHalf = React.useCallback(
    (half: TabSplitHalf) => {
      if (selectedWorktreeId === null) return;
      setTabSplitLayout((prev) =>
        focusTabSplit(prev, selectedWorktreeId, half),
      );
    },
    [selectedWorktreeId],
  );

  const changeTabSplitRatio = React.useCallback(
    (ratio: number) => {
      if (selectedWorktreeId === null) return;
      setTabSplitLayout((prev) =>
        setTabSplitRatio(prev, selectedWorktreeId, ratio),
      );
    },
    [selectedWorktreeId],
  );

  /** The pointer's reorder, routed to whichever list owns the tab.
   *
   * **A shell and a reading cannot be dragged past each other**, and that is
   * structural rather than a missing feature: the strip draws the ordinals and
   * then the readings because they are two models, and interleaving them would
   * mean one ordered list holding both — a thing with no pty inside the model
   * that names ptys, which is exactly what `viewTabs.ts` exists to refuse. A
   * drop across the boundary lands on the end of its own run. */
  const reorderStageTab = React.useCallback(
    (key: string, before: string | null) => {
      if (selectedWorktreeId === null) return;
      const moved = parseStageKey(key);
      if (moved === null) return;
      const target = before === null ? null : parseStageKey(before);
      if (moved.kind === "terminal") {
        runTabCommand({
          before:
            target !== null && target.kind === "terminal" ? target.n : null,
          n: moved.n,
          type: "reorder",
        });
        return;
      }
      setViewLayout((prev) =>
        moveView(
          prev,
          selectedWorktreeId,
          moved.id,
          target !== null && target.kind === "view" ? target.id : null,
        ),
      );
    },
    [selectedWorktreeId, runTabCommand],
  );

  return {
    closeFocusedTab,
    closeStageTabs,
    changeTabSplitRatio,
    focusTabHalf,
    focusedStageTab,
    focusedTabClosable,
    moveTabToHalf,
    primaryStageTab: primaryKey,
    reorderStageTab,
    selectStageTab,
    splitTabOut,
    stageTabs,
    tabSplit,
    toggleTabSplit,
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
