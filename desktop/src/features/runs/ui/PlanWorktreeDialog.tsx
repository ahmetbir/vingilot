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
// **The plan is handed in, live, and is never read back out of storage.**
// `RunsScreen` opens the document (`lib/useDocument.ts`) and both doors onto
// this dialog — the Plan pane's button and the palette's row — are given the
// same value the pane's textarea is showing. This dialog used to read the
// document from storage when it opened, which is a debounce behind: a plan
// rewritten and acted on straight away briefed the worktree with the text the
// owner had already replaced, and a plan typed from nothing was "empty" here
// while the pane's own button offered the act. A flush before the read would
// not have been a fix — it cannot cover what is typed after it, and the copy
// taken at open never caught up afterwards either.
//
// **The outcome is reported in two parts, because it is two things.** A
// worktree can be created and its brief refused — the branch it was opened
// from already carried a file by that name. Nothing is undone in that case and
// nothing is written over; the dialog says the worktree exists, says why the
// brief did not land, and leaves the plan where it is.

import * as React from "react";

import {
  BRIEF_FILE,
  briefText,
  planBlocked,
  planOffer,
} from "@/features/runs/lib/planBrief";
import type { Repo } from "@/features/runs/lib/projects";
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
  /** The project's plan as it is on screen this render — the workspace's own
   * copy of the document, not a reading of storage. */
  plan: string;
  refusal: WorktreeRefusal | null;
}

export function PlanWorktreeDialog({
  onCreate,
  onOpened,
  onOpenChange,
  open,
  pending,
  plan,
  refusal,
  repo,
  worktreeRoot,
}: Props) {
  /** What the owner typed into the branch field, or `null` while the offered
   * name still stands. Not seeded from the offer: a piece of state holding a
   * copy of the derived name is a copy that goes stale the moment the plan's
   * title changes, which is the bug one line down from the one this file just
   * had. */
  const [edited, setEdited] = React.useState<string | null>(null);
  const [base, setBase] = React.useState(DEFAULT_BASE);
  /** A worktree that exists whose brief did not. The one outcome that is
   * neither a success to close on nor a refusal that changed nothing. */
  const [partial, setPartial] = React.useState<BriefedOutcome | null>(null);

  // Opening — or a project changing under an open dialog — is what clears the
  // last visit, and nothing else does: a name the owner typed here is his
  // until he leaves, however the plan's title changes underneath it. React's
  // own "adjust state when a prop changes", as in `lib/useDocument.ts`, so the
  // reset lands in this render rather than after a frame showing the previous
  // visit's refusal. Nothing here reads storage; `plan` is the live document.
  const [visit, setVisit] = React.useState({ open, repo: repo.path });
  if (visit.open !== open || visit.repo !== repo.path) {
    setVisit({ open, repo: repo.path });
    setEdited(null);
    setBase(DEFAULT_BASE);
    setPartial(null);
  }

  const offer = planOffer(plan);
  const blocked = planBlocked(offer);
  const branch = edited ?? offer.branch;
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
                className="text-sm text-muted-foreground"
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
                onChange={(event) => setEdited(event.target.value)}
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
                <p className="text-sm text-amber-700 dark:text-amber-400">
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
