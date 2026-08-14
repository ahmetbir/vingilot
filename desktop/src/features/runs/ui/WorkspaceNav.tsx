// The workspace's one navigation tree: the projects on this machine, and
// under the open one its worktrees
// (vingilot/docs/plans/2026-08-11-one-column-design.md). It replaced the two
// columns this screen used to put side by side — a 192px project list and a
// 224px worktree list — with one column; the single-sidebar rework
// (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2) then moved that
// column out of the work surface's row entirely: it renders inside
// `AppSidebar`'s contextual region now, portalled there by `RunsScreen`
// through `shared/lib/sidebarNavSlot.ts`, so the whole width it used to spend
// beside the surface is the surface's.
//
// **A tree, not a drill-in.** There is no back button because you never left:
// every project keeps its row and its rollup attention dot while you work
// inside one of them. This workspace runs agents in several worktrees across
// several projects at once, and the dots on the *other* projects are the whole
// triage story — a view that hid them would answer fewer questions in more
// space. Selection is disclosure; `ui/ProjectRow.tsx` says why.
//
// **Two mark shapes, deliberately not merged.** `repoMarks` is a `Record` by
// repo id and `worktreeMarks` is a `Map` by binding id. Both come from the one
// `useMemo` in `lib/useWorktreeSignals.ts` and neither is recomputed here — a
// second derivation is how two dots come to disagree about the same worktree.
// Conflating the two types blanks every dot without failing anything.
//
// **Test ids are a test vocabulary, not a description of the DOM.** They are
// kept verbatim rather than renamed, because renaming buys nothing and costs
// guarded assertions: `projects-nav` is this tree, `worktree-column` is the
// disclosed subtree inside it (`ui/WorktreeDisclosure.tsx`). The rail's ids
// (`worktree-column-rail` / `-expand` / `-collapse`, `nav-rail-*`) are gone
// with the rail itself — see below.
//
// **The rail is retired with the second sidebar.** This tree used to collapse
// to a 36px rail on its own chord (⇧⌘B) — two independently-collapsible
// sidebars side by side, each with its own way back, was exactly the
// redundancy the single-sidebar rework removed. Living inside `AppSidebar`,
// the tree now collapses with the sidebar it is part of (⌘B, upstream's own
// `SidebarProvider`), and the refusal-visibility work the rail carried
// (`nav-rail-refusal`, the per-project dots at 36px) went with it: every
// refusal panel is in the one branch that exists now, on screen whenever the
// sidebar is. The per-project remembered nav-collapse flag was discarded, not
// migrated — the safe direction is starting expanded, the same reasoning the
// v1→v2 storage discard used (2026-08-11-one-column-design.md §3).
//
// **All four dialogs live outside the tree's own markup**, on purpose: they
// are portalled surfaces, and three of them are opened from two doors each —
// the tree's buttons and the palette — so their state is `RunsScreen`'s and
// there is exactly one instance of each. The fourth, the remove-worktree
// confirm, is held here: it has no second door.
//
// Projects are added and forgotten from here
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 4). The confirm before
// a removal is a deliberate interruption and its exact words are a tested
// promise (`lib/repoChoice.ts`'s `removeProjectConfirm`): **removing forgets a
// path.** Nothing in this feature deletes, moves, or writes anything inside a
// project directory.

import * as React from "react";

