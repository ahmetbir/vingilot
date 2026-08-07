// The prune confirm: what git would remove, before anything is removed
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 3).
//
// **The list is the confirm.** `git worktree prune --dry-run` is asked first
// and its own lines are shown verbatim — "Removing worktrees/fix: gitdir file
// points to non-existent location". Nothing here paraphrases them, because the
// owner is being asked to approve a write to his repository and the only
// trustworthy description of it is git's.
//
// **Prune does not delete a directory**, and the copy says so plainly, because
// the word "prune" beside a list of worktrees reads like one. It removes
// `.git/worktrees/<name>/` for worktrees whose directories git can no longer
// find — a locked worktree is never touched, and a worktree that is still on
// disk is not prunable at all.
//
// A preview that names nothing is not a dialog: there is nothing to approve,
// and the caller is told so rather than being shown an empty list with a
// button under it.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

interface PruneWorktreesDialogProps {
  /** The preview lines, or `null` while none has been asked for. */
  preview: string[] | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}

export function PruneWorktreesDialog({
  onConfirm,
  onOpenChange,
  pending,
  preview,
}: PruneWorktreesDialogProps) {
  const entries = preview ?? [];
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      open={preview !== null}
    >
      <AlertDialogContent data-testid="worktree-prune-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {entries.length === 1
              ? "Prune 1 worktree record?"
              : `Prune ${entries.length} worktree records?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            git named these itself, and would remove only the bookkeeping under{" "}
            <code>.git/worktrees/</code>. No directory and no branch is deleted
            — these entries point at directories git can no longer find. A
            locked worktree is never pruned.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 font-mono text-2xs text-muted-foreground"
          data-testid="worktree-prune-entries"
        >
          {entries.map((line) => (
            <li className="truncate" key={line} title={line}>
              {line}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="worktree-prune-confirm-action"
            disabled={pending}
            onClick={onConfirm}
          >
            Prune records
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
