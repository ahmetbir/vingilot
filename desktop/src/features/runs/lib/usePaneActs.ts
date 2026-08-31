// What a pane asks the workspace for, and where each ask lands.
//
// **A pane is a second door, not a second implementation.** Every arm below
// ends on the same state the palette's command table ends on
// (`usePaletteCommands.ts`), which is why the two files look alike and why
// neither of them holds behaviour of its own.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet**
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2 — the palette's
// four new inputs are what pushed it over). The rule is that an edit to a file
// at the ceiling begins with a split, and this was the seam already there: the
// callback reads an act and calls handlers, and knows nothing about the state
// they close over. Same shape, same reason, as `usePaletteCommands.ts`.

import * as React from "react";

import { requestFile } from "@/features/runs/lib/filesTarget";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import type { ViewSubject } from "@/features/runs/lib/viewTabs";
import type { Worktree } from "@/features/runs/lib/projects";
import { defaultDiffBase } from "@/features/runs/lib/worktreeDiff";

export interface PaneActHandlers {
  openPlanWorktree: () => void;
  /** Open a file / commit / diff as a tab beside the shells (P4.1). The
   * screen owns the strip, so the pane asks — the same shape
   * `runInNewTerminal` already has, and for the same reason. */
  openViewTab: (worktree: string, view: ViewSubject) => void;
  /** Remember an opened file for ⌘K's recent rows. */
  rememberOpenFile: (worktree: string, path: string) => void;
  /** Open a fresh terminal tab and type `text` into it (P3 dock — Start Dev,
   * "New terminal here"). The screen owns the strip and the session ids, so
   * the mailbox filing lives with it, not here. */
  runInNewTerminal: (text: string) => void;
  showFiles: () => void;
}

export function usePaneActs(handlers: PaneActHandlers): (act: PaneAct) => void {
  // Held in a ref so the returned callback is stable for the life of the
  // screen, for `usePaletteCommands.ts`'s reason: this screen re-renders on a
  // 2s poll and the panes are memoised on it.
  const held = React.useRef(handlers);
  held.current = handlers;

  return React.useCallback((act: PaneAct) => {
    const on = held.current;
    if (act.type === "plan-to-worktree") {
      on.openPlanWorktree();
      return;
    }
    if (act.type === "run-in-new-terminal") {
      on.runInNewTerminal(act.text);
      return;
    }
    // "Read this beside the shells." Nothing about the dock changes: the tree
    // the owner clicked in keeps its selection, and the tab is where the
    // reading goes (P4.1 items 3 and 4).
    if (act.type === "open-view") {
      on.openViewTab(act.worktree, act.view);
      return;
    }
    // Not a request — a report. **Since P4.1 the workspace no longer holds it
    // as the answer to "which file is open"**: a file opens as a view tab now,
    // so `RunsScreen` derives that from the tab showing rather than from a
    // pane that can only speak while it is mounted. What survives is the one
    // thing the derivation cannot do — remembering the file for ⌘K's recent
    // rows, which is a trail rather than a state. Nothing is opened here:
    // acting on it would reopen the file the pane just opened.
    if (act.type === "file-opened") {
      // `null` is a pane saying it has nothing, which is not a file to
      // remember.
      if (act.path !== null) on.rememberOpenFile(act.worktree, act.path);
      return;
    }
    // "Show me file X at line N in worktree W"
    // (vingilot/docs/plans/2026-08-12-files-pane-design.md, §6). The target is
    // filed BEFORE the pane is brought forward, on purpose: the pane reads
    // whatever is pending on mount, so the order is what makes a request from a
    // pane that is not yet on screen work at all.
    requestFile({ line: act.line, path: act.path, worktree: act.worktree });
    on.showFiles();
  }, []);
}

/** Open a worktree's diff as a view tab, through the act table above.
 *
 * **Here rather than inline in `RunsScreen`, because it is the same act by a
 * second door.** ⌘K's "Read this worktree's diff" row (P4.6) and the dock Diff
 * pane's "Open in tab" button ask for exactly one thing, and routing the
 * palette's copy through `runPaneAct` is what makes them land identically — a
 * soloed dock is put back first, which is `openViewTab`'s own rule and not
 * something a second caller should have to remember.
 *
 * `null` on either side is a workspace standing in no checkout: nothing is
 * opened, which is the same refusal `paletteSources.ts` already blocks the row
 * on. Read twice rather than trusted once, because the row is drawn from a
 * snapshot and Enter happens later. */
export function openDiffTabAct(
  worktree: Worktree | null,
  cwd: string | null,
  run: (act: PaneAct) => void,
): void {
  if (worktree === null || cwd === null) return;
  run({
    type: "open-view",
    view: { base: defaultDiffBase(worktree), kind: "diff" },
    worktree: cwd,
  });
}
