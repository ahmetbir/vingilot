// The selected worktree's work surface: **left pane, divider, right pane**
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 4).
//
// The left pane is the terminal — iTerm's rule, that the terminal *is* the
// work surface and not a drawer. The right pane is a slot, and what goes in it
// is chosen from that pane's own header (`ui/PanePicker.tsx`) out of the pane
// registry (`ui/paneRegistry.tsx`). The two sides are independent, and that
// independence is the whole feature: the tab bar this replaces made reading a
// diff cost the terminal.
//
// Which pane, how wide, and whether the right slot is showing at all are
// `lib/paneModel.ts`'s, held per worktree by `RunsScreen` (`lib/usePanes.ts`)
// and persisted. This component renders that arrangement and owns no part of
// it.
//
// It also owns the ⌘1…9 / ⌘` / Esc key map, the terminal-tab keys
// ⌘T / ⇧⌘W / ⌥⌘←→ (`lib/terminalKeys.ts`), and ⌥⌘B for the right pane
// (`lib/paneKeys.ts`) — VS Code's secondary-sidebar chord, left unclaimed by
// `lib/columnKeys.ts` until there was a pane to bind it to.
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
// That is also why the terminal is the pane fixed to the left rather than one
// more thing the picker can move: a terminal that changed slots would change
// parents, which means a new xterm, a fresh attach, and a replay into a
// terminal that has not been laid out. The terminal's frame is unconditional
// below, and `terminalAvailability` is constantly available, so nothing in the
// pane host can unmount a live session — the collapse hides the *right* side,
// never this one.

import * as React from "react";

import type { Worktree } from "@/features/runs/lib/projects";
import { resolvePaneKey } from "@/features/runs/lib/paneKeys";
import {
  clampRatioAt,
  LEFT_PANE,
  type PaneContext,
  type PaneState,
  rightChoices,
} from "@/features/runs/lib/paneModel";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { resolveKey } from "@/features/runs/lib/terminalKeys";
import type { TerminalSession } from "@/features/runs/lib/terminalSessions";
import type {
  TabCommand,
  WorktreeTabs,
} from "@/features/runs/lib/terminalTabs";
import type { Panes } from "@/features/runs/lib/usePanes";
import { PaneDivider } from "@/features/runs/ui/PaneDivider";
import { PaneFrame } from "@/features/runs/ui/PaneFrame";
import { PaneLabel, PanePicker } from "@/features/runs/ui/PanePicker";
import { paneEntry } from "@/features/runs/ui/paneRegistry";
import { Terminal } from "@/features/runs/ui/Terminal";
import { TerminalTabStrip } from "@/features/runs/ui/TerminalTabStrip";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

interface WorkSurfaceProps {
  workspaceId: string;
  /** Ordered — index N backs the ⌘(N+1) shortcut for N < 9; the same order
   * `WorktreeColumn` renders. */
  worktrees: Worktree[];
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string) => void;
  /** Every open PTY session, in visit order, with its resolved cwd — owned
   * by `RunsScreen`. Includes sessions from other projects; only the
   * selected one is ever visible, and keeping the rest mounted is what
   * makes a project switch cheap. */
  terminals: TerminalSession[];
  /** The selected worktree's terminal tabs, or `null` before it has any.
   * Owned by `RunsScreen` for the same reason `terminals` is. */
  tabs: WorktreeTabs | null;
  onTabCommand: (command: TabCommand) => void;
  runs: RunSummary[];
  reachable: boolean;
  /** What the panes are allowed to know about this worktree, assembled by
   * `RunsScreen` — it owns the repo/worktree-root pair a cwd derives from, and
   * whether that root has been resolved at all yet. */
  paneContext: PaneContext;
  /** The arrangement of this worktree's panes, and the only way to change it. */
  panes: Panes;
}

