// **What the stage draws** — the shells, the readings, the divider between two
// tabs, and the drop zones a drag lands on.
//
// **Split out of `WorkSurface.tsx` at the 1000-line ratchet** (P4.7; the house
// rule is that an edit to a file at the ceiling begins with a split, and the
// tab split's second reading and third divider are what pushed it over). The
// seam is exactly the one the surface's own header describes: the surface owns
// the ARRANGEMENT — where the dock is, how wide, which side has the whole
// window, and the key map over all of it — and this owns what goes in the
// stage's box.
//
// **Extracting this could not move a terminal, and the distinction matters
// here more than anywhere.** A component boundary adds no DOM node: every
// `<Terminal>` below is still a child of the same `PaneFrame` body it was, in
// the same order, with the same key. `WorkSurface.tsx`'s header is the rule
// this obeys — a terminal that changed parents is a new xterm, a fresh attach
// and a replay into a box that has not been laid out — and it is obeyed the
// only way it can be: the list is rendered in one place, always, and an
// arrangement changes CSS on it rather than where it lives.
//
// **Two readings can be on screen, one per half** (P4.7). Each is keyed by the
// tab it draws, so a reading that changes halves keeps the state it had
// instead of being pointed at a new subject; `ViewTabSurface` keys itself the
// same way for the same reason.

import type * as React from "react";

import type { PaneAct } from "@/features/runs/lib/paneModel";
import type { Worktree } from "@/features/runs/lib/projects";
import type { ScratchSession } from "@/features/runs/lib/scratchTerminal";
import {
  halfOf,
  parseStageKey,
  stageKey,
  type TabSplitHalf,
} from "@/features/runs/lib/tabSplit";
import type { TerminalSession } from "@/features/runs/lib/terminalSessions";
import {
  type SplitLayout,
  splitOf,
  splitSessionId,
} from "@/features/runs/lib/terminalSplit";
import type { StageTabs } from "@/features/runs/lib/useDeckLayers";
import { activeView, type WorktreeViews } from "@/features/runs/lib/viewTabs";
import { ScratchTerminal } from "@/features/runs/ui/ScratchTerminal";
import { StageDropZones } from "@/features/runs/ui/TabDnd";
import { TabSplitDivider } from "@/features/runs/ui/TabSplitDivider";
import { Terminal } from "@/features/runs/ui/Terminal";
import { TerminalSplitDivider } from "@/features/runs/ui/TerminalSplitDivider";
import { ViewTabSurface } from "@/features/runs/ui/ViewTabSurface";

interface StageBodyProps {
  /** Every open PTY session, in visit order — including other projects'. Only
   * the selected worktree's can be on the stage; the rest stay mounted and
   * un-laid-out, which is what makes a project switch cheap. */
  terminals: TerminalSession[];
  selectedWorktreeId: string | null;
  /** The selected worktree's readings and which of them the LEFT half draws. */
  views: WorktreeViews;
  /** Every terminal split, keyed by primary session id — two ptys inside one
   * tab, which is a different thing from the tab split above it. */
  splits: SplitLayout;
  onSplitRatio: (primary: string, ratio: number) => void;
  onCloseSplit: (primary: string) => void;
  /** The tab-split layer (`useDeckLayers.ts`). */
  stage: StageTabs;
  /** Bumped when something asks for the keyboard back in the terminal. */
  focusToken: number;
  /** Where the selected worktree is on disk, or `null` when this app cannot
   * name a directory for it — in which case there is nothing to read. */
  cwd: string | null;
  onPaneAct: (act: PaneAct) => void;
  worktree: Worktree | null;
  scratch: ScratchSession | null;
  onCloseScratch: () => void;
}

