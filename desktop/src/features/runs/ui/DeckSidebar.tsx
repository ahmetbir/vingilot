// The Deck's whole contribution to the app sidebar, and the portal that puts
// it there.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet** (the house rule:
// an edit to a file at the ceiling begins with a split, and P4.1's view tabs
// are what pushed it over). The seam is one the screen already had: this
// subtree is the ONE payload `sidebarNavSlot.ts` carries, it renders into a
// different part of the document from everything else `RunsScreen` returns,
// and its whole prop list was `WorkspaceNav`'s.
//
// **What moved is also a simplification, not only a move.** The screen was
// spelling out twenty-five individual props at the call site; every one of
// them came from one of four objects it already holds — the worktree actions,
// the dialog states, the project actions, the polled signals — so this
// component takes those four and unpacks them. A new field on any of the four
// is now a change here rather than a change at the call site as well.
//
// A `null` slot renders nothing: the app sidebar's contextual region does not
// exist on every route, and a portal into nowhere is not a fallback position.

import type * as React from "react";
import { createPortal } from "react-dom";

import type { Repo, Worktree } from "@/features/runs/lib/projects";
import type { useWorkspaceDialogs } from "@/features/runs/lib/useWorkspaceDialogs";
import type { useWorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import type { useWorktreeSignals } from "@/features/runs/lib/useWorktreeSignals";
import { SidebarDeckSections } from "@/features/runs/ui/SidebarDeckSections";
import { WorkspaceNav } from "@/features/runs/ui/WorkspaceNav";

/** What `RunsScreen` holds that the nav needs, as the four objects it holds
 * them in. Typed off the hooks rather than restated, so a field that changes
 * shape upstream fails here instead of drifting. */
export interface DeckSidebarProps {
  actions: ReturnType<typeof useWorktreeActions>;
  dialogs: ReturnType<typeof useWorkspaceDialogs>;
  /** `useLocalProjects`' half — adds, removes, and the three notices. Typed
   * structurally because the screen composes it from more than one source. */
  projectActions: {
    addProject: () => void;
    coordinatorNotice: string | null;
    dismissError: () => void;
    dismissImportNotice: () => void;
    error: string | null;
    importNotice: string | null;
    pending: boolean;
    removeProject: (repo: Repo) => void;
    storeNotice: string | null;
  };
  repos: Repo[];
  selectRepo: (id: string) => void;
  selectWorktree: (bindingId: string) => void;
  selectedRepo: Repo | null;
  selectedRepoId: string | null;
  selectedWorktreeId: string | null;
  signals: ReturnType<typeof useWorktreeSignals>;
  /** The app sidebar's contextual region, or `null` on a route with none. */
  slot: Element | null;
  worktreeRoot: string | null;
  /** The open project's worktrees, ordered by `orderWorktrees`. */
  worktrees: Worktree[];
}

export function DeckSidebar({
  actions,
  dialogs,
  projectActions,
  repos,
  selectRepo,
  selectWorktree,
  selectedRepo,
  selectedRepoId,
  selectedWorktreeId,
  signals,
  slot,
  worktreeRoot,
  worktrees,
}: DeckSidebarProps): React.ReactNode {
  if (slot === null) return null;
  return createPortal(
    <SidebarDeckSections
      worktrees={
        <WorkspaceNav
          actions={actions}
          confirming={dialogs.removingProject}
          coordinatorNotice={projectActions.coordinatorNotice}
          creating={dialogs.creatingWorktree}
          error={projectActions.error}
          importNotice={projectActions.importNotice}
          onAddProject={projectActions.addProject}
          onConfirmingChange={dialogs.setRemovingProject}
          onCreatingChange={dialogs.setCreatingWorktree}
          onDismissError={projectActions.dismissError}
          onDismissImportNotice={projectActions.dismissImportNotice}
          onOpenPrune={dialogs.openPrune}
          onPrunePreviewChange={dialogs.setPrunePreview}
          onRemoveProject={projectActions.removeProject}
          onSelectRepo={selectRepo}
          onSelectWorktree={selectWorktree}
          pending={projectActions.pending}
          prunePreview={dialogs.prunePreview}
          repoMarks={signals.byRepo}
          repos={repos}
          selectedRepo={selectedRepo}
          selectedRepoId={selectedRepoId}
          selectedWorktreeId={selectedWorktreeId}
          stats={signals.stats}
          storeNotice={projectActions.storeNotice}
          worktreeMarks={signals.byWorktree}
          worktreeOverlaps={signals.overlaps}
          worktreeRoot={worktreeRoot}
          worktrees={worktrees}
        />
      }
    />,
    slot,
  );
}
