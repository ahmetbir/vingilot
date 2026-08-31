// What ⌘W takes on the workspace, named one rung at a time.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet** — the house rule
// that an edit to a file at the ceiling begins with a split, and P4.7's ⌘W is
// the edit. The seam was already there: the screen held two parallel object
// literals, one saying which surfaces are up and one saying how to take each
// away, and keeping them in step was a rule nothing enforced. Here they are one
// list of pairs, which is the shape the rule actually has.
//
// The order below **is** the resolution order (`closeRequest.ts` is where it is
// written down and tested), outermost last: a dialog is modal over everything;
// the palette opens over the sheet and over the scratch shell, because it is a
// door to both; the sheet draws over the shell; the markdown buffer is before
// its shell sibling because it is a *typing* surface and ⌘W with text on screen
// must take the thing the cursor is in; and past all of them sits the tab.
//
// Nothing decides anything here — `closeRequest.ts` resolves and
// `useCloseRequest.ts` binds the two doors. This is the adapter, and it exists
// so that adding a surface is one entry rather than two.

import {
  type CloseRequestDismissers,
  useCloseRequest,
} from "@/features/runs/lib/useCloseRequest";
import type { StackedSurfaces } from "@/features/runs/lib/closeRequest";

/** One rung: whether it is there, and how to take it away. */
export interface ClosableSurface {
  open: boolean;
  close: () => void;
}

/** One entry per member of `StackedSurfaces`, so a surface added to the model
 * without a way to dismiss it does not compile. */
export type WorkspaceCloseSurfaces = {
  [Surface in keyof StackedSurfaces]: ClosableSurface;
};

export function useWorkspaceCloseRequest(s: WorkspaceCloseSurfaces): void {
  // Written out rather than folded over `Object.entries`: the fold needs two
  // casts through `unknown` to get back to the typed pair, and a cast is
  // exactly the thing that would stop the compiler noticing a surface added to
  // one list and not the other — which is the whole reason this hook exists.
  const stacked: StackedSurfaces = {
    cheatsheet: s.cheatsheet.open,
    closableTab: s.closableTab.open,
    dialog: s.dialog.open,
    palette: s.palette.open,
    scratch: s.scratch.open,
    scratchMarkdown: s.scratchMarkdown.open,
  };
  const dismiss: CloseRequestDismissers = {
    cheatsheet: s.cheatsheet.close,
    closableTab: s.closableTab.close,
    dialog: s.dialog.close,
    palette: s.palette.close,
    scratch: s.scratch.close,
    scratchMarkdown: s.scratchMarkdown.close,
  };
  useCloseRequest(stacked, dismiss);
}
