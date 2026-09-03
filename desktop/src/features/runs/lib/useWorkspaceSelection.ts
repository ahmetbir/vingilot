// The workspace's selection — which project, which worktree — and the three
// acts on it, moved out of `RunsScreen.tsx` at the 1000-line ratchet
// (2026-09-04) so the first landing could change without the screen growing.
//
// **Idempotent, and that is the whole point.** Choosing a *different* project
// clears the worktree so the auto-select effect lands on its primary checkout
// — that is why disclosing a project immediately shows a terminal. Choosing
// the project you are already standing in must do neither: `selectRepo` has
// three doors (the nav's project row, the collapsed rail's dot, the palette's
// `open-project`), all three of which the owner reaches *while inside* the
// project they name, and clearing the selection there would silently move
// him off the worktree he has open onto `main`. `ProjectRow.tsx` and the
// design's §2.1 both promise this is a no-op; the guard is what makes the
// promise true.
//
// **The first landing is where he was** (`homeLanding.ts`). Once the workspace
// has answered what worktrees exist, with nothing selected and nothing
// requested through `workspaceLanding.ts`, the most recent remembered
// worktree is opened — once. Every later clearing of the selection (the Deck
// row, removing a project) is his act and is left alone.

import * as React from "react";

import { homeLanding, type LandingIndex } from "./homeLanding.ts";
import type { Worktree } from "./projects.ts";
import { readRecent } from "./recentWorktreesStore.ts";
import { pendingLanding } from "./workspaceLanding.ts";

export interface WorkspaceSelectionArgs {
  selectedRepoId: string | null;
  selectedWorktreeId: string | null;
  setSelectedRepoId: (id: string | null) => void;
  setSelectedWorktreeId: (id: string | null) => void;
  setSelectedRunId: (id: string | null) => void;
  /** The open project's worktrees in nav order. */
  repoWorktrees: readonly Worktree[];
  /** Every worktree the workspace knows, by binding id. */
  index: LandingIndex;
  /** True once git has said what worktrees exist. */
  settled: boolean;
}

export interface WorkspaceSelection {
  selectRepo: (id: string) => void;
  /** Also clears any open run detail — clicking "Deck" while already on the
   * landing view is the way back to the Deck from a RunDetail. */
  selectLanding: () => void;
  /** Where a notification lands. Both ids together, because `selectRepo`
   * clears the worktree and the effect below would then put him on the
   * project's primary checkout — the app's last state, which is what the
   * notification existed to skip past. */
  openWorktree: (repoId: string, id: string) => void;
}

export function useWorkspaceSelection({
  index,
  repoWorktrees,
  selectedRepoId,
  selectedWorktreeId,
  setSelectedRepoId,
  setSelectedRunId,
  setSelectedWorktreeId,
  settled,
}: WorkspaceSelectionArgs): WorkspaceSelection {
  const selectRepo = React.useCallback(
    (id: string) => {
      if (id === selectedRepoId) return;
      setSelectedRepoId(id);
      setSelectedWorktreeId(null);
    },
    [selectedRepoId, setSelectedRepoId, setSelectedWorktreeId],
  );
  const selectLanding = React.useCallback(() => {
    setSelectedRepoId(null);
    setSelectedWorktreeId(null);
    setSelectedRunId(null);
  }, [setSelectedRepoId, setSelectedWorktreeId, setSelectedRunId]);
  const openWorktree = React.useCallback(
    (repoId: string, id: string) => {
      setSelectedRepoId(repoId);
      setSelectedWorktreeId(id);
    },
    [setSelectedRepoId, setSelectedWorktreeId],
  );

  // Entering a project with no worktree picked yet lands on its primary
  // checkout (or the first worktree, if there's no primary) rather than an
  // empty "select a worktree" state — the terminal that greets you.
  React.useEffect(() => {
    if (selectedRepoId === null || selectedWorktreeId !== null) return;
    const first =
      repoWorktrees.find((wt) => wt.role === "primary") ?? repoWorktrees[0];
    if (first !== undefined) setSelectedWorktreeId(first.binding_id);
  }, [
    selectedRepoId,
    selectedWorktreeId,
    repoWorktrees,
    setSelectedWorktreeId,
  ]);

  // The first landing, once. A pending request (a ⌘K row from a channel)
  // outranks the memory: it is where he just asked to go. `settled` is git's
  // answer; the coordinator's worktrees arrive on their own poll, so an empty
  // index is "not answered yet" rather than "nothing to land on" — the effect
  // waits for both before it spends its one landing.
  const landed = React.useRef(false);
  React.useEffect(() => {
    if (landed.current || !settled || index.size === 0) return;
    if (selectedRepoId !== null || selectedWorktreeId !== null) return;
    landed.current = true;
    if (pendingLanding() !== null) return;
    const home = homeLanding(readRecent(), index);
    if (home !== null) openWorktree(home.repoId, home.bindingId);
  }, [settled, selectedRepoId, selectedWorktreeId, index, openWorktree]);

  return { openWorktree, selectLanding, selectRepo };
}
