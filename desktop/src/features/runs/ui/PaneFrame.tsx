// One side of the split: a header that says which pane this is, and the pane
// under it.
//
// The header is where a pane is *chosen*, not a bar above both sides. That is
// the whole difference between this and the tab strip it replaces: a global
// tab bar makes the two halves one selection, and the point of the split is
// that they are two. The left header names its pane and the right header
// picks one, and neither disturbs the other.
//
// **An unavailable pane keeps its frame.** The header still says which pane
// the owner asked for and the body says why it cannot answer here — a pane
// that vanished would read as a bug in the picker, and one that rendered empty
// would read as a worktree with nothing in it.
//
// **A pane is a stacking context, so a z-index inside a pane is a number about
// the pane** (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task
// 1). Without that it is a number about the whole workspace, and the owner
// found out: with a team thread open, ⌘K was painted under the channel's header
// and its composer. Measured at 1728×1117 — the palette is `absolute inset-0
// z-30` in `RunsScreen`'s work-surface box, and every element between that box
// and the hosted channel screen (`work-surface`, this section, `pane-team`,
// `team-thread-inset`, `team-thread`, `channel-drop-zone`) was `z-index: auto`
// with no transform and no isolation, so none of them created a stacking
// context. `ChannelPane`'s top chrome (`absolute inset-x-0 z-40`) and its
// composer overlay (`absolute inset-x-0 bottom-0 z-40`) were therefore ranked
// against the palette directly, and 40 beats 30.
//
// `isolate` here rather than a higher z on the palette, and that is the whole
// point: raising the palette answers this surface and loses to the next one.
// A pane hosting a surface it did not write cannot know what numbers that
// surface uses, and must not have to — so it confines them. The cost is
// nothing visible: the section is `overflow-hidden`, so anything inside it was
// already clipped to it, and Radix menus and tooltips portal to `document.body`
// and are outside this context either way.

import type * as React from "react";

import type { PaneAvailability } from "@/features/runs/lib/paneModel";
import type { PaneEntry } from "@/features/runs/ui/paneRegistry";

interface PaneFrameProps {
  entry: PaneEntry;
  availability: PaneAvailability;
  /** `left` or `right` — the testid and the aria label, so a spec can address
   * a side without knowing which pane is currently in it. */
  side: "left" | "right";
  /** This side's share of the surface. Applied as a flex grow factor against a
   * zero basis, so the two sides split whatever the divider leaves without
   * either one being able to push the other out of the row.
   *
   * **"Whatever the divider leaves" is `surfaceWidth − DIVIDER_PX`**, and that
   * is the width `paneModel.ts` applies its floors to. A share computed
   * against the whole surface would put the terminal a column under the floor
   * that is supposed to guarantee it. */
  share: number;
  /** The picker, or a static label for a side that does not offer one. */
  chooser: React.ReactNode;
  /** Anything the pane wants in its own header, beside the chooser — the
   * terminal's tab strip is the only one so far. */
  header?: React.ReactNode;
  /** The buttons this side offers over its own width — hide, maximise. */
  action?: React.ReactNode;
  /** True when the *other* side has the whole surface. The frame stays
   * mounted and stops being laid out, which is not the same as not being
   * rendered: the terminal's xterm instances live inside the left frame and
   * cannot be unmounted without losing them (`WorkSurface.tsx` says why), so
   * "the right pane is maximised" has to mean a left frame that is still here
   * and merely has no box. `terminalFit.ts` already reads a 0×0 container as
   * "refuse", which is the same state a background terminal tab is in.
   *
   * Applied as an inline style rather than as `hidden` or a `hidden` class:
   * Tailwind's preflight `[hidden] { display: none }` is emitted *before* the
   * utilities, so the `flex` on this element would win on source order, and
   * two display utilities in one class list is the same coin toss. */
  hidden?: boolean;
  /** This side's own box, for a caller that has to ask whether something is
   * inside it — the work surface's key map does, since the terminal's tab
   * shortcuts must not fire while the owner is typing in the other pane. */
  frameRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export function PaneFrame({
  action,
  availability,
  chooser,
  children,
  entry,
  frameRef,
  header,
  hidden = false,
  share,
  side,
}: PaneFrameProps) {
  return (
    <section
      aria-label={`${side} pane`}
      className="isolate flex min-h-0 min-w-0 basis-0 flex-col overflow-hidden"
      data-pane={entry.id}
      data-testid={`pane-${side}`}
      ref={frameRef}
      style={{
        display: hidden ? "none" : undefined,
        flexGrow: share,
      }}
    >
      {/* min-h 42px — the mockup `.tbar`'s height, worn by both panes so the
       * two headers stay level (redesign P2). */}
      <div className="flex min-h-[42px] shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1">
        {chooser}
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {header}
        </div>
        {action}
      </div>
      {/* `relative` so a surface drawn OVER this pane's body (the scratch
       * shell) can anchor to exactly the body — leaving the header above it,
       * with its tabs, reachable. It costs the layout nothing. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {availability.status === "available" ? (
          children
        ) : (
          <PaneNotice availability={availability} />
        )}
      </div>
    </section>
  );
}

/** What a pane says when its backing is not there. Two states, deliberately
 * worded apart: a pending pane is waiting for an answer, an unavailable one
 * has had it. Reading the first as the second is how an owner gets told his
 * worktree has no checkout half a second after launch. */
function PaneNotice({ availability }: { availability: PaneAvailability }) {
  if (availability.status === "available") return null;
  const pending = availability.status === "pending";
  return (
    <p
      className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-muted-foreground"
      data-testid={pending ? "pane-pending" : "pane-unavailable"}
    >
      {pending ? availability.note : availability.reason}
    </p>
  );
}