import {
  type AttentionMark,
  NO_MARK,
} from "@/features/runs/lib/attentionSignal";
import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { removeProjectConfirm } from "@/features/runs/lib/repoChoice";
import type { WorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import type { WorktreeStats } from "@/features/runs/lib/useWorktreeStats";
import type { WorktreeOverlap } from "@/features/runs/lib/worktreeOverlap";
import {
  type RemovableWorktree,
  removeWorktreeConfirm,
} from "@/features/runs/lib/worktreePlan";
import { NewWorktreeDialog } from "@/features/runs/ui/NewWorktreeDialog";
import { ProjectRow } from "@/features/runs/ui/ProjectRow";
import { PruneWorktreesDialog } from "@/features/runs/ui/PruneWorktreesDialog";
import { WorktreeDisclosure } from "@/features/runs/ui/WorktreeDisclosure";
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

interface WorkspaceNavProps {
  actions: WorktreeActions;
  /** The project whose removal is being confirmed, held by the screen because
   * the palette is a second door to this same confirm. */
  confirming: Repo | null;
  /** Not dismissible by design: a coordinator holding a list this machine has
   * never taken is a state, not an event. */
  coordinatorNotice: string | null;
  /** The two worktree dialogs below are held by the screen rather than here,
   * because the palette is a second door to both. One state each, so whichever
   * door the owner came through he gets the same dialog. */
  creating: boolean;
  /** The last add/remove refusal, in words the owner can act on. */
  error: string | null;
  /** Said once, after this machine's list was seeded from a coordinator.
   * Deliberately not error-styled: an import is a thing that went right. */
  importNotice: string | null;
  onAddProject: () => void;
  onConfirmingChange: (repo: Repo | null) => void;
  onCreatingChange: (creating: boolean) => void;
  onDismissError: () => void;
  onDismissImportNotice: () => void;
  onOpenPrune: () => void;
  onPrunePreviewChange: (preview: string[] | null) => void;
  onRemoveProject: (repo: Repo) => void;
  /** The only route back to the project-less home once a project is
   * selected — `selectedRepoId` has no other path to `null` short of
   * forgetting the project you are standing in. */
  onSelectLanding: () => void;
  onSelectRepo: (id: string) => void;
  onSelectWorktree: (bindingId: string) => void;
  /** True while an add, a remove or a prune is in flight. */
  pending: boolean;
  /** git's own dry run of `worktree prune`, or `null` for a closed dialog. */
  prunePreview: string[] | null;
  /** The rollup of each project's worktrees, by repo id — a `Record`. */
  repoMarks: Readonly<Record<string, AttentionMark>>;
  repos: Repo[];
  /** The open project, or `null` on the landing view. Everything that needs a
   * non-null `Repo` lives in the disclosure, which only mounts with one. */
  selectedRepo: Repo | null;
  /** `null` when on the project-less landing view, which highlights Deck. */
  selectedRepoId: string | null;
  selectedWorktreeId: string | null;
  stats: WorktreeStats;
  /** This machine's list could not be read at all. Rendered above the others
   * and above the list itself, because while it holds the rows below are not
   * this machine's projects. */
  storeNotice: string | null;
  /** The attention mark per binding id — a `Map`. See the header. */
  worktreeMarks: ReadonlyMap<string, AttentionMark>;
  /** The cross-worktree overlap per binding id — a second, independent signal
   * that is passed straight through to the disclosure. It is not rolled up
   * onto the rail's project marks: a rollup answers "which project needs me",
   * and an overlap is not a thing that needs him
   * (`lib/worktreeOverlap.ts`). */
  worktreeOverlaps: ReadonlyMap<string, WorktreeOverlap>;
  worktreeRoot: string | null;
  /** The open project's worktrees, ordered by `orderWorktrees`. */
  worktrees: Worktree[];
}

export function WorkspaceNav({
  actions,
  confirming,
  coordinatorNotice,
  creating,
  error,
  importNotice,
  onAddProject,
  onConfirmingChange,
  onCreatingChange,
  onDismissError,
  onDismissImportNotice,
  onOpenPrune,
  onPrunePreviewChange,
  onRemoveProject,
  onSelectLanding,
  onSelectRepo,
  onSelectWorktree,
  pending,
  prunePreview,
  repoMarks,
  repos,
  selectedRepo,
  selectedRepoId,
  selectedWorktreeId,
  stats,
  storeNotice,
  worktreeMarks,
  worktreeOverlaps,
  worktreeRoot,
  worktrees,
}: WorkspaceNavProps) {
  const projectConfirm =
    confirming === null ? null : removeProjectConfirm(confirming);
  // The remove-worktree target. Held here rather than in the disclosure that
  // raises it: the disclosure unmounts when this column collapses, and a
  // confirm that vanishes with the column is a question the owner never got to
  // answer. Not lifted to `RunsScreen` either — the palette is not a second
  // door to this one, and lifting state without a reason is how that component
  // grows.
  const [removing, setRemoving] = React.useState<RemovableWorktree | null>(
    null,
  );
  const worktreeConfirm =
    removing === null ? null : removeWorktreeConfirm(removing);

  // The disclosed list's branch filter and its quiet-rows fold. Held here, not
  // in `WorktreeDisclosure`, so that the disclosure's own mount/unmount (a
  // fold, a re-render of the tree) cannot destroy them.
  //
  // A project switch clears them: a filter typed against one project's
  // branches means nothing against another's. Adjusted during the render that
  // brings the new project in rather than in an effect, so the tree is never
  // painted once showing the previous project's query. This is
  // `WorktreeColumn`'s `scope` reset, moved rather than reinvented — the key
  // is `selectedRepoId` and nothing else, and both pieces clear together: a
  // filter and a fold are two readings of the same list.
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const [scope, setScope] = React.useState(selectedRepoId);
  if (scope !== selectedRepoId) {
    setScope(selectedRepoId);
    setQuery("");
    setExpanded(false);
  }

  return (
    <>
      <div
        className="flex w-full flex-col gap-1 px-2 pb-2"
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

        {/* The column's one visible heading. The project name is the row the
         * owner clicked, and repeating it as a second heading 24px lower
         * would be the nested chrome this merge exists to remove — inside
         * the disclosure it is `sr-only` instead. */}
        <div className="mt-2 flex items-center gap-1 px-2">
          <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Projects
            <span className="text-muted-foreground/60">{repos.length}</span>
          </h2>
        </div>

        {storeNotice === null ? null : (
          <div
            className="mt-1 rounded-lg border border-border bg-muted/60 px-2 py-1.5"
            data-testid="projects-nav-store-notice"
          >
            <p className="text-sm text-foreground">{storeNotice}</p>
          </div>
        )}

        {repos.length === 0 ? (
          // Silent while the store is unreadable: "no projects yet" is the
          // sentence a fresh install shows, and it is exactly the wrong one
          // for a list that could not be opened. The notice above says what
          // is true instead.
          storeNotice !== null ? null : (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              no projects yet
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-0.5">
            {repos.map((repo) => (
              <ProjectRow
                disclosure={
                  selectedRepo !== null && selectedRepo.id === repo.id ? (
                    <WorktreeDisclosure
                      actions={actions}
                      creating={creating}
                      expanded={expanded}
                      onCreatingChange={onCreatingChange}
                      onExpandedChange={setExpanded}
                      onOpenPrune={onOpenPrune}
                      onQueryChange={setQuery}
                      onRemoveWorktree={setRemoving}
                      onSelectWorktree={onSelectWorktree}
                      query={query}
                      repo={selectedRepo}
                      selectedWorktreeId={selectedWorktreeId}
                      stats={stats}
                      worktreeMarks={worktreeMarks}
                      worktreeOverlaps={worktreeOverlaps}
                      worktreeRoot={worktreeRoot}
                      worktrees={worktrees}
                    />
                  ) : null
                }
                key={repo.id}
                mark={repoMarks[repo.id] ?? NO_MARK}
                onRemove={onConfirmingChange}
                onSelect={onSelectRepo}
                pending={pending}
                repo={repo}
                selected={repo.id === selectedRepoId}
              />
            ))}
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
      </div>

      {selectedRepo === null ? null : (
        <NewWorktreeDialog
          onCreate={actions.create}
          onOpenChange={onCreatingChange}
          open={creating}
          pending={actions.pending}
          refusal={actions.refusal}
          repo={selectedRepo}
          worktreeRoot={worktreeRoot}
        />
      )}

      <PruneWorktreesDialog
        onConfirm={() => {
          onPrunePreviewChange(null);
          void actions.prune();
        }}
        onOpenChange={() => onPrunePreviewChange(null)}
        pending={actions.pending}
        preview={prunePreview}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={removing !== null}
      >
        <AlertDialogContent data-testid="worktree-remove-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{worktreeConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {worktreeConfirm?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="worktree-remove-confirm-action"
              onClick={() => {
                if (removing !== null) actions.remove(removing);
                setRemoving(null);
              }}
            >
              {worktreeConfirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) onConfirmingChange(null);
        }}
        open={confirming !== null}
      >
        <AlertDialogContent data-testid="projects-nav-remove-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{projectConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {projectConfirm?.body}
            </AlertDialogDescription>
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
              {projectConfirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
