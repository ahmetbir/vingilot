// The dialogs the workspace can put over its surface, and the one fact three
// other gestures ask about them.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet**, the way
// `usePaletteCommands.ts` and `usePaneActs.ts` were: the house rule is that an
// edit to a file at the ceiling begins with a split, and this was the seam
// already there. Four pieces of state, three derivations over them, and nothing
// else on that screen reads any of the four except through this hook's answer.
//
// **Why they are together and not four `useState`s wherever they are used.**
// Each of the four has two doors — the column's button and the palette's row —
// and both must open the *same* dialog: a "New worktree…" the palette opened
// and a "+ New worktree" the column opened must not be two dialogs that can be
// on screen at once. Holding them here is what makes that true by construction
// rather than by two components agreeing to be careful.
//
// **`anyOpen` is one reading with three readers** — ⌘W's stack, ⌃Tab's
// `blocked`, and the close-request table — because two spellings of "a dialog
// is open" are two things that can come to disagree about the fourth one.
// `dismissAll` closes them together without asking which.
//
// **The crew offer is in that reading, and it is the one that most needs to
// be.** It is held elsewhere (`useCrewMint.ts` owns its state, because only it
// knows when there is a crew to offer) and handed in here, rather than being a
// fifth `useState`, precisely so there is still only one answer to "is a dialog
// up". It is also the only surface on this screen that *raises itself* — so a
// ⌃Tab that cycled worktrees underneath it, or a ⌘W the backend answered by
// closing the window because nothing claimed the key, would both be walking
// away from a question nobody asked to be asked.
//
// No JSX and no Tauri: the screen still renders the dialogs, and this hook
// holds only whether they are up.

import * as React from "react";

import type { Repo } from "@/features/runs/lib/projects";

export interface WorkspaceDialogs {
  creatingWorktree: boolean;
  setCreatingWorktree: (open: boolean) => void;
  planningWorktree: boolean;
  /** Opens or closes the plan's worktree dialog. Opening drops any refusal
   * first: `refusal` is one piece of state shared by both worktree dialogs, so
   * opening this one onto the last one's would explain a failure that was not
   * this attempt's. */
  setPlanningWorktree: (open: boolean) => void;
  /** The entries git says are prunable, once a preview has been read, or
   * `null` for no dialog. */
  prunePreview: string[] | null;
  setPrunePreview: (entries: string[] | null) => void;
  removingProject: Repo | null;
  setRemovingProject: (repo: Repo | null) => void;
  /** Read a prune preview and open the dialog on it. A preview that names
   * nothing is not a dialog — there is nothing to approve, and the refusal, if
   * git gave one, is already on screen. */
  openPrune: () => void;
  /** True while any dialog is up — the four held here and the crew offer. */
  anyOpen: boolean;
  /** Give up all of them. What ⌘W does to this layer of the stack. */
  dismissAll: () => void;
}

/** The crew offer, as this hook needs it: whether it is up, and how to put it
 * away. Structurally the whole of `CrewMint` satisfies it — it is written as
 * two fields so this module stays unaware of minting. */
export interface DismissableDialog {
  open: boolean;
  dismiss: () => void;
}

export interface WorkspaceDialogInputs {
  /** git's own prunable listing, or `null` when it refused. */
  previewPrune: () => Promise<string[] | null>;
  /** Drop the refusal the worktree dialogs share. */
  dismissRefusal: () => void;
  /** The crew offer (`useCrewMint.ts`), folded into this hook's one reading. */
  crew: DismissableDialog;
}

export function useWorkspaceDialogs({
  crew,
  dismissRefusal,
  previewPrune,
}: WorkspaceDialogInputs): WorkspaceDialogs {
  const [creatingWorktree, setCreatingWorktree] = React.useState(false);
  const [planningWorktree, setPlanningWorktree] = React.useState(false);
  const [prunePreview, setPrunePreview] = React.useState<string[] | null>(null);
  const [removingProject, setRemovingProject] = React.useState<Repo | null>(
    null,
  );

  const openPrune = React.useCallback(() => {
    void (async () => {
      const entries = await previewPrune();
      if (entries !== null && entries.length > 0) setPrunePreview(entries);
    })();
  }, [previewPrune]);

  const openPlanWorktree = React.useCallback(
    (open: boolean) => {
      if (open) dismissRefusal();
      setPlanningWorktree(open);
    },
    [dismissRefusal],
  );

  // `crew.dismiss` and not `crew`: the offer hook returns a fresh object every
  // render, and depending on it would hand ⌘W a new dismisser every tick.
  const dismissCrew = crew.dismiss;
  const dismissAll = React.useCallback(() => {
    setCreatingWorktree(false);
    openPlanWorktree(false);
    setPrunePreview(null);
    setRemovingProject(null);
    dismissCrew();
  }, [dismissCrew, openPlanWorktree]);

  return {
    anyOpen:
      creatingWorktree ||
      planningWorktree ||
      prunePreview !== null ||
      removingProject !== null ||
      crew.open,
    creatingWorktree,
    dismissAll,
    openPrune,
    planningWorktree,
    prunePreview,
    removingProject,
    setCreatingWorktree,
    setPlanningWorktree: openPlanWorktree,
    setPrunePreview,
    setRemovingProject,
  };
}
