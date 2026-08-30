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
import type { FileReport } from "@/features/runs/lib/placeMru";
import type { PaneAct } from "@/features/runs/lib/paneModel";

export interface PaneActHandlers {
  openPlanWorktree: () => void;
  /** Hold what the Files pane says it has open — a report, `null` path
   * included. */
  reportFile: (report: FileReport) => void;
  /** Remember an opened file for ⌘K's recent rows. A second reader of the same
   * report, never a second report. */
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
    // Not a request — a report. The Files pane is the only surface that knows
    // what it has open, and a place is worktree + pane + file
    // (`placeMru.ts`). Nothing is opened here: acting on it would reopen the
    // file the pane just opened.
    if (act.type === "file-opened") {
      on.reportFile({ path: act.path, worktree: act.worktree });
      // `null` is the viewer saying it has nothing, which is not a file to
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
