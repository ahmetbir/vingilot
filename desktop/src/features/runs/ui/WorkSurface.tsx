// The selected worktree's work surface: **the terminal, and the dock**
// (redesign P3 — mockup `.dock`, Vingilot.html:202-325; the pane host it
// grew out of is vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 4).
//
// The left pane is the terminal — iTerm's rule, that the terminal *is* the
// work surface and not a drawer. Beside it (or under it, or floating over
// it) sits the dock: the mockup's six-tab card (`ui/DockShell.tsx`), which
// replaced the `PanePicker` dropdown as the face of the same right-slot
// state — which pane is chosen is still `lib/paneModel.ts`'s, held per
// worktree by `RunsScreen` (`lib/usePanes.ts`) and persisted. This component
// renders that arrangement and owns only the dock's own three:
//
// - **position** — right card / bottom drawer / float, the P1 crew-position
//   store finally read (`vingilot-crew-position.ts`; per its header the
//   "crew" name governs the whole dock, inherited from the mockup's own
//   history). The `.dctl` buttons and ⌘\ write it.
// - **size** — the mockup's `--dockw` (300-540, default 376) and `--dockh`
//   (170-480, default 280), persisted app-wide (`vingilot-dock-size.ts`),
//   clamped by `dockModel.ts` with the terminal's 80-column floor ranked
//   above the dock's.
// - **the Checks/Run overlay** (`DockExtra`) — the two dock-only tabs with
//   no registry pane behind them, transient by design.
//
// It also owns the ⌘1…9 / ⌘` / Esc key map, the terminal-tab keys
// ⌘T / ⇧⌘W / ⌥⌘←→ (`lib/terminalKeys.ts`), ⌥⌘B / ⇧⌥⌘B for the two solos
// (`lib/paneKeys.ts` — ⌥⌘B is now literally the mockup's zen: hide the
// dock), and ⌘\ for float↔right — the mockup's own binding (vingilot.js:50),
// audited free: no key map in this app, and no Tauri menu accelerator,
// resolves Backslash.
//
// **Either side can have the whole surface, and that is not a ratio.** The
// dock hidden (`solo: "left"`) is the terminal alone with the dock on its
// rail; the dock maximised (`solo: "right"`) is the full-surface reading
// layout. The 80-column floor is a rule about *sharing* a row, so it caps
// the dock's width in the right position and has no standing over the
// drawer's height or the float.
//
// **The terminals are rendered here and must never move.** It renders a
// `<Terminal>` per open session (hidden, not torn down, when it is not the one
// showing) but it does not own that list, and must not: this component
// unmounts whenever the owner leaves a project for the landing view, so
// anything it owned would be lost on the way. `RunsScreen` — which stays
// mounted — owns which sessions are open and when one is really closed. What
// survives an unmount here is the pty session itself, whose screen `pty_open`
// replays on reattach.
//
// **A view tab draws in that same box, and cannot disturb it** (redesign
// P4.1, items 3 and 4). A file, a commit's patch or the worktree's diff can
// hold a tab in the strip above; while one is showing, every `<Terminal>`
// below is `hidden` — the exact state a background terminal tab is already in,
// which `terminalFit.ts` reads as "refuse" — and the view renders as a sibling
// in the same pane body. Nothing is unmounted, no session id is passed to the
// view, and no `pty_*` call is on the path. That the reading gets the STAGE
// rather than the dock is the point: at the default layout the stage is more
// than twice the dock card's width, and ⌥⌘B gives it the window.
//
// That is also why the terminal is the pane fixed to the left rather than one
// more thing the picker can move: a terminal that changed slots would change
// parents, which means a new xterm, a fresh attach, and a replay into a
// terminal that has not been laid out. The terminal's frame is unconditional
// below, and `terminalAvailability` is constantly available, so nothing in the
// pane host can unmount a live session. Maximising the *right* pane therefore
// leaves the left frame mounted and merely un-laid-out (`PaneFrame`'s
// `hidden`), which is the state a background terminal tab is already in and
// which `terminalFit.ts` already reads as "refuse". Only the right pane is
// ever really taken down, because a pane can be rebuilt and an xterm attached
// to a live pty cannot.

import * as React from "react";

