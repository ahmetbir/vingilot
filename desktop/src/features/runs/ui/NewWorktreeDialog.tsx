// "New worktree": a branch name, a base ref, and where it will land — shown
// before it happens, because the owner is about to get a directory on his own
// disk and should know which one (vingilot/docs/plans/2026-08-07-workspace-v1.md,
// Task 6).
//
// The path is derived, not typed. It comes from `worktreePathFor`, the same
// worktree root the executor checks Run worktrees out under, so everything
// this app creates is under one directory he can find in a shell. Showing it
// is what keeps that from being a secret.

import * as React from "react";

import type { Repo } from "@/features/runs/lib/projects";
import {
  type WorktreeRefusal,
  worktreePathFor,
} from "@/features/runs/lib/worktreePlan";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

interface NewWorktreeDialogProps {
  repo: Repo;
  worktreeRoot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the worktree was created; the dialog stays open on
   * false so the refusal is read where the fields still are. */
  onCreate: (branch: string, base: string) => Promise<boolean>;
  pending: boolean;
  refusal: WorktreeRefusal | null;
}

/** HEAD, because branching from where the project already is, is what the
 * owner means nine times in ten — and it is a ref that always resolves, so
 * the field is never a puzzle to fill in. */
const DEFAULT_BASE = "HEAD";

export function NewWorktreeDialog({
  onCreate,
  onOpenChange,
  open,
  pending,
  refusal,
  repo,
  worktreeRoot,
}: NewWorktreeDialogProps) {
  const [branch, setBranch] = React.useState("");
  const [base, setBase] = React.useState(DEFAULT_BASE);

  // A fresh dialog every time it opens: a branch name left over from a
  // previous attempt is the one thing that could make an accidental Enter
  // create something unexpected.
  React.useEffect(() => {
    if (!open) return;
    setBranch("");
    setBase(DEFAULT_BASE);
  }, [open]);

  const landing =
    worktreeRoot === null || branch.trim() === ""
      ? null
      : worktreePathFor(worktreeRoot, repo, branch.trim());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (await onCreate(branch, base)) onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="new-worktree-dialog">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>New worktree in {repo.name}</DialogTitle>
            <DialogDescription>
              A new branch, checked out in its own directory. Nothing already on
              disk is touched: if the branch exists, or something is already at
              the path below, this is refused rather than forced.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <label
              className="flex flex-col gap-1"
              htmlFor="new-worktree-branch"
            >
              <span className="text-xs font-medium text-muted-foreground">
                Branch
              </span>
              <Input
                data-testid="new-worktree-branch"
                id="new-worktree-branch"
                onChange={(event) => setBranch(event.target.value)}
                placeholder="fix-the-thing"
                value={branch}
              />
            </label>

            <label className="flex flex-col gap-1" htmlFor="new-worktree-base">
              <span className="text-xs font-medium text-muted-foreground">
                Base
              </span>
              <Input
                data-testid="new-worktree-base"
                id="new-worktree-base"
                onChange={(event) => setBase(event.target.value)}
                placeholder={DEFAULT_BASE}
                value={base}
              />
            </label>

            <p className="break-all text-2xs text-muted-foreground/80">
              {landing === null
                ? "the directory is shown here once the branch has a name"
                : landing}
            </p>

            {refusal === null ? null : (
              <div
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5"
                data-testid="new-worktree-refusal"
              >
                <p className="text-sm text-destructive">{refusal.message}</p>
                {refusal.entries.length === 0 ? null : (
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-2xs text-muted-foreground">
                    {refusal.entries.map((entry) => (
                      <li className="truncate" key={entry}>
                        {entry}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              data-testid="new-worktree-create"
              disabled={pending || branch.trim() === ""}
              type="submit"
            >
              {pending ? "Creating…" : "Create worktree"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
