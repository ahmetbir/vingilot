// The workspace's one navigation column: the projects on this machine, and
// under the open one its worktrees
// (vingilot/docs/plans/2026-08-11-one-column-design.md). It replaces the two
// columns this screen used to put side by side — a 192px project list and a
// 224px worktree list — with one 224px column, one border and one scroller.
// The 192px that went is the work surface's now.
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
// guarded assertions: `projects-nav` is this column, `worktree-column` is the
// disclosed subtree inside it (`ui/WorktreeDisclosure.tsx`),
// `worktree-column-rail` / `-expand` / `-collapse` are the whole column's
// collapse now rather than one project's.
//
// **Collapsed it is a rail, never nothing** (`lib/useColumns.ts` owns the flag
// and its ⇧⌘B binding, per project). A collapsed column plus a shortcut the
// owner has to remember is a trap, so the rail carries the way back *and* one
// dot per project: collapsing the nav must not destroy the answer to "which
// project needs me".
//
// **What a rail dot does, and the one case that is not obvious.** Clicking
// *another* project's dot selects it — the whole work surface changes to that
// project, which is the visible answer — and whether the column then opens is
// that project's own remembered flag. It is not forced open: the flag is per
// project, and overriding it here would throw away a collapse the owner asked
// for in the project he is entering. The design doc said "and expands the
// column" for every dot; §2.5 and §6.3 now record this narrowing and why.
// Clicking the *selected* project's dot is the case that would otherwise be a
// dead button — selection is already where it points, and `selectRepo` is
// idempotent — so it expands the column instead. That is not overriding a
// remembered flag with a guess; it is the owner asking, now, for the column of
// the project he is standing in, which is the only thing that gesture can
// mean.
//
// **Collapsing must not silence a refusal.** Everything that reports project
// state — the store notice, the add/remove error, the two notices — lives in
// the expanded branch, and so does the worktree-action refusal panel, one
// component further down in `ui/WorktreeDisclosure.tsx`; ⇧⌘B unmounts all of
// it. The palette can still reach `action:add-project` *and*
// `action:prune-worktrees` while the nav is a rail, so their refusals were
// being raised into components that were not on screen. The rail therefore
// carries a `!` mark whenever there is a refusal to read
// (`nav-rail-refusal`), and all three refusal sources feed it — `storeNotice`,
// `error`, `actions.refusal`. Its accessible name *is* the sentence, and
// clicking it opens the column the sentence is written in. A rail showing a bare `0` and no dots because the
// project list could not be read is "nothing there" standing in for "no
// answer", which is the one reading this repo forbids. The two informational
// notices get no mark: they are said once at start-up rather than in answer to
// something the owner just did, and they are still there to read when the
// column opens.
//
// **All four dialogs live outside the rail/column branch**, on purpose:
// collapsing the column while a confirm is open must not take the confirm with
// it. Three of them are opened from two doors each — the column's buttons and
// the palette — so their state is `RunsScreen`'s and there is exactly one
// instance of each. The fourth, the remove-worktree confirm, is held here: it
// has no second door, and `WorktreeDisclosure` (which raises it) unmounts when
// the column collapses.
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
import {
  type RemovableWorktree,
  removeWorktreeConfirm,
} from "@/features/runs/lib/worktreePlan";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";
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
  /** True while this column is a rail. Collapsing takes nothing from the
   * *workspace* — the worktrees are still open, still running, still selected —
   * and nothing from the nav's own state either: the filter, the fold and the
   * four dialogs are all held above the rail/column branch precisely so that
   * ⇧⌘B hides them rather than destroying them. What it does unmount is the
   * DOM of the expanded column. */
  collapsed: boolean;
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
  onToggleCollapsed: () => void;
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
  worktreeRoot: string | null;
  /** The open project's worktrees, ordered by `orderWorktrees`. */
  worktrees: Worktree[];
}

/** The column when it is collapsed: a rail whose job is to be the way back and
 * to keep answering "which project needs me" — and, when there is one, that
 * there is a refusal to read — while it is the only thing on screen. */