import type { AttentionMark } from "@/features/runs/lib/attentionSignal";
import type { Worktree } from "@/features/runs/lib/projects";
import {
  clampDockHeight,
  clampDockWidth,
  DOCK_DEFAULT_H,
  DOCK_DEFAULT_W,
  type DockExtra,
  dockFitsBeside,
} from "@/features/runs/lib/dockModel";
import { resolvePaneKey } from "@/features/runs/lib/paneKeys";
import {
  LEFT_PANE,
  type PaneAct,
  type PaneContext,
  type PaneSide,
  type PaneState,
} from "@/features/runs/lib/paneModel";
import type { ControlPlaneKind } from "@/features/runs/lib/reachability";
import type { RunSummary } from "@/features/runs/lib/runModel";
import type { ScratchSession } from "@/features/runs/lib/scratchTerminal";
import {
  stripView,
  type TaskCommand,
  taskOf,
  type WorktreeTaskStrip,
} from "@/features/runs/lib/taskStrip";
import {
  renamableOrdinal,
  stageTabPath,
  type TabCloseScope,
  tabsToClose,
} from "@/features/runs/lib/tabMenu";
import { parseStageKey, stageKey } from "@/features/runs/lib/tabSplit";
import {
  subscribeStripRename,
  takeStripRenameRequest,
} from "@/features/runs/lib/stripRename";
import {
  resolveKey,
  type TerminalKeyAction,
} from "@/features/runs/lib/terminalKeys";
import { isTypingTarget } from "@/features/runs/lib/typingTarget";
import type { TerminalSession } from "@/features/runs/lib/terminalSessions";
import type {
  SplitDirection,
  SplitLayout,
} from "@/features/runs/lib/terminalSplit";
import type {
  TabCommand,
  WorktreeTabs,
} from "@/features/runs/lib/terminalTabs";
import type { RecentDeck, StageTabs } from "@/features/runs/lib/useDeckLayers";
import type { ProjectDocuments } from "@/features/runs/lib/useDocument";
import type { Panes } from "@/features/runs/lib/usePanes";
import type { WorktreeViews } from "@/features/runs/lib/viewTabs";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { StageBody } from "@/features/runs/ui/StageBody";
import { type TabDrop, TabDndProvider } from "@/features/runs/ui/TabDnd";
import { DockFloat } from "@/features/runs/ui/DockFloat";
import { DockResizer } from "@/features/runs/ui/DockResizer";
import { DockShell } from "@/features/runs/ui/DockShell";
import { PaneFrame } from "@/features/runs/ui/PaneFrame";
import { paneEntry } from "@/features/runs/ui/paneRegistry";
import { TaskStrip } from "@/features/runs/ui/TaskStrip";
import { TerminalAgentReadout } from "@/features/runs/ui/TerminalAgentReadout";
import { TerminalTabStrip } from "@/features/runs/ui/TerminalTabStrip";
import { WorktreeSwitcher } from "@/features/runs/ui/WorktreeSwitcher";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import {
  persistVingilotCrewPosition,
  readVingilotCrewPosition,
  type VingilotCrewPosition,
} from "@/shared/theme/vingilot-crew-position";
import {
  persistVingilotDockHeight,
  persistVingilotDockWidth,
  readVingilotDockHeight,
  readVingilotDockWidth,
} from "@/shared/theme/vingilot-dock-size";

