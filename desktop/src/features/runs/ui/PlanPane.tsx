// Plan: the second pane on the document substrate, and the one with a verb
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 4).
//
// **Its own document, not a note with a flag.** `documentKey("plan", …)` is a
// different key from `documentKey("notes", …)`, so a project's plan and its
// notes are two documents that neither overwrite nor evict each other, and the
// pane that shows one cannot show the other by accident.
//
// **The pane offers the act; it does not perform it.** The button asks
// `RunsScreen` to open the dialog (`PaneAct`), because what happens next is a
// branch and a directory in the owner's repository, and because the palette is
// a second door onto the same dialog. A pane that made the worktree itself
// would be a second implementation of an act the workspace owns.
//
// The button is never a shortcut past the dialog: the branch name is derived
// from the plan's title and shown in a field the owner can edit, which is the
// difference between offering a name and taking one.

import { documentKey } from "@/features/runs/lib/documents";
import {
  BRIEF_FILE,
  planBlocked,
  planOffer,
} from "@/features/runs/lib/planBrief";
import { useDocument } from "@/features/runs/lib/useDocument";
import { DocumentEditor } from "@/features/runs/ui/DocumentEditor";
import { Button } from "@/shared/ui/button";

interface Props {
  /** The project this plan belongs to, by its path on disk. `null` only on a
   * surface with no project; the pane's availability rule refuses that first. */
  projectPath: string | null;
  /** Open the dialog that turns this plan into a worktree. */
  onTurnIntoWorktree: () => void;
}

export function PlanPane({ onTurnIntoWorktree, projectPath }: Props) {
  const doc = useDocument(
    projectPath === null ? null : documentKey("plan", projectPath),
  );
  // Read from what is on screen, not from storage: the title the owner has
  // just typed is the title the button should be about, and storage is a
  // debounce behind it.
  const offer = planOffer(doc.text);
  const blocked = planBlocked(offer);

  return (
    <DocumentEditor
      doc={doc}
      placeholder="the plan for this project — markdown. Its first line is the title, and the branch is offered from it."
      scope={
        projectPath === null
          ? "no project"
          : `the plan for ${projectPath}, kept in this app on this machine — it reaches a checkout only when you open a worktree from it.`
      }
      testId="plan"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button
            data-testid="plan-to-worktree"
            disabled={blocked !== null}
            onClick={onTurnIntoWorktree}
            size="sm"
            type="button"
            variant="secondary"
          >
            Turn this plan into a worktree…
          </Button>
          {blocked === null && offer.branch !== "" ? (
            <span
              className="truncate font-mono text-2xs text-muted-foreground"
              data-testid="plan-branch-offer"
            >
              {offer.branch}
            </span>
          ) : null}
        </div>
        <p className="text-2xs text-muted-foreground/80" data-testid="plan-act">
          {blocked ??
            `a new branch, checked out under this project, with this plan copied in as ${BRIEF_FILE}. The name is offered, and you can change it before anything is created.`}
        </p>
      </div>
    </DocumentEditor>
  );
}