export function WorkSurface({
  onSelectWorktree,
  onTabCommand,
  paneContext,
  panes,
  reachable,
  runs,
  selectedWorktreeId,
  tabs,
  terminals,
  worktrees,
  workspaceId,
}: WorkSurfaceProps) {
  const [focusToken, setFocusToken] = React.useState(0);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const toggleRightPane = panes.toggleCollapsed;

  // The right pane's box, the divider, and the rail that brings the pane back.
  // All three are read from effects, never during a render.
  const rightPaneRef = React.useRef<HTMLElement | null>(null);
  const dividerRef = React.useRef<HTMLDivElement | null>(null);
  const expandRef = React.useRef<HTMLButtonElement | null>(null);

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

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const input = {
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      };
      if (resolvePaneKey(input) !== null) {
        event.preventDefault();
        toggleRightPane();
        return;
      }

      const action = resolveKey(input);
      if (action === null) return;

      if (action.type === "switch-worktree") {
        const target = worktrees[action.index];
        if (target === undefined) return;
        event.preventDefault();
        onSelectWorktree(target.binding_id);
        return;
      }
      if (action.type === "focus-terminal") {
        event.preventDefault();
        setFocusToken((t) => t + 1);
        return;
      }
      // ⌘T brings focus with it as well as adding a tab — a shell that opened
      // somewhere the owner's keystrokes were not going would be a shell they
      // have to go looking for.
      if (action.type === "new-terminal-tab") {
        event.preventDefault();
        setFocusToken((t) => t + 1);
        onTabCommand({ type: "new" });
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
  }, [worktrees, onSelectWorktree, onTabCommand, toggleRightPane, tabs]);

  const selectedWorktree =
    worktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;
  const leftEntry = paneEntry(LEFT_PANE);
  const layout: PaneState = panes.state;
  // What the owner asked for, honoured as far as this surface can. The stored
  // ratio stays his — a window too narrow to keep the terminal at 80 columns
  // does not rewrite it, it only declines to draw it.
  const ratio = clampRatioAt(layout.ratio, surfaceWidth);

  // Collapsing the right pane unmounts the control that collapsed it — the
  // divider, or the × in its header — and focus lands on `<body>`, which
  // means a keyboard owner has to Tab from the top of the document to get
  // anywhere. So focus follows the surface: to the rail on the way out, to the
  // divider on the way back.
  //
  // Only when the act left focus nowhere. ⌥⌘B pressed while typing in the
  // terminal collapses the pane too, and moving focus off the terminal then
  // would be the theft this is meant to prevent.
  const wasCollapsed = React.useRef(layout.collapsed);
  React.useEffect(() => {
    const moved = layout.collapsed !== wasCollapsed.current;
    wasCollapsed.current = layout.collapsed;
    if (!moved) return;
    const held = document.activeElement;
    if (held !== null && held !== document.body) return;
    (layout.collapsed ? expandRef.current : dividerRef.current)?.focus();
  }, [layout.collapsed]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="work-surface"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden" ref={surfaceRef}>
        <PaneFrame
          availability={leftEntry.availability(paneContext)}
          chooser={<PaneLabel entry={leftEntry} />}
          entry={leftEntry}
          header={
            tabs === null ? null : (
              <TerminalTabStrip
                onClose={(n) => onTabCommand({ n, type: "close" })}
                onNew={() => onTabCommand({ type: "new" })}
                onSelect={(n) => onTabCommand({ n, type: "select" })}
                tabs={tabs}
              />
            )
          }
          share={layout.collapsed ? 1 : ratio}
          side="left"
        >
          {terminals.map((terminal) => (
            <Terminal
              active={
                selectedWorktreeId === terminal.bindingId &&
                tabs?.active === terminal.n
              }
              cwd={terminal.cwd}
              focusToken={focusToken}
              key={terminal.sessionId}
              sessionId={terminal.sessionId}
            />
          ))}
        </PaneFrame>

        {layout.collapsed ? (
          <CollapsedRail
            expandRef={expandRef}
            onExpand={toggleRightPane}
            title={paneEntry(layout.right).title}
          />
        ) : (
          <>
            <PaneDivider
              focusRef={dividerRef}
              onNudge={panes.nudgeRatio}
              onRatio={panes.setRatio}
              onReset={panes.resetRatio}
              onToggle={toggleRightPane}
              ratio={ratio}
              surfaceRef={surfaceRef}
            />
            <RightPane
              context={paneContext}
              frameRef={rightPaneRef}
              onCollapse={toggleRightPane}
              onChoose={panes.choose}
              reachable={reachable}
              right={layout.right}
              runs={runs}
              share={1 - ratio}
              worktree={selectedWorktree}
              workspaceId={workspaceId}
            />
          </>
        )}
      </div>
    </div>
  );
}

function RightPane({
  context,
  frameRef,
  onChoose,
  onCollapse,
  reachable,
  right,
  runs,
  share,
  worktree,
  workspaceId,
}: {
  context: PaneContext;
  frameRef: React.RefObject<HTMLElement | null>;
  onChoose: Panes["choose"];
  onCollapse: () => void;
  reachable: boolean;
  right: PaneState["right"];
  runs: RunSummary[];
  share: number;
  worktree: Worktree | null;
  workspaceId: string;
}) {
  const entry = paneEntry(right);
  const availability = entry.availability(context);
  const choices = rightChoices().map((id) => {
    const choice = paneEntry(id);
    return { availability: choice.availability(context), entry: choice };
  });
  const Pane = entry.component;

  return (
    <PaneFrame
      action={
        <button
          aria-label="hide the right pane"
          className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          data-testid="pane-right-collapse"
          onClick={onCollapse}
          title="Hide the right pane (⌥⌘B)"
          type="button"
        >
          ›
        </button>
      }
      availability={availability}
      chooser={
        <PanePicker choices={choices} current={entry} onChoose={onChoose} />
      }
      entry={entry}
      frameRef={frameRef}
      share={share}
      side="right"
    >
      {Pane === null ? null : (
        // Keyed by what the pane says it is a reading of, not by the worktree.
        // The host cannot answer that for a pane it knows nothing about: Diff
        // is a reading of one worktree and must be re-taken when it changes,
        // Runs is a reading of the workspace and would lose a half-typed
        // objective every time the owner pressed ⌘2.
        <Pane
          cwd={context.cwd}
          key={`${right}:${entry.identity(context)}`}
          onChoosePane={onChoose}
          ownerRunId={context.ownerRunId}
          reachable={reachable}
          runs={runs}
          worktree={worktree}
          workspaceId={workspaceId}
        />
      )}
    </PaneFrame>
  );
}

/** The right side when it is hidden: a rail whose only job is to be the way
 * back. A collapsed pane plus a shortcut the owner has to remember is a trap —
 * the same reason `WorktreeColumn` keeps a rail — and it is what makes ⌥⌘B
 * safe to have at all. For a keyboard owner it is only not a trap if focus
 * arrives here when the pane goes; the work surface sees to that. */
function CollapsedRail({
  expandRef,
  onExpand,
  title,
}: {
  expandRef: React.RefObject<HTMLButtonElement | null>;
  onExpand: () => void;
  title: string;
}) {
  return (
    <div
      className="flex min-h-0 w-9 shrink-0 flex-col items-center border-l border-border/60 py-3"
      data-testid="pane-right-rail"
    >
      <button
        aria-label={`show the ${title} pane`}
        className="rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        data-testid="pane-right-expand"
        onClick={onExpand}
        ref={expandRef}
        title={`${title} — show the right pane (⌥⌘B)`}
        type="button"
      >
        ‹
      </button>
    </div>
  );
}
