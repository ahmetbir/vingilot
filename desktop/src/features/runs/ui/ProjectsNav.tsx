// The Projects screen's leftmost column: pick a project (a repo from this
// machine's own list, see `lib/useLocalProjects.ts`) or fall back to the
// project-less landing view (the Deck). Mirrors RunList's "+ New run" row
// style — this replaces RunList as the screen's front door; RunList itself
// moves into WorkSurface's Runs tab (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md).
//
// It is also where projects are added and forgotten
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 4). That used to mean
// a compare-and-set write into the coordinator's workspace document, which is
// why a machine with no coordinator could not add a project at all
// (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 1); it now
// means a line in a file on this machine. The confirm before
// a removal is a deliberate interruption and its exact words are a tested
// promise (`lib/repoChoice.ts`'s `removeProjectConfirm`): **removing forgets
// a path.** Nothing in this feature deletes, moves, or writes anything inside
// a project directory.

import {
  type AttentionMark,
  NO_MARK,
} from "@/features/runs/lib/attentionSignal";
import type { Repo } from "@/features/runs/lib/projects";
import { removeProjectConfirm } from "@/features/runs/lib/repoChoice";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";
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

interface ProjectsNavProps {
  repos: Repo[];
  /** The strongest attention state among each project's worktrees, by repo id
   * (`lib/attentionSignal.ts`'s `rollupMark`). This column is where the owner
   * looks when he is not standing in a project, so it has to answer "which one
   * needs me" from here — with the same derivation the worktree rows use, never
   * a second one. A repo with no entry has had nothing answered about it and
   * draws no dot. */
  marks: Readonly<Record<string, AttentionMark>>;
  /** `null` when on the project-less landing view. */
  selectedRepoId: string | null;
  onSelectRepo: (id: string) => void;
  /** The only route back to the project-less home once a project is
   * selected — `selectedRepoId` has no other path to `null` short of
   * forgetting the project you are standing in. */
  onSelectLanding: () => void;
  onAddProject: () => void;
  onRemoveProject: (repo: Repo) => void;
  /** True while an add or a remove is in flight. */
  pending: boolean;
  /** Said once, after this machine's list was seeded from a coordinator
   * (`lib/localProjects.ts`'s `importNotice`). It is not an error and does not
   * look like one: an import is a thing that went right, and the reason it is
   * on screen at all is that a silent one is indistinguishable from a silent
   * loss when it goes wrong. */
  importNotice: string | null;
  onDismissImportNotice: () => void;
  /** A coordinator holding a list this machine has never taken, against a list
   * started here (`lib/localProjects.ts`'s `unreconciledNotice`). Not
   * dismissible: it is a state rather than an event, and the sentence names
   * the act that ends it. */
  coordinatorNotice: string | null;
  /** The last refusal, in words the owner can act on. */
  error: string | null;
  onDismissError: () => void;
  /** The project whose removal is being confirmed, held by the screen rather
   * than here because the palette is a second door to this same confirm — and
   * a second confirm would be a second set of words for an act whose exact
   * words are a tested promise (`lib/repoChoice.ts`). */
  confirming: Repo | null;
  onConfirmingChange: (repo: Repo | null) => void;
}

export function ProjectsNav({
  confirming,
  coordinatorNotice,
  error,
  importNotice,
  onAddProject,
  onConfirmingChange,
  marks,
  onDismissError,
  onDismissImportNotice,
  onRemoveProject,
  onSelectLanding,
  onSelectRepo,
  pending,
  repos,
  selectedRepoId,
}: ProjectsNavProps) {
  const confirm = confirming === null ? null : removeProjectConfirm(confirming);

  return (
    <div
      className="flex min-h-0 w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/60 px-2 py-3"
      data-testid="projects-nav"
    >
      <button
        className={`rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors ${
          selectedRepoId === null
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60"
        }`}
        data-testid="projects-nav-landing"
        onClick={onSelectLanding}
        type="button"
      >
        Deck
      </button>

      <h2 className="mt-2 flex items-center gap-1.5 px-2 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Projects
        <span className="text-muted-foreground/60">{repos.length}</span>
      </h2>

      {repos.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">
          no projects yet
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {repos.map((repo) => {
            const mark = marks[repo.id] ?? NO_MARK;
            return (
              <li className="group flex items-center gap-0.5" key={repo.id}>
                <button
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    repo.id === selectedRepoId
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                  data-testid={`projects-nav-repo-${repo.id}`}
                  onClick={() => onSelectRepo(repo.id)}
                  title={
                    mark.sentence === ""
                      ? repo.path
                      : `${repo.path} — ${mark.sentence}`
                  }
                  type="button"
                >
                  <AttentionDot mark={mark} />
                  <span className="min-w-0 flex-1 truncate">{repo.name}</span>
                </button>
                <button
                  aria-label={`remove ${repo.name}`}
                  className="shrink-0 rounded px-1 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  data-testid={`projects-nav-remove-${repo.id}`}
                  disabled={pending}
                  onClick={() => onConfirmingChange(repo)}
                  title={`Remove ${repo.name} — forgets the path, never touches the folder`}
                  type="button"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        className="mt-1 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        data-testid="projects-nav-add"
        disabled={pending}
        onClick={onAddProject}
        type="button"
      >
        + Add project
      </button>

      {importNotice === null ? null : (
        <div
          className="mt-1 rounded-lg border border-border bg-muted/60 px-2 py-1.5"
          data-testid="projects-nav-import-notice"
        >
          <p className="text-sm text-foreground">{importNotice}</p>
          <button
            className="mt-1 text-xs text-muted-foreground underline transition-colors hover:text-foreground"
            data-testid="projects-nav-import-notice-dismiss"
            onClick={onDismissImportNotice}
            type="button"
          >
            got it
          </button>
        </div>
      )}

      {coordinatorNotice === null ? null : (
        <div
          className="mt-1 rounded-lg border border-border bg-muted/60 px-2 py-1.5"
          data-testid="projects-nav-coordinator-notice"
        >
          <p className="text-sm text-foreground">{coordinatorNotice}</p>
        </div>
      )}

      {error === null ? null : (
        <div
          className="mt-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5"
          data-testid="projects-nav-error"
        >
          <p className="text-sm text-destructive">{error}</p>
          <button
            className="mt-1 text-xs text-muted-foreground underline transition-colors hover:text-foreground"
            data-testid="projects-nav-error-dismiss"
            onClick={onDismissError}
            type="button"
          >
            dismiss
          </button>
        </div>
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) onConfirmingChange(null);
        }}
        open={confirming !== null}
      >
        <AlertDialogContent data-testid="projects-nav-remove-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="projects-nav-remove-confirm-action"
              onClick={() => {
                if (confirming !== null) onRemoveProject(confirming);
                onConfirmingChange(null);
              }}
            >
              {confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
