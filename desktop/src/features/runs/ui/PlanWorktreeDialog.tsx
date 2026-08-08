// "Turn this plan into a worktree": the branch that will be made, the
// directory it will land in, and the file the plan will become — all shown
// before any of them exists
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 4).
//
// **The branch name is offered, never taken.** `planOffer` derives it from the
// plan's title into an editable field; what git is asked for is whatever is in
// that field. A plan whose title yields no name leaves the field empty with
// the reason beside it, rather than inventing one.
//
// **The plan is read when this opens, not when the palette row was drawn.**
// The document is the owner's live text, and a name derived a minute ago is a
// name for a plan he has since rewritten.
//
// **The outcome is reported in two parts, because it is two things.** A
// worktree can be created and its brief refused — the branch it was opened
// from already carried a file by that name. Nothing is undone in that case and
// nothing is written over; the dialog says the worktree exists, says why the
// brief did not land, and leaves the plan where it is.

import * as React from "react";

import { documentKey } from "@/features/runs/lib/documents";
import {
  BRIEF_FILE,
  briefText,
  planBlocked,
  planOffer,
} from "@/features/runs/lib/planBrief";
import type { Repo } from "@/features/runs/lib/projects";
import { readDocument } from "@/features/runs/lib/documentStore";
import type { BriefedOutcome } from "@/features/runs/lib/useWorktreeActions";
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

/** HEAD, for the reason `NewWorktreeDialog` gives: branching from where the
 * project already is, is what is meant nine times in ten, and it is a ref that
 * always resolves. */
const DEFAULT_BASE = "HEAD";

interface Props {
  repo: Repo;
  worktreeRoot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves the outcome when the worktree was created — which is not the
   * same as the brief having landed — and `null` when nothing was. */
  onCreate: (
    branch: string,
    base: string,
    brief: { name: string; text: string },
  ) => Promise<BriefedOutcome | null>;
  /** The worktree that was just opened, so the workspace can go and stand in
   * it. Called only when one exists. */
  onOpened: (path: string) => void;
  pending: boolean;
  refusal: WorktreeRefusal | null;
}

export function PlanWorktreeDialog({
  onCreate,
  onOpened,
  onOpenChange,
  open,
  pending,
  refusal,
  repo,
  worktreeRoot,
}: Props) {
  const [plan, setPlan] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [base, setBase] = React.useState(DEFAULT_BASE);
  /** A worktree that exists whose brief did not. The one outcome that is
   * neither a success to close on nor a refusal that changed nothing. */
  const [partial, setPartial] = React.useState<BriefedOutcome | null>(null);

  // The plan as it is *now*: read on open, so a dialog reached from the
  // palette and one reached from the pane are looking at the same text.
  React.useEffect(() => {
    if (!open) return;
    const text = readDocument(documentKey("plan", repo.path));
    const offered = planOffer(text);
    setPlan(text);
    setBranch(offered.branch);
    setBase(DEFAULT_BASE);
    setPartial(null);
  }, [open, repo.path]);

  const offer = planOffer(plan);
  const blocked = planBlocked(offer);
  const named = branch.trim();
  const landing =
    worktreeRoot === null || named === ""
      ? null
      : worktreePathFor(worktreeRoot, repo, named);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || blocked !== null) return;
    const outcome = await onCreate(branch, base, {
      name: BRIEF_FILE,
      text: briefText(plan),
    });
    if (outcome === null) return;
    if (outcome.briefRefusal !== null) {
      // The worktree is real. Closing here would report a success the owner
      // did not get, and re-submitting would now fail on a branch that exists.
      setPartial(outcome);
      return;
    }
    onOpened(outcome.path);
    onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="plan-worktree-dialog">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Open a worktree for this plan</DialogTitle>
            <DialogDescription>
              A new branch in {repo.name}, checked out in its own directory,
              with this plan copied in as {BRIEF_FILE}. Nothing already on disk
              is touched: if the branch exists, if something is already at the
              path below, or if that checkout already has a {BRIEF_FILE}, this
              is refused rather than forced.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            {blocked === null ? null : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="plan-worktree-blocked"
              >
                {blocked}
              </p>
            )}

            <label
              className="flex flex-col gap-1"
              htmlFor="plan-worktree-branch"
            >
              <span className="text-xs font-medium text-muted-foreground">
                Branch
              </span>
              <Input
                data-testid="plan-worktree-branch"
                id="plan-worktree-branch"
                onChange={(event) => setBranch(event.target.value)}
                placeholder="from the plan's title"
                value={branch}
              />
            </label>
            <p
              className="text-2xs text-muted-foreground/80"
              data-testid="plan-worktree-derivation"
            >
              {offer.title === null
                ? "this plan has no first line to take a name from — type one."
                : offer.branch === ""
                  ? `nothing in "${offer.title}" can be part of a branch name — type one.`
                  : `offered from this plan's title, "${offer.title}". Change it to anything git will take.`}
            </p>

            <label className="flex flex-col gap-1" htmlFor="plan-worktree-base">
              <span className="text-xs font-medium text-muted-foreground">
                Base
              </span>
              <Input
                data-testid="plan-worktree-base"
                id="plan-worktree-base"
                onChange={(event) => setBase(event.target.value)}
                placeholder={DEFAULT_BASE}
                value={base}
              />
            </label>

            <p
              className="break-all text-2xs text-muted-foreground/80"
              data-testid="plan-worktree-landing"
            >
              {landing === null
                ? "the directory is shown here once the branch has a name"
                : `${landing}, with the plan at ${landing}/${BRIEF_FILE}`}
            </p>

            {partial === null ? null : (
              <div
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
                data-testid="plan-worktree-partial"
              >
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  The worktree was created on {partial.branch}, at{" "}
                  {partial.path} — but the plan was not copied into it:{" "}
                  {partial.briefRefusal?.message} Nothing was removed, and the
                  plan is still in the pane.
                </p>
              </div>
            )}

            {refusal === null ? null : (
              <div
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5"
                data-testid="plan-worktree-refusal"
              >
                <p className="text-xs text-destructive">{refusal.message}</p>
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
              {partial === null ? "Cancel" : "Close"}
            </Button>
            <Button
              data-testid="plan-worktree-create"
              disabled={
                pending || blocked !== null || named === "" || partial !== null
              }
              type="submit"
            >
              {pending ? "Opening…" : "Open worktree"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
