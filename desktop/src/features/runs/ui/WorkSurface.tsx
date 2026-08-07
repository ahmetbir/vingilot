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
// ⌘T / ⇧⌘W / ⌥⌘←→ (`lib/terminalKeys.ts`), and ⌥⌘B / ⇧⌥⌘B for the two solos
// (`lib/paneKeys.ts`) — VS Code's secondary-sidebar chord and its mirror, left
// unclaimed by `lib/columnKeys.ts` until there was a pane to bind them to.
//
// **Either side can have the whole surface, and that is not a ratio.** The
// four panes this host replaced a tab bar with were full-surface tabs; a right
// pane whose ceiling is `1 - clampRatioAt(MIN_RATIO, w)` — 442px of 1195 —
// takes that away with no gesture to get it back. So the layout has three
// shapes rather than one collapse flag, and the floor that keeps the terminal
// at 80 columns applies to the split and to nothing else: it is a rule about
// *sharing* a surface, and it has no standing over a pane that is not sharing
// one.
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
// pane host can unmount a live session. Maximising the *right* pane therefore
// leaves the left frame mounted and merely un-laid-out (`PaneFrame`'s
// `hidden`), which is the state a background terminal tab is already in and
// which `terminalFit.ts` already reads as "refuse". Only the right pane is
// ever really taken down, because a pane can be rebuilt and an xterm attached
// to a live pty cannot.

import * as React from "react";

import type { Worktree } from "@/features/runs/lib/projects";
import { resolvePaneKey } from "@/features/runs/lib/paneKeys";
import {
  clampRatioAt,
  LEFT_PANE,
  type PaneContext,
  type PaneSide,
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
  const toggleSolo = panes.toggleSolo;

  // The right pane's box, the divider, and the rail on each side that brings
  // the hidden pane back. All are read from effects, never during a render.
  const rightPaneRef = React.useRef<HTMLElement | null>(null);
  const dividerRef = React.useRef<HTMLDivElement | null>(null);
  const leftRailRef = React.useRef<HTMLButtonElement | null>(null);
  const rightRailRef = React.useRef<HTMLButtonElement | null>(null);

  // Read by the window key listener, held in a ref rather than closed over so
  // that listener is not rebound every time the layout moves — it is bound
  // over a component that renders a live terminal.
  const soloNow = React.useRef(panes.state.solo);
  soloNow.current = panes.state.solo;

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
      const paneKey = resolvePaneKey(input);
      if (paneKey !== null) {
        event.preventDefault();
        toggleSolo(paneKey.side);
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
      // ⌘T brings focus with it as well as adding a tab — a shell that opened
      // somewhere the owner's keystrokes were not going would be a shell they
      // have to go looking for.
      if (action.type === "new-terminal-tab") {
        event.preventDefault();
        if (soloNow.current === "right") toggleSolo("right");
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
  }, [worktrees, onSelectWorktree, onTabCommand, toggleSolo, tabs]);

  const selectedWorktree =
    worktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;
  const leftEntry = paneEntry(LEFT_PANE);
  const layout: PaneState = panes.state;
  // What the owner asked for, honoured as far as this surface can. The stored
  // ratio stays his — a window too narrow to keep the terminal at 80 columns
  // does not rewrite it, it only declines to draw it.
  const ratio = clampRatioAt(layout.ratio, surfaceWidth);

  const solo = layout.solo;

  // Giving one side the surface unmounts or un-lays-out the control that did
  // it — the divider, or a button in the header that just went away — and
  // focus lands on `<body>`, which means a keyboard owner has to Tab from the
  // top of the document to get anywhere. So focus follows the surface: to the
  // rail that appeared on the way out, to the divider on the way back.
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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="work-surface"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden" ref={surfaceRef}>
        {solo === "right" ? (
          <PaneRail
            buttonRef={leftRailRef}
            onRestore={() => toggleSolo("right")}
            side="left"
            title={leftEntry.title}
          />
        ) : null}

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
          // Mounted, un-laid-out. Never unmounted: the xterm instances below
          // are attached to live ptys.
          hidden={solo === "right"}
          share={solo === null ? ratio : 1}
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

        {solo === null ? (
          <PaneDivider
            focusRef={dividerRef}
            onNudge={panes.nudgeRatio}
            onRatio={panes.setRatio}
            onReset={panes.resetRatio}
            onSolo={toggleSolo}
            ratio={ratio}
            surfaceRef={surfaceRef}
          />
        ) : null}

        {solo === "left" ? (
          <PaneRail
            buttonRef={rightRailRef}
            onRestore={() => toggleSolo("left")}
            side="right"
            title={paneEntry(layout.right).title}
          />
        ) : (
          <RightPane
            context={paneContext}
            frameRef={rightPaneRef}
            onChoose={panes.choose}
            onSolo={toggleSolo}
            reachable={reachable}
            right={layout.right}
            runs={runs}
            share={solo === null ? 1 - ratio : 1}
            solo={solo}
            worktree={selectedWorktree}
            workspaceId={workspaceId}
          />
        )}
      </div>
    </div>
  );
}

const PANE_BUTTON_CLASS =
  "shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground";

function RightPane({
  context,
  frameRef,
  onChoose,
  onSolo,
  reachable,
  right,
  runs,
  share,
  solo,
  worktree,
  workspaceId,
}: {
  context: PaneContext;
  frameRef: React.RefObject<HTMLElement | null>;
  onChoose: Panes["choose"];
  onSolo: Panes["toggleSolo"];
  reachable: boolean;
  right: PaneState["right"];
  runs: RunSummary[];
  share: number;
  /** `"right"` while this pane has the whole surface, `null` in the split.
   * Never `"left"` — the caller renders a rail instead of this component. */
  solo: PaneSide | null;
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
  const maximised = solo === "right";

  return (
    <PaneFrame
      action={
        <>
          {/* The gesture the four ported panes lost. `MIN_LEFT_PX` caps this
              pane at 37% of the surface while it is sharing one; it is not
              sharing one here, so the cap does not apply. */}
          <button
            aria-label={
              maximised
                ? "share the surface with the terminal again"
                : "give this pane the whole surface"
            }
            aria-pressed={maximised}
            className={PANE_BUTTON_CLASS}
            data-testid="pane-right-maximize"
            onClick={() => onSolo("right")}
            title={
              maximised
                ? "Back to the split (⇧⌥⌘B)"
                : "Give this pane the whole surface (⇧⌥⌘B)"
            }
            type="button"
          >
            {maximised ? "⤡" : "⤢"}
          </button>
          <button
            aria-label="hide the right pane"
            className={PANE_BUTTON_CLASS}
            data-testid="pane-right-collapse"
            onClick={() => onSolo("left")}
            title="Hide the right pane (⌥⌘B)"
            type="button"
          >
            ›
          </button>
        </>
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

/** A side that has no box, reduced to the way back. A hidden pane plus a
 * shortcut the owner has to remember is a trap — the same reason
 * `WorktreeColumn` keeps a rail — and it is what makes either solo safe to
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