export function StageBody({
  cwd,
  focusToken,
  onCloseScratch,
  onCloseSplit,
  onPaneAct,
  onSplitRatio,
  scratch,
  selectedWorktreeId,
  splits,
  stage,
  terminals,
  views,
  worktree,
}: StageBodyProps) {
  const tabSplit = stage.tabSplit;
  // The reading the LEFT half draws, or `null` while a shell does. Read once:
  // it gates the terminals' layout and what the pane body draws, and two
  // readings of one question is how they come to disagree.
  const showingView = activeView(views);
  // Which tab the left half draws — the deck's own answer rather than a second
  // derivation of it, for the same reason.
  const primaryKey = stage.primaryStageTab;
  // The reading in the OTHER half, when there is one and it is a reading.
  const secondaryView = (() => {
    if (tabSplit === null) return null;
    const parsed = parseStageKey(tabSplit.secondary);
    if (parsed === null || parsed.kind !== "view") return null;
    return views.tabs.find((view) => view.id === parsed.id) ?? null;
  })();

  return (
    <>
      {terminals.map((terminal) => {
        // **Which half draws this tab is a CSS answer, and that is the
        // pty-safety invariant.** A tab moving between halves changes this
        // box's `order` and `flex-grow` and nothing else: it is never
        // removed from this list, never reparented, never keyed
        // differently — so the xterm attached to a live pty below cannot
        // be remounted by an arrangement. `null` is "not on the stage",
        // which is `hidden`, which is where every background tab already
        // lives and which `terminalFit.ts` reads as "refuse".
        const half =
          selectedWorktreeId === terminal.bindingId && primaryKey !== null
            ? halfOf(
                tabSplit,
                stageKey({ kind: "terminal", n: terminal.n }),
                primaryKey,
              )
            : null;
        const activeTerminal = half !== null;
        const split = splitOf(splits, terminal.sessionId);
        return (
          // The split host: one tab's box, one or two live shells in it.
          // The primary Terminal's parent (the ratio box) exists in both
          // states, so opening or closing a split never remounts the
          // xterm that was already attached.
          <div
            className={`min-h-0 min-w-0 ${
              activeTerminal ? "flex" : "hidden"
            } ${split?.direction === "down" ? "flex-col" : ""}`}
            data-half={half ?? undefined}
            data-split={split?.direction ?? "none"}
            data-testid={`terminal-split-host-${terminal.sessionId}`}
            key={terminal.sessionId}
            // Clicking into a half is what moves the keyboard there, the
            // way clicking an editor group does. Nothing about the pty is
            // touched: no capture, no focus steal, no resize.
            onPointerDown={() => {
              if (half !== null) stage.focusTabHalf(half);
            }}
            style={halfStyle(half, tabSplit?.ratio ?? null)}
          >
            <div
              className="flex min-h-0 min-w-0 basis-0"
              style={{ flexGrow: split === null ? 1 : split.ratio }}
            >
              {/* **Known nit, stated rather than hidden:** with two SHELLS
               * sharing the stage both are laid out, so both answer a
               * `focusToken` bump and the later one in this list wins — ⌘` can
               * land in the half the keyboard was not in. Passing the token
               * only to the focused half is not the fix it looks like:
               * `Terminal`'s effect fires on any change of the value, so the
               * OTHER half would take focus back the moment its token fell to
               * zero. Nothing is lost either way (the half is one click away),
               * and the honest repair is a per-session monotonic token, which
               * is a change to `Terminal` this round did not need. */}
              <Terminal
                active={activeTerminal}
                cwd={terminal.cwd}
                focusToken={focusToken}
                sessionId={terminal.sessionId}
              />
            </div>
            {split === null ? null : (
              <>
                <TerminalSplitDivider
                  direction={split.direction}
                  onRatio={(next) => onSplitRatio(terminal.sessionId, next)}
                  ratio={split.ratio}
                />
                <div
                  className="relative flex min-h-0 min-w-0 basis-0"
                  style={{ flexGrow: 1 - split.ratio }}
                >
                  <Terminal
                    active={activeTerminal}
                    cwd={terminal.cwd}
                    // Never auto-focused: the keyboard stays where it
                    // was, and the half is a click away.
                    focusToken={0}
                    sessionId={splitSessionId(terminal.sessionId)}
                  />
                  <button
                    aria-label="close this split half and end its shell"
                    // Full-strength resting state on purpose: with
                    // opacity-60 the only affordance for closing a half
                    // measured 2.5:1 on the term ground (P2 verify,
                    // MAJOR 2) — a control may whisper, not vanish.
                    className="absolute right-2 top-2 z-10 rounded-md border border-border/60 bg-popover px-1.5 py-0.5 text-xs text-foreground/75 shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid={`terminal-split-close-${terminal.sessionId}`}
                    onClick={() => onCloseSplit(terminal.sessionId)}
                    title="Close this split half — ends its shell; the tab stays"
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
      {/* The readings, in the terminal pane's own body — beside the
       * shells, never instead of them. Up to TWO of them since P4.7: one
       * per half, each in its own box, each keyed by the tab it draws so a
       * reading that changes halves keeps the state it had rather than
       * being pointed at a new subject. A worktree with no cwd this app
       * can name has nothing to read, and no tab can be opened from
       * anywhere in that state. */}
      {cwd === null ? null : (
        <>
          {showingView === null ? null : (
            <div
              className="flex min-h-0 min-w-0 flex-col"
              data-half="left"
              key={`left:${showingView.id}`}
              onPointerDown={() => stage.focusTabHalf("left")}
              style={halfStyle("left", tabSplit?.ratio ?? null)}
            >
              <ViewTabSurface
                cwd={cwd}
                onPaneAct={onPaneAct}
                tab={showingView}
                worktree={worktree}
              />
            </div>
          )}
          {secondaryView === null ? null : (
            <div
              className="flex min-h-0 min-w-0 flex-col"
              data-half="right"
              key={`right:${secondaryView.id}`}
              onPointerDown={() => stage.focusTabHalf("right")}
              style={halfStyle("right", tabSplit?.ratio ?? null)}
            >
              <ViewTabSurface
                cwd={cwd}
                onPaneAct={onPaneAct}
                tab={secondaryView}
                worktree={worktree}
              />
            </div>
          )}
        </>
      )}
      {/* The third divider this app draws, and the outermost: it moves
       * whole TABS. `TerminalSplitDivider` (two shells inside one tab) and
       * the diff's own Split/Unified column rule can both be on screen
       * under it, legally — `tabSplit.ts`'s header holds the three names. */}
      {tabSplit === null ? null : (
        <TabSplitDivider
          onRatio={stage.changeTabSplitRatio}
          ratio={tabSplit.ratio}
        />
      )}
      {/* Drawn only while a tab is in flight, and never taking a pointer
       * event — see `TabDnd.tsx` for why that costs the terminal below
       * nothing at all. */}
      <StageDropZones split={tabSplit !== null} />
      {scratch === null ? null : (
        // Keyed by the session so a scratch opened somewhere else is a
        // new xterm rather than the old one pointed at a new pty. Drawn
        // over the terminal pane's BODY (PaneFrame's relative wrapper),
        // below its header — so the tab bar, the scratch tab the strip
        // mirrors, and that tab's ✕ stay reachable while the shell is
        // open, the way the mockup's own scratch sits under `.tbar`.
        // Nothing about the terminals underneath is touched either way:
        // they stay mounted, laid out, and the size they were.
        <ScratchTerminal
          key={scratch.sessionId}
          onClose={onCloseScratch}
          scratch={scratch}
        />
      )}
    </>
  );
}

/** A half's box, as two CSS numbers.
 *
 * `order` is what makes the halves GEOMETRY rather than containers: the DOM
 * order here is the shells in strip order and then the readings, which has
 * nothing to do with which of them is on the left — so the right half is
 * `order: 2`, the divider between them is `order: 1`, and everything else stays
 * exactly where it was mounted. That is the whole mechanism behind "a tab
 * changing halves never reattaches, resizes or ends a pty": a box that never
 * moves in the tree cannot take its xterm anywhere. */
function halfStyle(
  half: TabSplitHalf | null,
  ratio: number | null,
): React.CSSProperties {
  if (half === null) return {};
  if (ratio === null) return { flexBasis: 0, flexGrow: 1, order: 0 };
  return half === "left"
    ? { flexBasis: 0, flexGrow: ratio, order: 0 }
    : { flexBasis: 0, flexGrow: 1 - ratio, order: 2 };
}