interface WorkSurfaceProps {
  workspaceId: string;
  /** Ordered — index N backs the ⌘(N+1) shortcut for N < 9; the same order
   * `WorktreeDisclosure` renders. */
  worktrees: Worktree[];
  /** The dot for each worktree, for the switcher's rows (`useWorktreeSignals`). */
  worktreeMarks: ReadonlyMap<string, AttentionMark>;
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string | null) => void;
  /** Every open PTY session, in visit order, with its resolved cwd — owned
   * by `RunsScreen`. Includes sessions from other projects; only the
   * selected one is ever visible, and keeping the rest mounted is what
   * makes a project switch cheap. */
  terminals: TerminalSession[];
  /** The selected worktree's terminal tabs, or `null` before it has any.
   * Owned by `RunsScreen` for the same reason `terminals` is. */
  tabs: WorktreeTabs | null;
  onTabCommand: (command: TabCommand) => void;
  /** The selected worktree's task chips, reconciled against `tabs` by the
   * owner of both (`RunsScreen`); `null` exactly when `tabs` is. */
  tasks: WorktreeTaskStrip | null;
  onTaskCommand: (command: TaskCommand) => void;
  /** The selected worktree's non-terminal tabs and which of them is showing
   * (P4.1). Owned by `RunsScreen` for the reason `tabs` is. */
  views: WorktreeViews;
  onCloseView: (id: string) => void;
  /** The TAB SPLIT layer, whole (`useDeckLayers.ts`'s `StageTabs`): which tab
   * the other half draws, which half the keyboard is in, and every act that
   * changes either. One prop because it is one subject — eleven would be
   * eleven chances for the screen and this surface to disagree about which tab
   * is focused. */
  /** The deck's stage — and where he has been, on the same object. */
  stage: StageTabs & RecentDeck;
  /** Every terminal split, keyed by primary session id — owned by
   * `RunsScreen` for the reason the tab layout is. */
  splits: SplitLayout;
  /** Split the ACTIVE terminal. The workspace resolves which session that is;
   * the screen owns the layout the split lands in. */
  onSplit: (direction: SplitDirection) => void;
  onCloseSplit: (primary: string) => void;
  onSplitRatio: (primary: string, ratio: number) => void;
  runs: RunSummary[];
  controlPlane: ControlPlaneKind;
  /** The cadence the coordinator polls inside the panes run at — passed with
   * `controlPlane` rather than derived here, so every poll in the app settles
   * together (`lib/reachability.ts`). */
  pollMs: number;
  /** What the panes are allowed to know about this worktree, assembled by
   * `RunsScreen` — it owns the repo/worktree-root pair a cwd derives from, and
   * whether that root has been resolved at all yet. */
  paneContext: PaneContext;
  /** The open project's documents, opened by `RunsScreen` and passed straight
   * through. They are the workspace's rather than the panes' because the
   * workspace acts on one of them — a plan is what a worktree is briefed from
   * — and two readings of one document are two things that can disagree. */
  documents: ProjectDocuments;
  /** The arrangement of this worktree's panes, and the only way to change it. */
  panes: Panes;
  /** What a pane asks the workspace to do (`PaneAct`). Passed straight
   * through: this component hosts panes, it does not decide what their acts
   * mean — `RunsScreen` owns the dialogs they open. */
  onPaneAct: (act: PaneAct) => void;
  /** The scratch shell drawn over this surface, or `null`. Owned by
   * `RunsScreen` for the reason `terminals` is: this component unmounts on the
   * way to the landing view, and a shell it owned would be left running with
   * nothing tracking it. */
  scratch: ScratchSession | null;
  /** The chord's door to the scratch shell — a toggle, so ⌥⌘T is also the way
   * out of what ⌥⌘T opened. */
  onToggleScratch: () => void;
  onCloseScratch: () => void;
}

/** Does this chord act ON a strip, rather than on where the owner is looking?
 *
 * The distinction is the whole of P4.5's key rule. While a rename editor holds
 * the caret, a chord that CHANGES a strip has to be refused — otherwise naming
 * a shell `w` closes it, `t` opens a task and `\` splits the stage, and the
 * three doors this feature adds would each be a way to destroy what you are
 * naming. A chord that merely moves the owner somewhere else needs no refusal:
 * it takes the focus with it, the editor blurs, and a blur commits. So ⌘1…9
 * (another worktree), ⌘` (into and out of the terminal) and ⌥⌘T (the scratch
 * shell) are deliberately absent from this list — they are not exceptions that
 * were forgotten, they are the other half of the rule. */
function actsOnStrip(action: TerminalKeyAction): boolean {
  switch (action.type) {
    case "close-terminal-tab":
    case "move-terminal-tab":
    case "new-task":
    case "split-terminal":
    case "step-terminal-tab":
    case "toggle-tab-split":
      return true;
    default:
      return false;
  }
}