function CollapsedRail({
  onExpand,
  onSelectRepo,
  refusal,
  repoMarks,
  repos,
  selectedRepoId,
}: {
  onExpand: () => void;
  onSelectRepo: (id: string) => void;
  /** The refusal sentences the expanded column would be showing, joined, or
   * `null` when there are none. See the file header. */
  refusal: string | null;
  repoMarks: Readonly<Record<string, AttentionMark>>;
  repos: Repo[];
  selectedRepoId: string | null;
}) {
  return (
    <div
      className="flex min-h-0 w-9 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/60 py-3"
      data-testid="worktree-column-rail"
    >
      <button
        aria-label="show the projects"
        className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        data-testid="worktree-column-expand"
        onClick={onExpand}
        title="Show projects and worktrees (⇧⌘B)"
        type="button"
      >
        ›
      </button>
      {refusal === null ? null : (
        // The sentence is the accessible name rather than a generic "there is
        // a problem": a mark that says only that it exists is one more thing
        // to go and look up. Clicking opens the column, which is where the
        // sentence is written out and dismissible.
        <button
          aria-label={refusal}
          className="shrink-0 rounded-md px-1.5 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10"
          data-testid="nav-rail-refusal"
          onClick={onExpand}
          title={refusal}
          type="button"
        >
          !
        </button>
      )}
      {repos.map((repo) => {
        const mark = repoMarks[repo.id] ?? NO_MARK;
        const selected = repo.id === selectedRepoId;
        return (
          <button
            aria-label={
              mark.sentence === ""
                ? repo.name
                : `${repo.name} — ${mark.sentence}`
            }
            className={`flex shrink-0 items-center justify-center rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/60 ${
              selected ? "bg-muted" : ""
            }`}
            data-testid={`nav-rail-repo-${repo.id}`}
            key={repo.id}
            // The dot of the project you are already in has nothing to select,
            // so it opens the column instead. See the file header.
            onClick={selected ? onExpand : () => onSelectRepo(repo.id)}
            title={
              selected
                ? `Show ${repo.name}'s worktrees (⇧⌘B)`
                : `Open ${repo.name}`
            }
            type="button"
          >
            <AttentionDot mark={mark} />
          </button>
        );
      })}
      <span
        aria-hidden="true"
        className="shrink-0 text-2xs tabular-nums text-muted-foreground/70"
      >
        {repos.length}
      </span>
    </div>
  );
}

export function WorkspaceNav({
  actions,
  collapsed,
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
  onToggleCollapsed,
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
  // in `WorktreeDisclosure`, for exactly one reason: this component renders in
  // both the rail and the column states and the disclosure renders in only one
  // of them, so state kept down there is destroyed by ⇧⌘B. The two-column
  // build kept both across a collapse — `WorktreeColumn` was the component
  // that chose between rail and column, so it stayed mounted — and losing that
  // silently is the regression this lift undoes.
  //
  // A project switch still clears them, which is the other half of the same
  // guarantee: a filter typed against one project's branches means nothing
  // against another's. Adjusted during the render that brings the new project
  // in rather than in an effect, so the column is never painted once showing
  // the previous project's query. This is `WorktreeColumn`'s `scope` reset,
  // moved rather than reinvented — so the key is `selectedRepoId` and nothing
  // else. Folding `collapsed` into it would make ⇧⌘B the reset this lift exists
  // to undo, and both pieces clear together: a filter and a fold are two
  // readings of the same list.
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const [scope, setScope] = React.useState(selectedRepoId);
  if (scope !== selectedRepoId) {
    setScope(selectedRepoId);
    setQuery("");
    setExpanded(false);
  }

  // What the expanded column would be showing that the owner asked for and did
  // not get. Joined rather than ranked: all three can hold at once (an
  // unreadable list is also why a save failed) and a rail has room for one mark
  // either way. The informational notices are deliberately not here — the
  // header says why.
  //
  // `actions.refusal` is the third because it is a refusal with exactly the
  // same collapsed-state hole as the other two, and its only panel
  // (`worktree-column-refusal`) is inside `WorktreeDisclosure`, which ⇧⌘B
  // unmounts. The palette reaches `action:prune-worktrees` while the nav is a
  // rail — nothing in `paletteSources.ts` blocks it on `navCollapsed` — so git
  // refusing that prune raised a sentence into a component that was not on
  // screen. Not suppressed while `creating`, unlike the panel: that suppression
  // exists because `NewWorktreeDialog` prints the same sentence in the same
  // place, and a `!` behind a modal overlay is not a second copy of it.
  const railRefusal =
    [storeNotice, error, actions.refusal?.message ?? null]
      .filter((line) => line !== null)
      .join(" ") || null;

  return (
    <>
      {collapsed ? (
        <CollapsedRail
          onExpand={onToggleCollapsed}
          onSelectRepo={onSelectRepo}
          refusal={railRefusal}
          repoMarks={repoMarks}
          repos={repos}
          selectedRepoId={selectedRepoId}
        />
      ) : (
        <div
          className="flex min-h-0 w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/60 px-2 py-3"
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
            <button
              aria-label="hide the projects"
              className="shrink-0 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="worktree-column-collapse"
              onClick={onToggleCollapsed}
              title="Hide projects and worktrees (⇧⌘B)"
              type="button"
            >
              ‹
            </button>
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
      )}

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
