// **The workspace handing its one selected checkout to whoever is outside it**
// (vingilot/docs/plans/2026-08-29-redesign.md, P5).
//
// `shared/lib/worktreeFocus.ts` is the snapshot; this is its only writer. It
// lives in its own module rather than as ten more lines inside `RunsScreen.tsx`
// because that file is 985 lines against a 1000-line ratchet that is
// split-never-raise — and because a publisher with one job reads better than a
// publisher buried among a screen's twenty other effects.
//
// **It publishes what the screen already derived, and derives nothing.**
// `selectedWorktreeCwd` is `RunsScreen`'s own (`worktreeCwd(repo, worktree,
// root)`); the label is the nav row's own (`worktreeSummary().label`). A second
// derivation here would be a second answer to a question the screen has already
// answered, and the two would drift.
//
// **Nothing is published while the path is still being worked out.** The
// worktree root is an async home-directory lookup, so `cwd` is legitimately
// `null` for the first frames of a cold start. Publishing that `null` would
// wipe a stored focus the owner could still use, and the pane would say
// "nothing is selected" about a machine that has a checkout open. So `null`
// clears the snapshot only once the screen has settled — while it is unsettled
// the last good snapshot stands.

import * as React from "react";

import { publishFocus } from "@/shared/lib/worktreeFocus";

export interface WorktreeFocusInput {
  /** `RunsScreen`'s `selectedWorktreeCwd` — `null` when nothing is selected or
   * the worktree root has not resolved. */
  cwd: string | null;
  /** The owning project's name as the workspace names it. */
  repoName: string | null;
  /** The nav row's label for this checkout — its branch, or its role. */
  label: string | null;
  /** `rootSettled`: false while the worktree-root lookup is still out. */
  settled: boolean;
}

/** Publish the workspace's selected checkout for surfaces mounted outside it.
 *
 * Called from a screen that re-renders on a poll; `publishFocus` returns
 * without writing when nothing moved, so this runs every render for free. */
export function usePublishWorktreeFocus(focus: WorktreeFocusInput): void {
  const { cwd, label, repoName, settled } = focus;
  React.useEffect(() => {
    if (cwd === null) {
      if (settled) publishFocus(null);
      return;
    }
    publishFocus({ label: label ?? "", path: cwd, repoName: repoName ?? "" });
  }, [cwd, label, repoName, settled]);
}