export function WorkSurface({
  controlPlane,
  documents,
  onCloseScratch,
  onCloseSplit,
  onCloseView,
  onPaneAct,
  onSelectWorktree,
  onSplit,
  onSplitRatio,
  onTabCommand,
  onTaskCommand,
  onToggleScratch,
  paneContext,
  panes,
  pollMs,
  runs,
  scratch,
  selectedWorktreeId,
  splits,
  stage,
  tabs,
  tasks,
  terminals,
  views,
  worktrees,
  worktreeMarks,
  workspaceId,
}: WorkSurfaceProps) {
  // The reading on screen, or `null` while a shell is. Read once: it gates the
  // terminals' layout, the strip's lit tab, and what the pane body draws, and
  // three readings of one question is how they come to disagree.
  const tabSplit = stage.tabSplit;
  const [focusToken, setFocusToken] = React.useState(0);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const toggleSolo = panes.toggleSolo;
  const toggleTabSplit = stage.toggleTabSplit;

  // The dock's own three (see the header): where it is, how big, and whether
  // a dock-only panel (Checks/Run) is overlaying the slot's pane.
  const [dockPosition, setDockPosition] = React.useState<VingilotCrewPosition>(
    readVingilotCrewPosition,
  );
  const [dockWidth, setDockWidth] = React.useState(() =>
    readVingilotDockWidth(DOCK_DEFAULT_W),
  );
  const [dockHeight, setDockHeight] = React.useState(() =>
    readVingilotDockHeight(DOCK_DEFAULT_H),
  );
  // The Checks/Run overlay, stamped with the slot pane it was opened over: a
  // pane chosen from anywhere (a tab, ⌘K, useShowPane) changes the stamp's
  // referent and the overlay yields by construction — no effect watching for
  // it, nothing to clear.
  const [extraOver, setExtraOver] = React.useState<{
    at: PaneState["right"];
    extra: DockExtra;
  } | null>(null);

  const setPosition = React.useCallback((position: VingilotCrewPosition) => {
    setDockPosition(position);
    persistVingilotCrewPosition(position);
  }, []);
  const sizeDockWidth = React.useCallback((px: number, surface: number) => {
    const clamped = clampDockWidth(px, surface);
    setDockWidth(clamped);
    persistVingilotDockWidth(clamped);
  }, []);
  const sizeDockHeight = React.useCallback((px: number) => {
    const clamped = clampDockHeight(px);
    setDockHeight(clamped);
    persistVingilotDockHeight(clamped);
  }, []);

  const right = panes.state.right;
  const dockExtra =
    extraOver !== null && extraOver.at === right ? extraOver.extra : null;
  const rightNow = React.useRef(right);
  rightNow.current = right;
  const setDockExtra = React.useCallback((extra: DockExtra | null) => {
    setExtraOver(extra === null ? null : { at: rightNow.current, extra });
  }, []);

  // The right pane's box, the divider, and the rail on each side that brings
  // the hidden pane back. All are read from effects, never during a render.
  const rightPaneRef = React.useRef<HTMLElement | null>(null);
  const dividerRef = React.useRef<HTMLDivElement | null>(null);
  const leftRailRef = React.useRef<HTMLButtonElement | null>(null);
  const rightRailRef = React.useRef<HTMLButtonElement | null>(null);

  // Read by the window key listener, held in refs rather than closed over so
  // that listener is not rebound every time the layout moves — it is bound
  // over a component that renders a live terminal.
  const soloNow = React.useRef(panes.state.solo);
  soloNow.current = panes.state.solo;
  const positionNow = React.useRef(dockPosition);
  positionNow.current = dockPosition;

  // How wide the row the two panes share actually is, because the floors that
  // keep the terminal above 80 columns are in pixels and cannot be applied to
  // a ratio without one (`clampRatioAt`). 0 until it has been measured, which
  // reads as "no floor to apply" rather than as a floor of zero.
  //
  // A layout effect rather than a passive one: the first measurement has to
  // land before `Terminal`'s own effect runs, because being measured is what
  // opens its session and the geometry it opens at is the one tmux adopts for
  // a session restored from a previous app run.
  const [surfaceWidth, setSurfaceWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    setSurfaceWidth(surface.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setSurfaceWidth(measured);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // ── Renaming, one caret at a time (P4.5) ────────────────────────────────
  //
  // Held here rather than inside either strip because three doors open the
  // same editor — a double-click on the chip or tab, the tab menu's "Rename…",
  // and the palette's two rows — and only this component hears all three. It
  // is transient by design: a half-typed name is not layout and is never
  // written anywhere until it is committed.
  const [renaming, setRenaming] = React.useState<
    { kind: "task"; id: number } | { kind: "terminal"; n: number } | null
  >(null);
  // A rename left open when the owner leaves for another worktree is not
  // carried across to a strip it was never about.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the worktree id is the trigger; the body sets a constant
  React.useEffect(() => {
    setRenaming(null);
  }, [selectedWorktreeId]);

  // What the palette's two rows would act on, read at the moment the request
  // arrives rather than closed over — the subscription below is bound once.
  const renameTargets = React.useRef({ tab: 0, task: 0 });
  renameTargets.current = {
    tab: renamableOrdinal(stage.focusedStageTab) ?? 0,
    task:
      tabs === null || tasks === null
        ? 0
        : (taskOf(tasks, tabs.active)?.id ?? 0),
  };
  React.useEffect(() => {
    function check() {
      const request = takeStripRenameRequest();
      if (request === null) return;
      const { tab, task } = renameTargets.current;
      if (request === "task") {
        if (task !== 0) setRenaming({ id: task, kind: "task" });
        return;
      }
      if (tab !== 0) setRenaming({ kind: "terminal", n: tab });
    }
    check();
    return subscribeStripRename(check);
  }, []);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // **A keystroke aimed at a text field belongs to the field** (P4.5).
      // Until the strips gained editors this listener could not reach a caret
      // that was not the terminal's: every field on screen was in the right
      // pane, which the guard further down already refuses. The rename editor
      // is in the tab bar, so ⌘T, ⇧⌘W, ⌥⌘←→, ⇧⌘\ and ⌘\ have to be refused by
      // FOCUS as well as by pane, or naming a shell "w" would close it.
      //
      // Only the acts that change the strips or the stage; ⌘1…9, ⌘` and ⌥⌘T
      // are about where the owner is looking rather than about the strip, and
      // leaving the editor that way blurs it, which commits. `typingTarget.ts`
      // holds the predicate and says why a terminal is not a text field here.
      const typing = isTypingTarget(event.target);
      const input = {
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      };
      // ⌘\ — float↔right, the mockup's own binding (vingilot.js:50). Before
      // the pane map so nothing below can shadow it; `Esc docks back` is the
      // float's own listener (`DockFloat.tsx`).
      // ⇧ is refused explicitly: ⇧⌘\ is P4.7's TAB SPLIT (`terminalKeys.ts`),
      // and on a layout that reports "\" for both readings the dock would
      // otherwise float itself on the way to splitting the stage.
      if (
        input.primaryModifier &&
        !input.altKey &&
        input.shiftKey !== true &&
        input.key === "\\" &&
        input.repeat !== true
      ) {
        if (typing) return;
        event.preventDefault();
        setPosition(positionNow.current === "float" ? "right" : "float");
        return;
      }

      const paneKey = resolvePaneKey(input);
      if (paneKey !== null) {
        event.preventDefault();
        toggleSolo(paneKey.side);
        return;
      }

      const action = resolveKey(input);
      if (action === null) return;
      if (typing && actsOnStrip(action)) return;

      if (action.type === "switch-worktree") {
        const target = worktrees[action.index];
        if (target === undefined) return;
        event.preventDefault();
        onSelectWorktree(target.binding_id);
        return;
      }
      // Both of these put the owner's keystrokes in a terminal, so both have
      // to put a terminal on screen first: while the right pane has the whole
      // surface the left frame has no box, and focus does not land on an
      // element that is not laid out. "Focus the terminal" cannot mean
      // "focus a terminal he cannot see".
      if (action.type === "focus-terminal") {
        event.preventDefault();
        if (soloNow.current === "right") toggleSolo("right");
        setFocusToken((t) => t + 1);
        return;
      }
      // ⌘T brings focus with it as well as opening a task — a shell that
      // opened somewhere the owner's keystrokes were not going would be a
      // shell they have to go looking for. (⌘T means a new task now; the tab
      // bar's + is the new-tab door. `terminalKeys.ts` says why.)
      if (action.type === "new-task") {
        event.preventDefault();
        if (soloNow.current === "right") toggleSolo("right");
        setFocusToken((t) => t + 1);
        onTaskCommand({ type: "new-task" });
        return;
      }
      // ⌘D/⇧⌘D split the active terminal — likewise put it on screen first,
      // and put the keyboard in it, since the split half opens beside where
      // the owner is about to look.
      if (action.type === "split-terminal") {
        event.preventDefault();
        if (soloNow.current === "right") toggleSolo("right");
        setFocusToken((t) => t + 1);
        onSplit(action.direction);
        return;
      }
      // Before the tab guards below, because a scratch shell is not a tab and
      // has nothing to do with the strip: it needs no `tabs`, it does not care
      // which pane the cursor is in, and it must be reachable from a worktree
      // whose strip has not been created yet. The overlay's own listener
      // claims this chord back once it is open (`ScratchTerminal.tsx`), so
      // this arm only ever opens.
      if (action.type === "open-scratch-terminal") {
        event.preventDefault();
        onToggleScratch();
        return;
      }
      if (action.type === "leave-terminal") {
        // Move focus off whatever currently has it (the terminal's own hidden
        // input, most commonly) — this key map only owns focus, not
        // navigation.
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      // The rest act on the terminal's tab strip, and must not fire from
      // inside the other pane.
      //
      // The guard this replaces was `activeTab !== "terminal"`, and dropping
      // it read as being about *visibility* — the terminal is a pane now, so
      // there is no state in which these keys act on something the owner
      // cannot see. But the hazard was always *focus*, and the split is the
      // first time a text field and the terminal have been on screen at once:
      // with the cursor in the Deck's objective field, ⌥⌘→ stepped the tabs
      // and yanked focus into the xterm, and ⇧⌘W closed a tab, which under
      // tmux ends its session.
      if (tabs === null) return;
      const pane = rightPaneRef.current;
      if (
        pane !== null &&
        event.target instanceof Node &&
        pane.contains(event.target)
      ) {
        return;
      }
      if (action.type === "close-terminal-tab") {
        event.preventDefault();
        onTabCommand({ n: tabs.active, type: "close" });
        return;
      }
      // ⇧⌘\ — the TAB SPLIT. Guarded by the same two rules as the tab keys
      // above (a strip to act on, and the cursor not inside the dock), because
      // it is the same kind of act: it rearranges the strip's own stage, and a
      // chord that split the surface while the owner was typing an objective
      // would be the theft that guard exists to prevent.
      if (action.type === "toggle-tab-split") {
        event.preventDefault();
        if (soloNow.current === "right") toggleSolo("right");
        toggleTabSplit();
        return;
      }
      if (action.type === "step-terminal-tab") {
        event.preventDefault();
        onTabCommand({ dir: action.dir, type: "step" });
        setFocusToken((t) => t + 1);
        return;
      }
      if (action.type === "move-terminal-tab") {
        event.preventDefault();
        onTabCommand({ dir: action.dir, type: "move" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    worktrees,
    onSelectWorktree,
    onSplit,
    onTabCommand,
    onTaskCommand,
    onToggleScratch,
    setPosition,
    toggleTabSplit,
    toggleSolo,
    tabs,
  ]);

  const selectedWorktree =
    worktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;
  const leftEntry = paneEntry(LEFT_PANE);
  const layout: PaneState = panes.state;

  // Read from the surface, not only from storage: a window too narrow to
  // seat the terminal's 80 columns beside a 300px dock renders the terminal
  // alone with the dock on its rail — never a card squeezed off-screen. Only
  // the right position shares the terminal's row, so only it can force this.
  const solo: PaneSide | null =
    layout.solo !== null
      ? layout.solo
      : dockPosition === "right" && !dockFitsBeside(surfaceWidth)
        ? "left"
        : null;

  // The dock's drawn geometry. `solo === "right"` gives it the whole surface
  // (the full-width reading layout the old maximise was); otherwise the
  // stored size, clamped against today's surface.
  const dockStyle: React.CSSProperties =
    solo === "right"
      ? { flexBasis: 0, flexGrow: 1 }
      : dockPosition === "drawer"
        ? { height: clampDockHeight(dockHeight) }
        : { width: clampDockWidth(dockWidth, surfaceWidth) };

  const dockDocked = dockPosition !== "float";
  const dockHidden = solo === "left";

  // Giving one side the surface unmounts the control that did it — a rail, a
  // button that went away — and focus lands on `<body>`, which means a
  // keyboard owner has to Tab from the top of the document to get anywhere.
  // So focus follows the surface: to the rail that appeared on the way out,
  // to the dock's resizer on the way back.
  //
  // Only when the act left focus nowhere. ⌥⌘B pressed while typing in the
  // terminal moves the panes too, and taking focus off the terminal then would
  // be the theft this is meant to prevent.
  const wasSolo = React.useRef(solo);
  React.useEffect(() => {
    const moved = solo !== wasSolo.current;
    wasSolo.current = solo;
    if (!moved) return;
    const held = document.activeElement;
    if (held !== null && held !== document.body) return;
    if (solo === null) dividerRef.current?.focus();
    // The rail is on the side that lost its box, which is the other one.
    else if (solo === "left") rightRailRef.current?.focus();
    else leftRailRef.current?.focus();
  }, [solo]);

  // The context menu's three close scopes, resolved against the row the owner
  // right-clicked in (`tabMenu.ts`) and performed through the ordinary close
  // paths, so every rule those keep is kept here for free.
  const closeScope = React.useCallback(
    (key: string, scope: TabCloseScope) => {
      stage.closeStageTabs(tabsToClose(stage.stageTabs, key, scope));
    },
    [stage.closeStageTabs, stage.stageTabs],
  );

  const copyTabPath = React.useCallback(
    (key: string) => {
      const parsed = parseStageKey(key);
      const subject =
        parsed !== null && parsed.kind === "view"
          ? (views.tabs.find((view) => view.id === parsed.id)?.subject ?? null)
          : null;
      const path = stageTabPath(paneContext.cwd, subject);
      if (path !== null) void writeTextToClipboard(path);
    },
    [views.tabs, paneContext.cwd],
  );

  // Where a dragged tab landed. Three answers and one rule each: another tab
  // is a reorder, a half is a move into it, the stage's edge is a new split.
  const onTabDrop = React.useCallback(
    (drop: TabDrop) => {
      if (drop.over === null) return;
      if (drop.over.type === "tab-slot") {
        stage.reorderStageTab(drop.key, drop.over.key);
        return;
      }
      if (drop.over.type === "stage-edge") {
        stage.splitTabOut(drop.key);
        return;
      }
      stage.moveTabToHalf(drop.key, drop.over.half);
    },
    [stage.reorderStageTab, stage.splitTabOut, stage.moveTabToHalf],
  );

  return (
    // One dragging context around the strip AND the stage: a tab dragged out
    // of the row has to have somewhere to land, and a second context would be
    // a second vocabulary (`TabDnd.tsx`).
    <TabDndProvider onDrop={onTabDrop}>
      {/* `relative` costs the layout nothing: a relative box with no offsets
       * occupies exactly the space it did. (The scratch shell now anchors one
       * level deeper — the terminal pane's own body — so its tab bar stays
       * reachable while the shell is open.) */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        data-testid="work-surface"
      >
        {/* The Deck's tasks strip (mockup `.tasks`): full width, above both
         * panes — a task is about the worktree, not about one pane of it. */}
        {tabs !== null && tasks !== null ? (
          <TaskStrip
            activeTaskId={taskOf(tasks, tabs.active)?.id ?? null}
            onClose={(id) => onTaskCommand({ id, type: "close-task" })}
            onNew={() => onTaskCommand({ type: "new-task" })}
            onRenameCancel={() => setRenaming(null)}
            onRenameCommit={(id, name) => {
              setRenaming(null);
              onTaskCommand({ id, name, type: "rename-task" });
            }}
            onRenameStart={(id) => setRenaming({ id, kind: "task" })}
            onSelect={(id) => onTaskCommand({ id, type: "select-task" })}
            renamingId={renaming?.kind === "task" ? renaming.id : null}
            strip={tasks}
          />
        ) : null}
        {/* The mockup's `.card` (vingilot.css): the stage and the dock are
         * SIBLING cards with the window's gradient showing through a 10px gap,
         * not one box split by a divider. `overflow-visible` so each card's
         * own radius and shadow are not clipped by their container. */}
        <div
          className={`flex min-h-0 flex-1 gap-2.5 overflow-visible ${
            dockPosition === "drawer" ? "flex-col" : ""
          }`}
          ref={surfaceRef}
        >
          {solo === "right" && dockDocked ? (
            <PaneRail
              buttonRef={leftRailRef}
              onRestore={() => toggleSolo("right")}
              side="left"
              title={leftEntry.title}
            />
          ) : null}

          <PaneFrame
            card
            // A TAB SPLIT lays this body as a ROW; with one tab on the stage it
            // stays the column it has always been (`PaneFrame.tsx`).
            bodyRow={tabSplit !== null}
            action={
              // The mockup `.tright`: what the worktree's terminal agent is
              // doing, and for how long — empty when nothing is live.
              selectedWorktreeId === null ? null : (
                <TerminalAgentReadout
                  bindingId={selectedWorktreeId}
                  cwd={paneContext.cwd}
                />
              )
            }
            availability={leftEntry.availability(paneContext)}
            // The terminal's context, not its name: which worktree it is in,
            // and the door to another (`WorktreeSwitcher.tsx`).
            chooser={
              <WorktreeSwitcher
                onSelect={onSelectWorktree}
                recent={stage.recentWorktrees}
                selectedWorktreeId={selectedWorktreeId}
                marks={worktreeMarks}
                terminals={terminals}
                worktrees={worktrees}
              />
            }
            entry={leftEntry}
            header={
              tabs === null ? null : (
                <TerminalTabStrip
                  activeViewId={views.active}
                  onClose={(n) => onTabCommand({ n, type: "close" })}
                  onCloseScope={closeScope}
                  onCloseScratch={onCloseScratch}
                  onCloseView={onCloseView}
                  onCopyPath={copyTabPath}
                  onNew={() => onTabCommand({ type: "new" })}
                  onRenameCancel={() => setRenaming(null)}
                  onRenameCommit={(n, name) => {
                    setRenaming(null);
                    onTabCommand({ n, name, type: "rename" });
                  }}
                  onRenameStart={(n) => setRenaming({ kind: "terminal", n })}
                  // Selection goes through the stage rather than straight to the
                  // tab models: which half the keyboard lands in is part of what
                  // clicking a tab means now, and only the stage knows.
                  onSelect={(n) =>
                    stage.selectStageTab(stageKey({ kind: "terminal", n }))
                  }
                  onSelectView={(id) =>
                    stage.selectStageTab(stageKey({ id, kind: "view" }))
                  }
                  onSplitTab={stage.splitTabOut}
                  renamingTab={
                    renaming?.kind === "terminal" ? renaming.n : null
                  }
                  scratchOpen={scratch !== null}
                  splitFocus={tabSplit?.focus ?? null}
                  splitSecondary={tabSplit?.secondary ?? null}
                  // The active task's tabs only (mockup: each task owns its
                  // terminal set); the raw layout stays the model's business.
                  tabs={tasks === null ? tabs : stripView(tabs, tasks)}
                  // The readings, which belong to the worktree rather than to a
                  // task: a file is not a shell and joins no group of them.
                  views={views.tabs}
                />
              )
            }
            // Mounted, un-laid-out. Never unmounted: the xterm instances below
            // are attached to live ptys. A floating dock never takes the
            // terminal's box — it draws OVER it.
            hidden={solo === "right" && dockDocked}
            share={1}
            side="left"
          >
            <StageBody
              cwd={paneContext.cwd}
              focusToken={focusToken}
              onCloseScratch={onCloseScratch}
              onCloseSplit={onCloseSplit}
              onPaneAct={onPaneAct}
              onSplitRatio={onSplitRatio}
              scratch={scratch}
              selectedWorktreeId={selectedWorktreeId}
              splits={splits}
              stage={stage}
              terminals={terminals}
              views={views}
              worktree={selectedWorktree}
            />
          </PaneFrame>

          {/* The dock's resize rail (mockup `.rz2`) — only while the dock is
           * really sharing the surface in a docked position. */}
          {solo === null && dockDocked ? (
            dockPosition === "drawer" ? (
              <DockResizer
                axis="y"
                focusRef={dividerRef}
                onSize={sizeDockHeight}
                size={clampDockHeight(dockHeight)}
              />
            ) : (
              <DockResizer
                axis="x"
                focusRef={dividerRef}
                onSize={(px) => sizeDockWidth(px, surfaceWidth)}
                size={clampDockWidth(dockWidth, surfaceWidth)}
              />
            )
          ) : null}

          {dockHidden ? (
            <PaneRail
              buttonRef={rightRailRef}
              onRestore={() => toggleSolo("left")}
              side="right"
              title="Dock"
            />
          ) : dockDocked ? (
            <DockShell
              context={paneContext}
              controlPlane={controlPlane}
              documents={documents}
              extra={dockExtra}
              frameRef={rightPaneRef}
              onChoose={panes.choose}
              onExtra={setDockExtra}
              onPaneAct={onPaneAct}
              onPosition={setPosition}
              pollMs={pollMs}
              position={dockPosition}
              right={layout.right}
              runs={runs}
              style={dockStyle}
              workspaceId={workspaceId}
              worktree={selectedWorktree}
            />
          ) : null}
        </div>
        {/* The floating dock (mockup `.float`): over the surface, the terminal
         * keeping its whole box underneath. Hidden by zen like the docked card
         * — one meaning for ⌥⌘B, wherever the dock is. */}
        {dockPosition === "float" && !dockHidden ? (
          <DockFloat onDockBack={setPosition}>
            <DockShell
              context={paneContext}
              controlPlane={controlPlane}
              documents={documents}
              extra={dockExtra}
              frameRef={rightPaneRef}
              onChoose={panes.choose}
              onExtra={setDockExtra}
              onPaneAct={onPaneAct}
              onPosition={setPosition}
              pollMs={pollMs}
              position={dockPosition}
              right={layout.right}
              runs={runs}
              variant="float"
              workspaceId={workspaceId}
              worktree={selectedWorktree}
            />
          </DockFloat>
        ) : null}
      </div>
    </TabDndProvider>
  );
}

const PANE_BUTTON_CLASS =
  "shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground";

// The RightPane component that stood here — `PaneFrame` chrome, the
// `PanePicker` dropdown, the ⤢/› header buttons — was retired by the P3
// dock (`ui/DockShell.tsx`), which is the same slot state wearing the
// mockup's fixed tab strip. `PanePicker` itself stays compiled for now
// (P7 sweep candidate); the terminal's header is `WorktreeSwitcher` now.

/** A side that has no box, reduced to the way back. A hidden pane plus a
 * shortcut the owner has to remember is a trap — the same reason
 * `WorkspaceNav` keeps a rail — and it is what makes either solo safe to
 * have at all. For a keyboard owner it is only not a trap if focus arrives
 * here when the pane goes; the work surface sees to that.
 *
 * One component for both sides, because there is one act behind them: the rail
 * always restores the split, and it is the same act as pressing the chord
 * again. Two rails written apart would be two chances to disagree about what
 * "back" means. */
function PaneRail({
  buttonRef,
  onRestore,
  side,
  title,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onRestore: () => void;
  /** The side the rail *is*, which is the side whose pane is hidden. */
  side: PaneSide;
  title: string;
}) {
  const chord = side === "right" ? "⌥⌘B" : "⇧⌥⌘B";
  return (
    <div
      className={`flex min-h-0 w-9 shrink-0 flex-col items-center py-3 ${
        side === "right" ? "border-l" : "border-r"
      } border-border/60`}
      data-testid={`pane-${side}-rail`}
    >
      <button
        aria-label={`show the ${title} pane`}
        className={PANE_BUTTON_CLASS}
        data-testid={`pane-${side}-expand`}
        onClick={onRestore}
        ref={buttonRef}
        title={`${title} — back to the split (${chord})`}
        type="button"
      >
        {side === "right" ? "‹" : "›"}
      </button>
    </div>
  );
}
