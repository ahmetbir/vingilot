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
      // The rest act on the terminal's tab strip, which is on screen whenever
      // this surface is: the terminal is a pane now, not a tab, so there is no
      // longer a state in which these keys would close or reorder something
      // the owner cannot see.
      if (tabs === null) return;
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
          share={layout.collapsed ? 1 : layout.ratio}
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
            onExpand={toggleRightPane}
            title={paneEntry(layout.right).title}
          />
        ) : (
          <>
            <PaneDivider
              onNudge={panes.nudgeRatio}
              onRatio={panes.setRatio}
              onReset={panes.resetRatio}
              onToggle={toggleRightPane}
              ratio={layout.ratio}
              surfaceRef={surfaceRef}
            />
            <RightPane
              context={paneContext}
              onCollapse={toggleRightPane}
              onChoose={panes.choose}
              reachable={reachable}
              right={layout.right}
              runs={runs}
              share={1 - layout.ratio}
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
      share={share}
      side="right"
    >
      {Pane === null ? null : (
        // Keyed by both, because a pane holds a reading of one worktree: the
        // Diff pane's patch and the Runs pane's open run are answers about the
        // worktree that was selected when they were asked for.
        <Pane
          cwd={context.cwd}
          key={`${right}:${worktree?.binding_id ?? "none"}`}
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
 * safe to have at all. */
function CollapsedRail({
  onExpand,
  title,
}: {
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
        title={`${title} — show the right pane (⌥⌘B)`}
        type="button"
      >
        ‹
      </button>
    </div>
  );
}
